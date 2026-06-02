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
    const val = localStorage.getItem('sp_' + key);
    return val !== null ? JSON.parse(val) : defaultVal;
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

  async exportAll() {
    const data = await this.getAll();
    const userSkills = await this.get('userSkills', []);
    return JSON.stringify({ ...data, userSkills }, null, 2);
  },

  async importAll(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (data.watchlist) await this.set('watchlist', data.watchlist);
    if (data.portfolio) await this.set('portfolio', data.portfolio);
    if (data.settings) await this.set('settings', data.settings);
    if (data.currentStock) await this.set('currentStock', data.currentStock);
    if (data.userSkills) await this.set('userSkills', data.userSkills);
    if (data.stockGroups) await this.set('stockGroups', data.stockGroups);
  }
};
