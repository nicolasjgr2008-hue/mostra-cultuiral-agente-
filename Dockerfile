# Imagem com Node (servidor) + Python (voz humanizada via edge-tts)
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY . .

# Cria o venv na mesma pasta/formato que o server.js já espera por padrão
# (baseDir/.venv/bin/edge-tts em Linux/macOS).
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir edge-tts

EXPOSE 3000
CMD ["node", "server.js"]
