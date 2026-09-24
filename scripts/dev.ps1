#!/usr/bin/env pwsh
# Developer one-shot: docker infra + backend api + worker + frontend (Windows PowerShell)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:TEMP "reachinbox-dev"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "[1/5] docker compose up -d (redis, elasticsearch, mysql)" -ForegroundColor Cyan
docker compose -f (Join-Path $root "docker-compose.yml") up -d

Write-Host "[2/5] installing backend deps (if needed)" -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
if (-not (Test-Path "node_modules")) { npm install }
npm run build
Pop-Location

Write-Host "[3/5] installing frontend deps (if needed)" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) { npm install }
Pop-Location

Write-Host "[4/5] starting API + worker" -ForegroundColor Cyan
Start-Process -FilePath "node" -ArgumentList "node_modules\tsx\dist\cli.mjs","src\index.ts" -WorkingDirectory (Join-Path $root "backend") -RedirectStandardOutput (Join-Path $logDir "api.log") -RedirectStandardError (Join-Path $logDir "api.err.log") -WindowStyle Hidden
Start-Process -FilePath "node" -ArgumentList "node_modules\tsx\dist\cli.mjs","src\worker.ts" -WorkingDirectory (Join-Path $root "backend") -RedirectStandardOutput (Join-Path $logDir "worker.log") -RedirectStandardError (Join-Path $logDir "worker.err.log") -WindowStyle Hidden

Write-Host "[5/5] starting frontend (http://localhost:5173)" -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npx","vite","--port","5173" -WorkingDirectory (Join-Path $root "frontend") -RedirectStandardOutput (Join-Path $logDir "web.log") -RedirectStandardError (Join-Path $logDir "web.err.log") -WindowStyle Hidden

Write-Host ""
Write-Host "All services starting... " -ForegroundColor Green
Write-Host "  Frontend   : http://localhost:5173"
Write-Host "  API        : http://localhost:4000 (health: /api/health)"
Write-Host "  Bull Board : http://localhost:4000/admin/queues"
Write-Host "  Redis      : localhost:6379"
Write-Host "  MySQL      : localhost:3307 (reachinbox/reachinbox)"
Write-Host "  Elastic    : localhost:9200"
Write-Host "  Logs       : $logDir"