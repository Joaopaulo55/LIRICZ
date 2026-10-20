# Backend LGP (PE2LGP) — Render grátis

`POST /translate` com `{ "text": "..." }` e cabeçalho `X-LIRICZ-TOKEN` devolve:

```json
{
  "input": "qual é o teu nome",
  "glosses": ["NOME", "DELE", "QUAL"],
  "extra": {
    "visemes": [["CO","BE"],["CA","CE"]],      "visemes_aligned": false,
    "compound_gestures": [false, true, false],
    "pauses": [null, null, "frase"],            "conditional": [false, false, false],
    "facial_expressions": [{"start":0,"end":3,"types":["olhos_franzidos"]}]
  },
  "system": "PE2LGP", "language": "LGP (Portugal)", "disclaimer": "..."
}
```
`facial_expressions` usa intervalo `[start, end)` sobre `glosses`. `visemes_aligned=false` quer dizer que os visemas não têm o mesmo número de itens que as glosas (vêm do eSpeak sobre o texto): não os associes 1:1 sem verificar.

Erros: `401` token errado · `422` o PE2LGP não sabe traduzir esta frase · `503` a carregar/ocupado/sem `LGP_TOKEN` · `504` demorou demasiado.
`GET /health` mostra `translator_ready`, erro de arranque, avisos e `memory_mb` (atual e pico).

## Passos
1. Copia `Modulo_tradutor/` e `Modulo_construcao_regras/` do PE2LGP para `backend/pe2lgp/` (ver `pe2lgp/LEIAME.txt`).
2. `git push`. O workflow `lgp-image` compila a imagem no GitHub e publica `ghcr.io/<utilizador>/liricz-lgp:latest`. A primeira build demora (compila o FreeLing). Se falhar, o erro diz o quê. Depois, em GitHub → Packages → liricz-lgp → Settings, torna o pacote **público**.
3. Render: New → Web Service → **Existing image** → `ghcr.io/<utilizador>/liricz-lgp:latest`, plano **Free**. Variáveis:

| Nome | Valor |
|---|---|
| `LGP_TOKEN` | segredo longo (`openssl rand -hex 32`) |
| `LGP_TIMEOUT` | opcional, padrão `40` (segundos por tradução) |
| `LGP_AUTO_PERIOD` | opcional, `0` para não juntar "." a frases sem pontuação (padrão `1`) |
| `LGP_DEBUG` | opcional, `1` mostra os prints do PE2LGP nos logs |

   `PORT` é o Render que define. Quando publicares nova imagem, faz **Manual Deploy** no Render (não atualiza sozinho).
4. Vercel (Project → Settings → Environment Variables), depois **Redeploy**:

| Nome | Valor |
|---|---|
| `LGP_BACKEND_URL` | `https://<serviço>.onrender.com` (sem barra final) |
| `LGP_TOKEN` | o mesmo valor do Render |

5. Verifica: `curl https://<serviço>.onrender.com/health` até `translator_ready: true` e vê `memory_mb`.
   Teste: `curl -X POST .../translate -H "content-type: application/json" -H "x-liricz-token: $TOKEN" -d '{"text":"Qual é o teu nome?"}'`

## Teste local
`docker build -t liricz-lgp backend && docker run -p 10000:10000 -e LGP_TOKEN=teste liricz-lgp`

## Se a build falhar
- FreeLing 4.1 não compila ou o URL falha: `--build-arg FREELING_VERSION=4.2` (acrescenta `build-args: FREELING_VERSION=4.2` no workflow).
- "Faltam as bibliotecas": acrescenta-as ao `apt-get install` da imagem final.
- `/health` com `phonemizer/eSpeak indisponível`: as glosas funcionam, só faltam os visemas.

## Limites do Render grátis
512 MB de RAM e CPU fraco; adormece após ~15 min sem pedidos e o primeiro pedido depois demora (arranque frio + carregar FreeLing e spaCy). `GET /api/lgp` no Vercel acorda o servidor. Se aparecer "Out of memory" nos logs do Render, não cabe no plano grátis: plano pago ou VPS.

## Avisos
- O PE2LGP traduz para **LGP (Portugal)**, não para LGA. A API e a interface têm de o dizer.
- Verifica as licenças do PE2LGP e do FreeLing (AGPL) antes de publicar o serviço.
- O texto transcrito é enviado a este servidor (e ao Render): a função deve ser opcional e avisar o utilizador. O servidor não regista o texto.
