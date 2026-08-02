#!/bin/sh
# Render Cron Job에서 매일 한 번 실행. 발행완료 콘텐츠 초안 + 승인된 에셋 중 7일 지난
# 것들을 자동으로 지운다 (2026-07-29 요청). run-content-pipeline.sh와 동일한 패턴.
set -e

BASE_URL="https://anyone-dashboard-p3an.onrender.com"

if [ -z "$AUTO_RUN_SECRET" ]; then
  echo "AUTO_RUN_SECRET 환경변수가 없어요 (Render Cron Job의 Environment 탭에서 설정 필요)"
  exit 1
fi

echo "== 완료 콘텐츠 자동 정리 =="
RESPONSE=$(curl -sS -X POST "$BASE_URL/api/cleanup/run" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$AUTO_RUN_SECRET\"}")
echo "$RESPONSE"
echo "$RESPONSE" | grep -q '"ok":true'
