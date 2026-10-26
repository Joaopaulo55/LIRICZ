"""Único ponto de ligação do LIRICz ao PE2LGP (português europeu -> glosas de LGP).

Layout esperado (copiado do repositório PE2LGP):
    backend/pe2lgp/Modulo_tradutor/            (tradutor.py, regras, gestos_compostos.json, ...)
    backend/pe2lgp/Modulo_construcao_regras/   (freeling.py, Dicionario/, Estatisticas/, Regras_de_traducao/, ...)

O código do PE2LGP usa caminhos relativos ("../Modulo_construcao_regras/...") e assume que o
processo corre dentro de Modulo_tradutor/. Por isso load() faz chdir para lá e NÃO alteramos
nenhum ficheiro do PE2LGP: as correções necessárias (cache do modelo spaCy, silenciar prints,
fallback se o eSpeak falhar) são feitas aqui.
"""
from __future__ import annotations

import contextlib
import ctypes
import functools
import gc
import glob
import io
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(os.getenv("PE2LGP_DIR") or Path(__file__).parent / "pe2lgp").resolve()
TRAD = ROOT / "Modulo_tradutor"
REGRAS = ROOT / "Modulo_construcao_regras"
SPACY_MODEL = "pt_core_news_sm"
DEBUG = os.getenv("LGP_DEBUG") == "1"
AUTO_PERIOD = os.getenv("LGP_AUTO_PERIOD", "1") != "0"
# Modo leve (padrão): o FreeLing arranca SEM deteção de multipalavras e de nomes próprios (não carrega
# locucions.dat nem np.dat). Poupa memória no Render grátis (512 MB). LGP_LITE=0 repõe o comportamento original.
LITE = os.getenv("LGP_LITE", "1") != "0"
# Servidor NLP separado (spaCy). Se NLP_URL estiver definido, este processo NÃO carrega o spaCy (poupa ~270 MB)
# e pede as dependências sintáticas ao outro serviço. Sem NLP_URL, usa o spaCy local como antes.
NLP_URL = os.getenv("NLP_URL", "").strip().rstrip("/")
TOKEN = os.getenv("LGP_TOKEN", "")
# Dicionário editável no painel do LIRICz: o backend junta-o ao dicionario.csv incluído (ver _sync_dictionary).
# Ex.: DICT_URL=https://o-teu-site.vercel.app/api/lexicon  (usa o mesmo LGP_TOKEN)
DICT_URL = os.getenv("DICT_URL", "").strip()
# Se o PE2LGP não conseguir traduzir a frase, devolve glosas palavra-a-palavra em vez de erro 422 (LGP_FALLBACK=0 desliga).
FALLBACK = os.getenv("LGP_FALLBACK", "1") != "0"

_lock = threading.Lock()  # o PE2LGP usa estado global e cwd: um pedido de cada vez
_ctx: dict = {}
_dict_info: dict = {}
_base_rows: list | None = None  # linhas do dicionario.csv original (antes de juntar o do painel)
_lex_cache: tuple | None = None  # (id da lista, mapa palavra->glosa) para o fallback
warnings: list[str] = []  # mostrado em /health
stage = "a iniciar"  # fase do arranque, mostrada em /health (se o processo morrer, a última fase nos logs diz onde)


def _trim() -> None:
    """Devolve ao sistema a memória que o Python já libertou (ajuda a ficar abaixo dos 512 MB)."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001
        pass


def _log(msg: str) -> None:
    """Escreve nos logs do Render a memória usada em cada fase do arranque (para achar onde rebenta os 512 MB)."""
    try:
        with open("/proc/self/status") as f:
            rss = next(int(l.split()[1]) for l in f if l.startswith("VmRSS:")) // 1024
    except Exception:
        rss = -1
    print(f"[lgp] {msg} | RSS={rss} MB", file=sys.stderr, flush=True)


class TranslationError(Exception):
    """O PE2LGP não conseguiu traduzir esta frase (palavra fora do dicionário, estrutura sem regra, ...)."""


# --------------------------------------------------------------------------- arranque
def _find_pyfreeling() -> None:
    try:
        import pyfreeling  # noqa: F401
        return
    except ImportError:
        pass
    for d in glob.glob("/usr/local/share/*/APIs/python3") + glob.glob("/usr/share/*/APIs/python3"):
        if (Path(d) / "pyfreeling.py").exists():
            sys.path.append(d)
            break
    import pyfreeling  # noqa: F401  (se falhar, o erro técnico aparece em /health)


def _cache_spacy() -> None:
    """dependencias.py faz spacy.load() a CADA frase (segundos + centenas de MB). Carregamos uma vez."""
    import spacy

    if getattr(spacy.load, "_liricz_cached", False):
        return
    original = spacy.load

    @functools.lru_cache(maxsize=None)
    def cached(name: str):
        return original(name, disable=["ner"])  # o PE2LGP só usa token.dep_

    def load(name, **_kw):
        return cached(name)

    load._liricz_cached = True  # type: ignore[attr-defined]
    spacy.load = load


# --------------------------------------------------------------------------- spaCy remoto
_nlp_wait = 35.0  # segundos máximos a esperar pelo servidor NLP (maior no arranque, para ele acordar)
_last_nudge = 0.0


def _nlp_parse(text: str) -> dict:
    import json
    import urllib.error
    import urllib.request

    data = json.dumps({"text": text}).encode()
    deadline = time.monotonic() + _nlp_wait
    last: Exception | None = None
    while True:
        req = urllib.request.Request(NLP_URL + "/parse", data=data, headers={"content-type": "application/json", "x-liricz-token": TOKEN})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (502, 503, 504):  # 401/422/500: não adianta repetir
                raise RuntimeError(f"servidor NLP respondeu {e.code}") from e
        except Exception as e:  # noqa: BLE001  (timeout, ligação recusada, ...)
            last = e
        if time.monotonic() + 4 > deadline:
            raise RuntimeError(f"servidor NLP indisponível ({type(last).__name__}: {last})")
        time.sleep(4)


def _install_remote_spacy() -> None:
    """Põe em sys.modules um 'spacy' falso cujo load() devolve um cliente HTTP. O dependencias.py do PE2LGP não muda."""
    import types

    class _Tok:
        __slots__ = ("i", "dep_", "children")

        def __init__(self, i, dep):
            self.i, self.dep_, self.children = i, dep, []

    class _RemoteNlp:
        def __call__(self, text):
            d = _nlp_parse(text)
            toks = [_Tok(i, dep) for i, dep in enumerate(d["deps"])]
            for t, ch in zip(toks, d["children"]):
                t.children = [toks[j] for j in ch]
            return toks

    nlp = _RemoteNlp()
    mod = types.ModuleType("spacy")
    mod.load = lambda *_a, **_k: nlp  # type: ignore[attr-defined]
    sys.modules["spacy"] = mod


def _wake_nlp() -> None:
    """Acorda o servidor NLP em segundo plano (o Render grátis adormece)."""
    def go():
        try:
            import urllib.request
            urllib.request.urlopen(NLP_URL + "/health", timeout=60).read()
        except Exception:  # noqa: BLE001
            pass
    threading.Thread(target=go, daemon=True).start()


def nudge_nlp() -> None:
    """Chamado pelo /health: mantém/acorda o servidor NLP, no máximo uma vez por 2 minutos."""
    global _last_nudge
    if NLP_URL and time.monotonic() - _last_nudge > 120:
        _last_nudge = time.monotonic()
        _wake_nlp()


def _lite_freeling(tradutor) -> None:
    """Faz o load_freeling() do PE2LGP arrancar sem multipalavras/NER, sem alterar ficheiros do PE2LGP."""
    import freeling as fl  # Modulo_construcao_regras/freeling.py

    orig_opts, orig_load = fl.my_maco_options, fl.load_freeling

    def lite_opts(lang, lpath):
        opt = orig_opts(lang, lpath)
        opt.LocutionsFile = ""  # sem multipalavras
        opt.NPdataFile = ""  # sem nomes próprios
        return opt

    def lite_load(_valor):
        return orig_load(False)

    fl.my_maco_options = lite_opts
    fl.load_freeling = lite_load
    tradutor.load_freeling = lite_load  # o tradutor.py importou o nome com "from freeling import ..."


# --------------------------------------------------------------------------- dicionário do painel
_DICT_PATH = REGRAS / "Dicionario" / "dicionario.csv"
_REGEX_CHARS = re.compile(r"[\[\]()*+?|\\^${}.]")  # o PE2LGP mete o lema numa regex sem a escapar


def _sync_dictionary() -> dict:
    """Reescreve dicionario.csv = original + entradas do painel (DICT_URL). Se o painel não responder, fica o original."""
    global _base_rows
    if _base_rows is None:
        _base_rows = [l for l in _DICT_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows, added, err = list(_base_rows), 0, None
    if DICT_URL and TOKEN:
        try:
            url = DICT_URL + ("&" if "?" in DICT_URL else "?") + "format=tsv"
            with urllib.request.urlopen(urllib.request.Request(url, headers={"x-liricz-token": TOKEN}), timeout=25) as r:
                remote = r.read().decode("utf-8")
            seen = set(rows)
            for line in remote.splitlines():
                parts = [x.strip().lower() for x in line.split("\t")]
                if len(parts) != 3 or not all(parts) or _REGEX_CHARS.search(parts[0]) or _REGEX_CHARS.search(parts[1]):
                    continue
                row = "\t".join(parts)
                if row not in seen:
                    seen.add(row)
                    rows.append(row)
                    added += 1
        except Exception as e:  # noqa: BLE001  (painel em baixo: continua com o dicionário original)
            err = f"{type(e).__name__}: {e}"
    _DICT_PATH.write_text("\n".join(rows) + "\n", encoding="utf-8")
    _dict_info.update(base=len(_base_rows), from_panel=added, total=len(rows), error=err, source=DICT_URL or "só o incluído")
    return dict(_dict_info)


def reload_dictionary() -> dict:
    """Volta a ler o dicionário do painel e recarrega as tabelas do PE2LGP, sem reiniciar o servidor."""
    global _lex_cache
    with _lock:
        info = _sync_dictionary()
        if Path.cwd() != TRAD:
            os.chdir(TRAD)
        _ctx["palavras_glosas"], _ctx["freq_dic"] = _ctx["tradutor"].freq_dicionario()
        _lex_cache = None
        info["entries"] = len(_ctx["palavras_glosas"])
    return info


# --------------------------------------------------------------------------- fallback palavra-a-palavra
_STOP = {"o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
         "ao", "aos", "à", "às", "pelo", "pela", "pelos", "pelas", "é", "são", "foi", "era", "ser", "estar", "está", "estão"}


def _lexicon() -> dict:
    global _lex_cache
    pg = _ctx.get("palavras_glosas") or []
    if _lex_cache is None or _lex_cache[0] != id(pg):
        m: dict = {}
        for phrase, lemma, gloss in pg:
            m.setdefault(phrase, gloss)
            m.setdefault(lemma, gloss)
        _lex_cache = (id(pg), m)
    return _lex_cache[1]


def glosses() -> list:
    """Todas as glosas que o tradutor conhece (dicionário + gestos compostos), para o painel as listar."""
    out = set()
    for e in _ctx.get("palavras_glosas") or []:
        if len(e) > 2 and str(e[2]).strip():
            out.add(str(e[2]).strip())
    for k, parts in _compounds().items():
        out.add(k)
        out.update(parts)
    return sorted(out, key=lambda g: g.lower())


def fallback(text: str, reason: str = "") -> dict:
    """Quando o PE2LGP falha: glosas palavra-a-palavra (sem reordenar a frase). Palavras sem entrada ficam como estão
    e o LIRICz soletra-as ou usa a IA. É menos fiel à gramática da LGP, mas o avatar nunca fica parado."""
    lex = _lexicon()
    toks = re.findall(r"\d+(?:[.,]\d+)?|[^\W\d_]+(?:-[^\W\d_]+)*", unicodedata.normalize("NFC", text).lower())
    glosses = [str(lex.get(w) or w).upper().replace(" ", "_") for w in toks if w not in _STOP]
    if not glosses:
        raise TranslationError("Sem palavras para traduzir.")
    n = len(glosses)
    return {
        "glosses": glosses,
        "extra": {"visemes": [], "visemes_aligned": False, "compound_gestures": [False] * n, "pauses": [None] * (n - 1) + ["frase"],
                  "conditional": [False] * n, "facial_expressions": [], "compounds": _compounds(), "fallback": True, "reason": reason[:160]},
    }


def _compounds() -> dict:
    gc = _ctx.get("gestos_compostos") or {}
    gc = gc.get("gestos_compostos", gc) if isinstance(gc, dict) else {}
    return {str(k).upper(): [str(x).upper() for x in v] for k, v in gc.items() if isinstance(v, (list, tuple))}


def load() -> None:
    global stage
    for p in (TRAD / "tradutor.py", REGRAS / "freeling.py"):
        if not p.exists():
            raise FileNotFoundError(
                f"Falta {p.relative_to(ROOT.parent)}. Copia Modulo_tradutor/ e Modulo_construcao_regras/ "
                "do PE2LGP para backend/pe2lgp/ (ver backend/README.md)."
            )
    _log("início do carregamento")
    _find_pyfreeling()
    _log("pyfreeling importado")

    # caminhos absolutos (o PE2LGP acrescenta '../Modulo_construcao_regras', que só resolve com cwd certo)
    if str(TRAD) not in sys.path:
        sys.path.insert(0, str(TRAD))  # antes de REGRAS: ambas têm um geracao_fase.py, vale o do tradutor
    if str(REGRAS) not in sys.path:
        sys.path.append(str(REGRAS))
    os.chdir(TRAD)

    global _nlp_wait
    if NLP_URL:
        stage = "spaCy remoto"
        _install_remote_spacy()
        _wake_nlp()
        _log(f"spaCy remoto: {NLP_URL}")
    else:
        stage = "a carregar spaCy"
        _cache_spacy()
        import spacy

        spacy.load(SPACY_MODEL)  # falha cedo e com mensagem clara se o modelo não estiver instalado
        _trim()
        _log("spaCy carregado")

    import tradutor  # noqa: E402  (módulo do PE2LGP)

    _log("módulo tradutor importado")
    if LITE:
        _lite_freeling(tradutor)
        warnings.append("Modo leve: sem deteção de multipalavras e nomes próprios (LGP_LITE=0 para desligar).")
    stage = "a carregar FreeLing"
    _log("a carregar FreeLing (modo leve)" if LITE else "a carregar FreeLing (completo)")
    try:
        _sync_dictionary()  # junta o dicionário do painel ao original ANTES de o PE2LGP o ler
        _log(f"dicionário: {_dict_info.get('total')} linhas ({_dict_info.get('from_panel')} do painel)")
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Dicionário do painel não carregado ({type(e).__name__}: {e}).")
    result = tradutor.tradutor_main()
    _trim()
    _log("FreeLing + dicionário carregados")
    stage = "a aquecer"
    if not result:
        raise RuntimeError("tradutor_main() não devolveu os modelos do PE2LGP.")
    model, palavras_glosas, freq_dic, negativa_irregular, gestos_compostos = result

    # Visemas dependem de phonemizer + eSpeak. Se falharem, as glosas continuam a funcionar.
    visemes_ok = True
    try:
        out = tradutor.phonemize("olá", language="pt-pt", backend="espeak")
        visemes_ok = bool(str(out).strip())
    except Exception as e:  # noqa: BLE001
        visemes_ok = False
        warnings.append(f"phonemizer/eSpeak indisponível ({type(e).__name__}: {e}); sem visemas.")
    if not visemes_ok:
        tradutor.phonemize = lambda *_a, **_k: ""  # type: ignore[assignment]

    _ctx.update(
        tradutor=tradutor, model=model, palavras_glosas=palavras_glosas, freq_dic=freq_dic,
        negativa_irregular=negativa_irregular, gestos_compostos=gestos_compostos, visemes=visemes_ok,
    )

    # Aquecimento: carrega o que falta (NLTK, regras). Um falhanço aqui não impede o serviço.
    _nlp_wait = 150.0  # no arranque o servidor NLP pode estar a acordar
    try:
        _run("Bom dia.")
        _log("frase de aquecimento OK")
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Frase de aquecimento falhou ({type(e).__name__}): {e}")
    _nlp_wait = 35.0
    _trim()
    stage = "pronto"


def info() -> dict:
    return {"visemes": _ctx.get("visemes", False), "warnings": list(warnings), "lite": LITE, "nlp": NLP_URL or "local", "stage": stage,
            "dictionary": dict(_dict_info), "fallback": FALLBACK}


# --------------------------------------------------------------------------- tradução
_END = re.compile(r"[.!?…]$")


def prepare(text: str) -> str:
    t = unicodedata.normalize("NFC", text)
    t = "".join(ch for ch in t if ch.isprintable() or ch in " \t")
    t = re.sub(r"\s+", " ", t).strip()
    if t and AUTO_PERIOD and not _END.search(t):
        t += "."  # a fala transcrita não traz pontuação; o PE2LGP segmenta frases por ela
    return t


def _truthy(v) -> bool:
    return v is True or str(v).strip().lower() == "true"


def _run(text: str) -> dict:
    t = _ctx["tradutor"]
    if Path.cwd() != TRAD:
        os.chdir(TRAD)
    sink = io.StringIO()
    # o PE2LGP imprime dezenas de linhas de debug por frase; silenciamos (LGP_DEBUG=1 mostra)
    with (contextlib.nullcontext() if DEBUG else contextlib.redirect_stdout(sink)):
        raw = t.translate_sentence(
            _ctx["model"], _ctx["palavras_glosas"], _ctx["freq_dic"], text,
            _ctx["negativa_irregular"], _ctx["gestos_compostos"],
        )
    if not isinstance(raw, dict) or not raw.get("glosas"):
        raise TranslationError("O PE2LGP não devolveu glosas para esta frase.")
    return raw


def shape(raw: dict) -> dict:
    """Converte o dicionário do PE2LGP (chaves em português, 'true'/'false' em texto) para o contrato do LIRICz."""
    glosses = [str(g) for g in raw.get("glosas", [])]
    visemes = [list(v) for v in raw.get("fonemas", [])]

    facial = []
    for key, kinds in (raw.get("exprFaciais") or {}).items():
        try:
            a, b = (int(x) for x in str(key).split("-"))
        except ValueError:
            continue
        # intervalo [início, fim) sobre as glosas, ex.: "4-5" = só a 5.ª glosa
        facial.append({"start": a, "end": b, "types": list(kinds)})
    facial.sort(key=lambda f: (f["start"], -f["end"]))

    pauses = []
    for p in raw.get("pausas", []):
        pauses.append(None if str(p).lower() == "false" else str(p))  # "oracao" | "frase"

    return {
        "glosses": glosses,
        "extra": {
            "visemes": visemes,
            # os visemas vêm do eSpeak sobre o texto, não das glosas: só alinham 1:1 se os tamanhos baterem
            "visemes_aligned": len(visemes) == len(glosses),
            "compound_gestures": [_truthy(v) for v in raw.get("gestos_compostos", [])],
            "pauses": pauses,
            "conditional": [_truthy(v) for v in raw.get("adv_cond", [])],
            "facial_expressions": facial,
            "compounds": _compounds(),
        },
    }


def translate(text: str) -> dict:
    clean = prepare(text)
    if not clean:
        raise TranslationError("Texto vazio.")
    if "tradutor" not in _ctx:
        raise RuntimeError("PE2LGP ainda não foi carregado.")
    with _lock:
        try:
            raw = _run(clean)
        except TranslationError as e:
            if FALLBACK:
                return fallback(clean, str(e))
            raise
        except Exception as e:  # noqa: BLE001  (IndexError/ValueError/KeyError vindos das regras do PE2LGP)
            if DEBUG:
                import traceback
                traceback.print_exc()
            if FALLBACK:
                return fallback(clean, f"{type(e).__name__}: {e}")
            raise TranslationError(f"{type(e).__name__}: {e}") from e
    return shape(raw)
