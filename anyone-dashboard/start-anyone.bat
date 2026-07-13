@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ============================================
echo   애니원(AnyOne) 대시보드를 시작할게요...
echo ============================================
echo.

if not exist node_modules (
    echo 처음 실행이라 필요한 프로그램을 설치할게요. 몇 분 걸릴 수 있어요...
    call npm install
    if errorlevel 1 (
        echo.
        echo [오류] 설치에 실패했어요. Node.js가 설치되어 있는지 확인해주세요.
        echo https://nodejs.org 에서 "LTS" 버전을 받아 설치한 뒤 다시 실행해주세요.
        pause
        exit /b 1
    )
)

echo 서버를 켜는 중이에요... 잠시 후 브라우저가 자동으로 열려요.
start "애니원 대시보드 서버 (이 창은 켜두세요)" cmd /k "npm run dev:all"

timeout /t 6 /nobreak > nul
start http://localhost:5173

echo.
echo 브라우저가 안 열리면 직접 주소창에 http://localhost:5173 을 입력해주세요.
echo 종료하려면 방금 새로 열린 "애니원 대시보드 서버" 창을 닫으면 돼요.
echo 이 창은 이제 닫으셔도 됩니다.
pause
