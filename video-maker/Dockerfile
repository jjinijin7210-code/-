FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=4173
EXPOSE 4173

CMD ["node", "server.js"]
