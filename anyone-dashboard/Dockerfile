FROM node:20-slim

# 쇼츠 자동 렌더링(video-maker 로직)에 필요: ffmpeg + 한글 자막용 CJK 폰트
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server/index.js"]
