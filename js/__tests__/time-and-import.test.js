const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadOCR() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Intl, Date, Math, Number, String, Set, Object, Array, RegExp,
    parseFloat, parseInt, isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'time.js'), 'utf8') +
    '\nthis.__TimeUtils = TimeUtils;', sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ocr.js'), 'utf8') +
    '\nthis.__OCR = OCR;', sandbox);
  return { time: sandbox.__TimeUtils, ocr: sandbox.__OCR };
}

function loadChartManager() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Intl, Date, Math, Number, String, Set, Object, Array, RegExp,
    parseFloat, parseInt, isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chart.js'), 'utf8') +
    '\nthis.__ChartManager = ChartManager;', sandbox);
  return sandbox.__ChartManager;
}

function loadPortfolio() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    DB: {}, Math, Number, String, Array, Object
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'portfolio.js'), 'utf8') +
    '\nthis.__Portfolio = Portfolio;', sandbox);
  return sandbox.__Portfolio;
}

test('wall-clock realtime values use the market timezone', () => {
  const { time } = loadOCR();
  const shanghai = time.parseToEpochSeconds('2026-06-01 09:30', 'Asia/Shanghai');
  const newYork = time.parseToEpochSeconds('2026-06-01 09:30', 'America/New_York');
  assert.equal(new Date(shanghai * 1000).toISOString(), '2026-06-01T01:30:00.000Z');
  assert.equal(new Date(newYork * 1000).toISOString(), '2026-06-01T13:30:00.000Z');
  assert.equal(time.formatDateTime(shanghai, 'Asia/Shanghai'), '2026-06-01 09:30');
});

test('batch portfolio import supports legacy, buy/sell and TSV formats', () => {
  const { ocr } = loadOCR();
  const legacy = ocr.parseBatchPortfolio('600519 1800 100 2025-01-15')[0];
  assert.equal(legacy.direction, 'buy');
  assert.equal(legacy.date, '2025-01-15');

  const extended = ocr.parseBatchPortfolio('600519 买入 1800 100 2025-01-15 5 1 盘中')[0];
  assert.equal(extended.commission, 5);
  assert.equal(extended.stampTax, 1);
  assert.equal(extended.note, '盘中');

  const tsv = ocr.parseBatchPortfolio(
    '日期\t代码\t方向\t价格\t数量\t手续费\t印花税\n' +
    '2025-01-15\t600519\t卖出\t1810\t100\t5\t1'
  )[0];
  assert.equal(tsv.direction, 'sell');
  assert.equal(tsv.price, 1810);
  assert.equal(tsv.quantity, 100);
});

test('portfolio comparison uses a shared overlapping date window', () => {
  const chart = loadChartManager();
  const prepared = chart._prepareOverlayData([
    {
      key: 'SH:AAA', label: 'A', color: '#f00',
      klineData: [
        { time: '2025-01-01', close: 100 },
        { time: '2025-01-02', close: 110 },
        { time: '2025-01-03', close: 105 }
      ]
    },
    {
      key: 'SH:BBB', label: 'B', color: '#0f0',
      klineData: [
        { time: '2025-01-02', close: 200 },
        { time: '2025-01-03', close: 220 },
        { time: '2025-01-04', close: 210 }
      ]
    }
  ]);
  assert.equal(prepared.startTime, '2025-01-02');
  assert.equal(prepared.endTime, '2025-01-03');
  assert.equal(prepared.lines.length, 2);
  assert.equal(prepared.lines[0].points[0].value, 0);
  assert.equal(prepared.lines[1].points[0].value, 0);
  assert.ok(Math.abs(prepared.lines[0].returnPct + ((5 / 110) * 100)) < 1e-10);
  assert.ok(Math.abs(prepared.lines[1].returnPct - 10) < 1e-10);
});

test('price comparison falls back when symbols have no shared date window', () => {
  const chart = loadChartManager();
  const prepared = chart._prepareOverlayData([
    {
      key: 'SH:OLD', label: '旧区间',
      klineData: [
        { time: '2024-01-01', close: 100 },
        { time: '2024-01-02', close: 110 }
      ]
    },
    {
      key: 'SH:NEW', label: '新区间',
      klineData: [
        { time: '2025-01-01', close: 200 },
        { time: '2025-01-02', close: 220 }
      ]
    }
  ]);
  assert.equal(prepared.comparisonScope, 'individual');
  assert.equal(prepared.lines.length, 2);
  assert.ok(Math.abs(prepared.lines[0].returnPct - 10) < 1e-10);
  assert.ok(Math.abs(prepared.lines[1].returnPct - 10) < 1e-10);
});

test('holding comparison rebuilds return from buys, sells and fees', () => {
  const chart = loadChartManager();
  const prepared = chart._prepareOverlayData([{
    key: 'SH:AAA', label: 'A', color: '#f00', market: 'SH', currency: 'CNY',
    klineData: [
      { time: '2025-01-01', close: 100 },
      { time: '2025-01-02', close: 110 },
      { time: '2025-01-03', close: 105 }
    ],
    trades: [
      { direction: 'buy', price: 100, quantity: 10, date: '2025-01-01', commission: 1 },
      { direction: 'sell', price: 110, quantity: 5, date: '2025-01-02', commission: 1, stampTax: 0.5 }
    ]
  }], { mode: 'holding', settings: {} });
  assert.equal(prepared.lines.length, 1);
  assert.equal(prepared.startTime, '2025-01-01');
  assert.equal(prepared.endTime, '2025-01-03');
  // Jan 3: 5 * 105 + (5 * 110 - 1 - 0.5) - (10 * 100 + 1) = 72.5
  assert.ok(Math.abs(prepared.lines[0].pnl - 72.5) < 1e-10);
  assert.ok(Math.abs(prepared.lines[0].returnPct - (72.5 / 1001 * 100)) < 1e-10);
});

test('new positions keep a zero baseline before the first buy', () => {
  const chart = loadChartManager();
  const prepared = chart._prepareOverlayData([{
    key: 'SH:NEW', label: '新仓', market: 'SH',
    klineData: [
      { time: '2025-01-01', close: 100 },
      { time: '2025-01-02', close: 110 }
    ],
    trades: [{ direction: 'buy', price: 100, quantity: 10, date: '2025-01-02' }]
  }], { mode: 'holding', settings: {} });
  assert.equal(prepared.lines.length, 1);
  assert.equal(prepared.lines[0].points.length, 2);
  assert.equal(prepared.lines[0].points[0].time, '2025-01-01');
  assert.equal(prepared.lines[0].points[0].value, 0);
  assert.equal(prepared.lines[0].points[1].time, '2025-01-02');
  assert.equal(prepared.lines[0].points[1].value, 10);
});

test('latest quote adds today so a same-day buy is not filtered out', () => {
  const chart = loadChartManager();
  const prepared = chart._prepareOverlayData([{
    key: 'SH:TODAY', label: '今日新仓', market: 'SH',
    klineData: [{ time: '2025-01-01', close: 100 }],
    latestTime: '2025-01-02', latestPrice: 105,
    trades: [{ direction: 'buy', price: 100, quantity: 10, date: '2025-01-02' }]
  }], { mode: 'holding', settings: {} });
  assert.equal(prepared.lines.length, 1);
  assert.equal(prepared.lines[0].points.length, 2);
  assert.equal(prepared.lines[0].points[0].value, 0);
  assert.equal(prepared.lines[0].points[1].value, 5);
});

test('position percentage includes realized result and fees', () => {
  const portfolio = loadPortfolio();
  const calc = portfolio.calcPosition({ trades: [
    { direction: 'buy', price: 100, quantity: 10, commission: 1 },
    { direction: 'sell', price: 110, quantity: 5, commission: 1, stampTax: 0.5 }
  ] }, 105);
  assert.ok(Math.abs(calc.pnl - 72.5) < 1e-10);
  assert.ok(Math.abs(calc.pnlPercent - (72.5 / 1001 * 100)) < 1e-10);
  assert.ok(Math.abs(calc.unrealizedPnl - (5 * 105 - 5 * 100.1)) < 1e-10);
});
