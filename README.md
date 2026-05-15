# QuantumAI TradingBot v3.4 — Live Data Only

React + FastAPI tabanlı trading araştırma terminali. Bu sürümde uygulamadaki **mock/demo piyasa verileri, sahte portföy değerleri, sahte bot P&L kayıtları ve random backtest sonuçları kaldırıldı**. Veri sağlayıcı cevap vermezse sistem sahte veri üretmez; UI açık hata/boş durum gösterir.

> Bu proje yatırım tavsiyesi değildir. Teknik analiz, haber duyarlılığı, tahmin ve backtest modülleri karar destek aracıdır; kâr garantisi vermez.

## v3.4 canlı veri prensipleri

- **Piyasa verisi:** Crypto için Binance/CCXT, hisse/ETF için yfinance üzerinden gerçek sağlayıcı verisi.
- **Mock kapalı:** OHLCV, ticker, portföy, bot ve haber tarafında demo veri üretilmez.
- **Fail-closed davranış:** Sağlayıcı yoksa endpoint `503` veya boş gerçek veri durumu döndürür; fake `NEUTRAL`, fake portföy veya fake haber basılmaz.
- **Cache politikası:** SQLite yalnızca gerçek sağlayıcıdan gelen veriyi saklar. Stale cache recovery varsayılan kapalıdır. Gerekirse `ALLOW_REAL_CACHE_FALLBACK=true` ile açıkça etkinleştirilebilir.
- **OpenTrader:** OpenTrader yoksa yerel simülasyon botu başlatılmaz. Strateji ve backtest endpointleri gerçek OpenTrader API/CLI gerektirir.
- **Kronos/tahmin:** Random tahmin kaldırıldı. Gerçek Kronos paketi yoksa canlı OHLCV üzerinden deterministik istatistiksel tahmin etiketiyle çalışır.

## Özellikler

- Wilder RSI, MACD, ADX, Williams %R, Bollinger Bands, EMA 20/50/200, VWAP, OBV, ATR ve Stochastic.
- Doji, Hammer, Engulfing, Harami, Morning/Evening Star ve diğer mum formasyonları.
- Multi-timeframe consensus: `15m / 1h / 4h / 1d` sinyallerini birlikte değerlendirir.
- Risk Lab: ATR pozisyon boyutu, korelasyon, walk-forward validation ve gerçek OHLCV ile backtest.
- Research: RSS/Jina/GitHub tabanlı gerçek kaynak incelemesi.
- UI: canlı veri yoksa boş/hata durumu gösterir; sahte fiyat, sahte pozisyon veya sahte bot kartı göstermez.

## Proje yapısı

```text
TradingBot-main/
├─ backend/
│  ├─ main.py                 # FastAPI endpointleri, WebSocket, canlı veri politikası
│  ├─ data_manager.py         # Binance/yfinance canlı OHLCV + quote loader
│  ├─ predictor.py            # Kronos wrapper + random olmayan istatistiksel tahmin
│  ├─ opentrader_bridge.py    # OpenTrader API/CLI köprüsü; simülasyon fallback yok
│  ├─ backtest_engine.py      # Gerçek OHLCV ile backtest
│  ├─ candles.py              # Mum formasyonu motoru
│  ├─ research_adapter.py     # RSS/Jina/GitHub araştırma adaptörü
│  ├─ risk_engine.py          # ATR risk ve pozisyon boyutu
│  └─ requirements.txt
├─ frontend/
│  ├─ src/App.jsx             # Ana layout, canlı veri uyarıları
│  ├─ src/api.js              # API client
│  ├─ src/pages/Charts.jsx    # Teknik analiz + canlı veri kaynağı
│  ├─ src/pages/Portfolio.jsx # Mock portföy yok; gerçek hesap yoksa boş durum
│  ├─ src/pages/Bots.jsx      # Mock bot yok; OpenTrader yoksa boş durum
│  ├─ src/pages/RiskLab.jsx   # Risk, korelasyon ve validation
│  └─ src/pages/Research.jsx  # Gerçek kaynak araştırması
└─ package.json
```

## Kurulum

```bash
npm install
npm run install-all
npm run dev
```

Backend: `http://localhost:8000`  
Frontend: `http://localhost:5173`

Windows hızlı başlatma:

```powershell
.\run_app.ps1
```

## Ortam değişkenleri

```env
DEFAULT_LLM=ollama
MODEL_NAME=deepseek-r1:7b
OLLAMA_BASE_URL=http://localhost:11434

# Opsiyonel gerçek OpenTrader entegrasyonu
OPENTRADER_PORT=8001
OPENTRADER_PASSWORD=your-password

# Varsayılan false. Açılırsa sadece daha önce gerçek sağlayıcıdan kaydedilmiş cache kullanılır.
ALLOW_REAL_CACHE_FALLBACK=false
```

## OpenTrader

OpenTrader kurulmadan bot veya OpenTrader backtest simülasyonu döndürülmez.

```bash
npm install -g opentrader
opentrader set-password your-password
opentrader up --port 8001
```

## Canlı veri endpointleri

- `GET /api/market/tickers` — gerçek quote/ticker listesi.
- `GET /api/market/history?symbol=BTC_USDT&interval=1h&limit=200` — gerçek OHLCV.
- `GET /api/market/signal/BTC_USDT?timeframe=1h` — gerçek OHLCV üzerinden teknik sinyal.
- `GET /api/market/decision/BTC_USDT` — multi-timeframe canlı veri konsensüsü.
- `GET /api/portfolio` — gerçek hesap bağlı değilse boş ve açıklayıcı durum.
- `GET /api/bots` — gerçek OpenTrader botları; yoksa boş durum.

## Doğrulama

```bash
cd frontend
npm run build
npm run lint

cd ..
python -m py_compile backend\*.py
```

## Notlar

- Yahoo/yfinance verisi borsa ve sembole göre gecikmeli olabilir. Uygulama bu veriyi yine de gerçek sağlayıcı verisi olarak işler, mock olarak üretmez.
- Binance crypto OHLCV ve ticker tarafında ana canlı kaynaktır.
- Gerçek emir/hesap bağlamak için OpenTrader veya ayrı bir broker/exchange entegrasyonu yapılandırılmalıdır.
