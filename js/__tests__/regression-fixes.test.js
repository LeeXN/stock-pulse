const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function baseSandbox(extra = {}) {
  return {
    console: { log() {}, warn() {}, error() {} },
    Intl, Date, Math, Number, String, Set, Object, Array, RegExp,
    parseFloat, parseInt, isNaN, TextDecoder, ...extra
  };
}

function loadOcr() {
  const sandbox = baseSandbox();
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'time.js'), 'utf8') +
    '\nthis.__TimeUtils = TimeUtils;', sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ocr.js'), 'utf8') +
    '\nthis.__OCR = OCR;', sandbox);
  return sandbox;
}

function loadPortfolio() {
  let stored = [];
  const DB = {
    async get(key, fallback) { return key === 'portfolio' ? stored : fallback; },
    async set(key, value) { if (key === 'portfolio') stored = value; }
  };
  const sandbox = baseSandbox({ DB });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'portfolio.js'), 'utf8') +
    '\nthis.__Portfolio = Portfolio; this.__getStored = () => stored;', sandbox);
  return { portfolio: sandbox.__Portfolio, getStored: () => stored };
}

function loadEastmoney() {
  const calls = [];
  const sandbox = baseSandbox({
    fetch: async url => {
      calls.push(String(url));
      if (String(url).includes('secid=105.')) return { json: async () => ({ data: null }) };
      return {
        json: async () => ({ data: { klines: ['2025-01-01,10,11,12,9,100,1000,0,0,0,0'] } })
      };
    },
    chrome: { runtime: { sendMessage: async () => ({}) } }
  });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8') +
    '\nthis.__Eastmoney = EastmoneyAPI; this.__StockAPI = StockAPI;', sandbox);
  return { api: sandbox.__Eastmoney, stockApi: sandbox.__StockAPI, calls };
}

function loadMarket() {
  const sandbox = baseSandbox({
    fetch: async () => ({ ok: true, json: async () => ({ data: { diff: [
      { f12: '000001', f14: '上证指数', f2: 10000, f15: 9900, f16: 9800, f17: 10100, f4: 100, f3: 1 },
      { f12: '399001', f14: '深证成指', f2: 20000, f15: 19900, f16: 19800, f17: 20100, f4: 100, f3: 1 }
    ] } }) }),
    chrome: { runtime: { sendMessage: async () => ({}) } }
  });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'market.js'), 'utf8') +
    '\nthis.__Market = MarketAPI;', sandbox);
  return sandbox.__Market;
}

test('date parsing rejects impossible dates and preserves quoted CSV fields', () => {
  const sandbox = loadOcr();
  assert.equal(sandbox.__TimeUtils.normalizeDate('2025-02-31'), '');
  const row = sandbox.__OCR.parseBatchPortfolio(
    '日期,代码,方向,价格,数量,备注\n' +
    '2025-02-31,600519,买入,1800,100,"盘中,一笔"'
  )[0];
  assert.equal(row.date, '');
  assert.equal(row.note, '盘中,一笔');
});

test('OCR does not enable a text-only model as a vision engine', () => {
  const sandbox = loadOcr();
  sandbox.__OCR.init({ llmApiKey: 'key', llmBaseUrl: 'https://example.test/v1', llmModel: 'deepseek-chat', llmVisionModel: '' });
  assert.equal(sandbox.__OCR.isEnabled(), false);
  assert.match(sandbox.__OCR.getUnavailabilityReason(), /视觉模型/);
});

test('portfolio rejects overselling, validates atomically, and skips duplicate imports', async () => {
  const { portfolio, getStored } = loadPortfolio();
  const buy = { fullCode: 'SH:600519', code: '600519', market: 'SH', direction: 'buy', price: 10, quantity: 100, date: '2025-01-01' };
  await portfolio.addTrade(buy);
  await assert.rejects(
    () => portfolio.addTrade({ ...buy, direction: 'sell', quantity: 101 }),
    /卖出数量超过当前持仓/
  );
  const before = getStored()[0].trades.length;
  await assert.rejects(
    () => portfolio.addTrades([
      { ...buy, price: 11, quantity: 10, dedupeKey: 'batch|1' },
      { ...buy, price: -1, quantity: 10, dedupeKey: 'batch|2' }
    ]),
    /价格必须大于 0/
  );
  assert.equal(getStored()[0].trades.length, before);
  await portfolio.addTrade({ ...buy, price: 11, quantity: 10, dedupeKey: 'batch|1' });
  const result = await portfolio.addTrades([{ ...buy, price: 11, quantity: 10, dedupeKey: 'batch|1' }]);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
});

test('East Money US K-line fallback tries secid 106 after secid 105 has no data', async () => {
  const { api, calls } = loadEastmoney();
  const out = await api.getKline('US:NVDA', 'daily', 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].close, 11);
  assert.ok(calls.some(url => url.includes('secid=105.NVDA')));
  assert.ok(calls.some(url => url.includes('secid=106.NVDA')));
});

test('numeric stock codes never fall back to a crypto search result', () => {
  const { stockApi } = loadEastmoney();
  const parsed = { fullCode: 'SH:600519', market: 'SH', code: '600519' };
  const cryptoOnly = [{ fullCode: 'CRYPTO:600519USDT', market: 'CRYPTO', code: '600519', name: '600519 / USDT' }];
  assert.equal(stockApi.matchSearchResult(parsed, cryptoOnly), null);
  const stock = { fullCode: 'SH:600519', market: 'SH', code: '600519', name: '贵州茅台' };
  assert.equal(stockApi.matchSearchResult(parsed, [cryptoOnly[0], stock]).fullCode, stock.fullCode);
});

test('market cache filters indices removed from the current selection', async () => {
  const market = loadMarket();
  await market.fetchAll(['1.000001', '0.399001'], 0, true);
  const out = await market.fetchAll(['1.000001'], 60_000, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].secid, '1.000001');
});
