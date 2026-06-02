/**
 * market.js - 大盘指数行情
 *
 * 支持：A 股 / 港股
 * 用户可在设置中选择显示哪些指数。
 *
 * 数据源：东方财富 push2 接口（走 background 中转避免 CORS）
 *   fields:
 *     f43  最新价（分）  f44 最高  f45 最低  f46 今开
 *     f47  成交量        f48 成交额
 *     f57  代码          f58 名称
 *     f60  昨收（分）    f169 涨跌额（分）  f170 涨跌幅（%×100）
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
    ]
  },

  // 默认选中的指数 secid 列表
  DEFAULT_SELECTED: ['1.000001', '0.399001', '0.399006', '100.HSI'],

  _endpoint: 'https://push2.eastmoney.com/api/qt/stock/get',
  _fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170',
  _cache: null,
  _cacheAt: 0,
  _CACHE_TTL: 10 * 1000,

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
   * 拉取用户选中的指数行情（带 10s 缓存）
   * 走 background 中转避免 CORS
   * @param {string[]} [secids] - 要拉的 secid 列表，默认用 settings.marketIndices 或 DEFAULT_SELECTED
   * @returns {Promise<Array>}
   */
  async fetchAll(secids, force) {
    const ids = secids || this.DEFAULT_SELECTED;
    const indices = this.getIndicesBySecids(ids);
    if (!indices.length) return [];

    if (!force && this._cache && (Date.now() - this._cacheAt) < this._CACHE_TTL) {
      // 检查缓存是否覆盖所请求的 ids
      const cachedIds = new Set(this._cache.map(c => c.secid));
      if (ids.every(id => cachedIds.has(id))) return this._cache;
    }

    const results = await Promise.all(indices.map(async idx => {
      const url = `${this._endpoint}?secid=${idx.secid}&fields=${this._fields}&_=${Date.now()}`;
      // 重试 3 次（service worker 可能未唤醒，首消息可能丢失）
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let resp;
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url });
          } else {
            // 直接 fetch 兜底（非扩展环境或 service worker 不可用）
            const r = await fetch(url);
            resp = { data: await r.json() };
          }
          if (resp && resp.error) {
            console.warn('[Market] fetch error', idx.secid, resp.error);
            if (attempt < 2) { await new Promise(r => setTimeout(r, 300 + attempt * 300)); continue; }
            return null;
          }
          const data = resp && resp.data;
          if (!data || !data.data) return null;
          const d = data.data;
          return {
            secid: idx.secid, code: idx.code, market: idx.market,
            name: d.f58 || idx.name,
            price: (parseFloat(d.f43) || 0) / 100,
            prevClose: (parseFloat(d.f60) || 0) / 100,
            open: (parseFloat(d.f46) || 0) / 100,
            high: (parseFloat(d.f44) || 0) / 100,
            low: (parseFloat(d.f45) || 0) / 100,
            change: (parseFloat(d.f169) || 0) / 100,
            changePercent: (parseFloat(d.f170) || 0) / 100
          };
        } catch (e) {
          console.warn('[Market] fetch exception', idx.secid, e);
          if (attempt < 2) { await new Promise(r => setTimeout(r, 300 + attempt * 300)); continue; }
          return null;
        }
      }
      return null;
    }));
    this._cache = results.filter(Boolean);
    this._cacheAt = Date.now();
    return this._cache;
  },

  formatChange(p) {
    if (!p || !p.price) return null;
    const sign = p.change >= 0 ? '+' : '';
    return {
      priceStr: p.price.toFixed(2),
      changeStr: `${sign}${p.changePercent.toFixed(2)}%`
    };
  }
};
