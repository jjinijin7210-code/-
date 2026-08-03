@echo off
cd /d "%~dp0"
start "" /min cmd /c "node watermark-studio\server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3333/"
