$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Luna One"

Write-Host "========================================"
Write-Host "         Luna One"
Write-Host "========================================"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js was not found." -ForegroundColor Red
    Write-Host "Install Node.js 20 or newer: https://nodejs.org"
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing required files for the first run..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installation failed." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

Start-Process "http://localhost:4174"
npm start
Read-Host "Press Enter to close"
