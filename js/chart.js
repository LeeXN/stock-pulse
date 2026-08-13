/**
 * chart.js - K线图表管理（基于 Lightweight Charts）
 */
const ChartManager = {
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  lineSeries: null,
  avgLineSeries: null,
  realtimeSeries: [],
  realtimeAvgSeries: [],
  maSeries: {},
  bollSeries: {},
  macdSeries: {},
  kdjSeries: {},

  overlayChart: null,
  overlaySeries: {},
  _overlaySeriesMeta: {},
  _overlayHighlightKey: null,
  _container: null,
  _indicators: { boll: false, macd: false, kdj: false },
  _resizeFrame: null,
  _lastSize: { width: 0, height: 0 },
  _market: 'SH',
  _settings: {},
  _timeZone: 'Asia/Shanghai',

  // MA颜色
  MA_COLORS: {
    5: '#f0b90b',
    10: '#e040fb',
    20: '#4fc3f7',
    60: '#26a69a'
  },

  _resizeObserver: null,
  _overlayResizeObserver: null,

  /**
   * 初始化主图表（如果已存在则跳过，只触发 resize）
   */
  init(containerId, timeContext = {}) {
    this.setTimeContext(timeContext.market, timeContext.settings);
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
        rightOffset: 5,
        tickMarkFormatter: time => this._formatAxisTime(time)
      },
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd',
        timeFormatter: time => this._formatCrosshairTime(time)
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

  setTimeContext(market, settings) {
    if (market) this._market = String(market).toUpperCase();
    if (settings) this._settings = settings;
    if (typeof TimeUtils !== 'undefined') {
      this._timeZone = TimeUtils.resolveTimeZone(this._market, this._settings);
    }
    if (this.chart) {
      this.chart.applyOptions({
        timeScale: { tickMarkFormatter: time => this._formatAxisTime(time) },
        localization: {
          locale: 'zh-CN',
          dateFormat: 'yyyy-MM-dd',
          timeFormatter: time => this._formatCrosshairTime(time)
        }
      });
    }
  },

  _formatAxisTime(time) {
    if (typeof TimeUtils === 'undefined') return String(time || '');
    if (time && typeof time === 'object' && time.year) {
      return `${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
    }
    return TimeUtils.formatAxisLabel(time, this._market, this._settings);
  },

  _formatCrosshairTime(time) {
    if (typeof TimeUtils === 'undefined') return String(time || '');
    if (time && typeof time === 'object' && time.year) {
      return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
    }
    return TimeUtils.formatCrosshairLabel(time, this._market, this._settings);
  },

  setCrosshairInfoElement(elementId) {
    if (!this.chart) return;
    const element = document.getElementById(elementId);
    if (!element) return;
    if (this._crosshairInfoElement && this._crosshairHandler) {
      try { this.chart.unsubscribeCrosshairMove(this._crosshairHandler); } catch (_) {}
    }
    this._crosshairInfoElement = element;
    this._crosshairHandler = param => {
      if (!param || !param.time || !param.seriesData) {
        element.textContent = '移动光标查看 OHLC';
        return;
      }
      const candle = this.candleSeries ? param.seriesData.get(this.candleSeries) : null;
      const volume = this.volumeSeries ? param.seriesData.get(this.volumeSeries) : null;
      const timeLabel = this._formatCrosshairTime(param.time);
      if (candle && candle.open !== undefined) {
        const volumeText = volume && volume.value !== undefined
          ? ` V:${this._formatChartNumber(volume.value)}` : '';
        element.textContent = `${timeLabel} O:${this._formatChartNumber(candle.open)} H:${this._formatChartNumber(candle.high)} L:${this._formatChartNumber(candle.low)} C:${this._formatChartNumber(candle.close)}${volumeText}`;
      } else {
        const line = this.lineSeries ? param.seriesData.get(this.lineSeries) : null;
        element.textContent = line && line.value !== undefined
          ? `${timeLabel} 价:${this._formatChartNumber(line.value)}` : timeLabel;
      }
    };
    this.chart.subscribeCrosshairMove(this._crosshairHandler);
  },

  setLegendElement(elementId) {
    this._legendElement = document.getElementById(elementId);
    if (!this._legendElement) return;
    this._renderLegend([]);
  },

  _renderLegend(items) {
    if (!this._legendElement) return;
    this._legendElement.replaceChildren();
    for (const item of items) {
      const span = document.createElement('span');
      span.className = 'chart-legend-item';
      const dot = document.createElement('i');
      dot.className = 'chart-legend-dot';
      dot.style.background = item.color;
      span.appendChild(dot);
      span.appendChild(document.createTextNode(item.label));
      this._legendElement.appendChild(span);
    }
  },

  _formatChartNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(3);
    return n.toFixed(6);
  },

  _restoreOrFit(preserveRange, previousRange) {
    if (preserveRange && previousRange) {
      try {
        this.chart.timeScale().setVisibleLogicalRange(previousRange);
        return;
      } catch (_) {}
    }
    this.chart.timeScale().fitContent();
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
   * @param {Object} [options] - { boll, macd, kdj }
   */
  renderKline(klineData, trades = [], options = {}) {
    if (!this.chart) return;

    const previousRange = this.chart.timeScale().getVisibleLogicalRange();
    this._clearSeries();
    this._indicators.boll = !!options.boll;
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
    this._renderKlineLegend();

    // Trade markers
    if (trades.length > 0) this._renderTradeMarkers(trades);

    this._restoreOrFit(!!options.preserveRange, previousRange);
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
      this._indicators.boll = !!this.bollSeries.upper;
    }
    this._applyLayout();
    this._renderKlineLegend();
  },

  _renderKlineLegend() {
    this._renderLegend([
      { label: 'MA5', color: this.MA_COLORS[5] },
      { label: 'MA10', color: this.MA_COLORS[10] },
      { label: 'MA20', color: this.MA_COLORS[20] },
      ...(this._indicators.boll ? [{ label: 'BOLL', color: '#4fc3f7' }] : []),
      ...(this._indicators.macd ? [{ label: 'MACD', color: '#f0b90b' }] : []),
      ...(this._indicators.kdj ? [{ label: 'KDJ', color: '#e040fb' }] : [])
    ]);
  },

  /**
   * 渲染分时图
   */
  renderRealtime(realtimeData, options = {}) {
    if (!this.chart) return;
    this.setTimeContext(options.market, options.settings);
    const previousRange = this.chart.timeScale().getVisibleLogicalRange();
    this._clearSeries();
    this._indicators.macd = false;
    this._indicators.kdj = false;

    const { prevClose, points } = realtimeData;
    if (!points || !points.length) return;

    // 时间格式转换：结合市场/用户时区解析无偏移的接口时间。
    const normalized = points.map(p => ({
      ...p,
      time: this._parseTimeToEpoch(p.time),
      price: Number(p.price) || 0,
      avgPrice: Number(p.avgPrice) || 0,
      volume: Number(p.volume) || 0
    })).filter(p => p.time > 0 && p.price > 0)
      .sort((a, b) => a.time - b.time)
      .filter((p, index, arr) => index === 0 || p.time !== arr[index - 1].time);
    if (!normalized.length) return;

    // 午休、跨交易日等长间隔拆成多个 series，避免画出误导性的斜线。
    const segments = [[]];
    for (const point of normalized) {
      const current = segments[segments.length - 1];
      if (current.length && point.time - current[current.length - 1].time > 20 * 60) {
        segments.push([]);
      }
      segments[segments.length - 1].push(point);
    }
    const priceOptions = {
      lineColor: '#4fc3f7',
      topColor: 'rgba(79,195,247,0.3)',
      bottomColor: 'rgba(79,195,247,0.02)',
      lineWidth: 1.5,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3
    };
    this.realtimeSeries = [];
    this.realtimeAvgSeries = [];
    if (this._crosshairInfoElement) this._crosshairInfoElement.textContent = '移动光标查看 OHLC';
    const hasAverage = normalized.some(p => p.avgPrice > 0);
    for (const segment of segments) {
      const priceSeries = this.chart.addAreaSeries(priceOptions);
      priceSeries.setData(segment.map(p => ({ time: p.time, value: p.price })));
      this.realtimeSeries.push(priceSeries);
      if (!this.lineSeries) this.lineSeries = priceSeries;
      if (hasAverage) {
        const avgSeries = this.chart.addLineSeries({
          color: '#f0b90b', lineWidth: 1,
          priceLineVisible: false, crosshairMarkerVisible: false,
          lastValueVisible: false, title: '均价'
        });
        avgSeries.setData(segment.filter(p => p.avgPrice > 0)
          .map(p => ({ time: p.time, value: p.avgPrice })));
        this.realtimeAvgSeries.push(avgSeries);
      }
    }

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
    const volData = normalized.map(p => {
      return {
        time: p.time,
        value: p.volume,
        color: p.price >= prevClose ? 'rgba(239,83,80,0.3)' : 'rgba(38,166,154,0.3)'
      };
    });
    this.volumeSeries.setData(volData);

    this._applyLayout();
    this._renderLegend([
      { label: '昨收', color: '#f0b90b' },
      ...(hasAverage ? [{ label: '分时均价', color: '#f0b90b' }] : [])
    ]);
    this._restoreOrFit(!!options.preserveRange, previousRange);
  },

  _clearSeries() {
    if (this.candleSeries) {
      this.chart.removeSeries(this.candleSeries);
      this.candleSeries = null;
    }
    const realtimeSeries = new Set([
      ...(this.realtimeSeries || []),
      ...(this.realtimeAvgSeries || []),
      this.lineSeries,
      this.avgLineSeries
    ].filter(Boolean));
    for (const series of realtimeSeries) {
      try { this.chart.removeSeries(series); } catch (_) {}
    }
    this.lineSeries = null;
    this.avgLineSeries = null;
    this.realtimeSeries = [];
    this.realtimeAvgSeries = [];
    this._renderLegend([]);
    for (const key of Object.keys(this.maSeries)) {
      this.chart.removeSeries(this.maSeries[key]);
    }
    this.maSeries = {};
    this._removeSeriesGroup('boll');
    this._removeSeriesGroup('macd');
    this._removeSeriesGroup('kdj');
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
    if (typeof TimeUtils !== 'undefined') {
      return TimeUtils.parseToEpochSeconds(timeStr, this._timeZone);
    }
    const d = new Date(String(timeStr || '').replace(/\//g, '-'));
    return Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : 0;
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

  // ===== 持仓收益对比（共同区间归一化） =====
  initOverlay(containerId, timeContext = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    this.setTimeContext(timeContext.market, timeContext.settings);
    if (this.overlayChart) {
      try { this.overlayChart.remove(); } catch {}
    }
    if (this._overlayResizeObserver) this._overlayResizeObserver.disconnect();
    container.innerHTML = '';
    const rect = container.getBoundingClientRect();
    const w = rect.width || 500;
    const h = rect.height || 320;
    this.overlayChart = LightweightCharts.createChart(container, {
      width: w, height: h,
      layout: { background: { color: 'transparent' }, textColor: '#8892a4', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(42,58,85,0.5)' }, horzLines: { color: 'rgba(42,58,85,0.5)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: '#2a3a55',
        scaleMargins: { top: 0.08, bottom: 0.12 }
      },
      timeScale: {
        borderColor: '#2a3a55', timeVisible: true, secondsVisible: false, rightOffset: 5,
        tickMarkFormatter: time => this._formatAxisTime(time)
      },
      localization: {
        locale: 'zh-CN', dateFormat: 'yyyy-MM-dd',
        timeFormatter: time => this._formatCrosshairTime(time)
      }
    });
    this.overlaySeries = {};
    this._overlayResizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (this.overlayChart) {
          this.overlayChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      }
    });
    this._overlayResizeObserver.observe(container);
  },

  clearOverlay() {
    this._overlaySeriesMeta = {};
    this._overlayHighlightKey = null;
    if (!this.overlayChart) return;
    for (const key of Object.keys(this.overlaySeries)) {
      try { this.overlayChart.removeSeries(this.overlaySeries[key]); } catch {}
    }
    this.overlaySeries = {};
  },

  _overlayTimeKey(time) {
    if (time && typeof time === 'object' && time.year) {
      return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
    }
    if (typeof time === 'string') return time.replace(/\//g, '-');
    return time;
  },

  _compareOverlayTime(left, right) {
    const a = this._overlayTimeKey(left);
    const b = this._overlayTimeKey(right);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a || '').localeCompare(String(b || ''));
  },

  _normalizeOverlayKline(klineData) {
    const points = (Array.isArray(klineData) ? klineData : [])
      .map(point => ({ time: point && point.time, close: Number(point && point.close) }))
      .filter(point => point.time !== undefined && point.time !== null && Number.isFinite(point.close) && point.close > 0)
      .sort((a, b) => this._compareOverlayTime(a.time, b.time));
    return points.filter((point, index, all) => {
      return index === 0 || this._compareOverlayTime(point.time, all[index - 1].time) !== 0;
    });
  },

  _overlayDateKey(time, market, settings) {
    const normalized = this._overlayTimeKey(time);
    if (typeof normalized === 'string') {
      const text = normalized.trim();
      if (typeof TimeUtils !== 'undefined') {
        const date = TimeUtils.normalizeDate(text);
        if (date) return date;
      }
      const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
      if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
      const separated = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (separated) return `${separated[1]}-${String(separated[2]).padStart(2, '0')}-${String(separated[3]).padStart(2, '0')}`;
      return text.slice(0, 10);
    }
    if (typeof TimeUtils !== 'undefined' && Number.isFinite(Number(normalized))) {
      const zone = TimeUtils.resolveTimeZone(market || this._market, settings || this._settings);
      return TimeUtils.formatDate(normalized, zone);
    }
    return String(normalized || '').slice(0, 10);
  },

  _normalizeOverlayTrade(trade, market, settings) {
    const date = this._overlayDateKey(trade && trade.date, market, settings);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const quantity = Number(trade && trade.quantity) || 0;
    const price = Number(trade && trade.price) || 0;
    if (!(quantity > 0) || !(price > 0)) return null;
    return {
      date,
      time: String(trade && trade.time || ''),
      timestamp: Number(trade && trade.timestamp) || 0,
      direction: trade && trade.direction === 'sell' ? 'sell' : 'buy',
      quantity,
      buyCost: price * quantity + (Number(trade && trade.commission) || 0),
      sellRevenue: price * quantity - (Number(trade && trade.commission) || 0) - (Number(trade && trade.stampTax) || 0)
    };
  },

  _preparePriceOverlayData(items) {
    const prepared = (Array.isArray(items) ? items : [])
      .map(item => ({ ...item, points: this._normalizeOverlayKline(item.klineData) }))
      .filter(item => item.points.length >= 2);
    if (!prepared.length) return { lines: [], startTime: null, endTime: null };

    const commonStart = prepared.reduce((latest, item) => {
      const first = item.points[0].time;
      return !latest || this._compareOverlayTime(first, latest) > 0 ? first : latest;
    }, null);
    const commonEnd = prepared.reduce((earliest, item) => {
      const last = item.points[item.points.length - 1].time;
      return !earliest || this._compareOverlayTime(last, earliest) < 0 ? last : earliest;
    }, null);

    let lines = prepared.map(item => {
      const points = item.points.filter(point =>
        this._compareOverlayTime(point.time, commonStart) >= 0 &&
        this._compareOverlayTime(point.time, commonEnd) <= 0
      );
      if (points.length < 2) return null;
      const basePrice = points[0].close;
      if (!(basePrice > 0)) return null;
      const normalized = points.map(point => ({
        time: point.time,
        value: ((point.close / basePrice) - 1) * 100
      }));
      return {
        key: item.key || item.fullCode,
        label: item.label || item.name || item.fullCode,
        code: item.code || '',
        color: item.color || '#4fc3f7',
        points: normalized,
        returnPct: normalized[normalized.length - 1].value,
        metric: 'price'
      };
    }).filter(Boolean);

    // 停牌、跨市场或异常历史区间可能导致没有两个共同交易日。
    // 此时按每个标的自己的可用区间归一化，至少保留可读的价格表现。
    let comparisonScope = 'common';
    let resultStart = commonStart;
    let resultEnd = commonEnd;
    if (!lines.length) {
      comparisonScope = 'individual';
      resultStart = null;
      resultEnd = null;
      lines = prepared.map(item => {
        const basePrice = item.points[0].close;
        if (!(basePrice > 0) || item.points.length < 2) return null;
        const normalized = item.points.map(point => ({
          time: point.time,
          value: ((point.close / basePrice) - 1) * 100
        }));
        const firstTime = normalized[0].time;
        const lastTime = normalized[normalized.length - 1].time;
        if (!resultStart || this._compareOverlayTime(firstTime, resultStart) < 0) resultStart = firstTime;
        if (!resultEnd || this._compareOverlayTime(lastTime, resultEnd) > 0) resultEnd = lastTime;
        return {
          key: item.key || item.fullCode,
          label: item.label || item.name || item.fullCode,
          code: item.code || '',
          color: item.color || '#4fc3f7',
          points: normalized,
          returnPct: normalized[normalized.length - 1].value,
          metric: 'price'
        };
      }).filter(Boolean);
    }

    return { lines, startTime: resultStart, endTime: resultEnd, comparisonScope };
  },

  /**
   * Rebuild each position's daily return from its own transaction ledger.
   * Return = (market value + net sale proceeds - gross buy cost) / gross buy cost.
   * This is a cumulative return on the money spent buying the position; it is
   * intentionally different from a pure price-performance line.
   */
  _prepareHoldingOverlayData(items, settings = {}) {
    const lines = [];
    let startTime = null;
    let endTime = null;
    for (const item of Array.isArray(items) ? items : []) {
      const bars = this._normalizeOverlayKline(item.klineData);
      const trades = (Array.isArray(item.trades) ? item.trades : [])
        .map(trade => this._normalizeOverlayTrade(trade, item.market, settings))
        .filter(Boolean)
        .sort((a, b) => {
          const dateCmp = a.date.localeCompare(b.date);
          if (dateCmp) return dateCmp;
          const timeCmp = a.time.localeCompare(b.time);
          return timeCmp || a.timestamp - b.timestamp;
        });
      if (!bars.length || !trades.length) continue;

      // Use the latest quote for the last bar when it is available, so the
      // legend reflects the current position rather than yesterday's close.
      const points = bars.map(point => ({ ...point }));
      if (Number(item.latestPrice) > 0 && points.length) {
        const latestTime = item.latestTime || points[points.length - 1].time;
        const lastPoint = points[points.length - 1];
        const timeCmp = this._compareOverlayTime(latestTime, lastPoint.time);
        if (timeCmp > 0) points.push({ time: latestTime, close: Number(item.latestPrice) });
        else if (timeCmp === 0) lastPoint.close = Number(item.latestPrice);
      }

      let tradeIndex = 0;
      let buyQty = 0;
      let sellQty = 0;
      let buyCost = 0;
      let sellRevenue = 0;
      const returnPoints = [];
      let lastPnl = 0;
      let lastReturnPct = 0;
      let previousPoint = null;
      for (const point of points) {
        const date = this._overlayDateKey(point.time, item.market, settings);
        const hadInvestment = buyCost > 0;
        while (tradeIndex < trades.length && trades[tradeIndex].date <= date) {
          const trade = trades[tradeIndex++];
          if (trade.direction === 'buy') {
            buyQty += trade.quantity;
            buyCost += trade.buyCost;
          } else {
            sellQty += trade.quantity;
            sellRevenue += trade.sellRevenue;
          }
        }
        // 新建仓时，买入前一根 K 线作为 0% 起点，避免只有当天一根有效点而被丢弃。
        if (!hadInvestment && buyCost > 0 && previousPoint && returnPoints.length === 0) {
          returnPoints.push({ time: previousPoint.time, value: 0 });
        }
        previousPoint = point;
        if (!(buyCost > 0)) continue;
        const holdingQty = buyQty - sellQty;
        const equity = holdingQty * point.close + sellRevenue;
        const pnl = equity - buyCost;
        const returnPct = pnl / buyCost * 100;
        returnPoints.push({ time: point.time, value: returnPct });
        lastPnl = pnl;
        lastReturnPct = returnPct;
      }
      if (!returnPoints.length) continue;
      const line = {
        key: item.key || item.fullCode,
        label: item.label || item.name || item.fullCode,
        code: item.code || '',
        color: item.color || '#4fc3f7',
        points: returnPoints,
        returnPct: lastReturnPct,
        pnl: lastPnl,
        currency: item.currency || '',
        metric: 'holding'
      };
      lines.push(line);
      const firstTime = returnPoints[0].time;
      const lastTime = returnPoints[returnPoints.length - 1].time;
      if (!startTime || this._compareOverlayTime(firstTime, startTime) < 0) startTime = firstTime;
      if (!endTime || this._compareOverlayTime(lastTime, endTime) > 0) endTime = lastTime;
    }
    return { lines, startTime, endTime };
  },

  /** Prepare the selected overlay metric. */
  _prepareOverlayData(items, options = {}) {
    return options.mode === 'holding'
      ? this._prepareHoldingOverlayData(items, options.settings || this._settings)
      : this._preparePriceOverlayData(items);
  },

  renderOverlayLines(items, options = {}) {
    if (!this.overlayChart) return { lines: [], startTime: null, endTime: null };
    const prepared = this._prepareOverlayData(items, options);
    this.clearOverlay();
    if (!prepared.lines.length) return prepared;

    for (const line of prepared.lines) {
      const series = this.overlayChart.addLineSeries({
        color: line.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        // 名称和收益率放到图表下方的可滚动列表，避免右侧标签互相覆盖。
        title: '',
        priceFormat: {
          type: 'custom',
          minMove: 0.01,
          formatter: value => `${Number(value).toFixed(2)}%`
        }
      });
      series.setData(line.points);
      this.overlaySeries[line.key] = series;
      this._overlaySeriesMeta[line.key] = {
        series,
        color: line.color,
        visible: true
      };
    }
    this.overlaySeries.__baseline = this.overlayChart.addLineSeries({
      color: 'rgba(136,146,164,0.65)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      title: '',
      priceFormat: {
        type: 'custom',
        minMove: 0.01,
        formatter: value => `${Number(value).toFixed(2)}%`
      }
    });
    const baselineStart = prepared.startTime || prepared.lines[0].points[0].time;
    const baselineEnd = prepared.endTime || prepared.lines[0].points[prepared.lines[0].points.length - 1].time;
    const baselineData = this._compareOverlayTime(baselineStart, baselineEnd) === 0
      ? [{ time: baselineStart, value: 0 }]
      : [{ time: baselineStart, value: 0 }, { time: baselineEnd, value: 0 }];
    this.overlaySeries.__baseline.setData(baselineData);
    this.overlayChart.timeScale().fitContent();
    return prepared;
  },

  _mutedOverlayColor(color) {
    const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
    if (!match) return color;
    const value = match[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.22)`;
  },

  _applyOverlayStyles() {
    for (const [key, meta] of Object.entries(this._overlaySeriesMeta)) {
      const highlighted = !this._overlayHighlightKey || key === this._overlayHighlightKey;
      meta.series.applyOptions({
        color: this._overlayHighlightKey && !highlighted
          ? this._mutedOverlayColor(meta.color) : meta.color,
        lineWidth: this._overlayHighlightKey && highlighted ? 3 : 2,
        visible: meta.visible
      });
    }
  },

  toggleOverlayHighlight(key) {
    if (!this._overlaySeriesMeta[key]) return null;
    this._overlayHighlightKey = this._overlayHighlightKey === key ? null : key;
    this._applyOverlayStyles();
    return this._overlayHighlightKey;
  },

  clearOverlayHighlight() {
    this._overlayHighlightKey = null;
    this._applyOverlayStyles();
  },

  toggleOverlayLineVisibility(key) {
    const meta = this._overlaySeriesMeta[key];
    if (!meta) return false;
    meta.visible = !meta.visible;
    this._applyOverlayStyles();
    return meta.visible;
  },

  getOverlayViewState() {
    const visible = {};
    for (const [key, meta] of Object.entries(this._overlaySeriesMeta)) {
      visible[key] = meta.visible;
    }
    return { highlightKey: this._overlayHighlightKey, visible };
  }
};
