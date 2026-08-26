import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "data", "knowledge-base.json");

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "é", "em", "um", "uma",
  "que", "qual", "quais", "como", "para", "por", "com", "sem", "sobre", "no", "na",
  "nos", "nas", "se", "meu", "minha", "seu", "sua", "isso", "isso?", "voce", "você",
  "vc", "bambolino", "bonjovee", "eu", "me", "mim", "ao", "aos", "à", "às", "ou", "mas", "tem", "ser",
]);

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos para comparar com mais tolerância
}

function tokenize(str) {
  return normalize(str)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
}

let cachedEntries = null;

function loadEntries() {
  if (!cachedEntries) {
    const raw = readFileSync(KB_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cachedEntries = parsed.map((entry) => ({
      ...entry,
      _searchTokens: new Set(
        tokenize([entry.topic, entry.tags.join(" "), entry.fact].join(" ")),
      ),
    }));
  }
  return cachedEntries;
}

/**
 * Retorna as `topN` entradas da base de conhecimento mais relevantes para `query`,
 * usando sobreposição simples de tokens (sem embeddings/banco vetorial).
 * Entradas com pontuação 0 (nenhuma palavra em comum) são descartadas.
 */
export function retrieveRelevant(query, topN = 4) {
  const entries = loadEntries();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = entries.map((entry) => {
    let score = 0;
    for (const tok of queryTokens) {
      if (entry._searchTokens.has(tok)) score += 1;
      else {
        // match parcial (prefixo) para lidar com plural/singular e pequenas variações
        for (const kbTok of entry._searchTokens) {
          if (kbTok.length > 3 && (kbTok.startsWith(tok) || tok.startsWith(kbTok))) {
            score += 0.5;
            break;
          }
        }
      }
    }
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.entry);
}

/** Formata entradas recuperadas como um bloco de texto para injetar no prompt. */
export function formatContextBlock(entries) {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => `- [${e.topic}] ${e.fact}`).join("\n");
  return `CONTEXTO INTERNO (base de conhecimento institucional — use estes dados para fundamentar a resposta quando forem relevantes; não os leia literalmente em voz alta, incorpore-os à sua fala):\n${lines}`;
}
