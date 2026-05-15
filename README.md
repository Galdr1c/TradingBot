# QuantumAI TradingBot

Kronos tahmin modeli, çoklu ajan karar mekanizması, teknik analiz, mum formasyonu analizi, risk kontrolü ve OpenTrader uyumlu strateji panellerini tek arayüzde birleştiren React + FastAPI tabanlı trading araştırma uygulaması.

> **Önemli:** Bu proje al/sat emri vermek için garanti sistemi değildir ve yatırım tavsiyesi üretmez. Teknik analiz, mum formasyonu, haber duyarlılığı ve model tahminleri olasılıksal karar destek araçlarıdır. Gerçek para ile işlem yapmadan önce paper trading, backtest, forward test ve risk limiti kullanın.

## Öne Çıkanlar

- **Gelişmiş teknik analiz:** Wilder RSI, MACD, MACD histogram, ADX, Williams %R, Bollinger Bands, EMA 20/50/200, VWAP, OBV, ATR ve Stochastic.
- **Mum analizi motoru:** Doji, Hammer, Hanging Man, Inverted Hammer, Shooting Star, Bullish/Bearish Engulfing, Harami, Piercing Line, Dark Cloud Cover, Morning/Evening Star, Three White Soldiers ve Three Black Crows tespiti.
- **Ağırlıklı sinyal sistemi:** İndikatör, trend gücü, hacim, VWAP ve mum formasyonu skorlarını tek bir `BUY / SELL / HOLD` kararına dönüştürür.
- **Trading Swarm:** Market Analyst, News Aggregator, Risk Manager ve Kronos Strategy AI ajanları aynı sembol için konsensüs üretir.
- **Kronos tahmin ekranı:** Seçilen varlık ve zaman dilimi için sonraki bar tahmini ve güven bandı gösterir.
- **OpenTrader entegrasyonu:** GRID, DCA ve RSI stratejileri için hesaplayıcı, durum paneli ve backtest endpointleri. OpenTrader kurulu değilse uygulama simülasyon moduna düşer.
- **Dashboard & Charts:** Piyasa özeti, canlı WebSocket logları, indikatör rozetleri, mum sinyali, sinyal gerekçeleri ve gelişmiş grafik sekmeleri.
- **Cache katmanı:** OHLCV verileri SQLite üzerinde saklanır; Binance/CCXT ve yfinance fallback mantığı kullanılır.

## Proje Yapısı

```text
TradingBot-main/
├─ backend/
│  ├─ main.py                 # FastAPI endpointleri, WebSocket, sinyal üretimi
│  ├─ agents.py               # Çoklu ajanlar, teknik analiz, risk ve strateji sentezi
│  ├─ candles.py              # Mum formasyonu analiz motoru
│  ├─ data_manager.py         # OHLCV fetch + SQLite cache
│  ├─ predictor.py            # Kronos tahmin katmanı
│  ├─ opentrader_bridge.py    # OpenTrader API/CLI köprüsü ve fallback simülasyon
│  ├─ backtest_engine.py      # Basit Python backtest motoru
│  └─ requirements.txt
├─ frontend/
│  ├─ src/App.jsx             # Ana layout ve navigasyon
│  ├─ src/api.js              # Backend API client
│  ├─ src/pages/Dashboard.jsx # KPI, grafik, sinyal ve sistem durumu
│  ├─ src/pages/Charts.jsx    # Teknik analiz grafik sekmeleri
│  ├─ src/pages/Kronos.jsx    # AI tahmin ekranı
│  ├─ src/pages/Strategies.jsx# GRID/DCA/RSI strateji paneli
│  └─ src/pages/Swarm.jsx     # Çoklu ajan konsensüsü
├─ SETUP_v3.1.md              # Entegrasyon/migrasyon notları
├─ package.json               # Root geliştirme scriptleri
└─ run_app.ps1                # Windows hızlı başlatma scripti
```

## Kurulum

### Gereksinimler

- Python 3.10+
- Node.js 22+
- npm
- Opsiyonel: Ollama veya OpenAI API anahtarı
- Opsiyonel: OpenTrader CLI

### Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

### Root üzerinden tek komut

```bash
npm install
npm run install-all
npm run dev
```

`npm run dev` aynı anda FastAPI backend’i `http://localhost:8000` üzerinde, Vite frontend’i `http://localhost:5173` üzerinde başlatır.

Windows kullanıyorsanız:

```powershell
.\run_app.ps1
```

## Ortam Değişkenleri

`backend/.env` dosyası oluşturabilirsiniz. Örnek:

```env
DEFAULT_LLM=ollama
MODEL_NAME=deepseek-r1:7b
OLLAMA_BASE_URL=http://localhost:11434

# Cloud LLM kullanacaksanız
OPENAI_API_KEY=sk-...

# OpenTrader opsiyonel
OPENTRADER_PORT=8001
OPENTRADER_PASSWORD=your-password
```

## OpenTrader Kullanımı

OpenTrader kurulu değilse uygulama çalışmaya devam eder ve strateji/backtest ekranlarında simülasyon sonucu döndürür. Gerçek OpenTrader köprüsünü kullanmak için:

```bash
npm install -g opentrader
opentrader set-password your-password
opentrader up --port 8001
```

Backend açılışta OpenTrader servisini kontrol eder. Uygunsa `LIVE`, değilse `SIMULATION` modunda çalışır.

## Analiz Mantığı

### Teknik analiz skoru

Sistem son OHLCV serisine şu bileşenleri uygular:

1. **Momentum:** Wilder RSI, Williams %R, Stochastic.
2. **Trend:** EMA 20/50/200 dizilimi, ADX trend gücü, MACD/signal kesişimi.
3. **Volatilite:** Bollinger Bands konumu ve ATR.
4. **Hacim:** OBV ve hacim ortalamasına göre hacim onayı.
5. **Fiyat konumu:** VWAP üstü/altı ve Bollinger band yüzdesi.
6. **Mum formasyonu:** Son mum ve yakın formasyon bağlamı için bullish/bearish skor.

Her bileşen ağırlıklı puana çevrilir. Nihai skor şu etiketlere dönüştürülür:

- `STRONG BUY`
- `BUY`
- `NEUTRAL / HOLD`
- `SELL`
- `STRONG SELL`

### Mum analizi

`backend/candles.py` mum gövdesi, fitiller, önceki trend yönü ve 2-3 mumluk dizilimleri değerlendirir. Sonuçlar hem API verisine hem de sinyal kararına eklenir:

```json
{
  "candle_pattern": "Bullish Engulfing, Morning Star",
  "candle_signal": "BULLISH",
  "candle_score": 2.6,
  "candle_strength": 0.9
}
```

Bu skor tek başına işlem kararı değildir; teknik analiz sisteminde yalnızca bir doğrulama katmanı olarak kullanılır.

### Çoklu ajan konsensüsü

`/api/swarm/run` endpoint’i dört ana perspektifi birleştirir:

- **Market Analyst:** Teknik analiz ve mum formasyonu.
- **News Aggregator:** Haber/başlık duyarlılığı.
- **Risk Manager:** Volatilite, drawdown, VaR/CVaR, Kelly benzeri pozisyon limiti.
- **Kronos Strategy AI:** Teknik, haber, risk ve OpenTrader strateji sinyallerini ağırlıklı karara dönüştürür.

## Ana API Endpointleri

| Endpoint | Açıklama |
|---|---|
| `GET /api/market/tickers` | Varsayılan semboller için fiyat ve 24s değişim |
| `GET /api/market/history` | OHLCV + indikatör + mum analizi + sinyal |
| `GET /api/market/signal/{symbol}` | Tek sembol için ağırlıklı sinyal |
| `GET /api/predict/{symbol}` | Kronos tahmini ve güven bandı |
| `POST /api/swarm/run` | Çoklu ajan konsensüsü |
| `GET /api/backtest/run` | Python backtest motoru |
| `GET /api/opentrader/status` | OpenTrader bağlantı durumu |
| `POST /api/opentrader/strategy` | GRID/DCA/RSI strateji hesaplama veya paper bot |
| `POST /api/opentrader/backtest` | OpenTrader CLI backtest veya Python simülasyon |
| `GET /api/system/stats` | CPU, bellek, Kronos, swarm ve OpenTrader durumu |
| `WS /ws/market` | Piyasa ticker stream |
| `WS /ws/logs` | Sistem log stream |

## Geliştirme Notları

- Sembol formatı hem `BTC/USDT` hem `BTC_USDT` olarak kabul edilir.
- Crypto verileri önce Binance/CCXT üzerinden, mümkün değilse yfinance üzerinden alınır.
- OHLCV cache’i SQLite içindedir; test sırasında eski veri görürseniz `backend/market_data.db` dosyasını temizleyebilirsiniz.
- Frontend build testi:

```bash
cd frontend
npm install
npm run build
```

- Python syntax kontrolü:

```bash
python -m py_compile backend/*.py backend/swarm/*.py
```

## Güvenlik ve Risk

- Bu uygulama karar destek ve araştırma amaçlıdır.
- Hiçbir sinyal kâr garantisi vermez.
- API anahtarlarını `.env` içinde tutun, repoya eklemeyin.
- Gerçek emir entegrasyonu yapmadan önce paper mode, küçük sermaye, stop-loss, maksimum pozisyon oranı ve günlük zarar limiti kullanın.
- Haber duyarlılığı ve LLM çıktıları yanılabilir; teknik analiz ile birlikte çapraz doğrulama yapılmalıdır.

## Bu Entegrasyonda Eklenenler

- `entegre.zip` içindeki v3.1 backend/frontend mantığı ana projeye taşındı.
- `backend/opentrader_bridge.py` eklendi.
- `frontend/src/pages/Strategies.jsx` eklendi.
- `backend/candles.py` ile mum formasyonu motoru eklendi.
- Dashboard ve Charts ekranlarına mum sinyali/pattern göstergesi eklendi.
- Backend sinyal motoruna candlestick confirmation ağırlığı eklendi.
- `data_manager.py` cache sorgusu parametreli hale getirildi.
- Frontend production build doğrulandı.
- Python dosyaları syntax kontrolünden geçirildi.
