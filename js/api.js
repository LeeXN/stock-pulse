/**
 * api.js - 行情 / K线 / 分时 数据接口（多 Provider 架构）
 *
 * 公开 API:
 *   StockAPI.init(settings)               - 注入当前设置
 *   StockAPI.getQuotes(codes)              - 实时报价（用 quoteProvider）
 *   StockAPI.getKline(fullCode, period, count)  - K线（用 klineProvider）
 *   StockAPI.getRealtime(fullCode)         - 分时（用 klineProvider）
 *   StockAPI.search(keyword)               - 股票搜索（用搜索接口独立的东财）
 *   StockAPI.listProviders()               - UI 列已注册 provider
 *
 * 注册的 Provider:
 *   tencent    - 腾讯财经（实时报价·批量·最快）
 *   eastmoney  - 东方财富（实时·K线·分时·搜索）
 *   sina       - 新浪财经（实时·K线·分时）
 *   tushare    - Tushare Pro（实时·K线·分时·付费）
 *   juhe       - 聚合数据（实时·K线·分时·付费·A股）
 */

// ===== 通用：fullCode <-> 各家代码格式 =====
const CodeConvert = {
  toTushare(fullCode) {
    const [m, c] = fullCode.split(':');
    if (m === 'HK') return c.padStart(5, '0') + '.HK';
    return c + '.' + m;
  },
  toSinaList(fullCode) {
    const [m, c] = fullCode.split(':');
    return (m === 'HK' ? 'hk' : m.toLowerCase()) + c;
  },
  toSinaSymbol(fullCode) { return this.toSinaList(fullCode); },
  toJuheGid(fullCode) {
    const [m, c] = fullCode.split(':');
    if (m === 'HK') return 'hk' + c;
    return m.toLowerCase() + c;
  }
};

// ===== Provider: 腾讯财经（仅实时报价·批量）=====
const TencentAPI = {
  async getQuotes(codes) {
    if (!codes.length) return {};
    const tcCodes = codes.map(c => {
      const [mkt, code] = c.split(':');
      if (mkt === 'HK') return 'hk' + code;
      return mkt.toLowerCase() + code;
    });
    const url = `https://qt.gtimg.cn/q=${tcCodes.join(',')}`;
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      let text;
      try { text = new TextDecoder('gbk').decode(buf); } catch (_) { text = new TextDecoder('utf-8').decode(buf); }
      const results = {};
      const lines = text.split(';').filter(l => l.trim());
      for (const line of lines) {
        // 支持 A 股（纯数字）和国际股（字母，如 AAPL）
        const match = line.match(/v_([a-z]{2})([A-Za-z0-9]+)="(.+)"/);
        if (!match) continue;
        const [, prefix, code, dataStr] = match;
        const parts = dataStr.split('~');
        if (parts.length < 5) continue;
        let market = 'SZ';
        if (prefix === 'sh') market = 'SH';
        else if (prefix === 'hk') market = 'HK';
        else if (prefix === 'us') market = 'US';
        else if (prefix === 'jp') market = 'JP';
        const fullCode = `${market}:${code}`;
        if (prefix === 'hk') {
          results[fullCode] = {
            code, market, fullCode, name: parts[1],
            price: parseFloat(parts[3]) || 0, prevClose: parseFloat(parts[4]) || 0,
            open: parseFloat(parts[5]) || 0, high: parseFloat(parts[33]) || 0,
            low: parseFloat(parts[34]) || 0, volume: parseFloat(parts[36]) || 0,
            amount: parseFloat(parts[37]) || 0,
            change: parseFloat(parts[31]) || 0, changePercent: parseFloat(parts[32]) || 0,
            time: parts[30] || ''
          };
        } else if (prefix === 'us' || prefix === 'jp') {
          results[fullCode] = {
            code, market, fullCode, name: parts[1],
            price: parseFloat(parts[3]) || 0, prevClose: parseFloat(parts[4]) || 0,
            open: parseFloat(parts[5]) || 0, high: parseFloat(parts[33]) || 0,
            low: parseFloat(parts[34]) || 0, volume: parseFloat(parts[36]) || 0,
            amount: parseFloat(parts[37]) || 0,
            change: parseFloat(parts[31]) || 0, changePercent: parseFloat(parts[32]) || 0,
            time: parts[30] || ''
          };
        } else {
          results[fullCode] = {
            code, market, fullCode, name: parts[1],
            price: parseFloat(parts[3]) || 0, prevClose: parseFloat(parts[4]) || 0,
            open: parseFloat(parts[5]) || 0, high: parseFloat(parts[33]) || 0,
            low: parseFloat(parts[34]) || 0, volume: parseFloat(parts[36]) || 0,
            amount: parseFloat(parts[37]) || 0,
            change: parseFloat(parts[31]) || 0, changePercent: parseFloat(parts[32]) || 0,
            time: parts[30] || ''
          };
        }
      }
      return results;
    } catch (e) { console.error('Tencent quote error:', e); return {}; }
  }
};

// ===== Provider: 东方财富（K线·分时·搜索·实时备选）=====
const EastmoneyAPI = {
  /**
   * fullCode → eastmoney secid 映射
   * SH→1, SZ→0, HK→116, US→105(自动尝试106), JP→113, KR→114, DE→115, UK→115
   */
  _toSecid(market, code) {
    if (market === 'SH') return `1.${code}`;
    if (market === 'SZ') return `0.${code}`;
    if (market === 'HK') return `116.${code}`;
    if (market === 'US') return `105.${code}`;   // NASDAQ default; NYSE fallback in getQuotes
    if (market === 'JP') return `113.${code}`;
    return `100.${code}`;  // fallback
  },

  async search(keyword) {
    if (!keyword || keyword.length < 1) return [];
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.QuotationCodeTable || !data.QuotationCodeTable.Data) return [];
      return data.QuotationCodeTable.Data
        .filter(item => item.Code && item.Name)
        .map(item => {
          let market = 'SZ';
          const mkt = item.SecurityTypeName || '';
          const jys = item.Jys || '';
          const mid = item.MarketId || '';
          if (jys === 'HK' || mid === '116' || mid === '128' || /^[0-9]{5}$/.test(item.Code)) {
            market = 'HK';
          } else if (item.Code.startsWith('6') || item.Code.startsWith('9')) {
            market = 'SH';
          } else if (jys === 'NASDAQ' || jys === 'NYSE' || mid === '105' || mid === '106' ||
                     /^[A-Z]{1,5}$/.test(item.Code)) {
            market = 'US';
          } else if (jys === 'JP' || mid === '113') {
            market = 'JP';
          }
          return { code: item.Code, name: item.Name, market, fullCode: `${market}:${item.Code}` };
        }).slice(0, 10);
    } catch (e) { console.error('Eastmoney search error:', e); return []; }
  },

  // 东财实时报价（每只一次请求，比腾讯慢，仅作 fallback 或 K线联动时用）
  async getQuotes(codes) {
    const results = {};
    for (const fullCode of codes) {
      const [market, code] = fullCode.split(':');
      let secid = this._toSecid(market, code);
      if (!secid) continue;
      const buildUrl = (sid) => `https://push2.eastmoney.com/api/qt/stock/get?secid=${sid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f51,f52,f168,f167,f169,f170,f50,f117,f59,f292`;
      try {
        let data;
        try {
          const resp = await fetch(buildUrl(secid));
          data = await resp.json();
        } catch (e0) {
          // 直接 fetch 失败，走 background 中转
          try {
            const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
            if (resp && resp.data) data = resp.data;
            else throw new Error(resp?.error || 'no data');
          } catch (e1) {
            console.warn('Eastmoney quote failed', fullCode, e1);
            continue;
          }
        }
        // US: 如果 105 没数据，尝试 106（NYSE）
        if ((!data.data || !data.data.f43) && market === 'US') {
          secid = `106.${code}`;
          try {
            const resp2 = await fetch(buildUrl(secid));
            data = await resp2.json();
          } catch (_) {
            try {
              const resp2 = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
              if (resp2 && resp2.data) data = resp2.data;
            } catch (_) {}
          }
        }
        const d = data.data;
        if (!d) continue;
        const isIntl = market !== 'SH' && market !== 'SZ' && market !== 'HK';
        results[fullCode] = {
          code, market, fullCode,
          name: d.f58 || '',
          price: isIntl ? (parseFloat(d.f43) || 0) : ((parseFloat(d.f43) || 0) / 100),
          prevClose: isIntl ? (parseFloat(d.f60) || 0) : ((parseFloat(d.f60) || 0) / 100),
          open: isIntl ? (parseFloat(d.f46) || 0) : ((parseFloat(d.f46) || 0) / 100),
          high: isIntl ? (parseFloat(d.f44) || 0) : ((parseFloat(d.f44) || 0) / 100),
          low: isIntl ? (parseFloat(d.f45) || 0) : ((parseFloat(d.f45) || 0) / 100),
          volume: parseFloat(d.f47) || 0,
          amount: parseFloat(d.f48) || 0,
          change: isIntl ? (parseFloat(d.f169) || 0) : ((parseFloat(d.f169) || 0) / 100),
          changePercent: isIntl ? (parseFloat(d.f170) || 0) : ((parseFloat(d.f170) || 0) / 100),
          time: ''
        };
      } catch (e) { console.warn('Eastmoney quote failed', fullCode, e); }
    }
    return results;
  },

  async getKline(fullCode, period = 'daily', count = 120) {
    const [market, code] = fullCode.split(':');
    let secid = this._toSecid(market, code);
    if (!secid) return [];

    const kltMap = { daily: 101, weekly: 102, monthly: 103, yearly: 103 };
    const klt = kltMap[period] || 101;

    const buildUrl = (sid) => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${sid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=1&lmt=${count}&end=20500101&_=${Date.now()}`;

    let data;
    try {
      const resp = await fetch(buildUrl(secid));
      data = await resp.json();
    } catch (e) {
      console.warn('[API] kline direct fetch failed, trying background:', fullCode, e);
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
        if (resp && resp.data) data = resp.data;
        else throw new Error(resp?.error || 'background fetch returned no data');
      } catch (e2) {
        console.error('[API] kline background fetch also failed:', fullCode, e2);
        return [];
      }
    }

    // US fallback: try 106 if 105 returns no data
    if ((!data.data || !data.data.klines) && market === 'US') {
      secid = `106.${code}`;
      try {
        const resp2 = await fetch(buildUrl(secid));
        data = await resp2.json();
      } catch (_) {
        try {
          const resp2 = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
          if (resp2 && resp2.data) data = resp2.data;
        } catch (_) {}
      }
    }
    if (!data.data || !data.data.klines) return [];
    let klines = data.data.klines.map(line => {
      const p = line.split(',');
      return {
        time: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]),
        high: parseFloat(p[3]), low: parseFloat(p[4]), volume: parseFloat(p[5]),
        amount: parseFloat(p[6]), turnover: parseFloat(p[10]) || 0
      };
    });
    if (period === 'yearly') klines = this._aggregateYearly(klines);
    return klines;
  },

  async getRealtime(fullCode) {
    const [market, code] = fullCode.split(':');
    let secid = this._toSecid(market, code);
    if (!secid) return { prevClose: 0, points: [] };

    const buildUrl = (sid) => `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${sid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&_=${Date.now()}`;

    let data;
    try {
      const resp = await fetch(buildUrl(secid));
      data = await resp.json();
    } catch (e) {
      console.warn('[API] realtime direct fetch failed, trying background:', fullCode, e);
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
        if (resp && resp.data) data = resp.data;
        else throw new Error(resp?.error || 'background fetch returned no data');
      } catch (e2) {
        console.error('[API] realtime background fetch also failed:', fullCode, e2);
        return { prevClose: 0, points: [] };
      }
    }

    if (!data.data || !data.data.trends) return { prevClose: 0, points: [] };
    const prevClose = data.data.prePrice || data.data.preClose || 0;
    return {
      prevClose,
      points: data.data.trends.map(line => {
        const p = line.split(',');
        return { time: p[0], price: parseFloat(p[2]), avgPrice: parseFloat(p[7]) || parseFloat(p[2]), volume: parseFloat(p[5]) };
      })
    };
  },

  _aggregateYearly(monthlyData) {
    const yearMap = {};
    for (const d of monthlyData) {
      const year = d.time.substring(0, 4);
      if (!yearMap[year]) {
        yearMap[year] = { time: year + '-01-01', open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume, amount: d.amount };
      } else {
        const y = yearMap[year];
        y.high = Math.max(y.high, d.high);
        y.low = Math.min(y.low, d.low);
        y.close = d.close;
        y.volume += d.volume;
        y.amount += d.amount;
      }
    }
    return Object.values(yearMap).sort((a, b) => a.time.localeCompare(b.time));
  }
};

// ===== Provider: Tushare Pro =====
const TushareAPI = {
  _endpoint: 'https://api.tushare.pro',

  _tushareDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  },
  _chartDate(s) {
    if (typeof s !== 'string' || s.length !== 8) return s;
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  },

  async _call(apiName, params, fields, settings) {
    const body = { api_name: apiName, token: settings.tushareToken, params: params || {}, fields: fields || '' };
    const resp = await fetch(this._endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.code !== 0) throw new Error('Tushare ' + apiName + ' 错误: ' + (data.msg || '未知错误'));
    return data.data || { fields: [], items: [] };
  },

  async getKline(fullCode, period = 'daily', count = 120, settings) {
    const tsCode = CodeConvert.toTushare(fullCode);
    const freqMap = { daily: 'D', weekly: 'W', monthly: 'M' };
    const freq = freqMap[period] || 'D';
    const end = new Date();
    const start = new Date(end.getTime() - count * 2 * 24 * 3600 * 1000);
    const data = await this._call('pro_bar', {
      ts_code: tsCode, freq, start_date: this._tushareDate(start), end_date: this._tushareDate(end), adj: 'qfq'
    }, 'trade_date,open,high,low,close,vol', settings);
    if (!data.items) return [];
    const out = data.items.map(row => ({
      time: this._chartDate(row[0]),
      open: parseFloat(row[1]) || 0, high: parseFloat(row[2]) || 0,
      low: parseFloat(row[3]) || 0, close: parseFloat(row[4]) || 0,
      volume: parseFloat(row[5]) || 0
    })).sort((a, b) => a.time.localeCompare(b.time));
    if (period === 'yearly') return this._aggregateYearly(out);
    return out.slice(-count);
  },

  async getRealtime(fullCode, settings) {
    const tsCode = CodeConvert.toTushare(fullCode);
    const today = this._tushareDate(new Date());
    const data = await this._call('pro_bar', {
      ts_code: tsCode, freq: '1min', start_date: today, end_date: today, adj: 'qfq'
    }, 'trade_time,open,close,high,low,vol', settings);
    if (!data.items || !data.items.length) return { prevClose: 0, points: [] };
    const points = data.items.map(row => ({
      time: String(row[0]).slice(-8),
      price: parseFloat(row[2]) || 0,
      avgPrice: parseFloat(row[2]) || 0,
      volume: parseFloat(row[5]) || 0
    }));
    const prevClose = parseFloat(data.items[0][1]) || 0;
    return { prevClose, points };
  },

  async getQuotes(codes, settings) {
    if (!codes.length) return {};
    const results = {};
    for (const fullCode of codes) {
      try {
        const tsCode = CodeConvert.toTushare(fullCode);
        const today = this._tushareDate(new Date());
        const data = await this._call('pro_bar', {
          ts_code: tsCode, freq: 'D', start_date: today, end_date: today, adj: 'qfq'
        }, 'trade_date,open,high,low,close,vol,pre_close', settings);
        if (data.items && data.items[0]) {
          const [date, open, high, low, close, vol, preClose] = data.items[0];
          const [m, c] = fullCode.split(':');
          const prevClose = parseFloat(preClose) || 0;
          const price = parseFloat(close) || 0;
          results[fullCode] = {
            code: c, market: m, fullCode, name: '',
            price, prevClose, open: parseFloat(open) || 0,
            high: parseFloat(high) || 0, low: parseFloat(low) || 0,
            volume: parseFloat(vol) || 0, amount: 0,
            change: price - prevClose,
            changePercent: prevClose ? ((price - prevClose) / prevClose * 100) : 0,
            time: this._chartDate(date)
          };
        }
      } catch (e) { console.warn('Tushare quote failed', fullCode, e); }
    }
    return results;
  },

  _aggregateYearly(monthlyData) {
    const yearMap = {};
    for (const d of monthlyData) {
      const year = d.time.substring(0, 4);
      if (!yearMap[year]) {
        yearMap[year] = { time: year + '-01-01', open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume };
      } else {
        const y = yearMap[year];
        y.high = Math.max(y.high, d.high);
        y.low = Math.min(y.low, d.low);
        y.close = d.close;
        y.volume += d.volume;
      }
    }
    return Object.values(yearMap).sort((a, b) => a.time.localeCompare(b.time));
  }
};

// ===== Provider: 新浪财经 =====
const SinaAPI = {
  async getQuotes(codes) {
    if (!codes.length) return {};
    const symbols = codes.map(c => CodeConvert.toSinaList(c));
    const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      // Sina 返回 GBK 编码，需用 TextDecoder 解码
      let text;
      try { text = new TextDecoder('gbk').decode(buf); } catch (_) { text = new TextDecoder('utf-8').decode(buf); }
      const results = {};
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const m = line.match(/hq_str_([a-z]{2})([A-Za-z0-9]+)="(.+)"/);
        if (!m) continue;
        const [, prefix, code, dataStr] = m;
        const parts = dataStr.split(',');
        let market = 'SZ';
        if (prefix === 'sh') market = 'SH';
        else if (prefix === 'hk') market = 'HK';
        else if (prefix === 'us') market = 'US';
        else if (prefix === 'jp') market = 'JP';
        const fullCode = `${market}:${code}`;
        if (prefix === 'hk') {
          results[fullCode] = {
            code, market, fullCode, name: parts[0] || '',
            price: parseFloat(parts[6]) || 0, prevClose: parseFloat(parts[3]) || 0,
            open: parseFloat(parts[3]) || 0, high: parseFloat(parts[4]) || 0,
            low: parseFloat(parts[5]) || 0, volume: 0, amount: 0,
            change: parseFloat(parts[7]) || 0, changePercent: parseFloat(parts[8]) || 0,
            time: ''
          };
        } else {
          results[fullCode] = {
            code, market, fullCode, name: parts[0] || '',
            price: parseFloat(parts[3]) || 0, prevClose: parseFloat(parts[2]) || 0,
            open: parseFloat(parts[1]) || 0, high: parseFloat(parts[4]) || 0,
            low: parseFloat(parts[5]) || 0, volume: parseFloat(parts[8]) || 0,
            amount: parseFloat(parts[9]) || 0,
            change: (parseFloat(parts[3]) || 0) - (parseFloat(parts[2]) || 0),
            changePercent: parts[2] ? (((parseFloat(parts[3]) || 0) - parseFloat(parts[2])) / parseFloat(parts[2]) * 100) : 0,
            time: parts[30] || ''
          };
        }
      }
      return results;
    } catch (e) { console.error('Sina quote error:', e); return {}; }
  },

  async getKline(fullCode, period = 'daily', count = 120) {
    const [market] = fullCode.split(':');
    try {
      if (market === 'HK') return await this._getHKLine(fullCode, period, count);
      return await this._getCNLine(fullCode, period, count);
    } catch (e) { console.error('Sina kline error:', e); return []; }
  },

  async _getCNLine(fullCode, period, count) {
    const symbol = CodeConvert.toSinaSymbol(fullCode);
    const scaleMap = { daily: 240, weekly: 1680, monthly: 43200, yearly: 43200 };
    const scale = scaleMap[period] || 240;
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${count}`;
    const text = await (await fetch(url)).text();
    const start = text.indexOf('[');
    const json = text.slice(start, text.lastIndexOf(']') + 1);
    let arr;
    try { arr = JSON.parse(json); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = arr.map(row => ({
      time: row.day,
      open: parseFloat(row.open) || 0, high: parseFloat(row.high) || 0,
      low: parseFloat(row.low) || 0, close: parseFloat(row.close) || 0,
      volume: parseFloat(row.volume) || 0
    }));
    if (period === 'yearly') return this._aggregateYearly(out);
    return out;
  },

  async _getHKLine(fullCode, period, count) {
    const [, code] = fullCode.split(':');
    const url = `https://stock.finance.sina.com.cn/hkstock/api/jsonp.php/HK_MarketDataService.getDayLine?symbol=${code}&type=normal&count=${count}&_=${Date.now()}`;
    const text = await (await fetch(url)).text();
    const start = text.indexOf('[');
    const json = text.slice(start, text.lastIndexOf(']') + 1);
    let arr;
    try { arr = JSON.parse(json); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = arr.map(row => ({
      time: row.day,
      open: parseFloat(row.open) || 0, high: parseFloat(row.high) || 0,
      low: parseFloat(row.low) || 0, close: parseFloat(row.close) || 0,
      volume: 0
    }));
    if (period === 'yearly') return this._aggregateYearly(out);
    return out;
  },

  async getRealtime(fullCode) {
    const [market] = fullCode.split(':');
    if (market === 'HK') {
      const klines = await this._getHKLine(fullCode, 'daily', 2);
      if (!klines.length) return { prevClose: 0, points: [] };
      return { prevClose: klines[0].close, points: [] };
    }
    const symbol = CodeConvert.toSinaSymbol(fullCode);
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var=/CN_MarketDataService.getMinLine?symbol=${symbol}&datalen=240`;
    const text = await (await fetch(url)).text();
    const start = text.indexOf('[');
    const json = text.slice(start, text.lastIndexOf(']') + 1);
    let arr;
    try { arr = JSON.parse(json); } catch (e) { return { prevClose: 0, points: [] }; }
    const points = arr.map(row => ({
      time: row.day + ' ' + (row.minute || ''),
      price: parseFloat(row.price) || 0,
      avgPrice: parseFloat(row.avg_price) || parseFloat(row.price) || 0,
      volume: parseFloat(row.volume) || 0
    }));
    const prevClose = points[0] ? (points[0].price - (parseFloat(arr[0].price_change) || 0)) : 0;
    return { prevClose, points };
  },

  _aggregateYearly(monthlyData) {
    const yearMap = {};
    for (const d of monthlyData) {
      const year = d.time.substring(0, 4);
      if (!yearMap[year]) {
        yearMap[year] = { time: year + '-01-01', open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume };
      } else {
        const y = yearMap[year];
        y.high = Math.max(y.high, d.high);
        y.low = Math.min(y.low, d.low);
        y.close = d.close;
        y.volume += d.volume;
      }
    }
    return Object.values(yearMap).sort((a, b) => a.time.localeCompare(b.time));
  }
};

// ===== Provider: 聚合数据（仅 A 股）=====
const JuheAPI = {
  _endpoint: 'https://web.juhe.cn/finance',

  async getQuotes(codes, settings) {
    if (!codes.length) return {};
    const results = {};
    for (const fullCode of codes) {
      const [market] = fullCode.split(':');
      const isHK = market === 'HK';
      const url = isHK
        ? `${this._endpoint}/stock/hk?key=${settings.juheKey}&num=${CodeConvert.toJuheGid(fullCode)}`
        : `${this._endpoint}/stock/hs?key=${settings.juheKey}&gid=${CodeConvert.toJuheGid(fullCode)}`;
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.error_code !== 0) { console.warn('Juhe quote error', fullCode, data.reason); continue; }
        const [m, c] = fullCode.split(':');
        const d = data.result && (data.result[0] || data.result);
        if (!d) continue;
        if (isHK) {
          results[fullCode] = {
            code: c, market: m, fullCode, name: d.name || d.stockname || '',
            price: parseFloat(d.nowPrice || d.price) || 0,
            prevClose: parseFloat(d.yesterdayPrice || d.prevClose) || 0,
            open: parseFloat(d.openPrice) || 0, high: parseFloat(d.highPrice) || 0,
            low: parseFloat(d.lowPrice) || 0, volume: parseFloat(d.volume) || 0,
            amount: 0, change: parseFloat(d.hnow) || 0, changePercent: parseFloat(d.hnowP) || 0,
            time: d.date || ''
          };
        } else {
          results[fullCode] = {
            code: c, market: m, fullCode, name: d.name || '',
            price: parseFloat(d.nowPrice) || 0,
            prevClose: parseFloat(d.yesterdayPrice) || 0,
            open: parseFloat(d.openPrice) || 0, high: parseFloat(d.highPrice) || 0,
            low: parseFloat(d.lowPrice) || 0, volume: parseFloat(d.tradeNum) || 0,
            amount: parseFloat(d.tradeAmount) || 0,
            change: parseFloat(d.hnow) || 0, changePercent: parseFloat(d.hnowP) || 0,
            time: d.date || ''
          };
        }
      } catch (e) { console.warn('Juhe quote failed', fullCode, e); }
    }
    return results;
  },

  async getKline(fullCode, period = 'daily', count = 120, settings) {
    const [market, code] = fullCode.split(':');
    if (market === 'HK') { console.warn('Juhe HK K线暂未实现'); return []; }
    const typeMap = { realtime: 1, daily: 101, weekly: 102, monthly: 103, yearly: 103 };
    const type = typeMap[period] || 101;
    const url = `${this._endpoint}/stock/hskline?key=${settings.juheKey}&gid=${CodeConvert.toJuheGid(fullCode)}&type=${type}&datalen=${count}`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error_code !== 0) { console.warn('Juhe kline error', data.reason); return []; }
      const arr = Array.isArray(data.result) ? data.result : (data.result && data.result.data) || [];
      const out = arr.map(row => ({
        time: typeof row[0] === 'string' ? row[0].replace(/\//g, '-') : row[0],
        open: parseFloat(row[1]) || 0, close: parseFloat(row[2]) || 0,
        high: parseFloat(row[3]) || 0, low: parseFloat(row[4]) || 0,
        volume: parseFloat(row[5]) || 0
      }));
      if (period === 'yearly') return this._aggregateYearly(out);
      return out;
    } catch (e) { console.error('Juhe kline error:', e); return []; }
  },

  async getRealtime(fullCode, settings) {
    const [market] = fullCode.split(':');
    if (market === 'HK') return { prevClose: 0, points: [] };
    const url = `${this._endpoint}/stock/hsmindata?key=${settings.juheKey}&gid=${CodeConvert.toJuheGid(fullCode)}&type=1`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error_code !== 0 || !Array.isArray(data.result)) return { prevClose: 0, points: [] };
      const points = data.result.map(row => ({
        time: row[0], price: parseFloat(row[1]) || 0,
        avgPrice: parseFloat(row[2]) || parseFloat(row[1]) || 0,
        volume: parseFloat(row[3]) || 0
      }));
      const prevClose = points[0] ? (points[0].price - (parseFloat(data.result[0][4]) || 0)) : 0;
      return { prevClose, points };
    } catch (e) { console.error('Juhe realtime error:', e); return { prevClose: 0, points: [] }; }
  },

  _aggregateYearly(monthlyData) {
    const yearMap = {};
    for (const d of monthlyData) {
      const year = String(d.time).substring(0, 4);
      if (!yearMap[year]) {
        yearMap[year] = { time: year + '-01-01', open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume };
      } else {
        const y = yearMap[year];
        y.high = Math.max(y.high, d.high);
        y.low = Math.min(y.low, d.low);
        y.close = d.close;
        y.volume += d.volume;
      }
    }
    return Object.values(yearMap).sort((a, b) => a.time.localeCompare(b.time));
  }
};

// ===== Provider Registry =====
const Providers = {
  tencent: {
    id: 'tencent',
    label: '腾讯财经',
    caps: { quote: true, kline: false },
    requires: [],
    impl: TencentAPI
  },
  eastmoney: {
    id: 'eastmoney',
    label: '东方财富',
    caps: { quote: true, kline: true },
    requires: [],
    impl: EastmoneyAPI
  },
  sina: {
    id: 'sina',
    label: '新浪财经',
    caps: { quote: true, kline: true },
    requires: [],
    impl: SinaAPI
  },
  tushare: {
    id: 'tushare',
    label: 'Tushare Pro',
    caps: { quote: true, kline: true },
    requires: ['tushareToken'],
    impl: TushareAPI
  },
  juhe: {
    id: 'juhe',
    label: '聚合数据',
    caps: { quote: true, kline: true },
    requires: ['juheKey'],
    impl: JuheAPI
  }
};

// ===== Public API =====
const StockAPI = {
  _settings: {
    quoteProvider: 'tencent',
    klineProvider: 'eastmoney',
    intlQuoteProvider: '',
    intlKlineProvider: '',
    tushareToken: '',
    juheKey: ''
  },

  _INTL_MARKETS: new Set(['HK', 'US', 'JP', 'KR', 'DE', 'UK']),

  init(settings) {
    const s = settings || {};
    // 兼容旧版 dataProvider 字段
    if (s.dataProvider && !s.quoteProvider) {
      const map = { free: 'tencent', tushare: 'tushare', sina: 'sina', juhe: 'juhe' };
      const id = map[s.dataProvider] || 'tencent';
      s.quoteProvider = id;
      s.klineProvider = id === 'tencent' ? 'eastmoney' : id;
    }
    this._settings = Object.assign({}, this._settings, s);
  },

  _isIntl(fullCode) {
    const market = fullCode.split(':')[0];
    return this._INTL_MARKETS.has(market);
  },

  _getQuoteProvider(intl) {
    if (intl && this._settings.intlQuoteProvider) {
      return Providers[this._settings.intlQuoteProvider] || Providers[this._settings.quoteProvider || 'tencent'];
    }
    return Providers[this._settings.quoteProvider || 'tencent'];
  },
  _getKlineProvider(intl) {
    if (intl && this._settings.intlKlineProvider) {
      return Providers[this._settings.intlKlineProvider] || Providers[this._settings.klineProvider || 'eastmoney'];
    }
    return Providers[this._settings.klineProvider || 'eastmoney'];
  },
  _checkRequirements(p, action) {
    if (!p) return `未注册的 provider`;
    if (!p.caps[action]) return `「${p.label}」不支持${action === 'quote' ? '实时报价' : 'K线/分时'}（仅支持${Object.keys(p.caps).filter(k => p.caps[k]).join('、')}）`;
    if (!p.requires || !p.requires.length) return null;
    const missing = p.requires.filter(k => !this._settings[k]);
    return missing.length ? `「${p.label}」需要配置：${missing.join(', ')}` : null;
  },

  async getQuotes(codes) {
    if (!codes.length) return {};
    // Split codes into domestic and international
    const domestic = [], intl = [];
    for (const c of codes) { (this._isIntl(c) ? intl : domestic).push(c); }
    const results = {};
    if (domestic.length) {
      const p = this._getQuoteProvider(false);
      const err = this._checkRequirements(p, 'quote');
      if (!err) Object.assign(results, await p.impl.getQuotes(domestic, this._settings));
    }
    if (intl.length) {
      const p = this._getQuoteProvider(true);
      const err = this._checkRequirements(p, 'quote');
      if (!err) Object.assign(results, await p.impl.getQuotes(intl, this._settings));
    }
    return results;
  },

  async getKline(fullCode, period, count) {
    const intl = this._isIntl(fullCode);
    const p = this._getKlineProvider(intl);
    const err = this._checkRequirements(p, 'kline');
    if (err) throw new Error(err);
    return p.impl.getKline(fullCode, period, count, this._settings);
  },

  async getRealtime(fullCode) {
    const intl = this._isIntl(fullCode);
    const p = this._getKlineProvider(intl);
    const err = this._checkRequirements(p, 'kline');
    if (err) throw new Error(err);
    return p.impl.getRealtime(fullCode, this._settings);
  },

  async search(keyword) {
    // 搜索走东财（暂时没其他 provider 实现）
    return EastmoneyAPI.search(keyword);
  },

  listProviders() {
    return Object.values(Providers).map(({ id, label, caps, requires }) => ({ id, label, caps, requires }));
  },

  getActiveProviders() {
    return {
      quote: this._getQuoteProvider().id,
      kline: this._getKlineProvider().id
    };
  }
};
