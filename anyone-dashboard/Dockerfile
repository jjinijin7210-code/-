FROM node:22-slim
# 자동 파이프라인(server/lib/supabaseAdmin.js)이 쓰는 @supabase/supabase-js가 내부적으로
# 네이티브 WebSocket을 요구해서(Node 22부터 기본 제공) Node 20에서는 실행 중 에러가 났었다.

# 쇼츠 자동 렌더링(video-maker 로직)에 필요: ffmpeg + 한글 자막용 CJK 폰트
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk curl ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 해외 쇼핑쇼츠 벤치마킹용 영상 다운로드(server/lib/videoDownloader.js)에 필요: yt-dlp
# 파이썬 설치 없이 바로 실행되는 독립 실행형 바이너리를 받아씀 (병합은 위에서 설치한 ffmpeg가 처리)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
# 인스타그램 자동 입력 기능(server/routes/instagram.js)의 playwright 패키지는 여기서
# 브라우저 바이너리를 내려받을 필요가 없다 - 그 기능은 headless:false라서 화면이 있는
# 사용자 컴퓨터에서만 동작하고, Render 서버에서는 애초에 실행될 수 없다. 그냥 안 쓰는
# 수백MB짜리 크로미움 다운로드를 건너뛰어서 빌드 시간/용량만 아낀다.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

# Vite는 빌드 시점에 VITE_ 환경변수를 결과물(js 번들)에 그대로 박아넣는다. Docker 빌드 단계는
# 기본적으로 서비스의 런타임 환경변수를 보지 못하므로, Render가 같은 이름의 ARG에 자동으로
# 채워주는 값을 명시적으로 받아와야 빌드 결과에 실제 Supabase 값이 반영된다.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# 2026-07-24: 지인 테스트 계정에게 대시보드를 넘겨줄 때 AI 이미지 생성 비용이 그쪽 사용으로도
# 진희님 API 키에 청구되는 걸 막기 위해, 본인 계정(UID)만 이미지 생성 버튼이 보이게 구분함.
ARG VITE_OWNER_USER_ID
ENV VITE_OWNER_USER_ID=$VITE_OWNER_USER_ID

RUN npm run build

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server/index.js"]
