const talkBtn = document.getElementById("talkBtn");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const chatLog = document.getElementById("chatLog");
const chatEmpty = document.getElementById("chatEmpty");
const chatCount = document.getElementById("chatCount");
const resetBtn = document.getElementById("resetBtn");
const canvas = document.getElementById("audio-ring");
const ctx = canvas.getContext("2d");
const audioEl = document.getElementById("ariaAudio");

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

let history = []; // { role: 'user'|'assistant', content: string }
let state = "idle"; // idle | listening | thinking | speaking
let recognition = null;
let phase = 0;
let currentAudioUrl = null;
let exchangeCount = 0;

function updateChatCount() {
  chatCount.textContent = `${exchangeCount} ${exchangeCount === 1 ? "troca" : "trocas"}`;
}

// Analisador do microfone (para o holograma reagir enquanto você fala)
let micAudioCtx = null;
let micAnalyser = null;
let micDataArray = null;
let micStream = null;

// Analisador do áudio de resposta (para a boca do holograma reagir na fala do Bambolino)
let ttsAudioCtx = null;
let ttsAnalyser = null;
let ttsDataArray = null;
let ttsGraphReady = false;

// ---------- State / UI ----------

function setState(next, label) {
  state = next;
  statusText.textContent = label;
  statusDot.className = "status-dot " + next;
  talkBtn.classList.toggle("active", next === "listening");
  talkBtn.disabled = next === "thinking" || next === "speaking";
}

function addMessage(role, text) {
  chatEmpty.style.display = "none";
  const div = document.createElement("div");
  div.className = "msg " + role;
  const roleLabel = document.createElement("span");
  roleLabel.className = "msg-role";
  roleLabel.textContent = role === "user" ? "Você" : "Bambolino";
  const textEl = document.createElement("span");
  textEl.className = "msg-text";
  textEl.textContent = text;
  div.appendChild(roleLabel);
  div.appendChild(textEl);
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- Microphone analyser (listening) ----------

async function setupMicAnalyser() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    micAnalyser = micAudioCtx.createAnalyser();
    micAnalyser.fftSize = 128;
    const source = micAudioCtx.createMediaStreamSource(micStream);
    source.connect(micAnalyser);
    micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
  } catch (err) {
    console.warn("Não foi possível acessar o microfone para visualização:", err);
    micAnalyser = null;
  }
}

function teardownMicAnalyser() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (micAudioCtx) {
    micAudioCtx.close().catch(() => {});
    micAudioCtx = null;
  }
  micAnalyser = null;
  micDataArray = null;
}

// ---------- TTS playback analyser (speaking) ----------
// Criado uma única vez, dentro do gesto de clique do usuário, para não
// esbarrar na política de autoplay dos navegadores.

function ensureTtsGraph() {
  if (ttsGraphReady) return;
  try {
    ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ttsAnalyser = ttsAudioCtx.createAnalyser();
    ttsAnalyser.fftSize = 128;
    const sourceNode = ttsAudioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(ttsAnalyser);
    ttsAnalyser.connect(ttsAudioCtx.destination);
    ttsDataArray = new Uint8Array(ttsAnalyser.frequencyBinCount);
    ttsGraphReady = true;
  } catch (err) {
    console.warn("Não foi possível preparar o visualizador de áudio do Bambolino:", err);
  }
}

// ---------- Speech recognition (STT) ----------

async function startListening() {
  if (!SpeechRecognitionAPI) {
    setState("idle", "Reconhecimento de voz não suportado. Use Chrome ou Edge.");
    return;
  }

  await setupMicAnalyser();

  recognition = new SpeechRecognitionAPI();
  recognition.lang = "pt-BR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => setState("listening", "Ouvindo...");

  recognition.onerror = (event) => {
    console.error("Erro no reconhecimento de voz:", event.error);
    teardownMicAnalyser();
    setState("idle", "Erro no microfone. Pressione Falar para tentar novamente.");
  };

  recognition.onend = () => {
    teardownMicAnalyser();
    if (state === "listening") {
      setState("idle", "Nenhuma fala detectada. Aguardando ativação...");
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) handleUserSpeech(transcript);
  };

  recognition.start();
}

function stopListening() {
  if (recognition) recognition.stop();
}

// ---------- Backend round-trip ----------

async function handleUserSpeech(transcript) {
  teardownMicAnalyser();
  addMessage("user", transcript);
  history.push({ role: "user", content: transcript });
  setState("thinking", "Bambolino está processando...");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro desconhecido do servidor.");

    history.push({ role: "assistant", content: data.reply });
    addMessage("assistant", data.reply);
    exchangeCount++;
    updateChatCount();
    speak(data.reply);
  } catch (err) {
    console.error(err);
    setState("idle", "Falha na comunicação com Bambolino. Tente novamente.");
  }
}

// ---------- Voice output: ElevenLabs, com fallback para a voz do navegador ----------

async function speak(text) {
  setState("speaking", "Bambolino está respondendo...");

  try {
    const res = await fetch(`/api/speak?text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error("Voz ElevenLabs indisponível (" + res.status + ")");

    const blob = await res.blob();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);

    ensureTtsGraph();
    audioEl.src = currentAudioUrl;

    audioEl.onended = () => setState("idle", "Aguardando ativação...");
    audioEl.onerror = () => setState("idle", "Aguardando ativação...");

    if (ttsAudioCtx && ttsAudioCtx.state === "suspended") {
      await ttsAudioCtx.resume();
    }
    await audioEl.play();
  } catch (err) {
    console.warn("Caindo para a voz nativa do navegador:", err.message);
    speakWithBrowserTts(text);
  }
}

function speakWithBrowserTts(text) {
  if (!window.speechSynthesis) {
    setState("idle", "Aguardando ativação...");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "pt-BR";
  utterance.rate = 0.97;
  utterance.pitch = 0.75;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const ptVoice =
    voices.find((v) => v.lang === "pt-BR") || voices.find((v) => v.lang && v.lang.startsWith("pt"));
  if (ptVoice) utterance.voice = ptVoice;

  utterance.onend = () => setState("idle", "Aguardando ativação...");
  utterance.onerror = () => setState("idle", "Aguardando ativação...");

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ---------- Controls ----------

talkBtn.addEventListener("click", () => {
  // Criado dentro do gesto de clique para satisfazer a política de autoplay.
  ensureTtsGraph();

  if (state === "idle") {
    startListening();
  } else if (state === "listening") {
    stopListening();
  }
});

resetBtn.addEventListener("click", () => {
  history = [];
  exchangeCount = 0;
  updateChatCount();
  chatLog.querySelectorAll(".msg").forEach((el) => el.remove());
  chatEmpty.style.display = "block";
  window.speechSynthesis.cancel();
  audioEl.pause();
  audioEl.currentTime = 0;
  teardownMicAnalyser();
  setState("idle", "Sessão reiniciada. Aguardando ativação...");
});

// ---------- Anel de áudio circular ----------

const BAR_COUNT = 64;

function drawWaveform() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const baseRadius = Math.min(w, h) * 0.26;
  const maxExtra = Math.min(w, h) * 0.16;

  const ttsActive = state === "speaking" && ttsAnalyser && ttsDataArray && !audioEl.paused;
  if (ttsActive) ttsAnalyser.getByteFrequencyData(ttsDataArray);
  const micActive = state === "listening" && micAnalyser && micDataArray;
  if (micActive) micAnalyser.getByteFrequencyData(micDataArray);

  // núcleo central
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
  coreGrad.addColorStop(0, "rgba(0, 200, 255, 0.18)");
  coreGrad.addColorStop(1, "rgba(0, 200, 255, 0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 200, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < BAR_COUNT; i++) {
    const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
    let amp;

    if (micActive) {
      const idx = Math.floor((i / BAR_COUNT) * micDataArray.length);
      amp = Math.max(3, (micDataArray[idx] / 255) * maxExtra);
    } else if (ttsActive) {
      const idx = Math.floor((i / BAR_COUNT) * ttsDataArray.length);
      amp = Math.max(3, (ttsDataArray[idx] / 255) * maxExtra);
    } else if (state === "speaking") {
      // voz de fallback do navegador não expõe amplitude real — anima um padrão sintético
      const wobble = Math.sin(phase * 0.18 + i * 0.55) * 0.5 + 0.5;
      const envelope = 0.35 + 0.65 * Math.abs(Math.sin(phase * 0.045 + i * 0.12));
      amp = wobble * envelope * maxExtra * 0.85 + 3;
    } else if (state === "thinking") {
      amp = (Math.sin(phase * 0.12 + i * 0.4) * 0.5 + 0.5) * maxExtra * 0.5 + 3;
    } else {
      amp = (Math.sin(phase * 0.03 + i * 0.35) * 0.5 + 0.5) * maxExtra * 0.18 + 3;
    }

    const x1 = cx + Math.cos(angle) * baseRadius;
    const y1 = cy + Math.sin(angle) * baseRadius;
    const x2 = cx + Math.cos(angle) * (baseRadius + amp);
    const y2 = cy + Math.sin(angle) * (baseRadius + amp);

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, "#00c8ff");
    grad.addColorStop(1, "#7f5af0");
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, ((Math.PI * 2 * baseRadius) / BAR_COUNT) * 0.55);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  phase++;
  requestAnimationFrame(drawWaveform);
}

// Some browsers populate the voice list asynchronously.
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

setState("idle", "Aguardando ativação...");
updateChatCount();
drawWaveform();
