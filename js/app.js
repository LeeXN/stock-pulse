/**
 * app.js v1.0.0 - 主控制器（多股图表、批量/OCR导入、Side Panel）
 */
(async function () {
  'use strict';

  // ===== State =====
  let state = {
    currentStock: null,
    currentPeriod: 'daily',
    currentTab: 'chart',
    chartSource: 'portfolio', // 'portfolio' | 'watchlist'
    chartStocks: [],          // stocks shown as chips in chart tab
    watchlist: [],
    portfolio: [],
    stockGroups: [],           // [{id, name}]
    activeGroupFilter: 'all',  // 'all' or group id
    // 排序状态：{ key: 'code'|'name'|'price'|'change'|'volume'|'pnl'|'pnlPercent'|'marketValue', dir: 'asc'|'desc' }
    sort: {
      chart: { key: 'change', dir: 'desc' },
      watchlist: { key: 'change', dir: 'desc' },
      portfolio: { key: 'pnl', dir: 'desc' }
    },
    settings: {
      refreshInterval: 10, theme: 'dark', klineCount: 120,
      quoteProvider: 'tencent', klineProvider: 'eastmoney',
      llmProvider: 'openai', llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: '', llmModel: 'gpt-4o-mini', llmVisionModel: 'gpt-4o-mini',
      llmMaxTokens: 4096,
      corsProxy: ''
    },
    indicators: { boll: false, macd: false, kdj: false },
    refreshTimer: null,
    marketTimer: null,
    quotes: {},
    _klineCache: {},          // 缓存最近一次 K 线数据，供指标切换时复用
    _loadingChart: false      // 防止并发 loadChart
  };

  // ===== 排序工具 =====
  function sortStocks(stocks, sortState, quotes) {
    const { key, dir } = sortState;
    const mult = dir === 'asc' ? 1 : -1;
    return [...stocks].sort((a, b) => {
      const qa = quotes[a.fullCode] || {};
      const qb = quotes[b.fullCode] || {};
      let va, vb;
      switch (key) {
        case 'code':    va = a.code || ''; vb = b.code || ''; return mult * va.localeCompare(vb);
        case 'name':    va = qa.name || a.name || ''; vb = qb.name || b.name || ''; return mult * va.localeCompare(vb);
        case 'price':   va = qa.price || 0; vb = qb.price || 0; break;
        case 'change':  va = qa.changePercent || 0; vb = qb.changePercent || 0; break;
        case 'volume':  va = qa.volume || 0; vb = qb.volume || 0; break;
        default: return 0;
      }
      return mult * (va - vb);
    });
  }

  function sortPositions(positions, sortState, quotes) {
    const { key, dir } = sortState;
    const mult = dir === 'asc' ? 1 : -1;
    return [...positions].sort((a, b) => {
      const qa = quotes[a.fullCode] || {};
      const qb = quotes[b.fullCode] || {};
      const ca = Portfolio.calcPosition(a, qa.price || 0);
      const cb = Portfolio.calcPosition(b, qb.price || 0);
      let va, vb;
      switch (key) {
        case 'code':       va = a.code || ''; vb = b.code || ''; return mult * va.localeCompare(vb);
        case 'name':       va = a.name || ''; vb = b.name || ''; return mult * va.localeCompare(vb);
        case 'price':      va = qa.price || 0; vb = qb.price || 0; break;
        case 'change':     va = qa.changePercent || 0; vb = qb.changePercent || 0; break;
        case 'pnl':        va = ca.pnl; vb = cb.pnl; break;
        case 'pnlPercent': va = ca.pnlPercent; vb = cb.pnlPercent; break;
        case 'marketValue':va = ca.marketValue; vb = cb.marketValue; break;
        case 'holdingQty': va = ca.holdingQty; vb = cb.holdingQty; break;
        default: return 0;
      }
      return mult * (va - vb);
    });
  }

  function sortIndicator(currentKey, sortState) {
    if (currentKey !== sortState.key) return '';
    return sortState.dir === 'asc' ? ' ▲' : ' ▼';
  }

  function toggleSort(page, key) {
    const s = state.sort[page];
    if (s.key === key) {
      s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    } else {
      s.key = key;
      s.dir = (key === 'code' || key === 'name') ? 'asc' : 'desc';
    }
  }

  // ===== Init =====
  async function init() {
    const stored = await DB.getAll();
    state.watchlist = stored.watchlist || [];
    state.portfolio = stored.portfolio || [];
    state.stockGroups = stored.stockGroups || [];
    state.settings = { ...state.settings, ...stored.settings };
    if (stored.settings && stored.settings.indicators) {
      state.indicators = { ...state.indicators, ...stored.settings.indicators };
    }
    state.currentStock = stored.currentStock || null;

    // 同步指标按钮高亮
    document.querySelectorAll('.ind-btn[data-ind]').forEach(b => {
      b.classList.toggle('active', !!state.indicators[b.dataset.ind]);
    });


    // 初始化 API 提供商
    StockAPI.init(state.settings);
    OCR.init(state.settings);
    LLM.init(state.settings);
    refreshOCRAvailability();

    applyTheme(state.settings.theme);
    bindEvents();
    await rebuildChartChips();
    renderGroupFilterBar();
    listenBackgroundMessages();
    listenStorageChanges();

    ChartManager.init('chartContainer');
    if (state.currentStock) {
      showStockInfo(state.currentStock);
      loadChart();
    } else if (state.chartStocks.length > 0) {
      showStockInfo(state.chartStocks[0]);
      loadChart();
    }
    // Batch fetch quotes for summary table
    refreshChartQuotes();

    startAutoRefresh();
    updateMarketTime();
    setInterval(updateMarketTime, 1000);
    // 大盘指数 10s 刷新
    refreshMarketBar();
    state.marketTimer = setInterval(refreshMarketBar, 10 * 1000);
  }

  // ===== Tab Switching =====
  function switchTab(tab) {
    state.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');

    if (tab === 'watchlist') renderWatchlist();
    if (tab === 'portfolio') renderPortfolio();
    if (tab === 'chart') {
      setTimeout(() => {
        ChartManager.init('chartContainer');
        if (state.currentStock) loadChart();
      }, 50);
    }
  }

  // ===== Chart Chips (multi-stock) =====
  async function rebuildChartChips() {
    // 确保从 storage 读取最新数据
    if (state.chartSource === 'portfolio') {
      state.portfolio = await DB.get('portfolio', []);
    } else {
      state.watchlist = await DB.get('watchlist', []);
    }
    const source = state.chartSource === 'portfolio' ? state.portfolio : state.watchlist;
    const sourceCodes = new Set(source.map(s => s.fullCode));
    // 仅保留手动添加的（fromSource: false），不保留另一个源的股票
    const extras = (state.chartStocks || []).filter(s => !s.fromSource && !sourceCodes.has(s.fullCode));
    state.chartStocks = [
      ...source.map(s => ({ fullCode: s.fullCode, code: s.code, name: s.name, market: s.market, fromSource: true })),
      ...extras
    ];
    // 如果当前选中的股票不在新列表中，自动选第一个
    if (state.currentStock && !state.chartStocks.some(s => s.fullCode === state.currentStock.fullCode)) {
      state.currentStock = state.chartStocks.length > 0 ? state.chartStocks[0] : null;
    }
    renderChartChips();
    renderStockSummaryTable();
  }

  function renderChartChips() {
    const container = document.getElementById('chartChips');
    container.innerHTML = '';
    for (const stock of state.chartStocks) {
      const chip = document.createElement('span');
      const isActive = state.currentStock && state.currentStock.fullCode === stock.fullCode;
      chip.className = 'chip' + (isActive ? ' active' : '');
      const removeBtn = stock.fromSource
        ? ''
        : `<span class="chip-remove" data-code="${stock.fullCode}" title="移除">&times;</span>`;
      chip.innerHTML = `<span>${stock.name}</span>${removeBtn}`;
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('chip-remove')) {
          removeChartStock(stock.fullCode);
          return;
        }
        showStockInfo(stock);
        loadChart();
        renderChartChips();
      });
      container.appendChild(chip);
    }
  }

  function addChartStock(stock) {
    if (state.chartStocks.find(s => s.fullCode === stock.fullCode)) {
      // Already exists, just select it
      showStockInfo(stock);
      loadChart();
      renderChartChips();
      return;
    }
    state.chartStocks.push({
      fullCode: stock.fullCode, code: stock.code,
      name: stock.name, market: stock.market, fromSource: false
    });
    showStockInfo(stock);
    loadChart();
    renderChartChips();
  }

  function removeChartStock(fullCode) {
    const stock = state.chartStocks.find(s => s.fullCode === fullCode);
    if (stock && stock.fromSource) return; // 源股不可删
    state.chartStocks = state.chartStocks.filter(s => s.fullCode !== fullCode);
    if (state.currentStock && state.currentStock.fullCode === fullCode) {
      state.currentStock = state.chartStocks.length > 0 ? state.chartStocks[0] : null;
      if (state.currentStock) {
        showStockInfo(state.currentStock);
        loadChart();
      } else {
        clearStockDisplay();
      }
    }
    renderChartChips();
  }

  // ===== Stock Summary Table (同花顺风格) =====
  async function renderStockSummaryTable() {
    const container = document.getElementById('stockSummaryTable');
    if (!container) return;
    const stocks = state.chartStocks;
    if (!stocks.length) {
      container.innerHTML = '';
      return;
    }
    const s = state.sort.chart;
    const sorted = sortStocks(stocks, s, state.quotes);
    // Build table HTML
    let html = '<table><thead><tr>' +
      `<th class="stock-col-code sortable" data-sort="code">代码${sortIndicator('code', s)}</th>` +
      `<th class="sortable" data-sort="name">名称${sortIndicator('name', s)}</th>` +
      `<th class="sortable" data-sort="price">最新价${sortIndicator('price', s)}</th>` +
      `<th class="sortable" data-sort="change">涨跌幅${sortIndicator('change', s)}</th>` +
      `<th class="sortable" data-sort="volume">成交量${sortIndicator('volume', s)}</th>` +
      '<th>30日走势</th>' +
      '</tr></thead><tbody>';
    for (const stock of sorted) {
      const q = state.quotes[stock.fullCode] || {};
      const change = q.changePercent || 0;
      const cls = change >= 0 ? 'price-up' : 'price-down';
      const isActive = state.currentStock && state.currentStock.fullCode === stock.fullCode;
      const priceStr = q.price ? (q.market === 'HK' ? q.price.toFixed(3) : q.price.toFixed(2)) : '--';
      const changeStr = q.price ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '--';
      const vol = q.volume >= 1e8 ? (q.volume / 1e8).toFixed(1) + '亿' :
                  q.volume >= 1e4 ? (q.volume / 1e4).toFixed(0) + '万' :
                  (q.volume || '--');
      html += `<tr class="${isActive ? 'active' : ''}" data-code="${stock.fullCode}">` +
        `<td class="stock-col-code">${stock.code}</td>` +
        `<td class="stock-col-name">${q.name || stock.name}</td>` +
        `<td class="${cls}">${priceStr}</td>` +
        `<td class="${cls}">${changeStr}</td>` +
        `<td>${vol}</td>` +
        `<td class="stock-col-spark" id="spark-${stock.fullCode.replace(/[:.]/g,'_')}">--</td>` +
        '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    // Bind sort header clicks
    container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        toggleSort('chart', th.dataset.sort);
        renderStockSummaryTable();
      });
      th.style.cursor = 'pointer';
    });
    // Bind click events
    container.querySelectorAll('tr[data-code]').forEach(row => {
      row.addEventListener('click', () => {
        const code = row.dataset.code;
        const stock = state.chartStocks.find(s => s.fullCode === code);
        if (stock) {
          showStockInfo(stock);
          loadChart();
          renderChartChips();
          renderStockSummaryTable();
        }
      });
    });
    // Fetch kline data for sparklines (sequential with delay to avoid API rate limit)
    loadSparklines(stocks);
  }

  // ===== Sparkline: 并发限流 + 本地缓存 =====
  const SPARKLINE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  const SPARKLINE_CONCURRENCY = 2;

  async function loadSparklines(stocks) {
    // Load persistent cache from storage
    let persistCache = {};
    try {
      const stored = await DB.get('_sparklineCache');
      if (stored && stored.data && Date.now() - stored.ts < SPARKLINE_CACHE_TTL) {
        persistCache = stored.data;
      }
    } catch (_) {}

    const toFetch = [];
    for (const stock of stocks) {
      const cellId = 'spark-' + stock.fullCode.replace(/[:.]/g, '_');
      const cell = document.getElementById(cellId);
      if (!cell) continue;

      // 1. Try in-memory cache (from klineCache — loaded by loadChart)
      let klines = state._klineCache[stock.fullCode];
      // 2. Try persistent sparkline cache
      if (!klines && persistCache[stock.fullCode]) {
        klines = persistCache[stock.fullCode];
        state._klineCache[stock.fullCode] = klines;
      }
      if (klines && klines.length >= 2) {
        renderSparklineSVG(cell, klines);
      } else {
        toFetch.push({ stock, cell });
      }
    }

    // Fetch missing sparklines with concurrency limit
    let idx = 0;
    const updatedCache = { ...persistCache };
    async function fetchNext() {
      while (idx < toFetch.length) {
        const { stock, cell } = toFetch[idx++];
        try {
          const klines = await StockAPI.getKline(stock.fullCode, 'daily', 30);
          if (klines && klines.length >= 2) {
            state._klineCache[stock.fullCode] = klines;
            updatedCache[stock.fullCode] = klines;
            renderSparklineSVG(cell, klines);
          } else {
            cell.textContent = '';
          }
        } catch (_) {
          cell.textContent = '';
        }
        // Small delay between requests to be nice to the API
        await new Promise(r => setTimeout(r, 200));
      }
    }
    // Run N workers in parallel
    const workers = [];
    for (let i = 0; i < SPARKLINE_CONCURRENCY; i++) workers.push(fetchNext());
    await Promise.all(workers);

    // Persist updated cache
    try { await DB.set('_sparklineCache', { data: updatedCache, ts: Date.now() }); } catch (_) {}
  }

  function renderSparklineSVG(cell, klines) {
    const closes = klines.slice(-30).map(k => k.close);
    if (closes.length < 2) { cell.textContent = ''; return; }
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const w = 60, h = 20;
    const points = closes.map((v, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const isUp = closes[closes.length - 1] >= closes[0];
    const color = isUp ? 'var(--up)' : 'var(--down)';
    cell.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      '</svg>';
  }

  async function buildSparkline(stock) {
    // Legacy wrapper — kept for compatibility
    const cellId = 'spark-' + stock.fullCode.replace(/[:.]/g, '_');
    const cell = document.getElementById(cellId);
    if (!cell) return;
    let klines = state._klineCache[stock.fullCode];
    if (!klines) {
      try {
        klines = await StockAPI.getKline(stock.fullCode, 'daily', 30);
        state._klineCache[stock.fullCode] = klines;
      } catch (_) { cell.textContent = ''; return; }
    }
    if (!klines || klines.length < 2) { cell.textContent = ''; return; }
    renderSparklineSVG(cell, klines);
  }

  async function refreshChartQuotes() {
    if (!state.chartStocks.length) return;
    const codes = state.chartStocks.map(s => s.fullCode);
    try {
      const quotes = await StockAPI.getQuotes(codes);
      state.quotes = { ...state.quotes, ...quotes };
      for (const stock of state.chartStocks) {
        const q = quotes[stock.fullCode];
        if (q && q.name) stock.name = q.name;
      }
      // Update prices in-place (don't rebuild table — preserves sparklines)
      updateSummaryTablePrices();
      // Full table rebuild only if table doesn't exist yet
      const container = document.getElementById('stockSummaryTable');
      if (!container || !container.querySelector('table')) {
        renderStockSummaryTable();
      }
    } catch (e) {
      console.warn('[refreshChartQuotes] failed:', e);
    }
  }

  function updateSummaryTablePrices() {
    const container = document.getElementById('stockSummaryTable');
    if (!container) return;
    for (const stock of state.chartStocks) {
      const q = state.quotes[stock.fullCode] || {};
      const row = container.querySelector(`tr[data-code="${stock.fullCode}"]`);
      if (!row) continue;
      const change = q.changePercent || 0;
      const cls = change >= 0 ? 'price-up' : 'price-down';
      const priceStr = q.price ? (q.market === 'HK' ? q.price.toFixed(3) : q.price.toFixed(2)) : '--';
      const changeStr = q.price ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '--';
      const vol = q.volume >= 1e8 ? (q.volume / 1e8).toFixed(1) + '亿' :
                  q.volume >= 1e4 ? (q.volume / 1e4).toFixed(0) + '万' :
                  (q.volume || '--');
      const cells = row.querySelectorAll('td');
      if (cells[2]) { cells[2].className = cls; cells[2].textContent = priceStr; }
      if (cells[3]) { cells[3].className = cls; cells[3].textContent = changeStr; }
      if (cells[4]) { cells[4].textContent = vol; }
      // Update name
      if (cells[1] && q.name) cells[1].textContent = q.name;
    }
  }

  // ===== Chart Loading =====
  async function loadChart() {
    if (!state.currentStock) return;
    if (state._loadingChart) return; // 防止并发
    state._loadingChart = true;
    try {
      // 自动初始化图表（如果尚未创建）
      if (!ChartManager.chart) {
        try { ChartManager.init('chartContainer'); } catch (e) { console.error('[Chart] init failed:', e); }
      }
      if (!ChartManager.chart) {
        document.getElementById('stockName').textContent = '图表初始化失败';
        return;
      }
      const { fullCode } = state.currentStock;

      try {
        if (state.currentPeriod === 'realtime') {
          const data = await StockAPI.getRealtime(fullCode);
          if (!data.points || data.points.length === 0) {
            console.warn('[loadChart] realtime data empty for', fullCode);
            document.getElementById('stockName').textContent = `${state.currentStock.name || fullCode} — 无分时数据（可能已休市）`;
          } else {
            document.getElementById('stockName').textContent = state.currentStock.name || fullCode;
          }
          ChartManager.renderRealtime(data);
        } else {
          const klines = await StockAPI.getKline(fullCode, state.currentPeriod, state.settings.klineCount);
          if (!klines || klines.length === 0) {
            console.warn('[loadChart] kline data empty for', fullCode, 'period:', state.currentPeriod);
            document.getElementById('stockName').textContent = `${state.currentStock.name || fullCode} — 无K线数据`;
          }
          state._klineCache[fullCode] = klines;
          const pos = state.portfolio.find(p => p.fullCode === fullCode);
          const trades = pos ? pos.trades : [];
          ChartManager.renderKline(klines, trades, {
            boll: state.indicators.boll,
            macd: state.indicators.macd,
            kdj: state.indicators.kdj,
            alertLines: []
          });
        }
      } catch (err) {
        console.error('[loadChart] error:', err);
        document.getElementById('stockName').textContent = `加载失败: ${err.message}`;
      }

      try {
        const quotes = await StockAPI.getQuotes([fullCode]);
        if (quotes[fullCode]) {
          updateStockDisplay(quotes[fullCode]);
        }
      } catch (err) {
        console.warn('[loadChart] quote fetch error:', err);
      }
    } finally {
      state._loadingChart = false;
    }
  }

  function updateStockDisplay(q) {
    document.getElementById('stockName').textContent = `${q.name} (${q.code})`;
    const priceEl = document.getElementById('stockPrice');
    priceEl.textContent = q.price.toFixed(q.market === 'HK' ? 3 : 2);
    const sign = q.change >= 0 ? '+' : '';
    const changeEl = document.getElementById('stockChange');
    changeEl.textContent = `${sign}${q.change.toFixed(2)} (${sign}${q.changePercent.toFixed(2)}%)`;
    const cls = q.change >= 0 ? 'price-up' : 'price-down';
    priceEl.className = 'stock-price ' + cls;
    changeEl.className = 'stock-change ' + cls;
    const vol = q.volume >= 1e8 ? (q.volume / 1e8).toFixed(2) + '亿' :
                q.volume >= 1e4 ? (q.volume / 1e4).toFixed(0) + '万' :
                q.volume.toString();
    document.getElementById('stockVol').textContent = `量:${vol}`;
  }

  function showStockInfo(stock) {
    state.currentStock = stock;
    DB.set('currentStock', stock);
    document.getElementById('stockName').textContent = `${stock.name} (${stock.code})`;
    document.getElementById('stockPrice').textContent = '--';
    document.getElementById('stockChange').textContent = '--';
  }

  function clearStockDisplay() {
    state.currentStock = null;
    document.getElementById('stockName').textContent = '--';
    document.getElementById('stockPrice').textContent = '--';
    document.getElementById('stockChange').textContent = '--';
    document.getElementById('stockVol').textContent = '';
  }

  // ===== Search Helper =====
  function bindSearch(inputEl, resultsEl, onSelect) {
    let timer = null;
    inputEl.addEventListener('input', () => {
      clearTimeout(timer);
      const val = inputEl.value.trim();
      if (!val) { resultsEl.classList.remove('show'); return; }
      timer = setTimeout(async () => {
        const results = await StockAPI.search(val);
        renderSearchResults(resultsEl, results, onSelect);
      }, 300);
    });
    inputEl.addEventListener('blur', () => {
      setTimeout(() => resultsEl.classList.remove('show'), 200);
    });
    inputEl.addEventListener('focus', () => {
      if (resultsEl.children.length > 0) resultsEl.classList.add('show');
    });
  }

  function renderSearchResults(container, results, onSelect) {
    container.innerHTML = '';
    if (!results.length) { container.classList.remove('show'); return; }
    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'search-item';
      div.innerHTML = `<span class="code">${r.code}</span><span class="name">${r.name}</span><span class="market">${r.market}</span>`;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(r);
        container.classList.remove('show');
      });
      container.appendChild(div);
    }
    container.classList.add('show');
  }

  // ===== Watchlist =====
  async function addToWatchlist(stock) {
    if (state.watchlist.find(w => w.fullCode === stock.fullCode)) return;
    state.watchlist.push({
      fullCode: stock.fullCode, code: stock.code,
      name: stock.name, market: stock.market
    });
    await DB.set('watchlist', state.watchlist);
    if (state.chartSource === 'watchlist') await rebuildChartChips();
    renderWatchlist();
  }

  async function addManyToWatchlist(stocks) {
    let added = 0;
    for (const s of stocks) {
      if (!state.watchlist.find(w => w.fullCode === s.fullCode)) {
        state.watchlist.push({ fullCode: s.fullCode, code: s.code, name: s.name, market: s.market });
        added++;
      }
    }
    await DB.set('watchlist', state.watchlist);
    if (state.chartSource === 'watchlist') await rebuildChartChips();
    return added;
  }

  async function removeFromWatchlist(fullCode) {
    state.watchlist = state.watchlist.filter(w => w.fullCode !== fullCode);
    await DB.set('watchlist', state.watchlist);
    if (state.chartSource === 'watchlist') await rebuildChartChips();
    renderWatchlist();
  }

  async function renderWatchlist() {
    const table = document.getElementById('watchlistTable');
    // 按分组过滤
    let stocks = state.watchlist;
    if (state.activeGroupFilter !== 'all') {
      stocks = stocks.filter(w => w.groupId === state.activeGroupFilter);
    }
    if (!stocks.length) {
      const msg = state.activeGroupFilter !== 'all'
        ? '该分组暂无自选股'
        : '暂无自选股，点击"添加"或"批量"按钮';
      table.innerHTML = `<div class="empty-state"><div class="icon">&#9734;</div><div>${msg}</div></div>`;
      return;
    }
    const codes = stocks.map(w => w.fullCode);
    const quotes = await StockAPI.getQuotes(codes);
    state.quotes = { ...state.quotes, ...quotes };
    // 排序
    const s = state.sort.watchlist;
    const sorted = sortStocks(stocks, s, state.quotes);
    // 排序工具栏
    let toolbar = '<div class="sort-bar">';
    const fields = [
      { key: 'code', label: '代码' },
      { key: 'name', label: '名称' },
      { key: 'price', label: '价格' },
      { key: 'change', label: '涨跌' }
    ];
    for (const f of fields) {
      const active = s.key === f.key;
      const cls = active ? ' sort-btn active' : ' sort-btn';
      const arrow = active ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
      toolbar += `<button class="${cls}" data-key="${f.key}">${f.label}${arrow}</button>`;
    }
    toolbar += '</div>';
    table.innerHTML = toolbar;
    // Bind sort clicks
    table.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSort('watchlist', btn.dataset.key);
        renderWatchlist();
      });
    });
    for (const stock of sorted) {
      const q = state.quotes[stock.fullCode] || {};
      const change = q.changePercent || 0;
      const cls = change >= 0 ? 'price-up' : 'price-down';
      const row = document.createElement('div');
      row.className = 'wl-row';
      row.innerHTML = `
        <span class="wl-code">${stock.code}</span>
        <span class="wl-name" title="点击跳转东财">${q.name || stock.name}</span>
        <span class="wl-price ${cls}">${q.price ? (q.market === 'HK' ? q.price.toFixed(3) : q.price.toFixed(2)) : '--'}</span>
        <span class="wl-change ${cls}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>
        <span class="wl-actions-cell">
          <button class="wl-action wl-jump" data-code="${stock.fullCode}" title="在东方财富查看">&#8599;</button>
          <button class="wl-action wl-del" data-code="${stock.fullCode}" title="删除">&times;</button>
        </span>
      `;
      if (q.name && q.name !== stock.name) {
        stock.name = q.name;
        DB.set('watchlist', state.watchlist);
      }
      row.addEventListener('click', (e) => {
        if (e.target.closest('.wl-action')) return;
        showStockInfo(stock);
        switchTab('chart');
        addChartStock(stock);
      });
      row.querySelector('.wl-jump').addEventListener('click', (e) => {
        e.stopPropagation();
        jumpToEastmoney(stock);
      });
      row.querySelector('.wl-del').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromWatchlist(stock.fullCode);
      });
      table.appendChild(row);
    }
  }

  // ===== Portfolio =====
  async function renderPortfolio() {
    state.portfolio = await DB.get('portfolio', []);
    const list = document.getElementById('portfolioList');
    if (!state.portfolio.length) {
      list.innerHTML = '<div class="empty-state"><div class="icon">&#128202;</div><div>暂无持仓记录</div></div>';
      renderPortfolioSummary([]);
      return;
    }
    const codes = state.portfolio.map(p => p.fullCode);
    const quotes = await StockAPI.getQuotes(codes);
    state.quotes = { ...state.quotes, ...quotes };

    // 排序
    const s = state.sort.portfolio;
    const sorted = sortPositions(state.portfolio, s, quotes);

    // 排序工具栏
    let toolbar = '<div class="sort-bar">';
    const fields = [
      { key: 'name', label: '名称' },
      { key: 'pnl', label: '盈亏' },
      { key: 'pnlPercent', label: '盈亏%' },
      { key: 'marketValue', label: '市值' },
      { key: 'price', label: '现价' }
    ];
    for (const f of fields) {
      const active = s.key === f.key;
      const cls = active ? ' sort-btn active' : ' sort-btn';
      const arrow = active ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
      toolbar += `<button class="${cls}" data-key="${f.key}">${f.label}${arrow}</button>`;
    }
    toolbar += '</div>';

    list.innerHTML = toolbar;
    // Bind sort clicks
    list.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSort('portfolio', btn.dataset.key);
        renderPortfolio();
      });
    });

    const summaryData = [];
    for (const pos of sorted) {
      const q = state.quotes[pos.fullCode] || {};
      if (q.name && q.name !== pos.name) { pos.name = q.name; }
      const currentPrice = q.price || 0;
      const calc = Portfolio.calcPosition(pos, currentPrice);
      summaryData.push({ ...calc, name: pos.name });
      const color = Portfolio.getColor(pos.colorIndex || 0);
      const pnlCls = calc.pnl >= 0 ? 'price-up' : 'price-down';
      const card = document.createElement('div');
      card.className = 'pos-card';
      card.innerHTML = `
        <div class="pos-card-top">
          <div><span class="pos-card-name" style="color:${color}">${pos.name}</span><span class="pos-card-code">${pos.code}</span></div>
          <span class="pos-card-pnl ${pnlCls}">${calc.pnl >= 0 ? '+' : ''}${calc.pnl.toFixed(2)} (${calc.pnlPercent >= 0 ? '+' : ''}${calc.pnlPercent.toFixed(2)}%)</span>
        </div>
        <div class="pos-card-bottom">
          <span>持仓:${calc.holdingQty}</span>
          <span>均价:${calc.avgCost.toFixed(2)}</span>
          <span>现价:${currentPrice > 0 ? currentPrice.toFixed(2) : '--'}</span>
          <span>市值:${calc.marketValue.toFixed(0)}</span>
        </div>
        <div class="pos-card-actions">
          <button class="view-chart" data-code="${pos.fullCode}">K线</button>
          <button class="add-trade" data-code="${pos.fullCode}">追加</button>
          <button class="show-trades" data-code="${pos.fullCode}">记录(${pos.trades.length})</button>
          <button class="pos-jump" data-code="${pos.fullCode}" title="东方财富查看">&#8599;</button>
          <button class="del-pos" data-code="${pos.fullCode}">删除</button>
        </div>
        <div class="pos-trades" id="trades-${pos.fullCode.replace(':','-')}" style="display:none"></div>
      `;
      card.querySelector('.view-chart').addEventListener('click', () => {
        showStockInfo(pos); addChartStock(pos); switchTab('chart');
      });
      card.querySelector('.add-trade').addEventListener('click', () => openPositionModal(pos));
      card.querySelector('.show-trades').addEventListener('click', () => toggleTrades(pos));
      card.querySelector('.pos-jump').addEventListener('click', () => jumpToEastmoney(pos));
      card.querySelector('.del-pos').addEventListener('click', async () => {
        if (confirm(`确认删除 ${pos.name} 的所有记录？`)) {
          state.portfolio = await Portfolio.deletePosition(pos.fullCode);
          renderPortfolio();
          if (state.chartSource === 'portfolio') await rebuildChartChips();
        }
      });
      list.appendChild(card);
    }
    renderPortfolioSummary(summaryData);
  }

  function renderPortfolioSummary(data) {
    const el = document.getElementById('portfolioSummary');
    if (!data.length) { el.innerHTML = ''; return; }
    const totalValue = data.reduce((s, d) => s + d.marketValue, 0);
    const totalCost = data.reduce((s, d) => s + d.costValue, 0);
    const totalPnl = data.reduce((s, d) => s + d.pnl, 0);
    // 今日盈亏 = 持仓数 * (现价 - 昨收)
    let todayPnl = 0;
    for (const pos of state.portfolio) {
      const q = state.quotes[pos.fullCode] || {};
      if (q.price && q.prevClose) todayPnl += (q.price - q.prevClose) * Portfolio.calcPosition(pos, q.price).holdingQty;
    }
    const totalReturnPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
    const cls = totalPnl >= 0 ? 'price-up' : 'price-down';
    const tcls = todayPnl >= 0 ? 'price-up' : 'price-down';
    el.innerHTML = `
      <div class="summary-item"><span class="summary-label">总市值</span><span class="summary-value">${totalValue.toFixed(0)}</span></div>
      <div class="summary-item"><span class="summary-label">今日</span><span class="summary-value ${tcls}">${todayPnl >= 0?'+':''}${todayPnl.toFixed(0)}</span></div>
      <div class="summary-item"><span class="summary-label">总盈亏</span><span class="summary-value ${cls}">${totalPnl >= 0?'+':''}${totalPnl.toFixed(0)} (${totalReturnPct >= 0?'+':''}${totalReturnPct.toFixed(2)}%)</span></div>
    `;
  }

  function toggleTrades(pos) {
    const el = document.getElementById('trades-' + pos.fullCode.replace(':','-'));
    if (!el) return;
    if (el.style.display === 'none') {
      el.style.display = 'block';
      el.innerHTML = '';
      for (const t of pos.trades.sort((a,b)=>a.date.localeCompare(b.date))) {
        const cls = t.direction === 'buy' ? 'trade-buy' : 'trade-sell';
        const row = document.createElement('div');
        row.className = 'pos-trade-row';
        row.innerHTML = `<span class="${cls}">${t.direction==='buy'?'买':'卖'}</span><span>${t.date}</span><span>${t.price}</span><span>${t.quantity}股</span><span>${t.note||''}</span><button class="wl-del">&times;</button>`;
        row.querySelector('.wl-del').addEventListener('click', async () => {
          state.portfolio = await Portfolio.deleteTrade(pos.fullCode, t.id);
          renderPortfolio();
        });
        el.appendChild(row);
      }
    } else {
      el.style.display = 'none';
    }
  }

  // ===== Overlay Chart =====
  async function renderOverlayChart() {
    if (!state.portfolio.length) return;
    ChartManager.initOverlay('overlayChart');
    ChartManager.clearOverlay();
    for (const pos of state.portfolio) {
      const klines = await StockAPI.getKline(pos.fullCode, 'daily', 120);
      const color = Portfolio.getColor(pos.colorIndex || 0);
      await ChartManager.addOverlayLine(pos.fullCode, pos.name, color, klines);
    }
  }

  // ===== 大盘指数条 =====
  function renderMarketIndicesCheckboxes() {
    const container = document.getElementById('marketIndicesCheckboxes');
    if (!container || typeof MarketAPI === 'undefined') return;
    const selected = new Set(state.settings.marketIndices || MarketAPI.DEFAULT_SELECTED);
    container.innerHTML = '';
    for (const [group, indices] of Object.entries(MarketAPI.MARKETS)) {
      const label = document.createElement('div');
      label.className = 'market-group-label';
      label.textContent = group;
      container.appendChild(label);
      for (const idx of indices) {
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = idx.secid;
        cb.checked = selected.has(idx.secid);
        cb.addEventListener('change', async () => {
          const checked = [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
          state.settings.marketIndices = checked.length ? checked : MarketAPI.DEFAULT_SELECTED;
          await DB.set('settings', state.settings);
        });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + idx.name));
        container.appendChild(lbl);
      }
    }
  }

  async function refreshMarketBar() {
    const bar = document.getElementById('marketBar');
    if (!bar) return;
    try {
      const data = await MarketAPI.fetchAll(state.settings.marketIndices);
      if (!data || !data.length) {
        bar.innerHTML = '<div class="market-bar-loading">大盘数据加载失败（网络/接口异常）</div>';
        return;
      }
      bar.innerHTML = '';
      for (const item of data) {
        const fmt = MarketAPI.formatChange(item);
        if (!fmt) continue;
        const cls = item.change >= 0 ? 'price-up' : 'price-down';
        const div = document.createElement('div');
        div.className = `market-item ${cls}`;
        div.innerHTML = `<span class="market-name">${item.name}</span>` +
          `<span class="market-price">${fmt.priceStr}</span>` +
          `<span class="market-change">${fmt.changeStr}</span>`;
        bar.appendChild(div);
      }
    } catch (err) {
      console.error('[Market] refreshMarketBar error:', err);
      bar.innerHTML = '<div class="market-bar-loading">大盘数据加载失败</div>';
    }
  }

  // ===== 弹窗（独立窗口） =====
  function openPopoutWindow() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'sp:open-window' });
  }

  // ===== AI 助手 =====
  function openAIModal() {
    const stock = state.currentStock;
    const infoEl = document.getElementById('aiStockInfo');
    if (stock) {
      infoEl.textContent = `${stock.name} (${stock.code})`;
    } else {
      infoEl.textContent = '请先在 K 线图选择一只股票';
    }
    document.getElementById('aiExtraPrompt').value = '';
    document.getElementById('aiResultText').value = '';
    document.getElementById('aiStatus').textContent = '';
    renderAISkills();
    openModal('aiModal');
  }

  async function renderAISkills() {
    const list = document.getElementById('aiSkillsList');
    const skills = await Skills.list();
    list.innerHTML = '';
    for (const s of skills) {
      const card = document.createElement('label');
      card.className = 'ai-skill-card';
      card.innerHTML = `
        <input type="radio" name="ai-skill" value="${s.id}" ${skills.indexOf(s) === 0 ? 'checked' : ''}>
        <div>
          <div class="ai-skill-name">${s.name}${s.builtin ? ' <span class="badge">内置</span>' : ''}</div>
          <div class="ai-skill-desc">${s.description || ''}</div>
        </div>
      `;
      list.appendChild(card);
    }
  }

  async function runAISkill() {
    if (!state.currentStock) {
      alert('请先在 K 线图选择一只股票');
      return;
    }
    if (!state.settings.llmApiKey) {
      if (confirm('尚未配置 LLM API Key，是否打开设置？')) {
        closeAllModals();
        document.getElementById('settingsBtn').click();
      }
      return;
    }
    const sel = document.querySelector('input[name="ai-skill"]:checked');
    if (!sel) { alert('请选择一个 Skill'); return; }
    const skillId = sel.value;
    const stock = state.currentStock;
    const extra = document.getElementById('aiExtraPrompt').value.trim();
    const resultEl = document.getElementById('aiResultText');
    const statusEl = document.getElementById('aiStatus');
    const runBtn = document.getElementById('aiRunBtn');

    resultEl.value = '';
    statusEl.textContent = '正在拉取行情和 K 线...';
    runBtn.disabled = true;

    try {
      const klines = await StockAPI.getKline(stock.fullCode, 'daily', state.settings.klineCount);
      state._klineCache[stock.fullCode] = klines;
      const quotes = await StockAPI.getQuotes([stock.fullCode]);
      const q = quotes[stock.fullCode] || {};
      if (q.name && q.name !== stock.name) { stock.name = q.name; }
      statusEl.textContent = '正在拉取基本面和公告...';
      const enrichment = await Enrichment.fetchAll(stock.fullCode).catch(() => ({}));
      statusEl.textContent = '调用大模型中...';
      let res = await Skills.run(skillId, stock, { quote: q, kline: klines, enrichment });
      if (extra) res.content += `\n\n---\n**附加要求**：${extra}\n\n` + (await LLM.chat({
        system: '你是同一位分析师，针对用户附加要求作答。',
        user: `原回答基础上，补充回答：${extra}\n\n原回答：\n${res.content}`,
        temperature: 0.5
      })).content;
      resultEl.value = res.content;
      statusEl.textContent = '完成';
    } catch (err) {
      statusEl.textContent = '';
      resultEl.value = '失败：' + (err.message || err);
    } finally {
      runBtn.disabled = false;
    }
  }

  // ===== Skills 管理 =====
  function openSkillsModal() {
    renderSkillsList();
    switchSkillsTab('list');
    document.getElementById('editingSkillId').value = '';
    clearSkillForm();
    openModal('skillsModal');
  }

  function switchSkillsTab(tab) {
    document.querySelectorAll('.skills-tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.skillsTab === tab));
    document.getElementById('skillsListPanel').style.display = tab === 'list' ? 'block' : 'none';
    document.getElementById('skillsEditPanel').style.display = tab === 'edit' ? 'block' : 'none';
    document.getElementById('skillsImportPanel').style.display = tab === 'import' ? 'block' : 'none';
  }

  async function renderSkillsList() {
    const list = document.getElementById('skillsList');
    const skills = await Skills.list();
    // 检测哪些是覆盖了内置的 _user 版本
    const userSkills = await DB.get('userSkills', []);
    const userOverrideIds = new Set(userSkills.filter(s => s.id.endsWith('_user')).map(s => s.id));
    list.innerHTML = '';
    for (const s of skills) {
      const card = document.createElement('div');
      card.className = 'skill-card';
      const licenseTag = s.license ? ` <span class="badge badge-license">${s.license}</span>` : '';
      const isOverride = userOverrideIds.has(s.id);
      const badge = s.builtin ? ' <span class="badge">内置</span>'
        : isOverride ? ' <span class="badge" style="background:#e67e22">已修改</span>'
        : '';
      card.innerHTML = `
        <div class="skill-card-main">
          <div class="skill-card-name">${escapeHtml(s.name)}${badge}${licenseTag}</div>
          <div class="skill-card-desc">${escapeHtml(s.description || '')}</div>
        </div>
        <div class="skill-card-actions">
          <button class="secondary-btn skill-copy" data-id="${s.id}" title="复制为 SKILL.md">📋 复制</button>
          <button class="secondary-btn skill-edit" data-id="${s.id}">编辑</button>
          ${isOverride ? '<button class="secondary-btn skill-reset" data-id="' + s.id + '" title="恢复内置默认">重置</button>' : ''}
          ${s.builtin ? '' : '<button class="danger-btn skill-del" data-id="' + s.id + '">删除</button>'}
        </div>
      `;
      card.querySelector('.skill-copy').addEventListener('click', () => copySkillAsMarkdown(s.id));
      card.querySelector('.skill-edit').addEventListener('click', () => loadSkillToForm(s.id));
      const delBtn = card.querySelector('.skill-del');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`确认删除 Skill「${s.name}」？`)) return;
          await Skills.remove(s.id);
          renderSkillsList();
        });
      }
      const resetBtn = card.querySelector('.skill-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          if (!confirm(`确认将「${s.name}」恢复为内置默认？您的修改将丢失。`)) return;
          await Skills.remove(s.id);
          renderSkillsList();
        });
      }
      list.appendChild(card);
    }
  }

  async function copySkillAsMarkdown(skillId) {
    const s = await Skills.get(skillId);
    if (!s) return;
    const md = Skills.toMarkdown(s);
    try {
      await navigator.clipboard.writeText(md);
      flashStatus('aiStatus', '✓ 已复制为 SKILL.md 到剪贴板，可粘贴到任何 LLM 平台');
    } catch (e) {
      // 降级方案：弹窗显示让用户手动复制
      prompt('复制以下 SKILL.md 内容（Ctrl+A 全选 → Ctrl+C 复制）：', md);
    }
  }

  async function importSkillFromMarkdown() {
    const text = document.getElementById('skillImportText').value.trim();
    const status = document.getElementById('skillImportStatus');
    if (!text) {
      status.textContent = '✗ 内容为空';
      status.className = 'skill-import-status error';
      return;
    }
    try {
      const skill = Skills.fromMarkdown(text);
      if (!skill.systemPrompt && !skill.userTemplate) {
        status.textContent = '✗ 解析失败：找不到「## 系统提示词」或「## 用户提示词模板」代码块';
        status.className = 'skill-import-status error';
        return;
      }
      await Skills.save(skill);
      status.textContent = `✓ 已导入「${skill.name}」`;
      status.className = 'skill-import-status success';
      document.getElementById('skillImportText').value = '';
      await renderSkillsList();
      setTimeout(() => switchSkillsTab('list'), 800);
    } catch (e) {
      status.textContent = '✗ 解析失败：' + e.message;
      status.className = 'skill-import-status error';
    }
  }

  function fillImportExample() {
    const s = Skills._BUILTIN[0];
    document.getElementById('skillImportText').value = Skills.toMarkdown(s);
  }

  // 简易 HTML escape
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 通用状态提示（3 秒自动清空）
  function flashStatus(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const oldText = el.textContent;
    el.textContent = message;
    setTimeout(() => { if (el.textContent === message) el.textContent = oldText; }, 3000);
  }

  async function loadSkillToForm(id) {
    const s = await Skills.get(id);
    if (!s) return;
    document.getElementById('editingSkillId').value = s.id;
    document.getElementById('skillName').value = s.name;
    document.getElementById('skillDesc').value = s.description || '';
    document.getElementById('skillSystem').value = s.systemPrompt || '';
    document.getElementById('skillTemplate').value = s.userTemplate || '';
    switchSkillsTab('edit');
  }

  function clearSkillForm() {
    document.getElementById('editingSkillId').value = '';
    document.getElementById('skillName').value = '';
    document.getElementById('skillDesc').value = '';
    document.getElementById('skillSystem').value = '';
    document.getElementById('skillTemplate').value = '';
  }

  async function saveSkill() {
    const name = document.getElementById('skillName').value.trim();
    const desc = document.getElementById('skillDesc').value.trim();
    const sys = document.getElementById('skillSystem').value.trim();
    const tpl = document.getElementById('skillTemplate').value.trim();
    if (!name || !sys || !tpl) { alert('名称/系统提示词/用户提示词模板 都不能为空'); return; }
    const editingId = document.getElementById('editingSkillId').value;
    const all = await Skills.list();
    const existing = editingId ? all.find(s => s.id === editingId) : null;
    const skill = {
      id: existing ? existing.id : ('user_' + Date.now()),
      name, description: desc, systemPrompt: sys, userTemplate: tpl,
      builtin: existing ? !!existing.builtin : false
    };
    await Skills.save(skill);
    clearSkillForm();
    switchSkillsTab('list');
    renderSkillsList();
  }

  async function testLLMConnection() {
    const statusEl = document.getElementById('llmTestStatus');
    const copyBtn = document.getElementById('llmCopyBtn');
    const maxTokens = state.settings.llmMaxTokens || 4096;
    statusEl.textContent = `测试中…（最长 30s，max tokens: ${maxTokens}）`;
    statusEl.className = 'llm-test-status';
    statusEl.removeAttribute('title');
    if (copyBtn) copyBtn.style.display = 'none';
    try {
      const res = await LLM.chat({
        system: 'You are a ping service. Reply with the single word PONG.',
        user: 'ping',
        temperature: 0
      });
      // 有 usage 说明连接通了（即使 content 为空也可能是推理模型 token 不够）
      const hasUsage = res && res.usage && (res.usage.total_tokens > 0 || res.usage.completion_tokens > 0);
      if (res && res.content) {
        const preview = res.content.replace(/\s+/g, ' ').slice(0, 60);
        statusEl.textContent = `✓ 连接成功（max tokens: ${maxTokens}，模型返回：${preview}）`;
        statusEl.classList.add('ok');
      } else if (hasUsage) {
        // 连接通了但 content 为空 → 推理模型 token 不够输出正文
        statusEl.textContent = `✓ 连接成功（max tokens: ${maxTokens}，模型已响应，但 content 为空）`;
        statusEl.classList.add('ok');
      } else {
        statusEl.textContent = `⚠ 返回为空（max tokens: ${maxTokens}，无 usage 数据，模型可能未正常工作）`;
        statusEl.classList.add('warn');
      }
    } catch (err) {
      const raw = (err && err.message) || String(err);
      statusEl.textContent = '✗ ' + raw;
      statusEl.classList.add('err');
      statusEl.title = raw;
      if (copyBtn) {
        copyBtn.style.display = '';
        copyBtn.dataset.text = raw;
      }
    }
  }

  async function copyLLMError() {
    const btn = document.getElementById('llmCopyBtn');
    const text = btn && btn.dataset.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(() => { btn.textContent = old; }, 1500);
    } catch (e) {
      btn.textContent = '复制失败';
    }
  }

  // ===== K线 AI 解读（顶栏按钮） =====
  async function runChartAI() {
    if (!state.currentStock) {
      alert('请先在 K 线图选择一只股票');
      return;
    }
    openAIModal();
  }

  // ===== Modals =====
  function openModal(modalId) {
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById(modalId).style.display = 'flex';
  }

  function closeAllModals() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  }

  function openPositionModal(existingPos) {
    document.getElementById('posDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('posPrice').value = '';
    document.getElementById('posQuantity').value = '';
    document.getElementById('posNote').value = '';
    document.getElementById('posDirection').value = 'buy';
    if (existingPos) {
      document.getElementById('posStockCode').value = existingPos.fullCode;
      document.getElementById('posStockLabel').textContent = `${existingPos.name} (${existingPos.code})`;
      document.getElementById('posStockSearch').value = existingPos.name;
      document.getElementById('posStockSearch').disabled = true;
    } else {
      document.getElementById('posStockCode').value = '';
      document.getElementById('posStockLabel').textContent = '';
      document.getElementById('posStockSearch').value = '';
      document.getElementById('posStockSearch').disabled = false;
    }
    openModal('addPositionModal');
  }

  // ===== Batch Import =====
  async function handleBatchWatchlist() {
    const text = document.getElementById('batchWatchInput').value.trim();
    const statusEl = document.getElementById('batchWatchStatus');
    const submitBtn = document.getElementById('batchWatchSubmit');
    if (!text) return;
    submitBtn.disabled = true;
    statusEl.innerHTML = '解析中...';
    const parsed = OCR.parseBatchCodes(text);
    if (!parsed.length) {
      statusEl.innerHTML = '<span class="err">未识别到有效股票代码</span>';
      submitBtn.disabled = false;
      return;
    }
    // Search each code to get name
    statusEl.innerHTML = `识别到 ${parsed.length} 个代码，正在查询...`;
    const resolved = [];
    for (const p of parsed) {
      const results = await StockAPI.search(p.code);
      const match = results.find(r => r.code === p.code) || results[0];
      if (match) {
        resolved.push(match);
        statusEl.innerHTML += `<br><span class="ok">+ ${match.name} (${match.code})</span>`;
      } else {
        statusEl.innerHTML += `<br><span class="err">? ${p.code} 未找到</span>`;
      }
    }
    if (resolved.length) {
      const added = await addManyToWatchlist(resolved);
      statusEl.innerHTML += `<br><b>成功添加 ${added} 只股票</b>`;
      renderWatchlist();
    }
    submitBtn.disabled = false;
    closeAllModals();
  }

  async function handleBatchPortfolio() {
    const text = document.getElementById('batchPortfolioInput').value.trim();
    const statusEl = document.getElementById('batchPortfolioStatus');
    const submitBtn = document.getElementById('batchPortfolioSubmit');
    if (!text) return;
    submitBtn.disabled = true;
    statusEl.innerHTML = '解析中...';
    const parsed = OCR.parseBatchPortfolio(text);
    if (!parsed.length) {
      statusEl.innerHTML = '<span class="err">未识别到有效持仓数据。格式：代码 价格 数量 [日期]</span>';
      submitBtn.disabled = false;
      return;
    }
    statusEl.innerHTML = `识别到 ${parsed.length} 条记录，正在导入...`;
    for (const p of parsed) {
      const results = await StockAPI.search(p.code);
      const match = results.find(r => r.code === p.code) || results[0];
      if (match) {
        await Portfolio.addTrade({
          fullCode: match.fullCode, code: match.code,
          name: match.name, market: match.market,
          direction: p.direction, price: p.price,
          quantity: p.quantity, date: p.date, note: p.note
        });
        const degraded = (p.price === 0 || p.quantity === 0);
        const parts = [];
        if (p.price > 0) parts.push(p.price); else parts.push('<i>价格待补</i>');
        if (p.quantity > 0) parts.push(`x${p.quantity}`); else parts.push('<i>x数量待补</i>');
        const label = parts.join('');
        const cls = degraded ? 'warn' : 'ok';
        statusEl.innerHTML += `<br><span class="${cls}">+ ${match.name} ${label}</span>`;
      } else {
        statusEl.innerHTML += `<br><span class="err">? ${p.code} 未找到</span>`;
      }
    }
    state.portfolio = await DB.get('portfolio', []);
    const hasDegraded = parsed.some(p => p.price === 0 || p.quantity === 0);
    statusEl.innerHTML += hasDegraded
      ? `<br><b>导入完成</b>（标记 <span class="warn">价格/数量待补</span> 的条目请在持仓页手动补全）`
      : `<br><b>导入完成</b>`;
    if (state.chartSource === 'portfolio') await rebuildChartChips();
    renderPortfolio();
    submitBtn.disabled = false;
    closeAllModals();
  }

  // ===== OCR =====
  async function handleOCR(file, target) {
    const previewEl = document.getElementById('ocrPreview');
    const imgEl = document.getElementById('ocrPreviewImg');
    const progressEl = document.getElementById('ocrProgress');
    const fillEl = document.getElementById('ocrProgressFill');
    const textEl = document.getElementById('ocrProgressText');
    const resultTextEl = document.getElementById('ocrResultText');
    const statusEl = document.getElementById('ocrEngineStatus');

    if (!OCR.isEnabled()) {
      alert('OCR 引擎未启用：' + OCR.getUnavailabilityReason() + '\n\n请在设置 → AI / 大模型 中配置 API Key、Base URL 和视觉模型。');
      return;
    }

    document.getElementById('ocrTarget').value = target;
    resultTextEl.value = '';
    resultTextEl.disabled = true;

    // 先显示原图作为快速反馈
    const reader = new FileReader();
    reader.onload = e => { imgEl.src = e.target.result; previewEl.style.display = 'block'; };
    reader.readAsDataURL(file);

    progressEl.style.display = 'flex';
    fillEl.style.width = '5%';
    textEl.textContent = '准备图片...';
    statusEl.textContent = '调用大模型视觉中...';

    try {
      const result = await OCR.recognizeImage(file, (p, status) => {
        const pct = Math.round(p * 100);
        fillEl.style.width = pct + '%';
        textEl.textContent = `${status || '识别中'} ${pct}%`;
        if (status) statusEl.textContent = status;
      }, target);

      fillEl.style.width = '100%';
      const conf = Math.round(result.confidence || 0);
      const isPortfolio = target === 'portfolio';
      const countLabel = isPortfolio
        ? `${result.text.split('\n').filter(l => l.trim()).length} 行数据`
        : `${result.codes.length} 个代码`;
      textEl.textContent = `识别完成（大模型视觉，置信度 ${conf}%，共 ${countLabel}）`;
      statusEl.textContent = '引擎就绪（大模型视觉）';
      statusEl.classList.remove('err');

      if (result.preview) imgEl.src = result.preview;

      const display = isPortfolio
        ? (result.text || '').trim()
        : (result.codes.length > 0 ? result.codes.join('\n') : (result.text || '').trim());
      resultTextEl.value = display;
      resultTextEl.disabled = false;
      resultTextEl.focus();
    } catch (err) {
      console.error(err);
      fillEl.style.width = '100%';
      const errMsg = err && err.message ? err.message : String(err);
      textEl.textContent = `OCR 识别失败：${errMsg}`;
      statusEl.textContent = OCR.isEnabled() ? '识别出错，可重试' : ('引擎不可用：' + OCR.getUnavailabilityReason());
      statusEl.classList.add('err');
      resultTextEl.placeholder = 'OCR 不可用，请直接输入或粘贴代码：\n600519\n00700\n000858\n...';
      resultTextEl.disabled = false;
    }
  }

  function handleClipboardPaste(e) {
    if (!e.clipboardData) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const target = document.getElementById('ocrTarget').value;
          handleOCR(file, target);
          return;
        }
      }
    }
  }

  async function handleOCRSubmit() {
    const submitBtn = document.getElementById('ocrSubmitBtn');
    const target = document.getElementById('ocrTarget').value;
    const text = document.getElementById('ocrResultText').value;
    if (!text.trim()) return;
    submitBtn.disabled = true;
    try {
      if (target === 'watchlist') {
        document.getElementById('batchWatchInput').value = text;
        closeAllModals();
        openModal('batchWatchModal');
        await handleBatchWatchlist();
      } else {
        document.getElementById('batchPortfolioInput').value = text;
        closeAllModals();
        openModal('batchPortfolioModal');
        await handleBatchPortfolio();
      }
    } catch (err) {
      console.error('[OCR Submit]', err);
      alert('导入出错：' + (err.message || err));
    }
    submitBtn.disabled = false;
  }

  // ===== Auto Refresh =====
  function startAutoRefresh() {
    stopAutoRefresh();
    const interval = state.settings.refreshInterval;
    if (interval > 0) {
      state.refreshTimer = setInterval(async () => {
        if (state.currentTab === 'chart') {
          if (state.currentStock) await loadChart();
          await refreshChartQuotes();
        }
        else if (state.currentTab === 'watchlist') {
          await renderWatchlist();
        }
        else if (state.currentTab === 'portfolio') {
          await renderPortfolio();
        }
      }, interval * 1000);
    }
  }

  /**
   */

  function stopAutoRefresh() {
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  }

  function updateMarketTime() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const isTrading = (h===9&&m>=30)||(h>=10&&h<11)||(h===11&&m<=30)||(h>=13&&h<15);
    const isWeekday = now.getDay()>=1 && now.getDay()<=5;
    document.getElementById('marketTime').textContent = `${timeStr} ${isWeekday&&isTrading?'交易中':'休市'}`;
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    if (ChartManager.chart) ChartManager.updateTheme(theme);
  }

  function applyAccentColor(color) {
    document.documentElement.style.setProperty('--accent', color);
    // 计算半透明版本用于 hover 等
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  }

  /**
   * 设置模态框：根据当前数据源显示 / 隐藏 token / key 输入框
   * 字段以 data-providers 或 data-token-providers 标记支持的提供商 ID（逗号分隔），
   *   如果列表里包含 tushare/juhe（数据源付费）→ 看 quoteProvider/klineProvider
   */
  function toggleProviderFields() {
    const quoteCur = document.getElementById('quoteProvider') && document.getElementById('quoteProvider').value;
    const klineCur = document.getElementById('klineProvider') && document.getElementById('klineProvider').value;
    document.querySelectorAll('.provider-only, .token-field').forEach(el => {
      const supported = (el.dataset.providers || el.dataset.tokenProviders || '').split(',').filter(Boolean);
      const isDataField = supported.some(p => p === 'tushare' || p === 'juhe');
      if (!isDataField) {
        el.style.display = 'none';
        return;
      }
      const visible = (quoteCur && supported.includes(quoteCur)) || (klineCur && supported.includes(klineCur));
      el.style.display = visible ? '' : 'none';
    });
  }

  /**
   * 刷新设置面板里的 OCR 状态行 + 全局 OCR 入口按钮启用状态
   * 在 LLM 字段变化 / 启动 / 打开设置时调用
   */
  function refreshOCRAvailability() {
    OCR.init(state.settings);
    const enabled = OCR.isEnabled();
    const reason = OCR.getUnavailabilityReason();
    const line = document.getElementById('ocrStatusLine');
    if (line) {
      line.textContent = enabled
        ? '✓ OCR 可用（将使用 ' + (state.settings.llmVisionModel || state.settings.llmModel || '视觉模型') + '）'
        : '✗ OCR 不可用：' + reason;
      line.className = 'ocr-status-line ' + (enabled ? 'ok' : 'err');
    }
    document.querySelectorAll('.ocr-entry-btn').forEach(btn => {
      btn.disabled = !enabled;
      btn.title = enabled ? '' : 'OCR 不可用：' + reason + '（请在设置 → AI / 大模型 中配置）';
    });
  }

  /**
   * 根据 provider 能力（caps）动态填充 quoteProvider / klineProvider 下拉框
   */
  function fillProviderDropdowns() {
    const providers = StockAPI.listProviders();
    const quoteSel = document.getElementById('quoteProvider');
    const klineSel = document.getElementById('klineProvider');
    const intlQuoteSel = document.getElementById('intlQuoteProvider');
    const intlKlineSel = document.getElementById('intlKlineProvider');

    const fillOpts = (sel, cap, addDefault) => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '';
      if (addDefault) {
        const opt0 = document.createElement('option');
        opt0.value = ''; opt0.textContent = '跟随上方设置';
        sel.appendChild(opt0);
      }
      providers.filter(p => p.caps[cap]).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label + (p.requires.length ? ' · 需 ' + p.requires.join('/') : '');
        sel.appendChild(opt);
      });
      // 恢复当前值（如果还存在），否则 fallback 到第一个
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    };

    fillOpts(quoteSel, 'quote', false);
    fillOpts(klineSel, 'kline', false);
    fillOpts(intlQuoteSel, 'quote', true);
    fillOpts(intlKlineSel, 'kline', true);
  }

  /**
   * 切换数据源后统一刷新所有视图
   */
  async function refreshAll() {
    // 重新计算每只股票
    if (state.currentTab === 'chart' && state.currentStock) {
      await loadChart();
    } else if (state.currentTab === 'watchlist') {
      await renderWatchlist();
    } else if (state.currentTab === 'portfolio') {
      await renderPortfolio();
    }
  }

  // ===== 跳转东方财富 =====
  function jumpToEastmoney(stock) {
    if (!stock) return;
    chrome.runtime.sendMessage({ type: 'sp:open-eastmoney', stock });
  }

  // ===== 预警模态框 =====



  // ===== Group Management =====
  async function addGroup(name) {
    if (!name.trim()) return;
    const id = 'grp_' + Date.now().toString(36);
    state.stockGroups.push({ id, name: name.trim() });
    await DB.set('stockGroups', state.stockGroups);
    renderGroupFilterBar();
    renderGroupModalList();
  }

  async function renameGroup(id, newName) {
    const g = state.stockGroups.find(g => g.id === id);
    if (!g) return;
    g.name = newName.trim();
    await DB.set('stockGroups', state.stockGroups);
    renderGroupFilterBar();
    renderGroupModalList();
    if (state.currentTab === 'watchlist') renderWatchlist();
  }

  async function deleteGroup(id) {
    state.stockGroups = state.stockGroups.filter(g => g.id !== id);
    // 清除该分组下股票的 groupId
    for (const stock of state.watchlist) {
      if (stock.groupId === id) delete stock.groupId;
    }
    await DB.set('stockGroups', state.stockGroups);
    await DB.set('watchlist', state.watchlist);
    if (state.activeGroupFilter === id) state.activeGroupFilter = 'all';
    renderGroupFilterBar();
    renderGroupModalList();
    if (state.currentTab === 'watchlist') renderWatchlist();
  }

  async function assignStockToGroup(fullCode, groupId) {
    const stock = state.watchlist.find(w => w.fullCode === fullCode);
    if (!stock) return;
    if (groupId) stock.groupId = groupId;
    else delete stock.groupId;
    await DB.set('watchlist', state.watchlist);
    renderGroupFilterBar();
    if (state.currentTab === 'watchlist') renderWatchlist();
  }

  function renderGroupFilterBar() {
    const bar = document.getElementById('groupFilterBar');
    if (!bar) return;
    let html = `<button class="group-filter-btn${state.activeGroupFilter === 'all' ? ' active' : ''}" data-group="all">全部</button>`;
    for (const g of state.stockGroups) {
      const count = state.watchlist.filter(w => w.groupId === g.id).length;
      html += `<button class="group-filter-btn${state.activeGroupFilter === g.id ? ' active' : ''}" data-group="${g.id}">${g.name} (${count})</button>`;
    }
    bar.innerHTML = html;
    bar.querySelectorAll('.group-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeGroupFilter = btn.dataset.group;
        renderGroupFilterBar();
        renderWatchlist();
      });
    });
  }

  function renderGroupModalList() {
    const list = document.getElementById('groupList');
    if (!list) return;
    if (!state.stockGroups.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px">暂无分组，请在上方创建</div>';
      return;
    }
    list.innerHTML = '';
    for (const g of state.stockGroups) {
      const count = state.watchlist.filter(w => w.groupId === g.id).length;
      const div = document.createElement('div');
      div.className = 'group-item';
      div.innerHTML = `<span class="group-item-name">${g.name}</span>` +
        `<span class="group-item-count">${count} 只</span>` +
        `<button class="group-edit" data-id="${g.id}" title="重命名">编辑</button>` +
        `<button class="group-del" data-id="${g.id}" title="删除">删除</button>`;
      div.querySelector('.group-edit').addEventListener('click', () => {
        const newName = prompt('重命名分组:', g.name);
        if (newName && newName.trim()) renameGroup(g.id, newName);
      });
      div.querySelector('.group-del').addEventListener('click', () => {
        if (confirm(`确定删除分组「${g.name}」？该组下的股票不会被删除。`)) deleteGroup(g.id);
      });
      list.appendChild(div);
    }
    // 更新下拉框
    const stockSelect = document.getElementById('assignStockSelect');
    const groupSelect = document.getElementById('assignGroupSelect');
    if (stockSelect) {
      stockSelect.innerHTML = '<option value="">选择自选股...</option>';
      for (const w of state.watchlist) {
        const grp = state.stockGroups.find(g => g.id === w.groupId);
        const label = grp ? `${w.name} (${w.code}) [${grp.name}]` : `${w.name} (${w.code})`;
        stockSelect.innerHTML += `<option value="${w.fullCode}">${label}</option>`;
      }
    }
    if (groupSelect) {
      groupSelect.innerHTML = '<option value="">不分组</option>';
      for (const g of state.stockGroups) {
        groupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
      }
    }
  }

  // ===== 监听 background 消息 =====
  function listenBackgroundMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'sp:add-watchlist') {
        addToWatchlist(msg.stock).then(() => {
          sendResponse({ ok: true });
        });
        return true;
      }
    });
  }

  /**
   * 监听 storage 变化：多 panel 共享数据时保持同步
   */
  function listenStorageChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.watchlist) {
        state.watchlist = changes.watchlist.newValue || [];
        if (state.chartSource === 'watchlist') rebuildChartChips();
      }
      if (changes.portfolio) {
        state.portfolio = changes.portfolio.newValue || [];
        if (state.chartSource === 'portfolio') rebuildChartChips();
      }
    });
  }

  // ===== Event Binding =====
  function bindEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentPeriod = btn.dataset.period;
        loadChart();
      });
    });

    // Indicator toggles
    document.querySelectorAll('.ind-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.ind;
        if (state.currentPeriod === 'realtime') {
          alert('分时图不支持技术指标');
          return;
        }
        btn.classList.toggle('active');
        state.indicators[name] = btn.classList.contains('active');
        // 持久化设置
        const settings = { ...state.settings, indicators: state.indicators };
        state.settings = settings;
        DB.set('settings', settings);
        // 复用缓存的 K 线数据切换
        const klines = state.currentStock && state._klineCache[state.currentStock.fullCode];
        if (klines) {
          ChartManager.toggleIndicator(name, klines);
        } else {
          loadChart();
        }
      });
    });

    // Chart source toggle (portfolio / watchlist)
    document.querySelectorAll('.src-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.src-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.chartSource = btn.dataset.src;
        await rebuildChartChips();
        if (state.currentStock) {
          showStockInfo(state.currentStock);
          loadChart();
        }
      });
    });

    // Chart add stock button
    document.getElementById('chartAddStockBtn').addEventListener('click', () => {
      const row = document.getElementById('chartSearchRow');
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      if (row.style.display === 'flex') document.getElementById('chartStockSearch').focus();
    });
    document.getElementById('chartSearchClose').addEventListener('click', () => {
      document.getElementById('chartSearchRow').style.display = 'none';
    });

    // Chart search
    bindSearch(
      document.getElementById('chartStockSearch'),
      document.getElementById('chartSearchResults'),
      (stock) => {
        addChartStock(stock);
        document.getElementById('chartStockSearch').value = '';
      }
    );

    // Watchlist: single add
    document.getElementById('addWatchBtn').addEventListener('click', () => {
      openModal('addWatchModal');
      setTimeout(() => document.getElementById('watchSearchInput').focus(), 50);
    });
    bindSearch(
      document.getElementById('watchSearchInput'),
      document.getElementById('watchSearchResults'),
      (stock) => {
        addToWatchlist(stock);
        document.getElementById('watchSearchInput').value = '';
        // Don't close modal — allow adding more
      }
    );

    // Watchlist: batch
    document.getElementById('batchWatchBtn').addEventListener('click', () => {
      document.getElementById('batchWatchInput').value = '';
      document.getElementById('batchWatchStatus').innerHTML = '';
      openModal('batchWatchModal');
    });
    document.getElementById('batchWatchSubmit').addEventListener('click', handleBatchWatchlist);

    // Watchlist: OCR
    document.getElementById('ocrWatchBtn').addEventListener('click', () => {
      resetOCRModal();
      document.getElementById('ocrTarget').value = 'watchlist';
      openModal('ocrModal');
      warmupOCR();
    });

    // Group management
    document.getElementById('groupManageBtn').addEventListener('click', () => {
      renderGroupModalList();
      openModal('groupModal');
    });
    document.getElementById('addGroupBtn').addEventListener('click', () => {
      const input = document.getElementById('newGroupName');
      addGroup(input.value);
      input.value = '';
    });
    document.getElementById('newGroupName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        addGroup(e.target.value);
        e.target.value = '';
      }
    });
    document.getElementById('assignGroupBtn').addEventListener('click', async () => {
      const fullCode = document.getElementById('assignStockSelect').value;
      const groupId = document.getElementById('assignGroupSelect').value;
      if (!fullCode) { alert('请选择一只自选股'); return; }
      await assignStockToGroup(fullCode, groupId);
      renderGroupModalList();
      const stock = state.watchlist.find(w => w.fullCode === fullCode);
      const grp = state.stockGroups.find(g => g.id === groupId);
      alert(`已将 ${stock ? stock.name : fullCode} 移动到${grp ? '「' + grp.name + '」' : '未分组'}`);
    });

    // Portfolio: add single
    document.getElementById('addPositionBtn').addEventListener('click', () => openPositionModal(null));

    // Portfolio: batch
    document.getElementById('batchPortfolioBtn').addEventListener('click', () => {
      document.getElementById('batchPortfolioInput').value = '';
      document.getElementById('batchPortfolioStatus').innerHTML = '';
      openModal('batchPortfolioModal');
    });
    document.getElementById('batchPortfolioSubmit').addEventListener('click', handleBatchPortfolio);

    // Portfolio: OCR
    document.getElementById('ocrPortfolioBtn').addEventListener('click', () => {
      resetOCRModal();
      document.getElementById('ocrTarget').value = 'portfolio';
      openModal('ocrModal');
      warmupOCR();
    });

    // Position search
    bindSearch(
      document.getElementById('posStockSearch'),
      document.getElementById('posSearchResults'),
      (stock) => {
        document.getElementById('posStockCode').value = stock.fullCode;
        document.getElementById('posStockLabel').textContent = `${stock.name} (${stock.code})`;
        document.getElementById('posStockSearch').value = stock.name;
        document.getElementById('posStockSearch').dataset.stock = JSON.stringify(stock);
      }
    );

    // Save position
    document.getElementById('savePositionBtn').addEventListener('click', async () => {
      const fullCode = document.getElementById('posStockCode').value;
      if (!fullCode) { alert('请先选择股票'); return; }
      const price = parseFloat(document.getElementById('posPrice').value);
      const quantity = parseInt(document.getElementById('posQuantity').value);
      if (!price || !quantity) { alert('请输入价格和数量'); return; }
      let stockData;
      const searchEl = document.getElementById('posStockSearch');
      if (searchEl.dataset.stock) {
        stockData = JSON.parse(searchEl.dataset.stock);
      } else {
        const pos = state.portfolio.find(p => p.fullCode === fullCode);
        stockData = pos || { fullCode, code: fullCode.split(':')[1], name: '', market: fullCode.split(':')[0] };
      }
      state.portfolio = await Portfolio.addTrade({
        fullCode: stockData.fullCode || fullCode,
        code: stockData.code, name: stockData.name, market: stockData.market,
        direction: document.getElementById('posDirection').value,
        price, quantity,
        date: document.getElementById('posDate').value,
        note: document.getElementById('posNote').value
      });
      closeAllModals();
      if (state.currentTab === 'portfolio') renderPortfolio();
      if (state.chartSource === 'portfolio') await rebuildChartChips();
    });

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('refreshInterval').value = state.settings.refreshInterval;
      document.getElementById('themeSelect').value = state.settings.theme;
      // 主题色
      const accentVal = state.settings.accentColor || '#4fc3f7';
      const accentInput = document.getElementById('accentColor');
      const accentLabel = document.getElementById('accentColorLabel');
      if (accentInput) accentInput.value = accentVal;
      if (accentLabel) accentLabel.textContent = accentVal;
      document.getElementById('klineCount').value = state.settings.klineCount;
      fillProviderDropdowns();
      document.getElementById('quoteProvider').value = state.settings.quoteProvider || 'tencent';
      document.getElementById('klineProvider').value = state.settings.klineProvider || 'eastmoney';
      document.getElementById('intlQuoteProvider').value = state.settings.intlQuoteProvider || '';
      document.getElementById('intlKlineProvider').value = state.settings.intlKlineProvider || '';
      document.getElementById('tushareToken').value = state.settings.tushareToken || '';
      document.getElementById('juheKey').value = state.settings.juheKey || '';
      document.getElementById('ocrProvider') && document.getElementById('ocrProvider');
      // OCR 引擎已统一为大模型视觉，状态由下方 LLM 字段决定
      refreshOCRAvailability();
      // LLM 字段
      const preset = LLM.getPreset(state.settings.llmProvider) || LLM.getPreset('openai');
      document.getElementById('llmProvider').value = state.settings.llmProvider || 'openai';
      document.getElementById('llmBaseUrl').value = state.settings.llmBaseUrl || preset.baseUrl;
      document.getElementById('llmApiKey').value = state.settings.llmApiKey || '';
      document.getElementById('llmModel').value = state.settings.llmModel || preset.model;
      document.getElementById('llmVisionModel').value = state.settings.llmVisionModel || preset.visionModel || preset.model;
      // 视觉模型若为空（首次设置或跟随对话模型），UI 上展示为跟随对话模型的值
      if (!state.settings.llmVisionModel && state.settings.llmModel) {
        document.getElementById('llmVisionModel').value = state.settings.llmModel;
      }
      document.getElementById('corsProxy').value = state.settings.corsProxy || '';
      document.getElementById('llmMaxTokens').value = state.settings.llmMaxTokens || 4096;
      // 大盘指数复选框
      renderMarketIndicesCheckboxes();
      // 记录当前模型值，用于判断视觉模型是否「还跟着对话模型走」
      state._previousLlmModel = state.settings.llmModel || '';
      const testStatus = document.getElementById('llmTestStatus');
      testStatus.textContent = ''; testStatus.className = 'llm-test-status';
      toggleProviderFields();
      openModal('settingsModal');
    });
    document.getElementById('refreshInterval').addEventListener('change', async (e) => {
      state.settings.refreshInterval = parseInt(e.target.value);
      await DB.set('settings', state.settings); startAutoRefresh();
    });
    document.getElementById('themeSelect').addEventListener('change', async (e) => {
      state.settings.theme = e.target.value;
      await DB.set('settings', state.settings); applyTheme(e.target.value);
    });
    // 主题色
    const accentInput = document.getElementById('accentColor');
    const accentLabel = document.getElementById('accentColorLabel');
    const accentResetBtn = document.getElementById('accentResetBtn');
    if (accentInput) {
      accentInput.addEventListener('input', (e) => {
        applyAccentColor(e.target.value);
        if (accentLabel) accentLabel.textContent = e.target.value;
      });
      accentInput.addEventListener('change', async (e) => {
        state.settings.accentColor = e.target.value;
        await DB.set('settings', state.settings);
      });
    }
    if (accentResetBtn) {
      accentResetBtn.addEventListener('click', async () => {
        const def = '#4fc3f7';
        applyAccentColor(def);
        if (accentInput) accentInput.value = def;
        if (accentLabel) accentLabel.textContent = def;
        state.settings.accentColor = def;
        await DB.set('settings', state.settings);
      });
    }
    document.getElementById('klineCount').addEventListener('change', async (e) => {
      state.settings.klineCount = parseInt(e.target.value);
      await DB.set('settings', state.settings);
      if (state.currentStock) loadChart();
    });

    // 实时报价 / K线 源切换
    document.getElementById('quoteProvider').addEventListener('change', async (e) => {
      state.settings.quoteProvider = e.target.value;
      toggleProviderFields();
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      refreshAll();
    });
    document.getElementById('klineProvider').addEventListener('change', async (e) => {
      state.settings.klineProvider = e.target.value;
      toggleProviderFields();
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      // 切换 K 线源后清空缓存，强制重拉
      if (state.currentStock) {
        delete state._klineCache[state.currentStock.fullCode];
        loadChart();
      }
    });
    document.getElementById('intlQuoteProvider').addEventListener('change', async (e) => {
      state.settings.intlQuoteProvider = e.target.value;
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      refreshAll();
    });
    document.getElementById('intlKlineProvider').addEventListener('change', async (e) => {
      state.settings.intlKlineProvider = e.target.value;
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      if (state.currentStock) {
        delete state._klineCache[state.currentStock.fullCode];
        loadChart();
      }
    });
    document.getElementById('tushareToken').addEventListener('change', async (e) => {
      state.settings.tushareToken = e.target.value.trim();
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      refreshAll();
    });
    document.getElementById('juheKey').addEventListener('change', async (e) => {
      state.settings.juheKey = e.target.value.trim();
      await DB.set('settings', state.settings);
      StockAPI.init(state.settings);
      refreshAll();
    });

    // OCR 引擎切换（已废弃，仅作向后兼容保护）
    // 当前 OCR 统一使用大模型视觉，状态由下方 LLM 字段驱动
    const legacyOcrProvider = document.getElementById('ocrProvider');
    if (legacyOcrProvider) legacyOcrProvider.addEventListener('change', refreshOCRAvailability);

    // LLM 字段
    document.getElementById('llmProvider').addEventListener('change', async (e) => {
      const id = e.target.value;
      state.settings.llmProvider = id;
      const preset = LLM.getPreset(id);
      if (preset && id !== 'custom') {
        document.getElementById('llmBaseUrl').value = preset.baseUrl;
        document.getElementById('llmModel').value = preset.model;
        document.getElementById('llmVisionModel').value = preset.visionModel;
        state.settings.llmBaseUrl = preset.baseUrl;
        state.settings.llmModel = preset.model;
        state.settings.llmVisionModel = preset.visionModel;
      }
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
      refreshOCRAvailability();
    });
    document.getElementById('llmBaseUrl').addEventListener('change', async (e) => {
      state.settings.llmBaseUrl = e.target.value.trim();
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
      refreshOCRAvailability();
    });
    document.getElementById('llmApiKey').addEventListener('change', async (e) => {
      state.settings.llmApiKey = e.target.value.trim();
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
      refreshOCRAvailability();
    });
    document.getElementById('llmModel').addEventListener('change', async (e) => {
      const newModel = e.target.value.trim();
      state.settings.llmModel = newModel;
      // 视觉模型跟随对话模型：仅当视觉模型输入框为空、或者还停留在上一个对话模型的值时才同步
      const visionInput = document.getElementById('llmVisionModel');
      const currentVision = state.settings.llmVisionModel || '';
      const previousModel = state._previousLlmModel || '';
      if (!currentVision || currentVision === previousModel) {
        visionInput.value = newModel;
        state.settings.llmVisionModel = newModel;
      }
      state._previousLlmModel = newModel;
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
      refreshOCRAvailability();
    });
    document.getElementById('llmVisionModel').addEventListener('change', async (e) => {
      state.settings.llmVisionModel = e.target.value.trim();
      // 用户主动改视觉模型后，标记为「已独立设置」，后续不再跟随对话模型自动同步
      state._visionModelCustomized = !!state.settings.llmVisionModel;
      state._previousLlmModel = state.settings.llmModel || '';
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
      refreshOCRAvailability();
    });
    document.getElementById('corsProxy').addEventListener('change', async (e) => {
      state.settings.corsProxy = e.target.value.trim();
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
    });
    document.getElementById('llmMaxTokens').addEventListener('change', async (e) => {
      const v = parseInt(e.target.value, 10);
      state.settings.llmMaxTokens = (v > 0) ? v : 4096;
      e.target.value = state.settings.llmMaxTokens;
      await DB.set('settings', state.settings);
      LLM.init(state.settings);
    });
    document.getElementById('llmTestBtn').addEventListener('click', testLLMConnection);
    const llmCopyBtn = document.getElementById('llmCopyBtn');
    if (llmCopyBtn) llmCopyBtn.addEventListener('click', copyLLMError);

    // AI 助手 / 弹窗 / Skills 按钮
    document.getElementById('aiBtn').addEventListener('click', openAIModal);
    document.getElementById('popoutBtn').addEventListener('click', openPopoutWindow);
    const chartAiBtn = document.getElementById('chartAiBtn');
    if (chartAiBtn) chartAiBtn.addEventListener('click', runChartAI);
    document.getElementById('aiRunBtn').addEventListener('click', runAISkill);
    document.getElementById('aiManageSkillsBtn').addEventListener('click', () => {
      closeAllModals();
      openSkillsModal();
    });
    document.querySelectorAll('.skills-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkillsTab(btn.dataset.skillsTab));
    });
    document.getElementById('saveSkillBtn').addEventListener('click', saveSkill);
    document.getElementById('clearSkillBtn').addEventListener('click', clearSkillForm);
    document.getElementById('importSkillBtn').addEventListener('click', importSkillFromMarkdown);
    document.getElementById('fillImportExampleBtn').addEventListener('click', fillImportExample);

    // Export/Import
    document.getElementById('exportDataBtn').addEventListener('click', async () => {
      const json = await DB.exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'stock-pulse-backup.json'; a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById('importDataBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await DB.importAll(await file.text());
        const stored = await DB.getAll();
        state.watchlist = stored.watchlist;
        state.portfolio = stored.portfolio;
        state.settings = { ...state.settings, ...stored.settings };
    applyTheme(state.settings.theme);
    if (state.settings.accentColor && state.settings.accentColor !== '#4fc3f7') {
      applyAccentColor(state.settings.accentColor);
    }
        await rebuildChartChips();
        alert('导入成功');
      } catch (err) { alert('导入失败：' + err.message); }
    });

    // Close modals
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeAllModals();
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });

    // Portfolio view toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        document.getElementById('portfolioList').style.display = view === 'list' ? 'block' : 'none';
        document.getElementById('portfolioOverlay').style.display = view === 'overlay' ? 'block' : 'none';
        if (view === 'overlay') renderOverlayChart();
      });
    });

    // OCR drop zone
    const dropZone = document.getElementById('ocrDropZone');
    const ocrInput = document.getElementById('ocrFileInput');
    const ocrModal = document.getElementById('ocrModal');

    dropZone.addEventListener('click', () => ocrInput.click());
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ocrInput.click(); }
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        handleOCR(file, document.getElementById('ocrTarget').value);
      }
    });
    ocrInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleOCR(file, document.getElementById('ocrTarget').value);
    });

    // 剪贴板粘贴：监听模态框内任意位置
    ocrModal.addEventListener('paste', handleClipboardPaste);

    document.getElementById('ocrSubmitBtn').addEventListener('click', handleOCRSubmit);
  }

  /**
   * 刷新 OCR 弹窗里的引擎状态文案（基于当前 LLM 配置）
   */
  function warmupOCR() {
    const statusEl = document.getElementById('ocrEngineStatus');
    if (!OCR.isEnabled()) {
      statusEl.textContent = 'OCR 不可用：' + OCR.getUnavailabilityReason() + '（请在设置 → AI / 大模型 中配置）';
      statusEl.classList.add('err');
      return;
    }
    statusEl.textContent = `引擎就绪（使用 ${state.settings.llmVisionModel || '视觉模型'}）`;
    statusEl.classList.remove('err');
  }

  function resetOCRModal() {
    document.getElementById('ocrPreview').style.display = 'none';
    document.getElementById('ocrProgress').style.display = 'none';
    document.getElementById('ocrProgressFill').style.width = '0%';
    document.getElementById('ocrProgressText').textContent = '识别中...';
    document.getElementById('ocrFileInput').value = '';
    const resultTextEl = document.getElementById('ocrResultText');
    resultTextEl.value = '';
    resultTextEl.disabled = false;
    resultTextEl.placeholder = '每行一个代码，例如：\n600519\n00700\n000858';
    const statusEl = document.getElementById('ocrEngineStatus');
    statusEl.classList.remove('err');
    statusEl.textContent = OCR.isEnabled()
      ? `引擎就绪（使用 ${state.settings.llmVisionModel || '视觉模型'}）`
      : 'OCR 不可用：' + OCR.getUnavailabilityReason();
  }

  // ===== Start =====
  init();
})();
