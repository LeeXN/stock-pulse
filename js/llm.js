/**
 * llm.js - 大模型调用层（OpenAI 兼容协议）
 *
 * 支持的预设（baseUrl + model 组合）：
 *   openai      OpenAI
 *   deepseek    DeepSeek
 *   qwen        通义千问 (DashScope OpenAI 兼容模式)
 *   moonshot    月之暗面 Kimi
 *   openrouter  OpenRouter（聚合多家）
 *   gemini      Gemini (OpenAI 兼容端点)
 *
 * 也支持 custom：用户自己填 baseUrl + model
 *
 * 公开 API:
 *   LLM.init(settings)              - 注入设置
 *   LLM.chat({ system, user, images, model?, temperature?, maxTokens? })
 *                                    - 通用对话（images 是 base64 dataURL 数组）
 *   LLM.ocr(image)                  - 用视觉模型识别股票代码
 *   LLM.listPresets()               - 预设列表（UI 用）
 *   LLM.getCurrentPreset()          - 当前预设
 */
const LLM = {
  _settings: {
    llmProvider: 'openai',
    llmBaseUrl: 'https://api.openai.com/v1',
    llmApiKey: '',
    llmModel: 'gpt-4o-mini',
    llmVisionModel: 'gpt-4o-mini'
  },

  _PRESETS: [
    { id: 'openai',     label: 'OpenAI',           baseUrl: 'https://api.openai.com/v1',                                          model: 'gpt-4o-mini',         visionModel: 'gpt-4o-mini',         placeholder: 'sk-...' },
    { id: 'deepseek',   label: 'DeepSeek',         baseUrl: 'https://api.deepseek.com/v1',                                        model: 'deepseek-chat',       visionModel: '',                    placeholder: 'sk-...' },
    { id: 'qwen',       label: '通义千问 (Qwen)',   baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',                model: 'qwen-plus',           visionModel: 'qwen-vl-plus',        placeholder: 'sk-...' },
    { id: 'moonshot',   label: '月之暗面 (Kimi)',   baseUrl: 'https://api.moonshot.cn/v1',                                         model: 'moonshot-v1-8k',      visionModel: 'moonshot-v1-8k-vision', placeholder: 'sk-...' },
    { id: 'openrouter', label: 'OpenRouter',       baseUrl: 'https://openrouter.ai/api/v1',                                       model: 'openai/gpt-4o-mini',  visionModel: 'openai/gpt-4o-mini', placeholder: 'sk-or-...' },
    { id: 'gemini',     label: 'Gemini (兼容)',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',          model: 'gemini-2.0-flash',    visionModel: 'gemini-2.0-flash',   placeholder: 'AIza...' },
    { id: 'custom',     label: '自定义 (OpenAI 兼容)', baseUrl: '',                                                                  model: '',                    visionModel: '',                    placeholder: 'API Key' }
  ],

  init(settings) {
    this._settings = Object.assign({}, this._settings, settings || {});
  },

  listPresets() { return this._PRESETS.slice(); },

  getPreset(id) { return this._PRESETS.find(p => p.id === id); },

  getCurrentPreset() {
    return this.getPreset(this._settings.llmProvider) || this._PRESETS[0];
  },

  /**
   * 通用对话 / 视觉问答
   * @param {Object} opts
   *   - system   string
   *   - user     string
   *   - images   string[]   base64 dataURL 数组（可选）
   *   - model    string     默认用 settings.llmModel，有图则用 llmVisionModel
   *   - temperature number
   *   - maxTokens number
   * @returns Promise<{content: string}>
   */
  async chat(opts) {
    const { system, user, images, model, temperature, maxTokens } = opts || {};
    const hasImages = images && images.length;
    const useModel = model ||
      (hasImages
        ? (this._settings.llmVisionModel || this._settings.llmModel)  // 视觉模型为空时 fallback 到对话模型
        : this._settings.llmModel);
    if (!useModel) throw new Error('未配置模型名' + (hasImages ? '（视觉模型）' : ''));

    let userContent;
    if (hasImages) {
      userContent = [{ type: 'text', text: user || '' }];
      for (const img of images) {
        userContent.push({ type: 'image_url', image_url: { url: img } });
      }
    } else {
      userContent = user || '';
    }

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: userContent });

    const result = await chrome.runtime.sendMessage({
      type: 'sp:llm-chat',
      payload: {
        baseUrl: this._settings.llmBaseUrl,
        apiKey: this._settings.llmApiKey,
        model: useModel,
        messages,
        temperature,
        maxTokens: maxTokens || this._settings.llmMaxTokens || 4096,
        corsProxy: this._settings.corsProxy || ''
      }
    });
    if (result && result.error) throw new Error(result.error);
    return result;
  },

  /**
   * 用视觉模型识别股票代码（OCR-via-LLM 入口）
   * @param {string} imageDataUrl
   * @param {string} [target] - 'watchlist'（只抽代码）或 'portfolio'（抽代码+买入价+数量）
   */
  async ocr(imageDataUrl, target) {
    if (!this._settings.llmApiKey) throw new Error('请先在设置中配置 LLM API Key');
    if (!this._settings.llmVisionModel && !this._settings.llmModel) {
      throw new Error('当前 LLM 预设未配置对话模型 / 视觉模型');
    }

    const isPortfolio = target === 'portfolio';
    const system = isPortfolio
      ? '你是一名专门识别股票持仓截图的助手。用户会给你一张持仓/自选股截图，里面可能包含股票代码、名称、买入价（成本价）、持仓数量等信息。\n' +
        '你的任务：逐行输出每只股票的关键数据，格式为「代码 买入价 数量」，用空格分隔。\n' +
        '识别规则：\n' +
        '- A 股代码为 6 位数字（沪市 6 开头 / 深市 0 或 3 开头），港股代码为 5 位数字\n' +
        '- 去掉 SH/SZ/HK 前缀和 .SH/.SZ/.HK 后缀，只保留数字\n' +
        '- 买入价：识别成本价/买入价/持仓均价等字段，保留原始精度（如 1580.00、12.35）\n' +
        '- 数量：识别持仓数量/持股数量/可用数量等字段，输出整数（如 100、500、2000）\n' +
        '- 如果某只股票看不清买入价或数量，仍然输出该行，对应位置填 0\n' +
        '- 如果完全无法识别某行，跳过\n' +
        '- 每行一只股票，不要输出其他任何内容（不要表头、不要标题、不要说明）\n' +
        '- 输出示例：\n' +
        '  600519 1580.00 100\n' +
        '  00700 320.50 500\n' +
        '  000858 128.50 0'
      : '你是一名专门识别股票代码的助手。用户会给你一张可能是股票列表、持仓截图、自选股截图的图片。\n' +
        '你的任务：输出图中所有可见的股票代码，每行一个，不要输出其他任何内容。\n' +
        '识别规则：\n' +
        '- A 股代码为 6 位数字（沪市 6 开头 / 深市 0 或 3 开头）\n' +
        '- 港股代码为 5 位数字\n' +
        '- 如果代码前有 SH/SZ/HK 前缀或 .SH/.SZ/.HK 后缀，去掉前缀后缀只保留数字\n' +
        '- 忽略股票名称、价格、涨跌幅等其他信息\n' +
        '- 如果图中有股票名称+代码同行（如「600519 贵州茅台」），只提取 600519\n' +
        '- 如果看不清或无法识别，跳过该行\n' +
        '- 输出时按股票代码升序排列，去重';

    const res = await this.chat({
      system,
      user: isPortfolio
        ? '请识别这张持仓截图中每只股票的代码、买入价和数量：'
        : '请识别这张图片中的股票代码：',
      images: [imageDataUrl],
      temperature: 0.1,
      maxTokens: isPortfolio ? 1500 : 500
    });
    const text = (res.content || '').trim();
    return { text, content: res.content };
  }
};
