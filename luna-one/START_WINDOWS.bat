@echo off
setlocal
cd /d "%~dp0"
title Luna One

echo ========================================
echo          Luna One
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NO_NODE

if not exist node_modules goto INSTALL
goto RUN

:INSTALL
echo Installing required files for the first run...
call npm install
if errorlevel 1 goto INSTALL_ERROR

:RUN
echo Starting Luna One...
start "" "http://localhost:4174"
call npm start
goto END

:NO_NODE
echo.
echo Node.js was not found.
echo Please install Node.js 20 or newer, then restart this file.
echo https://nodejs.org
echo.
pause
goto END

:INSTALL_ERROR
echo.
echo Installation failed.
echo Please copy the error message or take a screenshot.
echo.
pause

:END
endlocal
