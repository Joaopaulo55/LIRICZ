# LIRICz — Comunicação sem barreiras

Fase 1 (Android primeiro): voz para texto **online**, texto para voz, personalização local. Sem backend, sem contas, sem chaves.

## Funcionalidades da fase 1
- Conversa: transcrição em tempo real (Web Speech API), texto provisório vs. confirmado, reinício automático, proteção contra duplicados, limpar, ocultar controlos, ecrã inteiro, ecrã ligado (Wake Lock), atalhos (Espaço, Ctrl+L).
- Escrever: mensagem em letras gigantes, leitura em voz alta, frases rápidas editáveis, histórico da sessão.
- Personalizar: 5 perfis + perfis próprios, tamanho/peso/tipo/cor/espaçamento, voz e velocidade, apagar dados.
- PWA instalável (manifest + service worker simples).

## Fora desta fase
Reconhecimento offline, Língua Gestual Angolana (sem conteúdo validado), importação de fontes, regras de emojis, Capacitor/CodeMagic.

## Executar
```
npm install
npm run dev
npm run build
npm test
```
O microfone só funciona em HTTPS (o Vercel já fornece) ou em localhost.

## Deploy no Vercel
Importa o repositório (ou `vercel` na pasta). Framework: Vite. Build: `npm run build`. Output: `dist`. Não são precisas variáveis de ambiente.

## Compatibilidade (a confirmar em dispositivos reais)
| Ambiente | Voz→texto | Notas |
|---|---|---|
| Chrome Android | Esperado (online) | Testar continuidade e duplicados |
| Edge/Chrome Windows | Esperado (online) | |
| Firefox / Safari | Normalmente indisponível | A app avisa |
| WebView/APK | Não verificado | Exige Capacitor + plugin de reconhecimento nativo (fase seguinte) |

## Privacidade
Nenhum áudio ou texto é guardado ou enviado pelo LIRICz. O áudio vai ao serviço de voz do navegador, e a app pede consentimento antes do primeiro uso. Preferências e frases ficam em localStorage.

## Limitações conhecidas
- Sem Internet não há transcrição.
- Não existe motor com pt-AO; só pt-PT e pt-BR.
- Não foi possível executar `npm install`/build no ambiente onde o projeto foi escrito (sem rede): faz `npm run build` antes do deploy.
