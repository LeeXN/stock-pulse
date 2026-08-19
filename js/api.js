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
    // Sina supports: sh, sz, hk, us, jp. Others not supported by Sina.
    const sinaMap = { SH: 'sh', SZ: 'sz', HK: 'hk', US: 'us', JP: 'jp' };
    const prefix = sinaMap[m];
    return prefix ? prefix + c : '';
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
      // Tencent supports: sh, sz, us, jp, hk. Others not supported.
      if (mkt === 'US') return 'us' + code;
      if (mkt === 'JP') return 'jp' + code;
      if (mkt === 'SH') return 'sh' + code;
      if (mkt === 'SZ') return 'sz' + code;
      return '';  // Unsupported market
    }).filter(Boolean);
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
   * Based on EastMoney QuoteID format (from search API):
   * SH→1, SZ→0, HK→116, US→105/106, JP→176, KR→177
   */
  _toSecid(market, code) {
    if (market === 'SH') return `1.${code}`;
    if (market === 'SZ') return `0.${code}`;
    if (market === 'HK') return `116.${code}`;
    if (market === 'US') return `105.${code}`;
    if (market === 'JP') return `176.${code}`;
    if (market === 'KR') return `177.${code}`;
    // EU, TW, IN, VN not supported by EastMoney quote/K-line APIs
    return '';
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
          const classify = item.Classify || '';
          const mktType = item.MarketType || '';
          const mktNum = item.MktNum || '';
          const id = item.ID || '';

          // 韩股: Classify=KRX, MarketType=_KRX, MktNum=177, ID=xxx_KRX
          if (mkt === '韩股' || classify === 'KRX' || mktType === '_KRX' || mktNum === '177' || id.endsWith('_KRX')) {
            market = 'KR';
          // 日股: Classify=JPX, MarketType=_JPX, MktNum=176, ID=xxx_JPX
          } else if (mkt === '日股' || classify === 'JPX' || mktType === '_JPX' || mktNum === '176' || id.endsWith('_JPX')) {
            market = 'JP';
          // 港股: Classify=HK, MarketType=5, MktNum=116
          } else if (mkt === '港股' || classify === 'HK' || mktNum === '116') {
            market = 'HK';
          // 美股: Classify=UsStock, MktNum=105/106, ID ends with 7
          } else if (mkt === '美股' || classify === 'UsStock' || mktNum === '105' || mktNum === '106' ||
                     /^[A-Z]{1,5}$/.test(item.Code)) {
            market = 'US';
          // 英股/欧股: Classify=LSE, MarketType=_UKS, MktNum=155
          } else if (mkt === '英股' || mkt === '德股' || mkt === '法股' || mkt === '欧股' ||
                     classify === 'LSE' || mktType === '_UKS' || mktNum === '155') {
            market = 'EU';
          // 沪A: MktNum=1, ID ends with 1
          } else if (item.Code.startsWith('6') || item.Code.startsWith('9') || mktNum === '1' || id.endsWith('1')) {
            market = 'SH';
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
      if (!secid) { console.warn('[Eastmoney getQuotes] no secid for', fullCode); continue; }
      console.log('[Eastmoney getQuotes]', fullCode, '-> secid:', secid);
      const buildUrl = (sid) => `https://push2.eastmoney.com/api/qt/stock/get?secid=${sid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f51,f52,f168,f167,f169,f170,f50,f117,f59,f292`;
        try {
          let data;
          try {
            const resp = await fetch(buildUrl(secid));
            data = await resp.json();
          } catch (e0) {
            console.warn('[Eastmoney getQuotes] direct fetch failed for', fullCode, e0.message);
            try {
              const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
              if (resp && resp.data) data = resp.data;
              else throw new Error(resp?.error || 'no data');
            } catch (e1) {
              console.warn('[Eastmoney getQuotes] background fetch also failed for', fullCode, e1.message);
              // 所有请求都失败，尝试 ulist.np/get 作为最后手段
              if (market === 'JP' || market === 'KR') {
                console.log('[Eastmoney getQuotes]', fullCode, 'all fetch methods failed, trying ulist.np/get as fallback');
                try {
                  const resp = await chrome.runtime.sendMessage({
                    type: 'sp:fetch-ulist',
                    secids: secid,
                    fields: 'f2,f3,f4,f14,f15,f16,f17'
                  });
                  if (resp && resp.data) {
                    const ulistData = resp.data;
                    console.log('[Eastmoney getQuotes]', fullCode, 'ulist.np/get fallback response:', JSON.stringify(ulistData).substring(0, 300));
                    if (ulistData && ulistData.data && ulistData.data.diff && ulistData.data.diff.length > 0) {
                      const ud = ulistData.data.diff[0];
                      results[fullCode] = {
                        code, market, fullCode,
                        name: ud.f14 || '',
                        price: parseFloat(ud.f2) || 0,
                        prevClose: parseFloat(ud.f15) || 0,
                        open: parseFloat(ud.f15) || 0,
                        high: parseFloat(ud.f17) || 0,
                        low: parseFloat(ud.f16) || 0,
                        volume: 0, amount: 0,
                        change: parseFloat(ud.f4) || 0,
                        changePercent: parseFloat(ud.f3) || 0,
                        time: ''
                      };
                    }
                  }
                } catch (e2) {
                  console.error('[Eastmoney getQuotes]', fullCode, 'ulist.np/get fallback also failed:', e2.message);
                }
              }
              continue;
            }
          }
        console.log('[Eastmoney getQuotes]', fullCode, '-> raw response:', JSON.stringify(data).substring(0, 200));
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
        // JP/KR: 如果 stock/get 没数据，尝试 ulist.np/get 备用接口
        if ((!data.data || !data.data.f43) && (market === 'JP' || market === 'KR')) {
          console.log('[Eastmoney getQuotes]', fullCode, 'stock/get returned no data, trying ulist.np/get via background');
          try {
            const resp = await chrome.runtime.sendMessage({
              type: 'sp:fetch-ulist',
              secids: secid,
              fields: 'f2,f3,f4,f14,f15,f16,f17'
            });
            if (resp && resp.data) {
              data = resp.data;
              console.log('[Eastmoney getQuotes]', fullCode, 'ulist.np/get response:', JSON.stringify(data).substring(0, 300));
              if (data && data.data && data.data.diff && data.data.diff.length > 0) {
                const ulistData = data.data.diff[0];
                data = {
                  data: {
                    f58: ulistData.f14 || '',
                    f43: ulistData.f2 || 0,
                    f60: ulistData.f15 || 0,
                    f46: ulistData.f15 || 0,
                    f44: ulistData.f17 || 0,
                    f45: ulistData.f16 || 0,
                    f169: ulistData.f4 || 0,
                    f170: ulistData.f3 || 0
                  }
                };
              }
            }
          } catch (e) {
            console.error('[Eastmoney getQuotes]', fullCode, 'ulist.np/get fallback failed:', e.message);
          }
        }
        const d = data.data;
        if (!d) continue;
        const isAStock = market === 'SH' || market === 'SZ';
        const precisionRaw = Number(d.f59);
        const precision = Number.isFinite(precisionRaw) && precisionRaw >= 0 ? precisionRaw : (isAStock ? 2 : 2);
        const priceScale = Math.pow(10, precision);
        results[fullCode] = {
          code, market, fullCode,
          name: d.f58 || '',
          price: (parseFloat(d.f43) || 0) / priceScale,
          prevClose: (parseFloat(d.f60) || 0) / priceScale,
          open: (parseFloat(d.f46) || 0) / priceScale,
          high: (parseFloat(d.f44) || 0) / priceScale,
          low: (parseFloat(d.f45) || 0) / priceScale,
          volume: parseFloat(d.f47) || 0,
          amount: parseFloat(d.f48) || 0,
          change: (parseFloat(d.f169) || 0) / priceScale,
          changePercent: (parseFloat(d.f170) || 0) / 100,
          time: ''
        };
      } catch (e) { console.warn('Eastmoney quote failed', fullCode, e); }
    }
    return results;
  },

  async getKline(fullCode, period = 'daily', count = 120) {
    const [market, code] = fullCode.split(':');
    let secid = this._toSecid(market, code);
    if (!secid) { console.warn('[Eastmoney getKline]', fullCode, '-> no secid'); return []; }
    console.log('[Eastmoney getKline]', fullCode, '-> secid:', secid, 'period:', period, 'count:', count);

    const kltMap = { daily: 101, weekly: 102, monthly: 103, yearly: 103 };
    const klt = kltMap[period] || 101;

    // 使用未复权价格，才能和用户录入的券商成交价、实时价保持同一口径。
    const buildUrl = (sid) => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${sid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=${klt}&fqt=0&lmt=${count}&end=20500101&_=${Date.now()}`;

    let data;
    try {
      const resp = await fetch(buildUrl(secid));
      data = await resp.json();
    } catch (e) {
      console.warn('[Eastmoney getKline]', fullCode, 'direct fetch failed:', e.message, ', trying background...');
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
        if (resp && resp.data) data = resp.data;
        else throw new Error(resp?.error || 'background fetch returned no data');
      } catch (e2) {
        console.error('[Eastmoney getKline]', fullCode, 'background fetch also failed:', e2.message);
        return [];
      }
    }

    console.log('[Eastmoney getKline]', fullCode, '-> response rc:', data?.rc, 'hasKlines:', !!data?.data?.klines, 'klineCount:', data?.data?.klines?.length);
    // US fallback: try 106 if 105 returns no data
    if ((!data.data || !data.data.klines) && market === 'US') {
      console.log('[Eastmoney getKline]', fullCode, '-> 105 returned no data, trying 106');
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
    if (!data.data || !data.data.klines) {
      console.warn('[Eastmoney getKline]', fullCode, '-> no klines data. Full response:', JSON.stringify(data).substring(0, 300));
      return [];
    }
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
    if (!secid) { console.warn('[Eastmoney getRealtime]', fullCode, '-> no secid'); return { prevClose: 0, points: [] }; }
    console.log('[Eastmoney getRealtime]', fullCode, '-> secid:', secid);

    const buildUrl = (sid) => `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${sid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&_=${Date.now()}`;

    let data;
    try {
      const resp = await fetch(buildUrl(secid));
      data = await resp.json();
    } catch (e) {
      console.warn('[Eastmoney getRealtime]', fullCode, 'direct fetch failed:', e.message, ', trying background...');
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: buildUrl(secid) });
        if (resp && resp.data) data = resp.data;
        else throw new Error(resp?.error || 'background fetch returned no data');
      } catch (e2) {
        console.error('[Eastmoney getRealtime]', fullCode, 'background fetch also failed:', e2.message);
        return { prevClose: 0, points: [] };
      }
    }

    console.log('[Eastmoney getRealtime]', fullCode, '-> response rc:', data?.rc, 'hasTrends:', !!data?.data?.trends, 'trendCount:', data?.data?.trends?.length);
    if (!data.data || !data.data.trends) {
      console.warn('[Eastmoney getRealtime]', fullCode, '-> no trends data, trying ulist.np/get fallback');
      if (market === 'JP' || market === 'KR') {
        try {
          const ulistUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secid}&fields=f2,f3,f4,f14,f15,f16,f17`;
          let ulistResp;
          try { ulistResp = await fetch(ulistUrl); data = await ulistResp.json(); } catch (e0) {
            const r = await chrome.runtime.sendMessage({ type: 'sp:fetch-url', url: ulistUrl });
            if (r && r.data) data = r.data;
          }
          if (data && data.data && data.data.diff && data.data.diff.length > 0) {
            const ud = data.data.diff[0];
            const price = parseFloat(ud.f2) || 0;
            const prevClose = parseFloat(ud.f15) || 0;
            console.log('[Eastmoney getRealtime]', fullCode, '-> ulist.np/get fallback: price=', price, 'prevClose=', prevClose);
            return {
              prevClose,
              points: [{ time: 'latest', price, avgPrice: price, volume: 0 }]
            };
          }
        } catch (e) {
          console.warn('[Eastmoney getRealtime]', fullCode, 'ulist.np/get fallback failed:', e.message);
        }
      }
      console.warn('[Eastmoney getRealtime]', fullCode, '-> no trends data. Full response:', JSON.stringify(data).substring(0, 300));
      return { prevClose: 0, points: [] };
    }
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

// ===== Crypto API (Binance + DexScreener) =====
const CryptoAPI = {
  _binanceBase: 'https://api.binance.com/api/v3',
  _dexBase: 'https://api.dexscreener.com/latest/dex',
  _catalog: [
    { symbol: 'BTCUSDT', code: 'BTC', name: 'Bitcoin', aliases: ['btc', 'bitcoin', 'xbt'] },
    { symbol: 'ETHUSDT', code: 'ETH', name: 'Ethereum', aliases: ['eth', 'ethereum'] },
    { symbol: 'BNBUSDT', code: 'BNB', name: 'BNB', aliases: ['bnb', 'binance coin'] },
    { symbol: 'SOLUSDT', code: 'SOL', name: 'Solana', aliases: ['sol', 'solana'] },
    { symbol: 'XRPUSDT', code: 'XRP', name: 'XRP', aliases: ['xrp', 'ripple'] },
    { symbol: 'DOGEUSDT', code: 'DOGE', name: 'Dogecoin', aliases: ['doge', 'dogecoin'] }
  ],

  _isAddress(keyword) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(keyword || '').trim());
  },

  _normalizeBinanceSymbol(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return '';
    const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB'];
    if (quotes.some(q => s.endsWith(q) && s.length > q.length)) return s;
    if (s.length >= 2 && s.length <= 10) return `${s}USDT`;
    return '';
  },

  _decodeAddressCode(code) {
    const m = String(code || '').match(/^ADDR_([^_]+)_([A-Za-z0-9]+)$/);
    if (!m) return null;
    return { chainId: m[1], pairAddress: m[2] };
  },

  async _binance24h(symbol) {
    const url = `${this._binanceBase}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Binance ticker HTTP ${resp.status}`);
    return await resp.json();
  },

  async _binanceKlines(symbol, interval, limit) {
    const url = `${this._binanceBase}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Binance kline HTTP ${resp.status}`);
    return await resp.json();
  },

  async _dexPairsByAddress(address) {
    const url = `${this._dexBase}/tokens/${encodeURIComponent(address)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`DexScreener token HTTP ${resp.status}`);
    const data = await resp.json();
    return Array.isArray(data.pairs) ? data.pairs : [];
  },

  _bestDexPair(pairs) {
    if (!pairs || !pairs.length) return null;
    return [...pairs].sort((a, b) => {
      const la = Number(a?.liquidity?.usd) || 0;
      const lb = Number(b?.liquidity?.usd) || 0;
      if (lb !== la) return lb - la;
      const va = Number(a?.volume?.h24) || 0;
      const vb = Number(b?.volume?.h24) || 0;
      return vb - va;
    })[0];
  },

  _dexPairToSearchResult(pair) {
    if (!pair || !pair.pairAddress || !pair.chainId) return null;
    const base = pair.baseToken || {};
    const quote = pair.quoteToken || {};
    const code = `ADDR_${pair.chainId}_${pair.pairAddress}`;
    const symbol = base.symbol || 'TOKEN';
    const quoteSymbol = quote.symbol || '';
    const priceUsd = Number(pair.priceUsd);
    const name = `${base.name || symbol}${quoteSymbol ? `/${quoteSymbol}` : ''}${Number.isFinite(priceUsd) ? ` · $${priceUsd.toFixed(priceUsd < 1 ? 6 : 4)}` : ''}`;
    return {
      code: symbol,
      name,
      market: 'CRYPTO',
      fullCode: `CRYPTO:${code}`
    };
  },

  async search(keyword) {
    const q = String(keyword || '').trim();
    if (!q) return [];
    const out = [];
    const seen = new Set();
    const add = (item) => {
      if (!item || !item.fullCode || seen.has(item.fullCode)) return;
      seen.add(item.fullCode);
      out.push(item);
    };

    const low = q.toLowerCase();
    for (const item of this._catalog) {
      const hit = item.aliases.some(a => a.includes(low)) ||
        item.code.toLowerCase().includes(low) ||
        item.symbol.toLowerCase().includes(low) ||
        item.name.toLowerCase().includes(low);
      if (!hit) continue;
      add({
        code: item.code,
        name: `${item.name} (${item.code})`,
        market: 'CRYPTO',
        fullCode: `CRYPTO:${item.symbol}`
      });
    }

    const maybeBinance = this._normalizeBinanceSymbol(q);
    if (maybeBinance) {
      const base = maybeBinance.replace(/(USDT|USDC|BUSD|FDUSD|BTC|ETH|BNB)$/i, '');
      add({
        code: base || maybeBinance,
        name: `${base || maybeBinance} / USDT`,
        market: 'CRYPTO',
        fullCode: `CRYPTO:${maybeBinance}`
      });
    }

    if (this._isAddress(q)) {
      try {
        const pairs = await this._dexPairsByAddress(q);
        for (const p of pairs.slice(0, 5)) {
          add(this._dexPairToSearchResult(p));
        }
      } catch (e) {
        console.warn('[Crypto search] address lookup failed:', e.message || String(e));
      }
    }

    return out.slice(0, 10);
  },

  async getQuotes(codes) {
    const results = {};
    for (const fullCode of codes) {
      const [, rawCode] = String(fullCode || '').split(':');
      if (!rawCode) continue;
      const addr = this._decodeAddressCode(rawCode);
      try {
        if (addr) {
          const pairUrl = `${this._dexBase}/pairs/${encodeURIComponent(addr.chainId)}/${encodeURIComponent(addr.pairAddress)}`;
          const pairResp = await fetch(pairUrl);
          if (!pairResp.ok) throw new Error(`DexScreener pair HTTP ${pairResp.status}`);
          const pairData = await pairResp.json();
          const pair = Array.isArray(pairData.pairs) ? pairData.pairs[0] : null;
          if (!pair) continue;
          const price = Number(pair.priceUsd) || 0;
          const pct = Number(pair.priceChange?.h24) || 0;
          const prevClose = pct === -100 ? 0 : (price / (1 + pct / 100));
          const base = pair.baseToken || {};
          results[fullCode] = {
            code: base.symbol || 'TOKEN',
            market: 'CRYPTO',
            fullCode,
            name: base.name || base.symbol || rawCode,
            price,
            prevClose,
            open: prevClose,
            high: Number(pair?.high24h) || 0,
            low: Number(pair?.low24h) || 0,
            volume: Number(pair?.volume?.h24) || 0,
            amount: Number(pair?.liquidity?.usd) || 0,
            change: price - prevClose,
            changePercent: pct,
            time: ''
          };
          continue;
        }

        const symbol = this._normalizeBinanceSymbol(rawCode);
        if (!symbol) continue;
        const d = await this._binance24h(symbol);
        const price = Number(d.lastPrice) || 0;
        const prevClose = Number(d.prevClosePrice) || 0;
        const code = symbol.replace(/(USDT|USDC|BUSD|FDUSD|BTC|ETH|BNB)$/i, '');
        results[fullCode] = {
          code: code || symbol,
          market: 'CRYPTO',
          fullCode,
          name: `${code || symbol} / ${symbol.slice((code || '').length) || 'USDT'}`,
          price,
          prevClose,
          open: Number(d.openPrice) || 0,
          high: Number(d.highPrice) || 0,
          low: Number(d.lowPrice) || 0,
          volume: Number(d.volume) || 0,
          amount: Number(d.quoteVolume) || 0,
          change: Number(d.priceChange) || 0,
          changePercent: Number(d.priceChangePercent) || 0,
          time: ''
        };
      } catch (e) {
        console.warn('[Crypto quote] failed for', fullCode, e.message || String(e));
      }
    }
    return results;
  },

  async getKline(fullCode, period = 'daily', count = 120) {
    const [, rawCode] = String(fullCode || '').split(':');
    if (!rawCode) return [];
    if (this._decodeAddressCode(rawCode)) return [];
    const symbol = this._normalizeBinanceSymbol(rawCode);
    if (!symbol) return [];
    const intervalMap = { daily: '1d', weekly: '1w', monthly: '1M', yearly: '1M' };
    const interval = intervalMap[period] || '1d';
    const rows = await this._binanceKlines(symbol, interval, Math.min(Math.max(count, 20), 1000));
    let klines = rows.map(row => ({
      time: new Date(Number(row[0])).toISOString().slice(0, 10),
      open: Number(row[1]) || 0,
      high: Number(row[2]) || 0,
      low: Number(row[3]) || 0,
      close: Number(row[4]) || 0,
      volume: Number(row[5]) || 0,
      amount: Number(row[7]) || 0,
      turnover: 0
    }));
    if (period === 'yearly') {
      const yearMap = {};
      for (const d of klines) {
        const y = d.time.slice(0, 4);
        if (!yearMap[y]) {
          yearMap[y] = { time: `${y}-01-01`, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume, amount: d.amount, turnover: 0 };
        } else {
          const yd = yearMap[y];
          yd.high = Math.max(yd.high, d.high);
          yd.low = Math.min(yd.low, d.low);
          yd.close = d.close;
          yd.volume += d.volume;
          yd.amount += d.amount;
        }
      }
      klines = Object.values(yearMap).sort((a, b) => a.time.localeCompare(b.time));
    }
    return klines;
  },

  async getRealtime(fullCode) {
    const [, rawCode] = String(fullCode || '').split(':');
    if (!rawCode) return { prevClose: 0, points: [] };
    if (this._decodeAddressCode(rawCode)) {
      const q = await this.getQuotes([fullCode]);
      const item = q[fullCode];
      if (!item) return { prevClose: 0, points: [] };
      return {
        prevClose: item.prevClose || item.price || 0,
        points: [{ time: Math.floor(Date.now() / 1000), price: item.price, avgPrice: item.price, volume: item.volume || 0 }]
      };
    }
    const symbol = this._normalizeBinanceSymbol(rawCode);
    if (!symbol) return { prevClose: 0, points: [] };
    const rows = await this._binanceKlines(symbol, '1m', 240);
    const points = rows.map(row => ({
      // Binance 时间戳本身是 UTC，保留为数字，交给图表按用户选择的时区显示。
      time: Math.floor(Number(row[0]) / 1000),
      price: Number(row[4]) || 0,
      avgPrice: Number(row[4]) || 0,
      volume: Number(row[5]) || 0
    }));
    const daily = await this._binanceKlines(symbol, '1d', 2);
    const prevClose = daily.length >= 2 ? (Number(daily[daily.length - 2][4]) || 0) : (points[0]?.price || 0);
    return { prevClose, points };
  }
};

// ===== Provider: Tushare Pro =====
const TushareAPI = {
  _endpoint: 'https://api.tushare.pro',

  _tushareDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  },
  _marketToday(market) {
    if (typeof TimeUtils === 'undefined') {
      const d = new Date();
      return this._tushareDate(d);
    }
    const zone = TimeUtils.getExchangeTimeZone(market);
    const p = TimeUtils.getZonedParts(Date.now() / 1000, zone);
    return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
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
    // 年线用月线聚合，避免误用日线；不使用前复权以匹配成交记录价格。
    const freqMap = { daily: 'D', weekly: 'W', monthly: 'M', yearly: 'M' };
    const freq = freqMap[period] || 'D';
    const end = new Date();
    const daysByPeriod = { daily: 3, weekly: 14, monthly: 45, yearly: 450 };
    const start = new Date(end.getTime() - count * (daysByPeriod[period] || 3) * 24 * 3600 * 1000);
    const data = await this._call('pro_bar', {
      ts_code: tsCode, freq, start_date: this._tushareDate(start), end_date: this._tushareDate(end)
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
    const market = String(fullCode || '').split(':')[0];
    const today = this._marketToday(market);
    const data = await this._call('pro_bar', {
      ts_code: tsCode, freq: '1min', start_date: today, end_date: today
    }, 'trade_time,open,close,high,low,vol', settings);
    if (!data.items || !data.items.length) return { prevClose: 0, points: [] };
    const points = data.items.map(row => ({
      time: String(row[0]).includes('-')
        ? String(row[0]).replace(/\//g, '-')
        : `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)} ${String(row[0]).slice(-8)}`,
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
        const today = this._marketToday(fullCode.split(':')[0]);
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
    const fetchCount = period === 'weekly' ? count * 7 : period === 'monthly' ? count * 31 : period === 'yearly' ? count * 365 : count;
    const url = `https://stock.finance.sina.com.cn/hkstock/api/jsonp.php/HK_MarketDataService.getDayLine?symbol=${code}&type=normal&count=${fetchCount}&_=${Date.now()}`;
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
    if (period === 'weekly' || period === 'monthly') return this._aggregatePeriod(out, period).slice(-count);
    if (period === 'yearly') return this._aggregateYearly(out).slice(-count);
    return out;
  },

  async getRealtime(fullCode) {
    const [market] = fullCode.split(':');
    if (market === 'HK') {
      // 新浪港股接口只有日线，直接返回空分时会让用户误以为图表坏了。
      // 港股分时回退到东财的 trends2 接口，仍保留新浪作为日线来源。
      return EastmoneyAPI.getRealtime(fullCode);
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
  },

  _aggregatePeriod(data, period) {
    const groups = {};
    for (const item of data) {
      const date = new Date(`${String(item.time).slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      let key;
      let time;
      if (period === 'monthly') {
        key = String(item.time).slice(0, 7);
        time = `${key}-01`;
      } else {
        const day = date.getUTCDay() || 7;
        const monday = new Date(date.getTime() - (day - 1) * 86400000);
        time = monday.toISOString().slice(0, 10);
        key = time;
      }
      if (!groups[key]) groups[key] = { time, open: item.open, high: item.high, low: item.low, close: item.close, volume: item.volume || 0 };
      else {
        const group = groups[key];
        group.high = Math.max(group.high, item.high);
        group.low = Math.min(group.low, item.low);
        group.close = item.close;
        group.volume += item.volume || 0;
      }
    }
    return Object.values(groups).sort((a, b) => a.time.localeCompare(b.time));
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
    if (market === 'HK') {
      console.warn('Juhe 不提供港股 K 线，回退到东方财富');
      return EastmoneyAPI.getKline(fullCode, period, count);
    }
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
    if (market === 'HK') {
      console.warn('Juhe 不提供港股分时，回退到东方财富');
      return EastmoneyAPI.getRealtime(fullCode);
    }
    const url = `${this._endpoint}/stock/hsmindata?key=${settings.juheKey}&gid=${CodeConvert.toJuheGid(fullCode)}&type=1`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error_code !== 0 || !Array.isArray(data.result)) return { prevClose: 0, points: [] };
      const today = typeof TimeUtils !== 'undefined'
        ? (() => {
          const p = TimeUtils.getZonedParts(Date.now() / 1000, TimeUtils.getExchangeTimeZone(market));
          return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
        })()
        : new Date().toISOString().slice(0, 10);
      const points = data.result.map(row => ({
        time: /^\d{1,2}:\d{2}/.test(String(row[0] || '')) ? `${today} ${row[0]}` : row[0],
        price: parseFloat(row[1]) || 0,
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
    markets: ['domestic', 'intl'],
    requires: [],
    impl: TencentAPI
  },
  eastmoney: {
    id: 'eastmoney',
    label: '东方财富',
    caps: { quote: true, kline: true },
    markets: ['domestic', 'intl'],
    requires: [],
    impl: EastmoneyAPI
  },
  sina: {
    id: 'sina',
    label: '新浪财经',
    caps: { quote: true, kline: true },
    markets: ['domestic', 'intl'],
    requires: [],
    impl: SinaAPI
  },
  tushare: {
    id: 'tushare',
    label: 'Tushare Pro',
    caps: { quote: true, kline: true },
    markets: ['domestic', 'intl'],
    requires: ['tushareToken'],
    impl: TushareAPI
  },
  juhe: {
    id: 'juhe',
    label: '聚合数据',
    caps: { quote: true, kline: true },
    markets: ['domestic'],
    requires: ['juheKey'],
    impl: JuheAPI
  },
  crypto: {
    id: 'crypto',
    label: 'Crypto (Binance/Dex)',
    caps: { quote: true, kline: true },
    markets: ['crypto'],
    requires: [],
    impl: CryptoAPI
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

  _INTL_MARKETS: new Set(['HK', 'US', 'JP', 'KR']),
  _CRYPTO_MARKET: 'CRYPTO',

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

  _isCrypto(fullCode) {
    const market = fullCode.split(':')[0];
    return market === this._CRYPTO_MARKET;
  },

  _getQuoteProvider(intl) {
    const fallback = Providers.eastmoney;
    if (intl && this._settings.intlQuoteProvider) {
      const selected = Providers[this._settings.intlQuoteProvider];
      return selected && selected.markets.includes('intl') ? selected : fallback;
    }
    if (intl) {
      const configured = this._settings.quoteProvider || 'eastmoney';
      // 韩国/国际股票默认优先用东方财富报价，避免 Tencent 对 KR 这类市场返回空结果
      if (configured === 'tencent') return Providers.eastmoney;
      const selected = Providers[configured];
      return selected && selected.markets.includes('intl') ? selected : fallback;
    }
    const selected = Providers[this._settings.quoteProvider || 'eastmoney'];
    return selected && selected.markets.includes('domestic') ? selected : fallback;
  },
  _getKlineProvider(intl) {
    const fallback = Providers.eastmoney;
    if (intl && this._settings.intlKlineProvider) {
      const selected = Providers[this._settings.intlKlineProvider];
      return selected && selected.markets.includes('intl') ? selected : fallback;
    }
    if (intl) {
      const configured = this._settings.klineProvider || 'eastmoney';
      const selected = Providers[configured];
      return selected && selected.markets.includes('intl') ? selected : fallback;
    }
    const selected = Providers[this._settings.klineProvider || 'eastmoney'];
    return selected && selected.markets.includes('domestic') ? selected : fallback;
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
    const domestic = [], intl = [], crypto = [];
    for (const c of codes) {
      if (this._isCrypto(c)) crypto.push(c);
      else if (this._isIntl(c)) intl.push(c);
      else domestic.push(c);
    }
    const results = {};
    if (domestic.length) {
      const p = this._getQuoteProvider(false);
      const err = this._checkRequirements(p, 'quote');
      if (!err) {
        Object.assign(results, await p.impl.getQuotes(domestic, this._settings));
      } else {
        console.warn('[StockAPI] domestic quote provider unavailable:', err);
      }
    }
    if (intl.length) {
      const p = this._getQuoteProvider(true);
      const err = this._checkRequirements(p, 'quote');
      if (!err) {
        Object.assign(results, await p.impl.getQuotes(intl, this._settings));
      } else {
        console.warn('[StockAPI] intl quote provider unavailable:', err);
      }
    }
    if (crypto.length) {
      Object.assign(results, await CryptoAPI.getQuotes(crypto));
    }
    return results;
  },

  async getKline(fullCode, period, count) {
    if (this._isCrypto(fullCode)) {
      return CryptoAPI.getKline(fullCode, period, count);
    }
    const intl = this._isIntl(fullCode);
    const p = this._getKlineProvider(intl);
    const err = this._checkRequirements(p, 'kline');
    if (err) {
      console.warn('[StockAPI] kline provider unavailable:', err);
      throw new Error(err);
    }
    return p.impl.getKline(fullCode, period, count, this._settings);
  },

  async getRealtime(fullCode) {
    if (this._isCrypto(fullCode)) {
      return CryptoAPI.getRealtime(fullCode);
    }
    const intl = this._isIntl(fullCode);
    const p = this._getKlineProvider(intl);
    const err = this._checkRequirements(p, 'kline');
    if (err) {
      console.warn('[StockAPI] realtime provider unavailable:', err);
      throw new Error(err);
    }
    return p.impl.getRealtime(fullCode, this._settings);
  },

  async search(keyword) {
    const [stocks, cryptos] = await Promise.all([
      EastmoneyAPI.search(keyword),
      CryptoAPI.search(keyword)
    ]);
    const merged = [];
    const seen = new Set();
    for (const item of [...stocks, ...cryptos]) {
      if (!item || !item.fullCode || seen.has(item.fullCode)) continue;
      seen.add(item.fullCode);
      merged.push(item);
    }
    return merged.slice(0, 12);
  },

  matchSearchResult(parsed, results) {
    const candidates = Array.isArray(results) ? results : [];
    if (!parsed) return candidates[0] || null;
    const fullCode = String(parsed.fullCode || '').toUpperCase();
    const market = String(parsed.market || '').toUpperCase();
    const code = String(parsed.code || '');
    return candidates.find(item => String(item?.fullCode || '').toUpperCase() === fullCode) ||
      candidates.find(item => String(item?.market || '').toUpperCase() === market && String(item?.code || '') === code) ||
      null;
  },

  listProviders() {
    return Object.values(Providers).map(({ id, label, caps, requires, markets }) => ({ id, label, caps, requires, markets }));
  },

  getActiveProviders() {
    return {
      quote: this._getQuoteProvider().id,
      kline: this._getKlineProvider().id
    };
  }
};
