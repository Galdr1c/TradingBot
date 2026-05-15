Write-Host "QuantumAI TradingBot v3.2 kurulumu" -ForegroundColor Cyan
Write-Host "1) Frontend paketleri kontrol ediliyor..." -ForegroundColor Yellow
Push-Location frontend
npm install
npm run build
Pop-Location
Write-Host "2) Python syntax kontrolü..." -ForegroundColor Yellow
python -m py_compile backend\*.py
Write-Host "Tamam. Uygulamayı başlatmak için: npm run dev" -ForegroundColor Green
