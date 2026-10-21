"""Servidor NLP do LIRICz: só o spaCy (dependências sintáticas) para o PE2LGP. Cabe nos 512 MB do Render grátis."""
import hmac
import os
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

TOKEN = os.getenv("LGP_TOKEN", "")
state = {"nlp": None, "error": None}
lock = threading.Lock()  # o spaCy 2.x não é seguro entre threads


def _load():
    try:
        import spacy

        state["nlp"] = spacy.load("pt_core_news_sm", disable=["ner"])  # o PE2LGP só usa token.dep_
    except Exception as e:  # noqa: BLE001
        state["error"] = f"{type(e).__name__}: {e}"


threading.Thread(target=_load, daemon=True).start()  # a porta abre logo; o modelo carrega em segundo plano
app = FastAPI(title="LIRICz NLP")


class Req(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"service": "liricz-nlp", "ready": state["nlp"] is not None}


@app.get("/health")
def health():
    return {"status": "ok", "ready": state["nlp"] is not None, "error": state["error"]}


@app.post("/parse")
def parse(req: Req, x_liricz_token: str = Header(default="")):
    if not TOKEN:
        raise HTTPException(503, "LGP_TOKEN não está configurado.")
    if not hmac.compare_digest(x_liricz_token.encode(), TOKEN.encode()):
        raise HTTPException(401, "Token inválido.")
    nlp = state["nlp"]
    if nlp is None:
        raise HTTPException(503, state["error"] or "O modelo ainda está a carregar.")
    with lock:
        doc = nlp(req.text)
        return {"deps": [t.dep_ for t in doc], "children": [[c.i for c in t.children] for t in doc]}
