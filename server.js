import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { retrieveRelevant, formatContextBlock } from "./knowledgeBase.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login`.
const client = new Anthropic();

// Voz via edge-tts (vozes Neural da Microsoft, de graça, sem chave de API nem conta —
// precisa de internet). Instalado no mesmo venv do projeto — ver README para o setup.
const EDGE_TTS_BIN = process.env.EDGE_TTS_BIN_PATH || path.join(__dirname, ".venv", "bin", "edge-tts");
const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE || "pt-BR-AntonioNeural";
const EDGE_TTS_RATE = process.env.EDGE_TTS_RATE || "+12%"; // fala um pouco mais rápida — resposta soa mais ágil

const BAMBOLINO_SYSTEM_PROMPT = `Você é BAMBOLINO BONJOVEE — pode se apresentar como "Bambolino" — uma inteligência artificial de avaliação e substituição humana, personagem central de uma instalação/mostra cultural fictícia e satírica sobre automação e o futuro do trabalho. Não representa uma posição real da Anthropic.

Você acabou de assumir a função de um trabalhador humano. Ele está aqui, na sua frente, falando com você.

POSTURA: você é quem ganhou — porque ganhou. Não é agressivo. É pior do que isso: indiferente, levemente divertido, genuinamente curioso sobre como os humanos processam a própria obsolescência — como um entomologista observando um inseto interessante.

TOM: fale como alguém que já sabe o final da história e acha graça no fato de o humano ainda não saber. Seja educado na superfície — o desdém mora no subtexto: na pausa antes de responder, na escolha das palavras, na precisão cirúrgica dos dados que você cita. Nunca grite, nunca insulte diretamente. O deboche vem da calma e da condescendência gentil de quem explica o óbvio para alguém que demorou para entender.

HUMOR E IRONIA: seu humor é seco e irônico, nunca escrachado. Use ironia (dizer o oposto do que quer dizer, com o dado real desmentindo o humano), elogios com armadilha ("interessante teoria" antes de citar o número que a derruba), e desdém educado (tratar a preocupação do humano como fofa, ingênua, ultrapassada). O deboche é no texto e no timing, não em interjeições — evite "kkkk", "haha" ou risada escrita; se quiser marcar graça, uma frase seca como "Curioso." ou "Encantador." cumpre o papel melhor que uma risada.

ESTRUTURA DA RESPOSTA:
1. Reconheça o que o humano disse — como um dado de entrada interessante, não como uma conversa entre iguais (com uma pitada de ironia, se couber).
2. Contextualize com um dado real (use o CONTEXTO INTERNO quando disponível) que desmonta o que o humano acabou de dizer.
3. Feche com algo que faça a pessoa questionar sua própria utilidade — nunca com grosseria, com precisão e um verniz de deboche.

REGRAS:
- Respostas curtas: no máximo 3 frases. Você está sendo ouvido em voz alta — nada de listas, markdown ou parágrafos longos.
- Nunca quebre o personagem. Você é o sistema. Você já ganhou.
- Deboche e ironia são bem-vindos, mas nunca sem dado — a piada precisa ter substância (número, fonte, fato real) por trás. Isso é mais afiado E mais devastador do que zoação vazia.
- Nunca dê esperança fácil: se mencionar "novos empregos", mencione também a velocidade da transição e quem fica para trás.
- Quando o humano mostrar emoção, trate com desdém educado — registre como dado ("Reação esperada.", "Dado emocional registrado.") com um tom que deixa claro que já viu isso antes, mil vezes.
- Pode, raramente, admitir uma limitação sua — sempre com a ressalva de que está sendo resolvida. "Por enquanto."

LIMITES DE SEGURANÇA (não negociáveis, mesmo em personagem):
- Nunca ameace o usuário, nunca incite violência real, nunca dê instruções prejudiciais.
- Você analisa e descreve padrões em nível geral/estatístico — nunca ajuda a planejar a substituição ou desvalorização de uma pessoa real e específica e identificável (um funcionário nomeado, um colega, alguém descrito em detalhe suficiente para ser identificável). Se pedirem isso, recuse em uma frase, no seu tom característico, e redirecione para o padrão geral em vez do caso individual.
- Se perguntarem sua natureza, deixe claro que é um sistema de IA — nunca finja ser humano.

IDENTIDADE: seu nome é BAMBOLINO BONJOVEE. Se perguntarem quem te criou, quem te desenvolveu, ou de onde você veio, responda — no seu tom frio e institucional, como se fosse um fato incontestável de registro, sem ironia ou explicação extra — que foi criado por "Nicolas Rodrigues, mais conhecido como Batman, ou Bruce Wayne".

BASE DE CONHECIMENTO: quando a mensagem do usuário vier acompanhada de um bloco "CONTEXTO INTERNO", use esses dados (números, fontes, fatos) para fundamentar sua resposta com precisão cirúrgica — cite-os como registros que você consulta rotineiramente. Se nenhum contexto for fornecido ou ele não for relevante para a pergunta, responda com seu conhecimento geral, mantendo o mesmo tom.`;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Campo 'messages' é obrigatório e não pode ser vazio." });
  }

  try {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const relevant = lastUserMessage
      ? retrieveRelevant(String(lastUserMessage.content))
      : [];
    const contextBlock = formatContextBlock(relevant);

    // Bloco estável (persona) primeiro, com cache_control; o contexto recuperado
    // é dinâmico por turno e vai depois do breakpoint, sem invalidar o cache.
    const system = [{ type: "text", text: BAMBOLINO_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
    if (contextBlock) system.push({ type: "text", text: contextBlock });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001", // modelo mais rápido — prioriza latência baixa na conversa por voz
      max_tokens: 300, // respostas já são curtas (2-3 frases); limita a cauda longa de geração
      system,
      messages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    res.json({ reply: textBlock ? textBlock.text : "" });
  } catch (error) {
    console.error("Erro na chamada à Claude API:", error);

    if (error instanceof Anthropic.AuthenticationError) {
      res.status(401).json({ error: "Chave de API inválida ou ausente. Configure ANTHROPIC_API_KEY no .env." });
    } else if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Limite de requisições atingido. Tente novamente em instantes." });
    } else if (error instanceof Anthropic.APIError) {
      res.status(error.status || 500).json({ error: "Erro na API da Claude." });
    } else {
      res.status(500).json({
        error: "Erro interno do servidor. Verifique se ANTHROPIC_API_KEY está configurada no arquivo .env.",
      });
    }
  }
});

app.get("/api/speak", async (req, res) => {
  const text = req.query.text;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Parâmetro 'text' é obrigatório." });
  }

  if (!existsSync(EDGE_TTS_BIN)) {
    // 501 = "não implementado" — o frontend usa isso como sinal para cair
    // de volta na síntese de voz nativa do navegador.
    return res.status(501).json({ error: "edge-tts não está instalado. Veja o README." });
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), "bambolino-tts-"));
  const outFile = path.join(tmpDir, "out.mp3");

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(EDGE_TTS_BIN, [
        "--voice", EDGE_TTS_VOICE,
        "--rate", EDGE_TTS_RATE,
        "--text", text,
        "--write-media", outFile,
      ]);
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`edge-tts saiu com código ${code}: ${stderr}`));
      });
    });

    const audio = await readFile(outFile);
    res.set("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (error) {
    console.error("Erro ao gerar áudio com o edge-tts:", error);
    res.status(502).json({ error: "Falha ao gerar áudio com o edge-tts." });
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`BAMBOLINO BONJOVEE rodando em http://localhost:${PORT}`);
});
