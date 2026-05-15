# TradingBot v3.2 — İyileştirme Araştırması ve Uygulanan Kararlar

Bu not, uygulamanın daha stabil çalışması ve sinyal kalitesinin artması için yapılan araştırma-temelli geliştirmeleri özetler.

## 1. Veri Kalitesi ve Sağlayıcı Mantığı

- Crypto paritelerde birincil kaynak Binance/CCXT; Binance desteklemezse Yahoo Finance fallback kullanılır.
- Hisse/ETF sembollerinde doğrudan Yahoo Finance kullanılır; böylece `MSFT` gibi sembollerin Binance'e gönderilmesi engellenir.
- SQLite cache WAL moduna alındı, `busy_timeout` eklendi ve aynı sembol/zaman dilimi için eşzamanlı istekler lock ile sıraya alındı.
- Sağlayıcı veya cache çökerse UI tamamen kırılmasın diye açıkça `demo` kaynaklı fallback OHLCV üretildi. Bu veri arayüzde uyarı olarak gösterilir.

Kaynaklar:
- Binance Spot API, Kline/Candlestick endpointleri: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
- yfinance history period/interval limitleri: https://ranaroussi.github.io/yfinance/reference/yfinance.price_history.html

## 2. Lookahead Bias Azaltımı

- VWAP artık tüm dataframe toplamıyla tek değer olarak hesaplanmıyor; her mumda yalnızca o ana kadarki kümülatif veri kullanılıyor.
- Sinyal skoru son mum, önceki mum ve geçmiş pencere ile hesaplanıyor; gelecek mum verisi kullanılmıyor.
- Backtest kalitesi için ileri aşamada walk-forward / TimeSeriesSplit raporu eklenmesi önerilir.

Kaynaklar:
- Freqtrade lookahead-analysis dokümanı: https://docs.freqtrade.io/en/stable/lookahead-analysis/
- scikit-learn TimeSeriesSplit dokümanı: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html

## 3. Teknik Analiz ve Mum Formasyonu

- RSI, MACD, ADX, EMA stack, Bollinger, Williams %R, VWAP, hacim oranı ve mum formasyonu tek ağırlıklı karar motorunda birleştirildi.
- Mum formasyonu tek başına karar üretmez; yalnızca trend/momentum sinyalini doğrulayan yardımcı katman olarak kullanılır.
- ATR tabanlı stop-loss / take-profit seviyeleri API cevabına eklendi.

Kaynak:
- TA-Lib teknik analiz ve candlestick pattern kapsamı: https://ta-lib.org/

## 4. UI/UX Sağlamlaştırma

- Arama kutusu artık gerçek çalışıyor: `BTC`, `ETH`, `AAPL`, `MSFT` gibi girişler Charts ekranını açıyor.
- API Base URL ayarı artık localStorage'a kaydediliyor ve API client gerçekten bu değeri kullanıyor.
- Grafik ekranında loading / empty / error state eklendi.
- Global ErrorBoundary ve toast bildirim sistemi eklendi.
- Vite build bundle'ı manual chunk ile ayrıştırıldı; önceki büyük bundle uyarısı giderildi.

## 5. Sonraki Önerilen Aşamalar

1. Walk-forward backtest paneli.
2. Fee/slippage modeli.
3. Maksimum günlük zarar limiti.
4. Pozisyon boyutlandırma ekranı.
5. Sinyal performans günlüğü: her sinyalin sonraki 1/4/24 mum sonucunu takip etme.
6. Exchange API key kullanımı olacaksa read-only / trading permission ayrımı ve encrypted secret storage.

> Not: Bu proje yatırım tavsiyesi veya kâr garantisi değildir. İyileştirmeler karar destek kalitesini artırmak içindir.
