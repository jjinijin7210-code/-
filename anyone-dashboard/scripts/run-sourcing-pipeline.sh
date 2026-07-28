#!/bin/sh
# Render Cron Job에서 실행 - 1688 상품소싱(server/routes/auto.js, /api/auto/run) 자동 파이프라인.
# 2026-07-15에 자동 스케줄에서 빠졌던 걸(구매 링크 없는 문제, 이제 쿠팡 존재 확인 게이트로 해결됨)
# 2026-07-26 요청으로 아침/저녁 하루 2번 다시 켬. run-content-pipeline.sh와 같은 방식(실행
# 시각(UTC)으로 판단, Render Cron Job은 스케줄 하나당 명령 하나만 실행) - 별도 Render Cron Job으로
# 등록해서 이 스크립트를 아침/저녁 두 번 호출해야 함(README 참고).
#
# 카테고리 5개(수납정리/주방용품/욕실용품/인테리어 소품/조명)를 요일별로 하나씩 돌리고,
# 저녁에는 다음 카테고리를 써서 아침/저녁이 항상 같은 카테고리로 고정되지 않게 함.
set -e

BASE_URL="https://anyone-dashboard-p3an.onrender.com"
HOUR=$(date -u +%H)
DOW=$(date -u +%u) # 1(월)~7(일)

# 인덱스 0~4로 순환 (요일 기준)
IDX=$(( (DOW - 1) % 5 ))
case "$HOUR" in
  00) SLOT_IDX=$IDX ;;                  # 아침 슬롯
  *) SLOT_IDX=$(( (IDX + 1) % 5 )) ;;   # 저녁 슬롯 (아침과 겹치지 않게 하나 밀어서)
esac

case "$SLOT_IDX" in
  0) KEYWORD='收纳'; KEYWORD_KO='수납정리' ;;
  1) KEYWORD='厨房用品'; KEYWORD_KO='주방용품' ;;
  2) KEYWORD='浴室用品'; KEYWORD_KO='욕실용품' ;;
  3) KEYWORD='家居摆件'; KEYWORD_KO='인테리어 소품' ;;
  4) KEYWORD='灯具'; KEYWORD_KO='조명' ;;
esac

if [ -z "$AUTO_RUN_SECRET" ]; then
  echo "AUTO_RUN_SECRET 환경변수가 없어요 (Render Cron Job의 Environment 탭에서 설정 필요)"
  exit 1
fi

echo "== 1688 상품소싱 (키워드: $KEYWORD / $KEYWORD_KO) =="
RESPONSE=$(curl -sS -X POST "$BASE_URL/api/auto/run" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$AUTO_RUN_SECRET\",\"keyword\":\"$KEYWORD\",\"keywordKo\":\"$KEYWORD_KO\",\"channel\":\"인스타/틱톡\"}")
echo "$RESPONSE"
echo "$RESPONSE" | grep -q '"ok":true'
