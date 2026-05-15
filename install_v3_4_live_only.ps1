Write-Host "Applying TradingBot v3.4 Live Data Only update..." -ForegroundColor Cyan
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Project root: $root"
Write-Host "Mock/demo market data has been removed. If providers are unavailable the UI will show empty/error states." -ForegroundColor Yellow
Write-Host "Run: npm run dev" -ForegroundColor Green
