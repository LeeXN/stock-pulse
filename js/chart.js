/**
 * chart.js - K线图表管理（基于 Lightweight Charts）
 */
const ChartManager = {
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  lineSeries: null,
  maSeries: {},
  bollSeries: {},
  macdSeries: {},
  kdjSeries: {},
  alertLines: [],
  overlayChart: null,
  overlaySeries: {},
  _container: null,
  _indicators: { macd: false, kdj: false },
  _resizeFrame: null,
  _lastSize: { width: 0, height: 0 },

  // MA颜色
  MA_COLORS: {
    5: '#f0b90b',
    10: '#e040fb',
    20: '#4fc3f7',
    60: '#26a69a'
  },

  _resizeObserver: null,

  /**
   * 初始化主图表（如果已存在则跳过，只触发 resize）
   */
  init(containerId) {
    this._container = document.getElementById(containerId);
    if (!this._container) return;
    // 如果图表已存在且容器未变，只触发 resize 适配
    if (this.chart && this._container.children.length > 0) {
      const rect = this._container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.chart.applyOptions({ width: rect.width, height: rect.height });
      }
      return;
    }
    this._container.innerHTML = '';
    const rect = this._container.getBoundingClientRect();
    const w = rect.width || 500;
    const h = rect.height || 340;

    this.chart = LightweightCharts.createChart(this._container, {
      width: w,
      height: h,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8892a4',
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(42,58,85,0.5)' },
        horzLines: { color: 'rgba(42,58,85,0.5)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: '#4fc3f7' },
        horzLine: { labelBackgroundColor: '#4fc3f7' }
      },
      rightPriceScale: {
        borderColor: '#2a3a55',
        scaleMargins: { top: 0.05, bottom: 0.25 }
      },
      timeScale: {
        borderColor: '#2a3a55',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5
      },
      localization: {
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai'
      }
    });

    // Volume series at the bottom
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    this.chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      drawTicks: false
    });

    // Handle resize
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this._scheduleResize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this._resizeObserver.observe(this._container);
  },

  _scheduleResize(width, height) {
    if (!this.chart) return;
    const nextWidth = Math.round(width || 0);
    const nextHeight = Math.round(height || 0);
    if (nextWidth <= 0 || nextHeight <= 0) return;
    if (this._lastSize.width === nextWidth && this._lastSize.height === nextHeight) return;
    if (this._resizeFrame) cancelAnimationFrame(this._resizeFrame);
    this._resizeFrame = requestAnimationFrame(() => {
      this._resizeFrame = null;
      if (!this.chart) return;
      this._lastSize = { width: nextWidth, height: nextHeight };
      this.chart.applyOptions({ width: nextWidth, height: nextHeight });
    });
  },

  /**
   * 渲染K线数据
   * @param {Array} klineData
   * @param {Array} trades - 买卖点
   * @param {Object} [options] - { boll, macd, kdj, alertLines }
   */
  renderKline(klineData, trades = [], options = {}) {
    if (!this.chart) return;

    this._clearSeries();
    this._indicators.macd = !!options.macd;
    this._indicators.kdj = !!options.kdj;

    // Candlestick series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#ef5350',
      downColor: '#26a69a',
      borderUpColor: '#ef5350',
      borderDownColor: '#26a69a',
      wickUpColor: '#ef5350',
      wickDownColor: '#26a69a'
    });

    const candleData = klineData.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));
    this.candleSeries.setData(candleData);

    // MA lines
    this._renderMA(klineData, 5);
    this._renderMA(klineData, 10);
    this._renderMA(klineData, 20);

    // BOLL 布林带（叠加在 K 线上）
    if (options.boll) this._renderBOLL(klineData);

    // Volume
    const volData = klineData.map(d => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(239,83,80,0.4)' : 'rgba(38,166,154,0.4)'
    }));
    this.volumeSeries.setData(volData);

    // MACD / KDJ 副图
    if (options.macd) this._renderMACD(klineData);
    if (options.kdj) this._renderKDJ(klineData);

    // 重新布局
    this._applyLayout();

    // 预警线
    if (Array.isArray(options.alertLines)) {
      this._renderAlertLines(options.alertLines);
    }

    // Trade markers
    if (trades.length > 0) this._renderTradeMarkers(trades);

    this.chart.timeScale().fitContent();
  },

  /**
   * 切换指标显示（不重新加载数据）
   */
  toggleIndicator(name, klineData) {
    if (!this.candleSeries) return;
    this._indicators[name] = !this._indicators[name];
    if (name === 'macd') {
      if (this._indicators.macd) this._renderMACD(klineData);
      else this._removeSeriesGroup('macd');
    } else if (name === 'kdj') {
      if (this._indicators.kdj) this._renderKDJ(klineData);
      else this._removeSeriesGroup('kdj');
    } else if (name === 'boll') {
      // BOLL 通过重建数据切换
      if (this.bollSeries.upper) {
        this._removeSeriesGroup('boll');
      } else {
        this._renderBOLL(klineData);
      }
    }
    this._applyLayout();
  },

  /**
   * 渲染分时图
   */
  renderRealtime(realtimeData) {
    if (!this.chart) return;
    this._clearSeries();

    const { prevClose, points } = realtimeData;
    if (!points || !points.length) return;

    // Price line
    this.lineSeries = this.chart.addAreaSeries({
      lineColor: '#4fc3f7',
      topColor: 'rgba(79,195,247,0.3)',
      bottomColor: 'rgba(79,195,247,0.02)',
      lineWidth: 1.5,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3
      }
    );

    // 时间格式转换: "2026/06/01 09:30" -> epoch seconds
    const lineData = points.map(p => {
      const ts = this._parseTimeToEpoch(p.time);
      return { time: ts, value: p.price };
    }).filter(d => d.time > 0);

    this.lineSeries.setData(lineData);

    // Prev close reference line
    if (prevClose > 0) {
      this.lineSeries.createPriceLine({
        price: prevClose,
        color: '#f0b90b',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '昨收'
      });
    }

    // Volume
    const volData = points.map(p => {
      const ts = this._parseTimeToEpoch(p.time);
      return {
        time: ts,
        value: p.volume,
        color: p.price >= prevClose ? 'rgba(239,83,80,0.3)' : 'rgba(38,166,154,0.3)'
      };
    }).filter(d => d.time > 0);
    this.volumeSeries.setData(volData);

    this.chart.timeScale().fitContent();
  },

  /**
   * 渲染持仓叠加K线图
   */
  initOverlay(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    this.overlayChart = LightweightCharts.createChart(container, {
      width: container.clientWidth || 500,
      height: 340,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8892a4',
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(42,58,85,0.3)' },
        horzLines: { color: 'rgba(42,58,85,0.3)' }
      },
      rightPriceScale: {
        borderColor: '#2a3a55',
        mode: LightweightCharts.PriceScaleMode.Percentage
      },
      timeScale: { borderColor: '#2a3a55', rightOffset: 5 },
      localization: { locale: 'zh-CN', timeZone: 'Asia/Shanghai' }
    });
  },

  /**
   * 添加叠加线
   */
  async addOverlayLine(fullCode, name, color, klineData) {
    if (!this.overlayChart) return;
    const series = this.overlayChart.addLineSeries({
      color: color,
      lineWidth: 2,
      title: name,
      priceScaleId: 'right'
    });
    const data = klineData.map(d => ({ time: d.time, value: d.close }));
    series.setData(data);
    this.overlaySeries[fullCode] = series;
    this.overlayChart.timeScale().fitContent();
  },

  clearOverlay() {
    if (!this.overlayChart) return;
    for (const key of Object.keys(this.overlaySeries)) {
      this.overlayChart.removeSeries(this.overlaySeries[key]);
    }
    this.overlaySeries = {};
  },

  _clearSeries() {
    if (this.candleSeries) {
      this.chart.removeSeries(this.candleSeries);
      this.candleSeries = null;
    }
    if (this.lineSeries) {
      this.chart.removeSeries(this.lineSeries);
      this.lineSeries = null;
    }
    for (const key of Object.keys(this.maSeries)) {
      this.chart.removeSeries(this.maSeries[key]);
    }
    this.maSeries = {};
    this._removeSeriesGroup('boll');
    this._removeSeriesGroup('macd');
    this._removeSeriesGroup('kdj');
    this._removeAlertLines();
    this.volumeSeries.setData([]);
  },

  _removeSeriesGroup(group) {
    const map = { boll: 'bollSeries', macd: 'macdSeries', kdj: 'kdjSeries' }[group];
    if (!map) return;
    const seriesObj = this[map];
    if (!seriesObj) return;
    for (const key of Object.keys(seriesObj)) {
      try { this.chart.removeSeries(seriesObj[key]); } catch {}
    }
    this[map] = {};
  },

  _renderMA(data, period) {
    if (data.length < period) return;
    const color = this.MA_COLORS[period] || '#888';
    const series = this.chart.addLineSeries({
      color: color,
      lineWidth: 1,
      title: `MA${period}`,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      lastValueVisible: false
    });
    const maData = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
      maData.push({ time: data[i].time, value: sum / period });
    }
    series.setData(maData);
    this.maSeries[period] = series;
  },

  _renderTradeMarkers(trades) {
    if (!this.candleSeries) return;
    const markers = trades
      .filter(t => t.date)
      .map(t => ({
        time: t.date,
        position: t.direction === 'buy' ? 'belowBar' : 'aboveBar',
        color: t.direction === 'buy' ? '#ef5350' : '#26a69a',
        shape: t.direction === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${t.direction === 'buy' ? '买' : '卖'} ${t.quantity}股@${t.price}`
      }))
      .sort((a, b) => a.time < b.time ? -1 : 1);
    if (markers.length) {
      this.candleSeries.setMarkers(markers);
    }
  },

  _parseTimeToEpoch(timeStr) {
    // "2026/06/01 09:30" format
    try {
      const d = new Date(timeStr.replace(/\//g, '-'));
      return Math.floor(d.getTime() / 1000);
    } catch {
      return 0;
    }
  },

  updateTheme(theme) {
    if (!this.chart) return;
    const isDark = theme === 'dark';
    this.chart.applyOptions({
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#8892a4' : '#5a6478'
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(42,58,85,0.5)' : 'rgba(200,205,216,0.5)' },
        horzLines: { color: isDark ? 'rgba(42,58,85,0.5)' : 'rgba(200,205,216,0.5)' }
      },
      rightPriceScale: { borderColor: isDark ? '#2a3a55' : '#dfe3ec' },
      timeScale: { borderColor: isDark ? '#2a3a55' : '#dfe3ec' }
    });
  },

  // ===== 指标：布局 =====
  _applyLayout() {
    if (!this.chart) return;
    const panels = (this._indicators.macd ? 1 : 0) + (this._indicators.kdj ? 1 : 0);
    // 面板顺序（从上到下）：K线 + BOLL / MACD / KDJ / 成交量
    // 给每个面板约 12-15% 的高度，K线区压缩
    let kTop = 0.05;
    let kBottom = 0.22 + panels * 0.15;
    if (kBottom > 0.7) kBottom = 0.7;
    if (kBottom < 0.22) kBottom = 0.22;

    this.chart.priceScale('right').applyOptions({
      scaleMargins: { top: kTop, bottom: kBottom }
    });

    // 成交量始终在最底部
    this.chart.priceScale('vol').applyOptions({
      scaleMargins: { top: Math.max(0.82, 1 - 0.16 - panels * 0.15), bottom: 0 },
      drawTicks: false
    });

    // MACD / KDJ 的独立 price scale
    if (panels > 0) {
      const slotHeight = 0.13;  // 每个副图占 13%
      const volTop = Math.max(0.82, 1 - 0.16 - panels * 0.15);
      // 从 kBottom 之上开始排副图
      let cursor = kBottom;
      const order = [];
      if (this._indicators.macd) order.push('macd');
      if (this._indicators.kdj) order.push('kdj');
      for (const name of order) {
        const top = 1 - cursor - slotHeight;
        const bottom = cursor;
        this.chart.priceScale(name).applyOptions({
          scaleMargins: { top, bottom }
        });
        cursor += slotHeight + 0.02;
      }
    }
  },

  // ===== 指标：EMA / BOLL / MACD / KDJ =====
  _calcEMA(data, period) {
    const k = 2 / (period + 1);
    const ema = [];
    let prev = null;
    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        prev = data[i].close;
      } else {
        prev = data[i].close * k + prev * (1 - k);
      }
      ema.push({ time: data[i].time, value: prev });
    }
    return ema;
  },

  _calcBOLL(data, period = 20, mult = 2) {
    const upper = [], mid = [], lower = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
      const m = sum / period;
      let sqSum = 0;
      for (let j = i - period + 1; j <= i; j++) sqSum += (data[j].close - m) ** 2;
      const sd = Math.sqrt(sqSum / period);
      upper.push({ time: data[i].time, value: m + mult * sd });
      mid.push({ time: data[i].time, value: m });
      lower.push({ time: data[i].time, value: m - mult * sd });
    }
    return { upper, mid, lower };
  },

  _calcMACD(data, fast = 12, slow = 26, signal = 9) {
    const emaFast = this._calcEMA(data, fast);
    const emaSlow = this._calcEMA(data, slow);
    const dif = data.map((d, i) => ({ time: d.time, value: emaFast[i].value - emaSlow[i].value }));
    // DEA = EMA(DIF, signal)
    const k = 2 / (signal + 1);
    const dea = [];
    let prev = dif[0].value;
    for (let i = 0; i < dif.length; i++) {
      if (i === 0) prev = dif[i].value;
      else prev = dif[i].value * k + prev * (1 - k);
      dea.push({ time: dif[i].time, value: prev });
    }
    const hist = dif.map((d, i) => ({
      time: d.time,
      value: (d.value - dea[i].value) * 2,
      color: (d.value - dea[i].value) >= 0 ? 'rgba(239,83,80,0.7)' : 'rgba(38,166,154,0.7)'
    }));
    return { dif, dea, hist };
  },

  _calcKDJ(data, n = 9, kPeriod = 3, dPeriod = 3) {
    const kArr = [], dArr = [], jArr = [];
    let prevK = 50, prevD = 50;
    for (let i = 0; i < data.length; i++) {
      if (i < n - 1) continue;
      let hh = -Infinity, ll = Infinity;
      for (let j = i - n + 1; j <= i; j++) {
        if (data[j].high > hh) hh = data[j].high;
        if (data[j].low < ll) ll = data[j].low;
      }
      const rsv = hh === ll ? 50 : ((data[i].close - ll) / (hh - ll)) * 100;
      const K = (prevK * (kPeriod - 1) + rsv) / kPeriod;
      const D = (prevD * (dPeriod - 1) + K) / dPeriod;
      const J = 3 * K - 2 * D;
      kArr.push({ time: data[i].time, value: K });
      dArr.push({ time: data[i].time, value: D });
      jArr.push({ time: data[i].time, value: J });
      prevK = K; prevD = D;
    }
    return { k: kArr, d: dArr, j: jArr };
  },

  _renderBOLL(data) {
    if (!this.chart) return;
    const { upper, mid, lower } = this._calcBOLL(data);
    const mkLine = (key, vals, color) => {
      const s = this.chart.addLineSeries({
        color, lineWidth: 1, priceLineVisible: false,
        crosshairMarkerVisible: false, lastValueVisible: false
      });
      s.setData(vals);
      this.bollSeries[key] = s;
    };
    mkLine('upper', upper, 'rgba(79,195,247,0.7)');
    mkLine('mid', mid, 'rgba(240,185,11,0.8)');
    mkLine('lower', lower, 'rgba(79,195,247,0.7)');
  },

  _renderMACD(data) {
    if (!this.chart) return;
    const { dif, dea, hist } = this._calcMACD(data);
    this.macdSeries.hist = this.chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceScaleId: 'macd'
    });
    this.macdSeries.hist.setData(hist);

    const mkLine = (key, vals, color) => {
      const s = this.chart.addLineSeries({
        color, lineWidth: 1, priceScaleId: 'macd',
        priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false
      });
      s.setData(vals);
      this.macdSeries[key] = s;
    };
    mkLine('dif', dif, '#f0b90b');
    mkLine('dea', dea, '#4fc3f7');
  },

  _renderKDJ(data) {
    if (!this.chart) return;
    const { k, d, j } = this._calcKDJ(data);
    const mkLine = (key, vals, color) => {
      const s = this.chart.addLineSeries({
        color, lineWidth: 1, priceScaleId: 'kdj',
        priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false
      });
      s.setData(vals);
      this.kdjSeries[key] = s;
    };
    mkLine('k', k, '#f0b90b');
    mkLine('d', d, '#4fc3f7');
    mkLine('j', j, '#e040fb');
  },

  // ===== 预警价格线 =====
  _renderAlertLines(lines) {
    this._removeAlertLines();
    if (!this.candleSeries || !Array.isArray(lines)) return;
    for (const ln of lines) {
      const s = this.candleSeries.createPriceLine({
        price: ln.price,
        color: ln.color || '#ffa726',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: ln.title || '预警'
      });
      this.alertLines.push(s);
    }
  },

  _removeAlertLines() {
    if (!this.candleSeries) { this.alertLines = []; return; }
    for (const ln of this.alertLines) {
      try { this.candleSeries.removePriceLine(ln); } catch {}
    }
    this.alertLines = [];
  },

  // ===== 叠加 K 线（归一化多股对比） =====
  initOverlay(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (this.overlayChart) {
      try { this.overlayChart.remove(); } catch {}
    }
    container.innerHTML = '';
    const rect = container.getBoundingClientRect();
    const w = rect.width || 500;
    const h = rect.height || 340;
    this.overlayChart = LightweightCharts.createChart(container, {
      width: w, height: h,
      layout: { background: { color: 'transparent' }, textColor: '#8892a4', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(42,58,85,0.5)' }, horzLines: { color: 'rgba(42,58,85,0.5)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a3a55' },
      timeScale: { borderColor: '#2a3a55', timeVisible: true, secondsVisible: false, rightOffset: 5 },
      localization: { locale: 'zh-CN', timeZone: 'Asia/Shanghai' }
    });
    this.overlaySeries = {};
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        this.overlayChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(container);
  },

  clearOverlay() {
    if (!this.overlayChart) return;
    for (const key of Object.keys(this.overlaySeries)) {
      try { this.overlayChart.removeSeries(this.overlaySeries[key]); } catch {}
    }
    this.overlaySeries = {};
  },

  /**
   * 在叠加图上添加一条归一化线（以首日收盘价为 100%）
   * @param {string} key - 唯一标识（如 fullCode）
   * @param {string} label - 显示名称
   * @param {string} color - 线颜色
   * @param {Array} klineData - [{time, close}]
   */
  addOverlayLine(key, label, color, klineData) {
    if (!this.overlayChart || !klineData || klineData.length < 2) return;
    const basePrice = klineData[0].close;
    if (!basePrice) return;
    const normalized = klineData.map(d => ({
      time: d.time,
      value: ((d.close / basePrice) - 1) * 100
    }));
    const series = this.overlayChart.addLineSeries({
      color, lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: label
    });
    series.setData(normalized);
    this.overlaySeries[key] = series;
    this.overlayChart.timeScale().fitContent();
  }
};
