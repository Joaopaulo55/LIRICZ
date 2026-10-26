"""API HTTP do LIRICz para o PE2LGP (português europeu -> glosas de LGP)."""
import asyncio, hmac, os, resource
from collections import OrderedDict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import pe2lgp_adapter as adapter

TOKEN = os.getenv("LGP_TOKEN", "")
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGIN", "").split(",") if o.strip()]
TIMEOUT = float(os.getenv("LGP_TIMEOUT", "40"))  # o proxy da Vercel espera até 55 s
QUEUE_WAIT = 12  # segundos à espera da vez antes de responder "ocupado"
CACHE_MAX = 200

state = {"ready": False, "error": None, "task": None}
gate = asyncio.Semaphore(1)  # o FreeLing é pesado: um pedido de cada vez
cache: "OrderedDict[str, dict]" = OrderedDict()  # frases repetidas não gastam CPU do plano grátis


async def _load():
    try:
        await run_in_threadpool(adapter.load)
        state["ready"] = True
    except Exception as e:  # mostrado em /health, sem esconder o erro técnico
        state["error"] = f"{type(e).__name__}: {e}"


@asynccontextmanager
async def lifespan(_app):
    state["task"] = asyncio.create_task(_load())  # o servidor responde logo; o tradutor carrega em segundo plano
    yield


app = FastAPI(title="LIRICz LGP", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["content-type", "x-liricz-token"])


class Req(BaseModel):
    text: str = Field(min_length=1, max_length=300)


def _mem_mb():
    try:
        with open("/proc/self/status") as f:
            rss = next(int(l.split()[1]) for l in f if l.startswith("VmRSS:")) / 1024
    except Exception:
        rss = None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # KB no Linux
    return {"current": round(rss, 1) if rss else None, "peak": round(peak, 1)}


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"service": "liricz-lgp", "translator_ready": state["ready"]}


@app.get("/health")
def health():
    adapter.nudge_nlp()  # acorda o servidor NLP (spaCy), se existir
    return {"status": "ok", "translator_ready": state["ready"], "error": state["error"],
            "memory_mb": _mem_mb(), **(adapter.info() if state["ready"] else {"stage": adapter.stage})}


def _auth(x_liricz_token: str) -> None:
    if not TOKEN:
        raise HTTPException(503, "LGP_TOKEN não está configurado no servidor.")
    if not hmac.compare_digest(x_liricz_token.encode(), TOKEN.encode()):
        raise HTTPException(401, "Token inválido.")


@app.post("/reload-dictionary")
async def reload_dictionary(x_liricz_token: str = Header(default="")):
    """O painel chama isto depois de alterar o dicionário: o backend volta a lê-lo sem reiniciar."""
    _auth(x_liricz_token)
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "O tradutor ainda está a carregar.")
    try:
        await asyncio.wait_for(gate.acquire(), timeout=QUEUE_WAIT)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Servidor ocupado. Tenta de novo.")
    try:
        info = await run_in_threadpool(adapter.reload_dictionary)
    except Exception as e:
        raise HTTPException(500, f"Falha ao recarregar o dicionário: {type(e).__name__}: {e}")
    finally:
        gate.release()
    cache.clear()  # as traduções guardadas já não valem com o dicionário novo
    return {"ok": True, **info}


@app.get("/glosses")
async def glosses(x_liricz_token: str = Header(default="")):
    """Lista de glosas conhecidas pelo tradutor (o painel usa-a para procurar e converter em SiGML)."""
    _auth(x_liricz_token)
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "O tradutor ainda está a carregar.")
    g = adapter.glosses()
    return {"count": len(g), "glosses": g}


@app.post("/translate")
async def translate(req: Req, x_liricz_token: str = Header(default="")):
    _auth(x_liricz_token)
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Texto vazio.")
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "O tradutor ainda está a carregar. Tenta daqui a pouco.")

    key = adapter.prepare(text)
    out = cache.get(key)
    if out is None:
        try:
            await asyncio.wait_for(gate.acquire(), timeout=QUEUE_WAIT)
        except asyncio.TimeoutError:
            raise HTTPException(503, "Servidor ocupado. Tenta de novo.")
        try:
            out = await asyncio.wait_for(run_in_threadpool(adapter.translate, text), timeout=TIMEOUT)
        except asyncio.TimeoutError:
            raise HTTPException(504, "A tradução demorou demasiado.")
        except adapter.TranslationError as e:
            raise HTTPException(422, f"O PE2LGP não conseguiu traduzir esta frase ({e}).")
        except Exception as e:
            raise HTTPException(500, f"Falha no PE2LGP: {type(e).__name__}: {e}")
        finally:
            gate.release()
        cache[key] = out
        if len(cache) > CACHE_MAX:
            cache.popitem(last=False)
    else:
        cache.move_to_end(key)

    return {"input": text, "glosses": out["glosses"], "extra": out["extra"], "fallback": bool(out["extra"].get("fallback")),
            "system": "PE2LGP", "language": "LGP (Portugal)",
            "disclaimer": "Tradução para Língua Gestual Portuguesa, não para Língua Gestual Angolana."}
