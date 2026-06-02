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
    // 视觉模型为空时回退到对话模型
    const effectiveVisionModel = s.llmVisionModel || s.llmModel;
    return !!(s.llmApiKey && effectiveVisionModel && s.llmBaseUrl);
  },

  /**
   * 引擎不可用时给用户看的具体原因（用于 UI 提示）
   */
  getUnavailabilityReason() {
    const s = this._settings || {};
    if (!s.llmApiKey) return '未配置 LLM API Key';
    if (!s.llmBaseUrl) return '未配置 LLM Base URL';
    if (!s.llmVisionModel && !s.llmModel) return '未配置对话模型 / 视觉模型';
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
      confidence: 90,
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
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const line of lines) {
      if (/^[\u4e00-\u9fa5\s]{2,10}$/.test(line) && !/\d{4,}/.test(line)) continue;
      const parts = line.split(/[\s,\t]+/);
      if (parts.length < 1) continue;

      // 解析 code（第一列）
      const codeStr = parts[0];
      const parsed = this.parseBatchCodes(codeStr);
      if (!parsed.length) continue;

      // 降级：price / quantity 可能缺失或无效，允许留空（默认 0）
      const price = (parts.length >= 2) ? parseFloat(parts[1]) : 0;
      const quantity = (parts.length >= 3) ? parseInt(parts[2]) : 0;

      const dateRaw = parts[3];
      const date = dateRaw && /^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}/.test(dateRaw)
        ? dateRaw.replace(/\//g, '-')
        : new Date().toISOString().split('T')[0];
      const note = parts.slice(4).join(' ');
      results.push({ ...parsed[0], price: isNaN(price) ? 0 : price, quantity: isNaN(quantity) ? 0 : quantity, date, note, direction: 'buy' });
    }
    return results;
  }
};
