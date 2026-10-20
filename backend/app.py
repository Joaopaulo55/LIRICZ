"""API HTTP do LIRICz para o PE2LGP (português europeu -> glosas de LGP)."""
import asyncio, hmac, os
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
import pe2lgp_adapter as adapter

TOKEN = os.getenv("LGP_TOKEN", "")
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGIN", "").split(",") if o.strip()]
app = FastAPI(title="LIRICz LGP")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["content-type", "x-liricz-token"])
gate = asyncio.Semaphore(1)  # o FreeLing é pesado: um pedido de cada vez
state = {"ready": False, "error": None}


class Req(BaseModel):
    text: str = Field(min_length=1, max_length=300)


@app.on_event("startup")
async def startup():
    async def load():
        try:
            await run_in_threadpool(adapter.load)
            state["ready"] = True
        except Exception as e:  # mostrado em /health, sem esconder o erro técnico
            state["error"] = f"{type(e).__name__}: {e}"
    asyncio.create_task(load())  # o servidor responde logo; o tradutor carrega em segundo plano


@app.get("/health")
def health():
    return {"status": "ok", "translator_ready": state["ready"], "error": state["error"]}


@app.post("/translate")
async def translate(req: Req, x_liricz_token: str = Header(default="")):
    if not TOKEN:
        raise HTTPException(503, "LGP_TOKEN não está configurado no servidor.")
    if not hmac.compare_digest(x_liricz_token, TOKEN):
        raise HTTPException(401, "Token inválido.")
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "O tradutor ainda está a carregar. Tenta daqui a pouco.")
    async with gate:
        try:
            out = await asyncio.wait_for(run_in_threadpool(adapter.translate, req.text.strip()), timeout=25)
        except asyncio.TimeoutError:
            raise HTTPException(504, "A tradução demorou demasiado.")
        except Exception as e:
            raise HTTPException(500, f"Falha no PE2LGP: {type(e).__name__}: {e}")
    return {"input": req.text, "glosses": out.get("glosses", []), "extra": out.get("extra", {}),
            "system": "PE2LGP", "language": "LGP (Portugal)",
            "disclaimer": "Tradução para Língua Gestual Portuguesa, não para Língua Gestual Angolana."}
