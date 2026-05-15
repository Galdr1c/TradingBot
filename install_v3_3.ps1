Write-Host "Applying QuantumAI TradingBot v3.3 research/risk upgrade..." -ForegroundColor Cyan
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "Checking Python syntax..." -ForegroundColor Yellow
python -m py_compile backend\*.py
if ($LASTEXITCODE -ne 0) { throw "Python syntax check failed" }
Write-Host "v3.3 files are in place. Run: npm run dev" -ForegroundColor Green
