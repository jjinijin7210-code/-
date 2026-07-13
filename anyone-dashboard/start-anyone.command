#!/bin/bash
cd "$(dirname "$0")"

echo "============================================"
echo "  애니원(AnyOne) 대시보드를 시작할게요..."
echo "============================================"
echo ""

if [ ! -d node_modules ]; then
  echo "처음 실행이라 필요한 프로그램을 설치할게요. 몇 분 걸릴 수 있어요..."
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "[오류] 설치에 실패했어요. Node.js가 설치되어 있는지 확인해주세요."
    echo "https://nodejs.org 에서 \"LTS\" 버전을 받아 설치한 뒤 다시 실행해주세요."
    read -p "엔터를 누르면 창이 닫혀요..."
    exit 1
  fi
fi

echo "서버를 켜는 중이에요... 잠시 후 브라우저가 자동으로 열려요."
npm run dev:all &
SERVER_PID=$!

sleep 6
open http://localhost:5173

echo ""
echo "브라우저가 안 열리면 직접 주소창에 http://localhost:5173 을 입력해주세요."
echo "종료하려면 이 터미널 창에서 Ctrl + C 를 누르거나, 이 창을 닫아주세요."

wait $SERVER_PID
