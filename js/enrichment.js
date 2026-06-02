/**
 * enrichment.js - 股票数据增强（基本面 + 公告 + 资金流向）
 *
 * 为 Skills 提供额外上下文数据：
 *   - 财务数据：营收/净利/ROE/毛利率/资产负债率 等（东财 F10）
 *   - 公司公告：最近 N 条公告标题
 *   - 资金流向：近 5 日主力/散户净流入
 *
 * 公开 API:
 *   Enrichment.fetchAll(fullCode)          → { financials, announcements, moneyFlow }
 *   Enrichment.fetchFinancials(fullCode)   → 可读文本（财报）
 *   Enrichment.fetchAnnouncements(fullCode)→ 可读文本（公告）
 *   Enrichment.fetchMoneyFlow(fullCode)    → 可读文本（资金流向）
 */
const Enrichment = {
  _cache: {},
  _CACHE_TTL: 5 * 60 * 1000, // 5 分钟

  /**
   * 获取全部增强数据
   */
  async fetchAll(fullCode) {
    const cacheKey = fullCode;
    const cached = this._cache[cacheKey];
    if (cached && Date.now() - cached.ts < this._CACHE_TTL) {
      return cached.data;
    }

    const [financials, announcements, moneyFlow] = await Promise.all([
      this.fetchFinancials(fullCode).catch(() => ''),
      this.fetchAnnouncements(fullCode).catch(() => ''),
      this.fetchMoneyFlow(fullCode).catch(() => '')
    ]);

    const data = { financials, announcements, moneyFlow };
    this._cache[cacheKey] = { data, ts: Date.now() };
    return data;
  },

  /**
   * 获取财务数据（最近几期财报：营收/净利/ROE/毛利率/资产负债率）
   * 数据来源：东方财富 F10 财务数据接口
   */
  async fetchFinancials(fullCode) {
    const [market, code] = fullCode.split(':');
    const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECURITY_CODE=%22${code}%22)&pageNumber=1&pageSize=4&sortTypes=-1&sortColumns=REPORT_DATE`;

    try {
      const res = await this._fetch(url);
      if (!res || !res.result || !res.result.data || !res.result.data.length) return '';

      const rows = res.result.data;
      const lines = ['【财务数据】'];

      for (const d of rows) {
        const report = d.REPORT_DATE_NAME || d.REPORT_DATE?.slice(0, 10) || '未知';
        const parts = [];

        // 营收
        if (d.TOTALOPERATEREVE) {
          const rev = d.TOTALOPERATEREVE >= 1e8 ? (d.TOTALOPERATEREVE / 1e8).toFixed(2) + '亿' : (d.TOTALOPERATEREVE / 1e4).toFixed(0) + '万';
          const yoy = d.TOTALOPERATEREVETZ ? ` 同比${d.TOTALOPERATEREVETZ > 0 ? '+' : ''}${d.TOTALOPERATEREVETZ.toFixed(2)}%` : '';
          parts.push(`营收 ${rev}${yoy}`);
        }
        // 归母净利
        if (d.PARENTNETPROFIT) {
          const np = d.PARENTNETPROFIT >= 1e8 ? (d.PARENTNETPROFIT / 1e8).toFixed(2) + '亿' : (d.PARENTNETPROFIT / 1e4).toFixed(0) + '万';
          const yoy = d.PARENTNETPROFITTZ ? ` 同比${d.PARENTNETPROFITTZ > 0 ? '+' : ''}${d.PARENTNETPROFITTZ.toFixed(2)}%` : '';
          parts.push(`归母净利 ${np}${yoy}`);
        }
        // EPS
        if (d.EPSJB) parts.push(`EPS ${d.EPSJB.toFixed(2)}`);
        // ROE
        if (d.ROEJQ) parts.push(`ROE ${d.ROEJQ.toFixed(2)}%`);
        // 毛利率
        if (d.XSMLL) parts.push(`毛利率 ${d.XSMLL.toFixed(2)}%`);
        // 净利率
        if (d.XSJLL) parts.push(`净利率 ${d.XSJLL.toFixed(2)}%`);
        // 资产负债率
        if (d.ZCFZL) parts.push(`资产负债率 ${d.ZCFZL.toFixed(2)}%`);

        if (parts.length) lines.push(`- ${report}：${parts.join(' / ')}`);
      }

      // 额外指标
      const latest = rows[0];
      const extras = [];
      if (latest.LD) extras.push(`流动比率 ${latest.LD.toFixed(2)}`);
      if (latest.SD) extras.push(`速动比率 ${latest.SD.toFixed(2)}`);
      if (latest.BPS) extras.push(`每股净资产 ${latest.BPS.toFixed(2)}`);
      if (extras.length) lines.push(`- 最新指标：${extras.join(' / ')}`);

      return lines.join('\n');
    } catch (e) {
      console.warn('[Enrichment] fetchFinancials error:', e);
      return '';
    }
  },

  /**
   * 获取公司公告（最近 5 条）
   * 数据来源：东方财富公告接口
   */
  async fetchAnnouncements(fullCode) {
    const [market, code] = fullCode.split(':');
    // 东财公告接口需要 stock code + market
    // 公司公告列表（按时间倒序，取前 5 条）
    const emCode = market === 'HK' ? code : code;
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?page_size=5&page_index=1&ann_type=A&stock_list=${emCode}&f_node=0&s_node=0`;

    try {
      const res = await this._fetch(url);
      if (!res || !res.data || !res.data.list || !res.data.list.length) return '';

      const items = res.data.list.map(item => {
        const date = (item.notice_date || '').slice(0, 10);
        const title = item.title || '未知公告';
        return `- [${date}] ${title}`;
      });
      return '最近公司公告：\n' + items.join('\n');
    } catch (e) {
      console.warn('[Enrichment] fetchAnnouncements error:', e);
      return '';
    }
  },

  /**
   * 获取资金流向（近 5 日主力/散户净流入）
   * 数据来源：东方财富资金流向接口
   */
  async fetchMoneyFlow(fullCode) {
    const [market, code] = fullCode.split(':');
    let secid;
    if (market === 'HK') secid = '116.' + code;
    else if (market === 'SH') secid = '1.' + code;
    else secid = '0.' + code;

    const fmt = (v) => {
      const abs = Math.abs(v);
      if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
      if (abs >= 1e4) return (v / 1e4).toFixed(0) + '万';
      return v.toFixed(0);
    };

    const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=5&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;

    try {
      const res = await this._fetch(url);
      if (!res || !res.data || !res.data.klines || !res.data.klines.length) return '';

      const lines = ['【近 5 日资金流向】'];
      lines.push('（单位：元，正=净流入，负=净流出）');

      for (const line of res.data.klines) {
        const parts = line.split(',');
        // 格式：日期,主力净流入,小单净流入,中单净流入,大单净流入,超大单净流入
        const date = parts[0];
        const mainIn = parseFloat(parts[1]) || 0;   // 主力净流入
        const smallOut = parseFloat(parts[2]) || 0;  // 小单净流入
        const midIn = parseFloat(parts[3]) || 0;     // 中单净流入
        const bigIn = parseFloat(parts[4]) || 0;     // 大单净流入
        const superIn = parseFloat(parts[5]) || 0;   // 超大单净流入

        lines.push(`- ${date}：主力 ${fmt(mainIn)}（超大单 ${fmt(superIn)} / 大单 ${fmt(bigIn)}）`);
      }

      // 汇总
      const totals = res.data.klines.map(l => parseFloat(l.split(',')[1]) || 0);
      const totalMain = totals.reduce((s, v) => s + v, 0);
      const trend = totalMain > 0 ? '主力资金净流入' : totalMain < 0 ? '主力资金净流出' : '主力资金持平';
      lines.push(`- 5 日合计：${trend} ${fmt(totalMain)}`);

      return lines.join('\n');
    } catch (e) {
      console.warn('[Enrichment] fetchMoneyFlow error:', e);
      return '';
    }
  },

  /**
   * 内部 fetch，走 background 中转避免 CORS
   */
  async _fetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'sp:fetch-url', url }, resp => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.error) {
          reject(new Error(resp.error));
          return;
        }
        resolve(resp ? resp.data : null);
      });
    });
  }
};
