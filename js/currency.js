/**
 * currency.js - 汇率与货币换算（仅用于汇总展示）
 */
const CurrencyFX = {
  BASE: 'USD',
  CACHE_TTL: 10 * 60 * 1000,
  _cache: null,

  MARKET_CURRENCY: {
    SH: 'CNY',
    SZ: 'CNY',
    HK: 'HKD',
    US: 'USD',
    JP: 'JPY',
    KR: 'KRW',
    EU: 'EUR',
    TW: 'TWD',
    IN: 'INR',
    VN: 'VND',
    CRYPTO: 'USD'
  },

  getCurrencyByMarket(market) {
    const mkt = String(market || '').toUpperCase();
    return this.MARKET_CURRENCY[mkt] || 'USD';
  },

  async getRates(force) {
    if (!force && this._cache && (Date.now() - this._cache.ts) < this.CACHE_TTL) {
      return this._cache;
    }
    const url = 'https://api.frankfurter.app/latest?from=USD&to=CNY,HKD,USD,JPY,KRW,EUR,TWD,INR,VND';
    let data;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e1) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url });
        if (resp && resp.error) throw new Error(resp.error);
        data = resp && resp.data;
      } else {
        throw e1;
      }
    }

    if (!data || !data.rates) throw new Error('invalid fx payload');
    const rates = { ...data.rates, USD: 1 };
    this._cache = {
      base: 'USD',
      rates,
      ts: Date.now()
    };
    return this._cache;
  },

  convert(amount, fromCurrency, toCurrency, ratesInfo) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    const from = String(fromCurrency || '').toUpperCase();
    const to = String(toCurrency || '').toUpperCase();
    if (!from || !to) return null;
    if (from === to) return value;
    const rates = ratesInfo && ratesInfo.rates;
    if (!rates) return null;
    const fromRate = Number(rates[from]);
    const toRate = Number(rates[to]);
    if (!Number.isFinite(fromRate) || fromRate <= 0) return null;
    if (!Number.isFinite(toRate) || toRate <= 0) return null;
    const usdValue = value / fromRate;
    return usdValue * toRate;
  }
};
