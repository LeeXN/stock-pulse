/**
 * market.js - 大盘指数行情
 *
 * 支持：A 股 / 港股 / 美股 / 日股 / 韩股 / 欧洲 / 台湾 / 印度 / 越南（指数）+ Crypto（BTC/ETH）
 * 用户可在设置中选择显示哪些指数。
 *
 * 数据源：东方财富 push2 接口（主）+ ulist.np/get 接口（备用）
 *   stock/get fields:
 *     f43  最新价（分）  f44 最高  f45 最低  f46 今开
 *     f60  昨收（分）    f169 涨跌额（分）  f170 涨跌幅（%×100）
 *   ulist.np/get fields:
 *     f2   最新价（分）  f15 昨收  f16 最低  f17 最高
 *     f4   涨跌额（分）  f3  涨跌幅（%×100）  f14 名称
 */
const MarketAPI = {
  // 全量指数库（按市场分组）
  MARKETS: {
    'A 股': [
      { secid: '1.000001',  code: '000001', name: '上证指数', market: 'SH' },
      { secid: '0.399001',  code: '399001', name: '深证成指', market: 'SZ' },
      { secid: '0.399006',  code: '399006', name: '创业板指', market: 'SZ' }
    ],
    '港股': [
      { secid: '100.HSI',   code: 'HSI',    name: '恒生指数', market: 'HK' },
      { secid: '100.HSCEI', code: 'HSCEI',  name: '恒生国企', market: 'HK' },
      { secid: '100.HSTECH',code: 'HSTECH', name: '恒生科技', market: 'HK' }
    ],
    '美股': [
      { secid: '100.NDX', code: 'NDX',    name: '纳指100',   market: 'US' },
      { secid: '100.SPX', code: 'SPX',    name: '标普500',   market: 'US' },
      { secid: '100.DJIA',code: 'DJIA',   name: '道琼斯',    market: 'US' }
    ],
    '日股': [
      { secid: '100.N225', code: 'N225', name: '日经225',    market: 'JP' }
    ],
    '韩股': [
      { secid: '100.KS11', code: 'KS11', name: 'KOSPI',      market: 'KR' }
    ],
    '欧洲': [
      { secid: '100.GDAXI', code: 'GDAXI', name: 'DAX',       market: 'EU' },
      { secid: '100.FTSE',  code: 'FTSE',  name: '富时100',   market: 'EU' }
    ],
    '亚太其他': [
      { secid: '100.TWII',  code: 'TWII',  name: '台湾加权',  market: 'TW' },
      { secid: '100.SENSEX', code: 'SENSEX', name: '印度SENSEX', market: 'IN' },
      { secid: '100.VNINDEX', code: 'VNINDEX', name: '越南VN-Index', market: 'VN' }
    ],
    'Crypto': [
      { secid: 'CRYPTO:BTCUSDT', code: 'BTC', name: 'Bitcoin', market: 'CRYPTO' },
      { secid: 'CRYPTO:ETHUSDT', code: 'ETH', name: 'Ethereum', market: 'CRYPTO' }
    ]
  },

  // 默认选中的指数 secid 列表
  DEFAULT_SELECTED: ['1.000001', '0.399001', '0.399006', '100.HSI'],

  _endpoint: 'https://push2.eastmoney.com/api/qt/stock/get',
  _fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170',
  _ulistEndpoint: 'https://push2.eastmoney.com/api/qt/ulist.np/get',
  _ulistFields: 'f2,f3,f4,f12,f14,f15,f16,f17',
  _cache: null,
  _cacheAt: 0,
  _CACHE_TTL: 10 * 1000,

  _isCryptoSecid(secid) {
    return String(secid || '').startsWith('CRYPTO:');
  },

  _toMarketItemFromCryptoQuote(idx, q) {
    if (!idx || !q) return null;
    const price = Number(q.price) || 0;
    const prevClose = Number(q.prevClose) || 0;
    const change = Number.isFinite(Number(q.change)) ? Number(q.change) : (price - prevClose);
    const changePercent = Number.isFinite(Number(q.changePercent))
      ? Number(q.changePercent)
      : (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
    return {
      secid: idx.secid,
      code: idx.code,
      market: 'CRYPTO',
      name: q.name || idx.name,
      price,
      prevClose,
      open: Number(q.open) || prevClose,
      high: Number(q.high) || 0,
      low: Number(q.low) || 0,
      change,
      changePercent
    };
  },

  /**
   * 获取所有分组的指数列表（扁平化）
   */
  getAllIndices() {
    const result = [];
    for (const [group, indices] of Object.entries(this.MARKETS)) {
      for (const idx of indices) {
        result.push({ ...idx, group });
      }
    }
    return result;
  },

  /**
   * 根据 secid 列表获取对应指数定义
   */
  getIndicesBySecids(secids) {
    const all = this.getAllIndices();
    return secids.map(id => all.find(i => i.secid === id)).filter(Boolean);
  },

  /**
   * 从 ulist.np/get 响应中解析单个指数数据
   */
  _parseUlistDiff(diff, fallbackIdx) {
    if (!diff) return null;
    const price = parseFloat(diff.f2) || 0;
    const prevClose = parseFloat(diff.f15) || 0;
    const high = parseFloat(diff.f17) || 0;
    const low = parseFloat(diff.f16) || 0;
    const change = parseFloat(diff.f4) || 0;
    const changePercent = parseFloat(diff.f3) || 0;
    const scale = 100;
    return {
      secid: fallbackIdx.secid,
      code: diff.f12 || fallbackIdx.code,
      market: fallbackIdx.market,
      name: diff.f14 || fallbackIdx.name,
      price: price / scale,
      prevClose: prevClose / scale,
      open: prevClose / scale,
      high: high / scale,
      low: low / scale,
      change: change / scale,
      changePercent: changePercent / scale
    };
  },

  /**
   * 拉取用户选中的指数行情（带缓存）
   * 用 ulist.np/get 批量接口一次拉取所有指数
   * @param {string[]} [secids] - 要拉的 secid 列表，默认用 settings.marketIndices 或 DEFAULT_SELECTED
   * @param {number} [ttl] - 缓存 TTL（毫秒），默认 10s
   * @returns {Promise<Array>}
   */
  async fetchAll(secids, ttl, force) {
    const ids = secids || this.DEFAULT_SELECTED;
    const indices = this.getIndicesBySecids(ids);
    if (!indices.length) return [];
    const normalIndices = indices.filter(i => !this._isCryptoSecid(i.secid));
    const cryptoIndices = indices.filter(i => this._isCryptoSecid(i.secid));

    const cacheTtl = ttl || this._CACHE_TTL;
    if (!force && this._cache && (Date.now() - this._cacheAt) < cacheTtl) {
      const cachedIds = new Set(this._cache.map(c => c.secid));
      if (ids.every(id => cachedIds.has(id))) return this._cache;
    }

    const results = [];

    if (normalIndices.length) {
      // 用 ulist.np/get 批量接口一次拉取所有传统指数
      const secidsStr = normalIndices.map(i => i.secid).join(',');
      const url = `${this._ulistEndpoint}?secids=${secidsStr}&fields=${this._ulistFields}&_=${Date.now()}`;
      try {
        let data;
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          data = await r.json();
        } catch (innerErr) {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url });
            if (resp && resp.error) throw new Error(resp.error);
            data = resp && resp.data;
          } else {
            throw innerErr;
          }
        }
        if (data && data.data && data.data.diff) {
          const diffMap = {};
          for (const d of data.data.diff) {
            diffMap[d.f12] = d;
          }
          const parsed = normalIndices.map(idx => {
            const diff = diffMap[idx.code];
            if (!diff) return null;
            return {
              secid: idx.secid, code: idx.code, market: idx.market,
              name: diff.f14 || idx.name,
              price: (parseFloat(diff.f2) || 0) / 100,
              prevClose: (parseFloat(diff.f15) || 0) / 100,
              open: (parseFloat(diff.f15) || 0) / 100,
              high: (parseFloat(diff.f17) || 0) / 100,
              low: (parseFloat(diff.f16) || 0) / 100,
              change: (parseFloat(diff.f4) || 0) / 100,
              changePercent: (parseFloat(diff.f3) || 0) / 100
            };
          }).filter(Boolean);
          results.push(...parsed);
        }
      } catch (e) {
        console.warn('[Market] fetchAll normal indices error:', e.message || String(e));
        const fallback = await this._fetchAllFallback(normalIndices, ttl, force);
        results.push(...fallback);
      }
    }

    if (cryptoIndices.length) {
      try {
        if (typeof CryptoAPI !== 'undefined') {
          const quoteMap = await CryptoAPI.getQuotes(cryptoIndices.map(i => i.secid));
          for (const idx of cryptoIndices) {
            const item = this._toMarketItemFromCryptoQuote(idx, quoteMap[idx.secid]);
            if (item) results.push(item);
          }
        }
      } catch (e) {
        console.warn('[Market] fetchAll crypto indices error:', e.message || String(e));
      }
    }

    this._cache = results;
    this._cacheAt = Date.now();
    return results;
  },

  /**
   * 回退方案：逐个拉取（当 ulist.np/get 批量接口不可用时使用）
   */
  async _fetchAllFallback(indices, ttl, force) {
    if (!indices.length) return [];
    const results = await Promise.all(indices.map(async idx => {
      const url = `${this._endpoint}?secid=${encodeURIComponent(idx.secid)}&fields=${this._fields}&_=${Date.now()}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let data;
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            data = await r.json();
          } catch (innerErr) {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url });
              if (resp && resp.error) throw new Error(resp.error);
              data = resp && resp.data;
            } else {
              throw innerErr;
            }
          }
          if (!data || !data.data) {
            if (attempt === 2) {
              const ulistResult = await this._fetchUlist([idx.secid]);
              if (ulistResult && ulistResult[0]) return ulistResult[0];
            }
            return null;
          }
          const d = data.data;
          const scale = 100;
          return {
            secid: idx.secid, code: idx.code, market: idx.market,
            name: d.f58 || idx.name,
            price: (parseFloat(d.f43) || 0) / scale,
            prevClose: (parseFloat(d.f60) || 0) / scale,
            open: (parseFloat(d.f46) || 0) / scale,
            high: (parseFloat(d.f44) || 0) / scale,
            low: (parseFloat(d.f45) || 0) / scale,
            change: (parseFloat(d.f169) || 0) / scale,
            changePercent: (parseFloat(d.f170) || 0) / scale
          };
        } catch (e) {
          if (attempt < 2) { await new Promise(r => setTimeout(r, 300 + attempt * 300)); continue; }
          const ulistResult = await this._fetchUlist([idx.secid]);
          if (ulistResult && ulistResult[0]) return ulistResult[0];
          return null;
        }
      }
      return null;
    }));
    const filtered = results.filter(Boolean);
    if (filtered.length && !force) {
      this._cache = filtered;
      this._cacheAt = Date.now();
    }
    return filtered;
  },

  /**
   * 从 ulist.np/get 批量拉取指数数据（备用数据源）
   * 支持 stock/get 不返回数据的海外指数
   */
  async _fetchUlist(secids) {
    if (!secids || !secids.length) return [];
    const url = `${this._ulistEndpoint}?secids=${secids.join(',')}&fields=${this._ulistFields}&_=${Date.now()}`;
    try {
      let data;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json();
      } catch (innerErr) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url });
          if (resp && resp.error) throw new Error(resp.error);
          data = resp && resp.data;
        } else {
          throw innerErr;
        }
      }
      if (!data || !data.data || !data.data.diff) return [];
      const diffMap = {};
      for (const d of data.data.diff) {
        diffMap[d.f12] = d;
      }
      return secids.map(sid => {
        const idx = this.getIndicesBySecids([sid])[0];
        if (!idx) return null;
        const diff = diffMap[idx.code];
        return this._parseUlistDiff(diff, idx);
      }).filter(Boolean);
    } catch (e) {
      console.warn('[Market] ulist backup fetch error', secids, e.message || String(e));
      return [];
    }
  },

  formatChange(p) {
    if (!p || !Number.isFinite(p.price)) return null;
    const change = Number(p.changePercent ?? p.change ?? 0);
    const sign = change >= 0 ? '+' : '';
    const priceDigits = p.market === 'CRYPTO'
      ? (p.price >= 1000 ? 2 : (p.price >= 1 ? 4 : 6))
      : 2;
    return {
      priceStr: Number(p.price).toFixed(priceDigits),
      changeStr: `${sign}${change.toFixed(2)}%`
    };
  }
};
