FROM node:22-slim

# "영상 보고 대본 쓰기"(ffmpeg/ffprobe로 장면 추출) 기능에 필요
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# 네이버 블로그 자동 채우기(playwright)는 화면이 있는 로컬 PC에서만 동작하는 기능이라
# Render(서버)에서는 절대 실행되지 않음 - 수백MB짜리 크로미움 다운로드를 건너뛰어서
# 빌드 시간/용량만 아낀다(anyone-dashboard Dockerfile과 동일한 이유).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

ENV PORT=4174
EXPOSE 4174

CMD ["node", "server.js"]
