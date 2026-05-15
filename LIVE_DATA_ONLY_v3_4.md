# v3.4 Live Data Only Değişiklikleri

Bu sürümde uygulamada mock/demo piyasa verisi kullanılmaması için aşağıdaki değişiklikler yapıldı:

- `backend/data_manager.py`
  - Demo OHLCV üretimi tamamen kaldırıldı.
  - Provider-first çalışma eklendi: crypto için Binance/CCXT, hisse/ETF için yfinance.
  - Sağlayıcılar başarısız olursa sistem sahte veri üretmek yerine `LiveDataUnavailable` hatası yükseltir.
  - SQLite cache yalnızca gerçek provider verisini saklar; stale cache recovery varsayılan kapalıdır.

- `backend/main.py`
  - `/api/market/history`, `/api/market/signal`, `/api/market/decision` endpointleri sahte `NEUTRAL` cevap üretmez.
  - `/api/news` mock haber listesi kaldırıldı.
  - `/api/portfolio` sahte bakiye/pozisyon/P&L döndürmez.
  - `/api/bots` sahte bot performansı döndürmez.
  - WebSocket logları fake işlem sinyali yerine live-data-only durum bilgisini verir.

- `backend/opentrader_bridge.py`
  - OpenTrader yoksa local simulation bot/backtest fallback çalışmaz.

- `backend/predictor.py`
  - Random tahmin kaldırıldı.
  - Kronos paketi yoksa canlı OHLCV üzerinden deterministik istatistiksel tahmin kullanılır ve mod etiketi açıkça döner.

- Frontend
  - Ticker, portföy, bot, grafik ve haber ekranları veri yokken mock kart/fiyat üretmez.
  - UI boş durum ve hata mesajı gösterir.

Varsayılan davranış: **Mock yok, demo yok, fake portföy yok, fake bot yok.**
