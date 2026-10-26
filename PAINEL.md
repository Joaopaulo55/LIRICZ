# Painel LIRICz (`/#painel`)

Abre `https://o-teu-site.vercel.app/#painel` e entra com o `ADMIN_TOKEN` (mín. 12 caracteres).

## Variáveis de ambiente

**Vercel** (as marcadas com * são novas ou passam a ser usadas):
- `DATABASE_URL`, `ADMIN_TOKEN`, `LGP_BACKEND_URL`, `LGP_TOKEN` (já existiam)
- `GEMINI_API_KEY` já **não é obrigatória**: a chave cola-se em *Configuração → Chave do Gemini* (fica cifrada na BD com o `ADMIN_TOKEN`). Se existir na Vercel, serve de reserva.
- `GEMINI_TEXT_MODEL` (opcional) fixa o modelo. Sem ele (e com o campo do painel vazio) o painel pergunta à Google e usa sempre o Gemini *flash* mais recente.
- `PG_CA` (opcional) certificado do Aiven.

**Render** (backend Python):
- `LGP_TOKEN` (igual ao da Vercel)
- `DICT_URL`* = `https://o-teu-site.vercel.app/api/lexicon` (o backend junta o dicionário do painel ao incluído)
- `LGP_FALLBACK` (opcional, por defeito `1`): se o PE2LGP falhar, devolve glosas palavra a palavra em vez de erro 422.

As tabelas novas (`lexicon`, `settings`, `events`, `missing`) e as colunas novas de `signs` criam-se sozinhas no primeiro pedido. Os sinais que já tens continuam a funcionar.

## Converter glosas em SiGML (separador Sinais / LGA)
Caixa **“Converter glosas existentes em SiGML”**: junta as glosas do dicionário do painel, as do dicionário LGP incluído no projeto (e partes dos gestos compostos) e a fila sem sinal, e cria o SiGML das que ainda não têm sinal.
1. Palavras compostas (`TER-MUITO`, `MUITO_RICO`): junta os sinais das partes, se existirem (regras).
2. As restantes: a IA descreve a mão/local/movimento num vocabulário fechado (10 glosas por pedido) e o SiGML é montado por regras.
3. Opcional: soletrar com o alfabeto manual o que não der.
Tudo fica **rascunho provisório**. Podes parar e continuar: só converte o que ainda falta.

## O que cada separador faz
- **Visão geral**: estado do backend, sinais, fila, uso da IA, últimos eventos e erros.
- **Sinais**: lista, edita, pré-visualiza no avatar, valida, copia LGP → LGA, apaga.
- **LGA (Angola)**: o mesmo, só para LGA, com importação em lote e passos para palavras que só existem em Angola.
- **Fila**: palavras pedidas sem sinal, por ordem de procura; gerar com IA ou criar à mão.
- **Automático**: alfabeto e dígitos por regras, importação de SiGML em lote, IA para sinais, IA para dicionário.
- **Dicionário**: carregar CSV/TSV, adicionar, ligar/desligar, exportar, sincronizar com o backend.
- **Testar**: frase → glosas → sinais → avatar, com o tipo de cada palavra (sinal, soletrada, número, IA, em falta).
- **Configuração**: modo da IA (desligada / assistente / tempo real), limites, sinais provisórios, expressões faciais e pausas.

## Como cada palavra chega ao avatar
sinal na BD (LGA validado > LGP validado > provisórios) → gesto composto/partes → número (dígito a dígito) → IA em tempo real (só se ligada) → soletrada com o alfabeto manual → em falta.

## Avisos
- O alfabeto/dígitos de arranque e os sinais da IA são **aproximações provisórias**, não língua gestual validada. Aparecem marcados na app até alguém preencher “Validado por”.
- O SiGML e as expressões faciais não foram testados contra o CWASA no ambiente de desenvolvimento (sem rede). Testa no pré-visualizador do painel antes de validar ou de ligar as expressões faciais.
