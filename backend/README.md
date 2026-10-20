# Backend LGP (PE2LGP) — Render grátis

Contrato: `POST /translate` com `{ "text": "..." }` e cabeçalho `X-LIRICZ-TOKEN` → `{ glosses: [...], extra: {...}, language: "LGP (Portugal)" }`. `GET /health` mostra se o tradutor carregou ou o erro.

## Passos
1. Copia o PE2LGP para `backend/pe2lgp/` e liga-o em `pe2lgp_adapter.py` (falta ver o código real).
2. Testa localmente com Docker: `docker build -t liricz-lgp backend && docker run -p 10000:10000 -e LGP_TOKEN=teste liricz-lgp`, depois `curl localhost:10000/health`.
3. No GitHub, o workflow `lgp-image` publica `ghcr.io/<utilizador>/liricz-lgp:latest` (torna o pacote público).
4. No Render: New → Web Service → **Existing image** → esse URL, plano Free. Variáveis: `LGP_TOKEN` (secret).
5. No Vercel: `LGP_BACKEND_URL` (URL do Render, sem barra final) e o mesmo `LGP_TOKEN` (secret).

## Limites do Render grátis
512 MB de RAM e CPU fraco; adormece após ~15 min sem pedidos e o primeiro pedido depois demora (arranque frio, mais o carregamento do FreeLing). O LIRICz chama `GET /api/lgp` ao ativar a função para acordar o servidor. Se o FreeLing não couber em 512 MB, será preciso um plano pago ou uma VPS.

## Avisos
- O PE2LGP traduz para **LGP (Portugal)**, não para LGA. A API e a interface têm de o dizer.
- Verifica as licenças do PE2LGP e do FreeLing (AGPL) antes de publicar o serviço.
- O texto transcrito é enviado a este servidor: a função deve ser opcional e avisar o utilizador.
