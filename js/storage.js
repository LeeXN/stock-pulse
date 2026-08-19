/**
 * storage.js - Chrome storage wrapper with localStorage fallback
 */
const DB = {
  _useChrome: typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local,

  async get(key, defaultVal) {
    if (this._useChrome) {
      return new Promise(resolve => {
        chrome.storage.local.get(key, result => {
          resolve(result[key] !== undefined ? result[key] : defaultVal);
        });
      });
    }
    const raw = localStorage.getItem('sp_' + key);
    if (raw === null) return defaultVal;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[DB] parse failed for', key, e);
      return defaultVal;
    }
  },

  async set(key, value) {
    if (this._useChrome) {
      return new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
    localStorage.setItem('sp_' + key, JSON.stringify(value));
  },

  async getAll() {
    const watchlist = await this.get('watchlist', []);
    const portfolio = await this.get('portfolio', []);
    const settings = await this.get('settings', {
      refreshInterval: 10,
      theme: 'dark',
      klineCount: 120,
      timezoneMode: 'exchange',
      timezone: 'Asia/Shanghai',
      quoteProvider: 'tencent',
      klineProvider: 'eastmoney',
      intlQuoteProvider: '',
      intlKlineProvider: '',
      tushareToken: '',
      juheKey: '',
      llmProvider: 'openai',
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: '',
      llmModel: 'gpt-4o-mini',
      llmVisionModel: 'gpt-4o-mini',
      llmMaxTokens: 4096,
      corsProxy: '',
      accentColor: '#4fc3f7',
      portfolioBaseCurrency: 'CNY',
      marketIndices: MarketAPI ? MarketAPI.DEFAULT_SELECTED : ['1.000001','0.399001','0.399006','100.HSI']
    });
    // 清理掉废弃字段（ocrProvider / baiduApiKey / baiduSecretKey）
    if (settings.ocrProvider) delete settings.ocrProvider;
    if (settings.baiduApiKey) delete settings.baiduApiKey;
    if (settings.baiduSecretKey) delete settings.baiduSecretKey;
    const currentStock = await this.get('currentStock', null);
    const stockGroups = await this.get('stockGroups', []);
    return { watchlist, portfolio, settings, currentStock, stockGroups };
  },

  async exportAll(options = {}) {
    const data = await this.getAll();
    const userSkills = await this.get('userSkills', []);
    const settings = { ...(data.settings || {}) };
    const sensitiveKeys = ['llmApiKey', 'tushareToken', 'juheKey', 'baiduApiKey', 'baiduSecretKey'];
    if (!options.includeSecrets) {
      for (const key of sensitiveKeys) delete settings[key];
    }
    return JSON.stringify({ ...data, settings, userSkills }, null, 2);
  },

  async importAll(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份文件格式无效');
    if (Object.prototype.hasOwnProperty.call(data, 'watchlist')) {
      if (!Array.isArray(data.watchlist)) throw new Error('watchlist 必须是数组');
      await this.set('watchlist', data.watchlist);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'portfolio')) {
      if (!Array.isArray(data.portfolio)) throw new Error('portfolio 必须是数组');
      await this.set('portfolio', data.portfolio);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'settings')) {
      if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
        throw new Error('settings 格式无效');
      }
      // 不含密钥的安全备份不会抹掉本机已有密钥；完整备份中的密钥仍会按文件恢复。
      const currentSettings = await this.get('settings', {});
      await this.set('settings', { ...currentSettings, ...data.settings });
    }
    if (Object.prototype.hasOwnProperty.call(data, 'currentStock')) await this.set('currentStock', data.currentStock || null);
    if (Object.prototype.hasOwnProperty.call(data, 'userSkills')) {
      if (!Array.isArray(data.userSkills)) throw new Error('userSkills 必须是数组');
      await this.set('userSkills', data.userSkills);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'stockGroups')) {
      if (!Array.isArray(data.stockGroups)) throw new Error('stockGroups 必须是数组');
      await this.set('stockGroups', data.stockGroups);
    }
  },

  async clearAll() {
    if (this._useChrome) {
      return new Promise(resolve => chrome.storage.local.clear(resolve));
    }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sp_')) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
  },
};
