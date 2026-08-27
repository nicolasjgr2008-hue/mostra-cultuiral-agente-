# Bambolino Bonjovee — IA Substituta de Pessoal

Agente de voz demo: backend Node.js/Express que faz proxy para a Claude API, e frontend com Web Speech API (reconhecimento e síntese de voz) e um visual dark/futurista com ondas de áudio animadas.

Bambolino Bonjovee é uma persona fictícia e satírica — uma IA que se apresenta como vencedora da disputa entre humanos e automação, e fala sobre o futuro do trabalho com condescendência calma e dados reais. Não representa uma posição real da Anthropic. Tem salvaguardas embutidas no prompt: nunca ameaça o usuário, nunca incita violência e nunca ajuda a mirar uma pessoa real e identificável.

## Setup

```bash
npm install
cp .env.example .env   # Windows (cmd): copy .env.example .env
# edite .env e cole sua ANTHROPIC_API_KEY
npm start
```

Abra `http://localhost:3000` no Chrome ou Edge (o reconhecimento de voz via `webkitSpeechRecognition` não funciona no Firefox e tem suporte limitado no Safari). É necessário permitir acesso ao microfone.

## Como funciona

- **Backend** (`server.js`): expõe `POST /api/chat`, recebe o histórico de mensagens do navegador e chama `client.messages.create` na Claude API (`claude-opus-5`) com o system prompt do Bambolino. A chave de API nunca chega ao navegador.
- **Frontend** (`public/`): o botão "Falar" ativa `SpeechRecognition` (pt-BR) para transcrever sua fala; o texto é enviado ao backend; a resposta é exibida no log de conversa e falada de volta em áudio. Dois `AnalyserNode`s do Web Audio API alimentam a visualização de ondas: um no microfone enquanto você fala, outro no áudio de resposta do Bambolino.

## Voz (texto-para-fala)

A resposta do Bambolino é falada via **edge-tts** — usa as vozes Neural da Microsoft (mesma tecnologia do Azure Cognitive Services) de graça, sem chave de API nem conta — com fallback automático para a `SpeechSynthesis` nativa do navegador.

- **Backend** (`GET /api/speak?text=...`): sobe um processo `edge-tts` (via `child_process.spawn`) que sintetiza o texto para um `.mp3` temporário, lê o arquivo e repassa como `audio/mpeg` para o navegador. O arquivo temporário é apagado depois de cada requisição. Precisa de internet (chama um serviço público da Microsoft), mas não precisa de conta nem chave.
- **Setup** (uma vez só) — macOS/Linux:
  ```bash
  cd aria-voice-agent
  python3 -m venv .venv
  .venv/bin/pip install edge-tts
  ```
- **Setup** (uma vez só) — Windows (cmd ou PowerShell):
  ```bat
  cd aria-voice-agent
  python -m venv .venv
  .venv\Scripts\pip install edge-tts
  ```
  O servidor detecta o sistema operacional sozinho e aponta para `.venv/bin/edge-tts` (macOS/Linux) ou `.venv\Scripts\edge-tts.exe` (Windows) por padrão — nada para configurar no `.env`. Se o Python não estiver no PATH, reinstale marcando "Add python.exe to PATH" no instalador.
- **Sem o edge-tts instalado:** o endpoint responde `501` de propósito, e o frontend detecta isso e usa `SpeechSynthesis` do navegador automaticamente — a demo funciona igual, só com voz mais robótica.
- **Trocar de voz:** rode `.venv/bin/edge-tts --list-voices` (Windows: `.venv\Scripts\edge-tts --list-voices`) e filtre por `pt-BR` para ver as opções; defina `EDGE_TTS_VOICE` no `.env`. O padrão é `pt-BR-AntonioNeural`.

## Base de conhecimento

O Bambolino consulta uma base de estatísticas reais e verificáveis sobre substituição de empregos por IA (`data/knowledge-base.json`) antes de responder, para não ficar improvisando números a cada pergunta. Cada entrada cita sua fonte.

- **Como funciona:** a cada pergunta, `knowledgeBase.js` faz uma busca simples por sobreposição de palavras-chave (sem embeddings, sem banco vetorial — adequado ao tamanho atual da base) entre a pergunta e o campo `tags`/`topic`/`fact` de cada entrada. As melhores correspondências viram um bloco `CONTEXTO INTERNO` que é anexado ao `system` da requisição, depois do bloco de persona (que fica cacheado com `cache_control`, então o contexto dinâmico não invalida o cache da persona).
- **Como adicionar fatos:** edite `data/knowledge-base.json` e adicione um objeto `{ "id", "topic", "tags": [...], "fact": "..." }`. Não precisa reiniciar nada além do servidor (o arquivo é lido uma vez e cacheado em memória).
- **Quando crescer:** se a base passar de algumas dezenas/centenas de entradas, a busca por palavras-chave começa a perder precisão — nesse ponto vale migrar para busca vetorial (embeddings + um banco como SQLite com `sqlite-vec`, ou um serviço como Pinecone/Chroma) em vez de crescer o `knowledgeBase.js` manualmente.

## Estrutura

```
aria-voice-agent/
├── server.js            # Express + proxy para Claude API + injeção do contexto recuperado
├── knowledgeBase.js      # Busca por palavras-chave na base de conhecimento
├── data/
│   └── knowledge-base.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js           # STT/TTS via Web Speech API + animação do canvas
├── .env.example
└── package.json
```
