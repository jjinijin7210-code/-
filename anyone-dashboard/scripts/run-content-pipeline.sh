#!/bin/sh
# Render Cron Job에서 실행. GitHub Actions 스케줄러가 반복적으로 멈추는 문제(2026-07-15,
# 07-19, 07-20 세 차례) 때문에 별도 인프라(Render Cron Job)로 이중화/이전하기 위해 추가.
# .github/workflows/anyone-auto-pipeline.yml의 카테고리 결정 로직을 그대로 이식했다 -
# Render Cron Job은 스케줄 하나당 명령 하나만 실행하므로, 실행 시각(UTC)으로 카테고리를 직접 판단한다.
set -e

BASE_URL="https://anyone-dashboard-p3an.onrender.com"
HOUR=$(date -u +%H)

COLLECT=false
case "$HOUR" in
  00) CATEGORY='신기한동물'; COLLECT=true ;;
  02) CATEGORY='해외재밌는영상' ;;
  04) CATEGORY='신기한동물' ;;
  06) CATEGORY='해외재밌는영상' ;;
  08) CATEGORY='신기한동물' ;;
  10) CATEGORY='해외재밌는영상' ;;
  12) CATEGORY='신기한동물' ;;
  *) CATEGORY='신기한동물' ;;
esac

if [ -z "$AUTO_RUN_SECRET" ]; then
  echo "AUTO_RUN_SECRET 환경변수가 없어요 (Render Cron Job의 Environment 탭에서 설정 필요)"
  exit 1
fi

if [ "$COLLECT" = "true" ]; then
  echo "== 벤치마킹 수집 =="
  curl -sS -X POST "$BASE_URL/api/benchmark/collect" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$AUTO_RUN_SECRET\"}"
  echo ""
fi

echo "== 콘텐츠 생성 (카테고리: $CATEGORY) =="
RESPONSE=$(curl -sS -X POST "$BASE_URL/api/benchmark/content-run" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$AUTO_RUN_SECRET\",\"category\":\"$CATEGORY\",\"channel\":\"인스타/틱톡\"}")
echo "$RESPONSE"
echo "$RESPONSE" | grep -q '"ok":true'
