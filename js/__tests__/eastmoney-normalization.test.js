const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function loadApiSandbox() {
  const code = fs.readFileSync(require('node:path').join(__dirname, '..', 'api.js'), 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ json: async () => ({ data: null }) }),
    chrome: { runtime: { sendMessage: async () => ({}) } },
    TextDecoder,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.__EastmoneyAPI = EastmoneyAPI; this.__StockAPI = StockAPI;', sandbox);
  return sandbox;
}

function loadMarketSandbox() {
  const code = fs.readFileSync(require('node:path').join(__dirname, '..', 'market.js'), 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, json: async () => ({ data: { diff: [] } }) }),
    chrome: { runtime: { sendMessage: async () => ({}) } },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.__MarketAPI = MarketAPI;', sandbox);
  return sandbox;
}

test('EastMoney quote normalization uses precision for price and /100 for percent', async () => {
  const sb = loadApiSandbox();
  const EastmoneyAPI = sb.__EastmoneyAPI;

  sb.fetch = async () => ({
    json: async () => ({
      data: {
        f58: '英伟达',
        f59: 3,
        f43: 210960,
        f60: 202780,
        f46: 202000,
        f44: 211000,
        f45: 201920,
        f169: 8180,
        f170: 403,
        f47: 100,
        f48: 200
      }
    })
  });

  const out = await EastmoneyAPI.getQuotes(['US:NVDA']);
  const q = out['US:NVDA'];
  assert.ok(q);
  assert.equal(q.price, 210.96);
  assert.equal(q.prevClose, 202.78);
  assert.equal(q.change, 8.18);
  assert.equal(q.changePercent, 4.03);
});

test('Market ulist parsing maps by f12 and scales by /100', async () => {
  const sb = loadMarketSandbox();
  const MarketAPI = sb.__MarketAPI;

  sb.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        diff: [
          { f12: '000001', f14: '上证指数', f2: 391379, f15: 398305, f16: 390067, f17: 396602, f4: -8237, f3: -206 },
          { f12: 'NDX', f14: '纳斯达克', f2: 2628161, f15: 2630154, f16: 2600949, f17: 2617554, f4: 7472, f3: 29 }
        ]
      }
    })
  });

  const out = await MarketAPI.fetchAll(['1.000001', '100.NDX'], 0, true);
  assert.equal(out.length, 2);
  const sh = out.find(i => i.secid === '1.000001');
  const ndx = out.find(i => i.secid === '100.NDX');
  assert.ok(sh);
  assert.ok(ndx);
  assert.equal(sh.price, 3913.79);
  assert.equal(sh.changePercent, -2.06);
  assert.equal(ndx.price, 26281.61);
  assert.equal(ndx.changePercent, 0.29);
});
