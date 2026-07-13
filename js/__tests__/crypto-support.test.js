const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadApiSandbox() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: { runtime: { sendMessage: async () => ({}) } },
    TextDecoder,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(
    code + '\nthis.__CryptoAPI = CryptoAPI; this.__StockAPI = StockAPI;',
    sandbox
  );
  return sandbox;
}

function loadMarketSandbox(extra = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'market.js'), 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, json: async () => ({ data: { diff: [] } }) }),
    chrome: { runtime: { sendMessage: async () => ({}) } },
    setTimeout,
    clearTimeout,
    ...extra
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.__MarketAPI = MarketAPI;', sandbox);
  return sandbox;
}

test('CryptoAPI.search supports aliases and contract address lookup', async () => {
  const sb = loadApiSandbox();
  const CryptoAPI = sb.__CryptoAPI;

  const byAlias = await CryptoAPI.search('btc');
  assert.ok(byAlias.some(i => i.fullCode === 'CRYPTO:BTCUSDT'));

  sb.fetch = async (url) => {
    if (String(url).includes('/tokens/0x1111111111111111111111111111111111111111')) {
      return {
        ok: true,
        json: async () => ({
          pairs: [
            {
              chainId: 'eth',
              pairAddress: '0xabc123',
              baseToken: { symbol: 'ABC', name: 'ABC Token' },
              quoteToken: { symbol: 'WETH', name: 'Wrapped Ether' },
              priceUsd: '0.123456',
              liquidity: { usd: 100000 },
              volume: { h24: 50000 }
            }
          ]
        })
      };
    }
    return { ok: true, json: async () => ({ pairs: [] }) };
  };

  const byAddress = await CryptoAPI.search('0x1111111111111111111111111111111111111111');
  assert.ok(byAddress.some(i => i.fullCode === 'CRYPTO:ADDR_eth_0xabc123'));
});

test('CryptoAPI.getQuotes handles Binance symbol and Dex pair code', async () => {
  const sb = loadApiSandbox();
  const CryptoAPI = sb.__CryptoAPI;

  sb.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/ticker/24hr?symbol=BTCUSDT')) {
      return {
        ok: true,
        json: async () => ({
          lastPrice: '65432.10',
          prevClosePrice: '64000.00',
          openPrice: '64200.00',
          highPrice: '66000.00',
          lowPrice: '63000.00',
          volume: '123.45',
          quoteVolume: '8000000.12',
          priceChange: '1432.10',
          priceChangePercent: '2.24'
        })
      };
    }
    if (s.includes('/pairs/eth/0xabc123')) {
      return {
        ok: true,
        json: async () => ({
          pairs: [
            {
              chainId: 'eth',
              pairAddress: '0xabc123',
              baseToken: { symbol: 'ABC', name: 'ABC Token' },
              priceUsd: '100',
              priceChange: { h24: 25 },
              volume: { h24: 5000 },
              liquidity: { usd: 90000 }
            }
          ]
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const quotes = await CryptoAPI.getQuotes(['CRYPTO:BTC', 'CRYPTO:ADDR_eth_0xabc123']);
  assert.equal(quotes['CRYPTO:BTC'].price, 65432.1);
  assert.equal(quotes['CRYPTO:BTC'].changePercent, 2.24);
  assert.equal(quotes['CRYPTO:ADDR_eth_0xabc123'].price, 100);
  assert.equal(Number(quotes['CRYPTO:ADDR_eth_0xabc123'].prevClose.toFixed(2)), 80);
});

test('StockAPI.getQuotes merges domestic and crypto results', async () => {
  const sb = loadApiSandbox();
  const StockAPI = sb.__StockAPI;

  sb.fetch = async (url) => {
    const s = String(url);
    if (s.includes('push2.eastmoney.com/api/qt/stock/get?secid=0.000001')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            f58: '平安银行',
            f59: 2,
            f43: 1234,
            f60: 1200,
            f46: 1210,
            f44: 1250,
            f45: 1190,
            f169: 34,
            f170: 283,
            f47: 100,
            f48: 1000
          }
        })
      };
    }
    if (s.includes('/ticker/24hr?symbol=ETHUSDT')) {
      return {
        ok: true,
        json: async () => ({
          lastPrice: '3456.78',
          prevClosePrice: '3400.00',
          openPrice: '3410.00',
          highPrice: '3500.00',
          lowPrice: '3380.00',
          volume: '1000',
          quoteVolume: '3400000',
          priceChange: '56.78',
          priceChangePercent: '1.67'
        })
      };
    }
    return { ok: true, json: async () => ({ data: null }) };
  };

  StockAPI.init({ quoteProvider: 'eastmoney' });
  const out = await StockAPI.getQuotes(['SZ:000001', 'CRYPTO:ETHUSDT']);
  assert.ok(out['SZ:000001']);
  assert.ok(out['CRYPTO:ETHUSDT']);
  assert.equal(out['SZ:000001'].price, 12.34);
  assert.equal(out['CRYPTO:ETHUSDT'].price, 3456.78);
});

test('MarketAPI.fetchAll merges normal index and crypto index', async () => {
  const sb = loadMarketSandbox({
    CryptoAPI: {
      async getQuotes(codes) {
        return {
          [codes[0]]: {
            name: 'Bitcoin',
            price: 65000,
            prevClose: 64000,
            open: 64200,
            high: 65500,
            low: 63500,
            change: 1000,
            changePercent: 1.5625
          }
        };
      }
    }
  });
  const MarketAPI = sb.__MarketAPI;

  sb.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        diff: [
          { f12: '000001', f14: '上证指数', f2: 391379, f15: 398305, f16: 390067, f17: 396602, f4: -8237, f3: -206 }
        ]
      }
    })
  });

  const out = await MarketAPI.fetchAll(['1.000001', 'CRYPTO:BTCUSDT'], 0, true);
  assert.equal(out.length, 2);
  assert.ok(out.find(i => i.secid === '1.000001'));
  const btc = out.find(i => i.secid === 'CRYPTO:BTCUSDT');
  assert.ok(btc);
  assert.equal(btc.market, 'CRYPTO');
  const formatted = MarketAPI.formatChange(btc);
  assert.equal(formatted.priceStr, '65000.00');
});
