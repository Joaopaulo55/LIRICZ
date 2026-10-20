"""Único ponto de ligação ao PE2LGP.

AINDA NÃO LIGADO: falta o código real do PE2LGP (Modulo_tradutor/tradutor.py e server.py).
Quando o tivermos, aqui:
  load()      -> importa e inicializa o tradutor uma vez (FreeLing, spaCy, regras).
  translate() -> chama o tradutor e devolve {"glosses": [str, ...], "extra": {...}}
                 onde "extra" pode ter visemas, pausas, expressões faciais, conforme o PE2LGP devolver.
Não inventamos glosas: enquanto isto não estiver ligado, o servidor responde com erro claro.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "pe2lgp"))


def load() -> None:
    raise NotImplementedError("PE2LGP ainda não está ligado em pe2lgp_adapter.py")


def translate(text: str) -> dict:
    raise NotImplementedError("PE2LGP ainda não está ligado em pe2lgp_adapter.py")
