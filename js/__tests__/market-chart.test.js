const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };

function apiSandbox(fetch) {
  const sb = { console: quiet, fetch, AbortSignal, TextDecoder, setTimeout, clearTimeout };
  vm.createContext(sb);
  vm.runInContext(read('api.js') + read('market.js') + '\nthis.api=StockAPI;this.market=MarketAPI;this.crypto=CryptoAPI;', sb);
  return sb;
}

test('market instruments follow selection, preserve order, and keep index identity', () => {
  const { market } = apiSandbox();
  const selected = market.getChartStocks(['100.HSI', '1.000001', 'CRYPTO:BTCUSDT', '100.HSTECH']);
  assert.deepEqual(Array.from(selected, s => s.fullCode), ['INDEX:100.HSI', 'INDEX:1.000001', 'CRYPTO:BTCUSDT', 'INDEX:124.HSTECH']);
  assert.equal(selected[1].market, 'SH');
  assert.equal(selected[2].name, 'BTC / USDT');
  assert.equal(market.getChartStocks([]).length, 0);
});

test('all registered indices use their own secid for every supported K-line period', async () => {
  const urls = [];
  const { api, market } = apiSandbox(async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ data: { klines: ['2026-01-01,10,11,12,9,100,1000', '2026-02-01,11,13,14,10,200,2000'] } }) };
  });
  api.init({ klineProvider: 'juhe' });
  for (const instrument of market.getChartStocks(market.getAllIndices().map(idx => idx.secid)).filter(s => s.kind === 'index')) {
    for (const [period, klt] of [['daily', '101'], ['weekly', '102'], ['monthly', '103'], ['yearly', '103']]) {
      const rows = await api.getKline(instrument.fullCode, period, 2);
      const url = urls.at(-1);
      assert.equal(url.searchParams.get('secid'), instrument.secid);
      assert.equal(url.searchParams.get('klt'), klt);
      assert.equal(url.searchParams.get('fqt'), '0');
      assert.equal(url.searchParams.get('lmt'), period === 'yearly' ? '24' : '2');
      assert.equal(rows.at(-1).close, 13);
      if (period === 'yearly') {
        assert.equal(rows.length, 1);
        assert.deepEqual([rows[0].open, rows[0].high, rows[0].low, rows[0].volume], [10, 14, 9, 300]);
      }
    }
  }
  await assert.rejects(() => api.getRealtime('INDEX:100.HSI'), /不支持分时/);
  await assert.rejects(() => api.getKline('INDEX:100.HSI', 'realtime', 2), /不支持分时/);
});

test('index quotes bypass stock providers and crypto K-lines continue to use Binance', async () => {
  const { api, market, crypto } = apiSandbox();
  const calls = [];
  market.fetchAll = async ids => {
    calls.push(Array.from(ids));
    return [{ secid: '100.HSI', price: 24000, change: 10, changePercent: 0.04 }];
  };
  const quotes = await api.getQuotes(['INDEX:100.HSI']);
  assert.equal(quotes['INDEX:100.HSI'].price, 24000);
  assert.equal(quotes['INDEX:100.HSI'].name, '恒生指数');
  assert.deepEqual(calls, [['100.HSI']]);
  crypto._binanceKlines = async (symbol, interval, limit) => {
    assert.equal(symbol, 'BTCUSDT');
    assert.equal(interval, '1M');
    assert.equal(limit, 24);
    return [[Date.UTC(2025, 0, 1), '10', '12', '9', '11', '100', 0, '1000'], [Date.UTC(2026, 0, 1), '11', '14', '10', '13', '200', 0, '2000']];
  };
  const yearly = await api.getKline('CRYPTO:BTCUSDT', 'yearly', 2);
  assert.deepEqual(Array.from(yearly, row => row.time), ['2025-01-01', '2026-01-01']);
});

test('partial index quote responses retry only missing instruments', async () => {
  const { market } = apiSandbox(async () => ({ ok: true, json: async () => ({ data: { diff: [{ f12: '000001', f2: 370000, f3: 100, f4: 100 }] } }) }));
  let missing;
  market._fetchAllFallback = async indices => {
    missing = Array.from(indices, idx => idx.secid);
    return [{ secid: '100.HSI', price: 24000 }];
  };
  const rows = await market.fetchAll(['1.000001', '100.HSI'], 0, true);
  assert.deepEqual(missing, ['100.HSI']);
  assert.equal(rows.length, 2);
});

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.listeners = {};
    this.classList = {
      toggle: (name, active) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (active) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
      remove: name => this.classList.toggle(name, false)
    };
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function appSandbox() {
  const elements = new Map();
  const periods = ['realtime', 'daily', 'weekly', 'monthly', 'yearly'].map(period => Object.assign(new Element(), { dataset: { period } }));
  const sourceButtons = ['market', 'portfolio', 'watchlist'].map(src => Object.assign(new Element(), { dataset: { src } }));
  const stored = { portfolio: [{ fullCode: 'SH:600519', code: '600519', name: '茅台', market: 'SH' }], watchlist: [{ fullCode: 'US:AAPL', code: 'AAPL', name: 'Apple', market: 'US' }] };
  const renders = [];
  const sb = {
    console: quiet, setTimeout, clearTimeout,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
      createElement: () => new Element(),
      querySelectorAll: selector => selector === '.period-btn' ? periods : selector === '.src-btn' ? sourceButtons : []
    },
    DB: { get: async (key, fallback) => stored[key] || fallback, set: async () => {} },
    ChartManager: { chart: {}, clearMain() { renders.push('clear'); }, setTimeContext() {}, renderKline(rows) { renders.push(rows.at(-1)?.close); } },
    StockAPI: { getQuotes: async () => ({}), getKline: async () => [{ time: '2026-10-21', open: 1, high: 2, low: 1, close: 2, volume: 1 }] }
  };
  vm.createContext(sb);
  vm.runInContext(read('market.js'), sb);
  // 使用实际控制器，只跳过自动启动；表格网络请求与时钟由各自模块测试覆盖。
  const expose = 'renderStockSummaryTable=()=>{};updateMarketTime=()=>{};globalThis.app={state,switchChartSource,rebuildChartChips,showStockInfo,clearStockDisplay,loadChart,startMarketRefresh,refreshMarketBar,formatPrice};';
  vm.runInContext(read('app.js').replace('  init();\n})();', expose + '\n})();'), sb);
  return { ...sb.app, sb, periods, elements, renders };
}

test('source switching restores selection and disables only market realtime', async () => {
  const { state, switchChartSource, showStockInfo, periods } = appSandbox();
  state.settings.marketIndices = ['100.HSI', 'CRYPTO:BTCUSDT'];
  await switchChartSource('portfolio');
  await switchChartSource('market', 'INDEX:100.HSI');
  showStockInfo(state.chartStocks[1]);
  await switchChartSource('watchlist');
  assert.equal(state.currentStock.fullCode, 'US:AAPL');
  assert.equal(periods[0].disabled, false);
  state.currentPeriod = 'realtime';
  await switchChartSource('market');
  assert.equal(state.currentStock.fullCode, 'CRYPTO:BTCUSDT');
  assert.equal(state.currentPeriod, 'daily');
  assert.equal(periods[0].disabled, true);
  await switchChartSource('portfolio');
  assert.equal(state.currentStock.fullCode, 'SH:600519');
});

test('removing all market selections clears the chart and invalidates pending requests', async () => {
  const { state, sb, switchChartSource, rebuildChartChips, renders } = appSandbox();
  state.settings.marketIndices = ['100.HSI'];
  let finish;
  sb.StockAPI.getKline = () => new Promise(resolve => { finish = resolve; });
  await switchChartSource('market');
  state.settings.marketIndices = [];
  await rebuildChartChips();
  finish([{ time: '2026-10-21', close: 999 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.currentStock, null);
  assert.equal(state.chartStocks.length, 0);
  assert.equal(renders.includes(999), false);
});

test('latest chart request wins and K-line failures show retry even when quotes also fail', async () => {
  const { state, sb, loadChart, showStockInfo, elements, renders } = appSandbox();
  const pending = [];
  sb.StockAPI.getKline = () => new Promise(resolve => pending.push(resolve));
  showStockInfo({ fullCode: 'INDEX:100.HSI', name: '恒生', market: 'HK' });
  const first = loadChart();
  showStockInfo({ fullCode: 'INDEX:100.NDX', name: '纳指100', market: 'US' });
  const second = loadChart();
  pending[1]([{ time: '2026-10-21', close: 222 }]);
  await second;
  pending[0]([{ time: '2026-10-21', close: 111 }]);
  await first;
  assert.equal(renders.includes(111), false);
  assert.equal(renders.includes(222), true);
  sb.StockAPI.getKline = async () => { throw new Error('offline'); };
  sb.StockAPI.getQuotes = async () => { throw new Error('offline'); };
  await loadChart();
  assert.equal(elements.get('chartRetryBtn').hidden, false);
  assert.match(elements.get('chartStatusText').textContent, /上次成功数据/);
  assert.match(elements.get('chartStatusText').textContent, /2026-10-21/);
  assert.equal(state.currentStock.fullCode, 'INDEX:100.NDX');
});

test('disabled market auto refresh schedules no network timer', () => {
  const { state, startMarketRefresh, sb } = appSandbox();
  sb.setInterval = () => { throw new Error('unexpected timer'); };
  state.settings.refreshInterval = 0;
  startMarketRefresh();
});

test('index prices show points while stock prices retain their market currency', () => {
  const { formatPrice } = appSandbox();
  assert.equal(formatPrice(24000.123, 'HK', 'index'), '24000.12 点');
  assert.equal(formatPrice(210.123, 'HK'), '210.123 HKD');
  assert.equal(formatPrice(120.12, 'US'), '120.12 USD');
});
