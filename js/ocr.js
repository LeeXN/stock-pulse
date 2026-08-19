/**
 * ocr.js - OCR 图片识别 + 批量文本解析
 *
 * 仅支持一个引擎：大模型视觉（LLM Vision）
 *   - 调用 LLM.ocr()，由 LLM 模块走 background 中转
 *   - 从返回文本里用 extractStockCodes 抽取代码
 *
 * 启用条件（isEnabled）：
 *   1. settings.llmApiKey 非空
 *   2. settings.llmVisionModel 非空（为空时 fallback 到 settings.llmModel）
 *   3. settings.llmBaseUrl 非空
 *   以上任意一个不满足 → 引擎不可用，UI 会禁用 OCR 入口
 *
 * 纯文本解析（extractStockCodes / parseBatchCodes / parseBatchPortfolio）
 * 与引擎无关，所有识别路径共享。
 */
const OCR = {
  _settings: null,

  // ===== Public API =====

  init(settings) {
    this._settings = settings || {};
  },

  /**
   * 当前 LLM 配置是否支持视觉识别
   * 页面导入处的 OCR 按钮会根据此开关启用/禁用
   */
  isEnabled() {
    const s = this._settings || {};
    // 纯文本模型不能接收图片，不能再把 llmModel 当作视觉模型使用。
    return !!(s.llmApiKey && s.llmVisionModel && s.llmBaseUrl);
  },

  /**
   * 引擎不可用时给用户看的具体原因（用于 UI 提示）
   */
  getUnavailabilityReason() {
    const s = this._settings || {};
    if (!s.llmApiKey) return '未配置 LLM API Key';
    if (!s.llmBaseUrl) return '未配置 LLM Base URL';
    if (!s.llmVisionModel) return '未配置视觉模型（当前模型可能不支持图片）';
    return 'OCR 引擎不可用';
  },

  /**
   * 主入口：识别图片
   * @param {File|Blob|HTMLCanvasElement|string} image
   * @param {Function} onProgress - (0..1, statusText) => void
   * @param {string} [target] - 'watchlist' 或 'portfolio'，影响 LLM 识别策略
   * @returns {Promise<{text, codes, confidence, preview, provider, raw}>}
   */
  async recognizeImage(image, onProgress, target) {
    if (!this.isEnabled()) {
      throw new Error(this.getUnavailabilityReason() + '（请在设置 → AI / 大模型 中配置）');
    }
    if (onProgress) onProgress(0.10, '读取图片');
    const dataUrl = await this._toImageDataURL(image);
    if (!dataUrl) throw new Error('图片格式不支持');

    if (onProgress) onProgress(0.40, '调用大模型视觉');
    const res = await LLM.ocr(dataUrl, target);
    if (onProgress) onProgress(0.85, '解析结果');

    const text = (res.text || '').trim();
    const codes = this.extractStockCodes(text);
    if (onProgress) onProgress(1, '完成');
    return {
      text,
      codes,
      // OpenAI 兼容接口通常不会返回可验证的 OCR 置信度，避免伪造固定 90%。
      confidence: null,
      preview: dataUrl,
      provider: 'llm',
      raw: res.content
    };
  },

  warmup() {
    return this.isEnabled();
  },

  async destroy() {
    // LLM 路径无本地资源需要释放
  },

  // ===== 图片 → DataURL =====

  async _toImageDataURL(image) {
    if (image instanceof HTMLCanvasElement) {
      return image.toDataURL('image/jpeg', 0.92);
    }
    if (image instanceof Blob || image instanceof File) {
      return this._blobToDataURL(image);
    }
    if (typeof image === 'string') {
      return image;
    }
    return null;
  },

  _blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(blob);
    });
  },

  // ===== 文本解析（引擎无关，所有路径共享）=====

  extractStockCodes(text) {
    const codes = new Set();
    if (!text) return [];
    let m;
    // 先匹配带前缀/后缀的（最明确）
    const prefix = /(?:SH|SZ|sh|sz)[.\s]?(\d{6})/g;
    while ((m = prefix.exec(text)) !== null) codes.add(m[1]);
    const hkSuffix = /(\d{4,5})\.HK/gi;
    while ((m = hkSuffix.exec(text)) !== null) codes.add(m[1].padStart(5, '0'));
    // A 股 6 位代码（0/3/6 开头）
    const aShare = /\b([036]\d{5})\b/g;
    while ((m = aShare.exec(text)) !== null) codes.add(m[1]);
    // 港股 5 位代码 — 排除已被 A 股匹配的子串
    const aShareCodes = new Set(codes);
    const hk = /\b(0\d{4})\b/g;
    while ((m = hk.exec(text)) !== null) {
      const hkCode = m[1];
      // 检查此 5 位子串是否是某个已匹配 A 股代码的子串
      const isSubstrOfAShare = [...aShareCodes].some(a => a.length === 6 && a.endsWith(hkCode));
      if (!isSubstrOfAShare) codes.add(hkCode);
    }
    const namePlusCode = /[\u4e00-\u9fa5]{2,}\s*([036]\d{5})|([036]\d{5})\s*[\u4e00-\u9fa5]{2,}/g;
    while ((m = namePlusCode.exec(text)) !== null) codes.add(m[1] || m[2]);
    return Array.from(codes).filter(c => c !== '000000' && c !== '999999');
  },

  parseBatchCodes(text) {
    if (!text) return [];
    const lines = text.split(/[\n,;，；\s]+/).map(s => s.trim()).filter(Boolean);
    const results = [];
    for (let line of lines) {
      let code = line;
      let market = null;
      const prefixMatch = code.match(/^(SH|SZ|HK|sh|sz|hk)[.\s]?(\d+)/);
      if (prefixMatch) { market = prefixMatch[1].toUpperCase(); code = prefixMatch[2]; }
      const suffixMatch = code.match(/^(\d+)\.(HK|SH|SZ)$/i);
      if (suffixMatch) { code = suffixMatch[1]; market = suffixMatch[2].toUpperCase(); }
      code = code.replace(/[^\d]/g, '');
      if (!code || code.length < 4) continue;
      if (!market) {
        if (code.length <= 5) { code = code.padStart(5, '0'); market = 'HK'; }
        else if (code.length === 6) { market = (code.startsWith('6') || code.startsWith('9')) ? 'SH' : 'SZ'; }
      }
      const fullCode = `${market}:${code}`;
      if (market && code && !results.find(r => r.fullCode === fullCode)) {
        results.push({ code, market, fullCode });
      }
    }
    return results;
  },

  parseBatchPortfolio(text) {
    if (!text) return [];
    const splitRecords = value => {
      const source = String(value);
      const records = [];
      let record = '';
      let quoted = false;
      for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') {
          if (quoted && source[i + 1] === '"') { record += '""'; i++; }
          else { quoted = !quoted; record += ch; }
        } else if ((ch === '\n' || ch === '\r') && !quoted) {
          if (ch === '\r' && source[i + 1] === '\n') i++;
          if (record.trim()) records.push(record.trim());
          record = '';
        } else {
          record += ch;
        }
      }
      if (record.trim()) records.push(record.trim());
      return records;
    };
    const lines = splitRecords(String(text));
    if (!lines.length) return [];

    const normalizeHeader = value => String(value || '')
      .toLowerCase().replace(/[\s_()（）【】\[\]]/g, '');
    const headerAliases = {
      date: ['日期', '成交日期', '交易日期', 'date', 'tradedate'],
      time: ['时间', '成交时间', '交易时间', 'time', 'tradetime'],
      code: ['代码', '证券代码', '股票代码', '标的代码', 'code', 'symbol', 'ticker'],
      direction: ['方向', '买卖', '买卖方向', '交易方向', '操作', 'direction', 'side', 'type'],
      price: ['价格', '成交价', '成交价格', '买入价', '卖出价', 'price', '成交均价'],
      quantity: ['数量', '成交数量', '委托数量', '股数', 'quantity', 'qty', 'volume'],
      commission: ['手续费', '佣金', 'commission', 'fee'],
      stampTax: ['印花税', 'stamp', 'stamptax', 'tax'],
      note: ['备注', '说明', 'note', 'remark']
    };
    const findHeaderKey = value => {
      const h = normalizeHeader(value);
      for (const [key, aliases] of Object.entries(headerAliases)) {
        if (aliases.some(alias => normalizeHeader(alias) === h)) return key;
      }
      return null;
    };
    const detectDelimiter = line => line.includes('\t') ? '\t' : (line.includes(',') ? ',' : (line.includes('，') ? '，' : null));
    const splitDelimitedLine = (line, delimiter) => {
      if (!delimiter) return line.split(/\s+/).map(s => s.trim());
      const cells = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
          else quoted = !quoted;
        } else if (ch === delimiter && !quoted) {
          cells.push(cell.trim());
          cell = '';
        } else {
          cell += ch;
        }
      }
      cells.push(cell.trim());
      return cells;
    };
    const delimiter = detectDelimiter(lines[0]);
    const firstCells = splitDelimitedLine(lines[0], delimiter);
    const headerMap = {};
    firstCells.forEach((cell, index) => {
      const key = findHeaderKey(cell);
      if (key) headerMap[key] = index;
    });
    const hasHeader = headerMap.code !== undefined;
    const start = hasHeader ? 1 : 0;
    const results = [];
    const parseNumber = value => {
      const cleaned = String(value ?? '').replace(/[￥¥,，\s]/g, '');
      if (!cleaned || cleaned === '-') return 0;
      const n = Number(cleaned.replace(/[^\d.+-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const parseDirection = value => /卖|sell|sale|short|^s$|平仓/i.test(String(value || '')) ? 'sell' : 'buy';
    const parseDate = value => {
      const normalized = typeof TimeUtils !== 'undefined'
        ? TimeUtils.normalizeDate(value)
        : String(value || '').replace(/\//g, '-');
      return normalized;
    };
    const isDateToken = value => {
      const text = String(value || '').trim();
      return /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(text) || /^\d{8}$/.test(text);
    };

    for (let lineIndex = start; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const parts = splitDelimitedLine(line, delimiter);
      if (!parts.length) continue;

      const get = key => hasHeader ? parts[headerMap[key]] : undefined;
      let codeValue = get('code');
      const codeIndex = hasHeader ? headerMap.code : parts.findIndex(part => this.parseBatchCodes(part).length > 0);
      if (codeIndex < 0 || !codeValue) codeValue = parts[codeIndex];
      const parsed = this.parseBatchCodes(codeValue);
      if (!parsed.length) continue;

      const directionRaw = hasHeader ? get('direction') : parts.find(p => /^(买|卖|buy|sell|b|s|买入|卖出)/i.test(p));
      const direction = parseDirection(directionRaw);
      const priceRaw = hasHeader ? get('price') : (() => {
        const startIndex = codeIndex + (directionRaw ? 2 : 1);
        return parts.slice(startIndex).find(p => /^[-+]?\d[\d,.]*(?:\.\d+)?$/.test(p)) || '';
      })();
      const priceIndex = parts.indexOf(priceRaw, codeIndex + 1);
      const quantityRaw = hasHeader ? get('quantity') : parts[priceIndex >= 0 ? priceIndex + 1 : codeIndex + 2];
      const dateIndex = parts.findIndex(isDateToken);
      const dateRaw = hasHeader ? get('date') : (dateIndex >= 0 ? parts[dateIndex] : '');
      const timeIndex = parts.findIndex(p => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(p));
      const timeRaw = hasHeader ? get('time') : (timeIndex >= 0 ? parts[timeIndex] : '');
      const tailIndex = timeIndex >= 0 ? timeIndex + 1 : (dateIndex >= 0 ? dateIndex + 1 : priceIndex + 2);
      const commissionRaw = hasHeader ? get('commission') : parts[tailIndex];
      const stampTaxRaw = hasHeader ? get('stampTax') : parts[tailIndex + 1];
      const noteRaw = hasHeader ? get('note') : parts.slice(tailIndex + 2).join(' ');

      results.push({
        ...parsed[0],
        direction,
        price: parseNumber(priceRaw),
        quantity: parseNumber(quantityRaw),
        date: parseDate(dateRaw),
        time: String(timeRaw || '').trim(),
        commission: parseNumber(commissionRaw),
        stampTax: parseNumber(stampTaxRaw),
        note: String(noteRaw || '').trim(),
        sourceLine: lineIndex + 1,
        raw: line
      });
    }
    return results;
  }
};
