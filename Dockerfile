# Imagen única: bot (Node) + Remotion + ffmpeg + Chromium + whisper.cpp.
# Build:  docker build -t bot-inmobiliario .       (contexto = raíz del repo)
# ARG PREWARM_WHISPER=0 omite compilar whisper.cpp y bajar el modelo (se hará en el primer /guion).

FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bot/package.json bot/package-lock.json bot/
COPY my-video/package.json my-video/package-lock.json my-video/
RUN cd bot && npm ci && cd ../my-video && npm ci

FROM deps AS build
COPY . .
RUN cd bot && npm run build
# Chrome headless shell que usa Remotion para renderizar
RUN cd my-video && npx remotion browser ensure
ARG PREWARM_WHISPER=1
ENV WHISPER_DIR=/opt/whisper WHISPER_MODEL=medium
RUN if [ "$PREWARM_WHISPER" = "1" ]; then cd bot && npx tsx scripts/prewarm-whisper.ts; fi

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg chromium curl ca-certificates python3 python3-pip cmake make g++ git fonts-liberation fonts-noto-color-emoji \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
    libxcomposite1 libxdamage1 libgbm1 libcups2 libpango-1.0-0 libcairo2 libx11-xcb1 libxcb-dri3-0 \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY --from=build /opt/whisper /opt/whisper
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WHISPER_DIR=/opt/whisper \
    CHROMIUM_PATH=/usr/bin/chromium REMOTION_DIR=/app/my-video SKILLS_DIR=/app/bot/skills
WORKDIR /app/bot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs http://localhost:3000/healthz || exit 1
CMD ["node", "dist/src/index.js"]
