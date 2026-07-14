FROM node:20-slim

# 쇼츠 자동 렌더링(video-maker 로직)에 필요: ffmpeg + 한글 자막용 CJK 폰트
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite는 빌드 시점에 VITE_ 환경변수를 결과물(js 번들)에 그대로 박아넣는다. Docker 빌드 단계는
# 기본적으로 서비스의 런타임 환경변수를 보지 못하므로, Render가 같은 이름의 ARG에 자동으로
# 채워주는 값을 명시적으로 받아와야 빌드 결과에 실제 Supabase 값이 반영된다.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server/index.js"]
