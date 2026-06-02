/**
 * skills.js - 股票分析 skills 系统
 *
 * 概念：
 *   每个 skill = {
 *     id, name, description, systemPrompt, userTemplate,
 *     license, author, version, attribution, builtin
 *   }
 *   userTemplate 中支持占位符：
 *     {code}           代码
 *     {name}           名称
 *     {market}         市场（SH/SZ/HK）
 *     {quote}          最新报价（人类可读摘要）
 *     {kline_recent}   近期 N 日 K 线摘要
 *     {kline_summary}  整体 K 线概览
 *     {kline_count}    K 线根数
 *     {financials}     财务数据（营收/净利/ROE/毛利率/资产负债率，来自东财 F10）
 *     {news}           最近公司公告
 *     {money_flow}     近 5 日资金流向（主力/大单/散户净流入）
 *   系统会用当前股票 / 行情 / K 线 / 基本面 / 公告数据替换占位符，然后调用 LLM。
 *
 * 数据存储：
 *   chrome.storage.local: 'userSkills' 数组
 *   内置 skills 硬编码，用户可以克隆/修改/删除用户版。
 *
 * 跨 LLM 互操作：
 *   - toMarkdown() / fromMarkdown() 互转 SKILL.md（YAML frontmatter）
 *   - 用户可以一键复制到剪贴板，粘贴到 Claude.ai / ChatGPT / Cursor / Gemini 等
 *   - 用户也可以从这些平台复制别人的 skill 粘贴导入
 *   - 格式遵循 Anthropic / Claude Code Skills 开放规范
 */
const Skills = {
  _USER_SKILLS_KEY: 'userSkills',
  _DEFAULT_LICENSE: 'MIT',

  // ===== 内置 skills（3 个，均有真实数据支撑）=====
  _BUILTIN: [
    {
      id: 'stock-fundamentals',
      name: '基本面速读',
      description: '基于财报数据（营收/净利/ROE/毛利率）+ 行情 + 资金流向，输出基本面评分',
      builtin: true,
      license: 'MIT',
      author: 'Stock Pulse',
      version: '2.0.0',
      systemPrompt: '你是一名 A 股 / 港股分析师。所有判断必须基于提供的财务数据和行情数据，不得编造数据。如果某项数据缺失，明确标注"数据缺失"。回答简洁、结构化，使用中文。',
      userTemplate: '请对【{name}（{code}）】做一份「基本面速读」。\n\n【最新行情】\n{quote}\n\n【财务数据】\n{financials}\n\n【资金流向】\n{money_flow}\n\n【最近公告】\n{news}\n\n请严格按以下格式输出：\n\n## 基本面评分: XX / 100\n（A+ ≥85 / A 70-84 / B 55-69 / C 40-54 / D 25-39 / F <25）\n\n## 评级理由（2-3 句）\n只基于上述数据，不编造。\n\n## 盈利能力\n营收/净利的同比增速，ROE 水平，毛利率高低。\n\n## 估值参考\n结合 EPS 和当前价计算 PE，与上面的财报数据对比。\n\n## 资金动向\n主力资金是净流入还是净流出，趋势如何。\n\n## 风险提示\n基于财报数据的风险点（增速放缓 / 毛利率下降 / 负债率高等）。\n\n## 关注事项\n建议用户后续关注什么（具体财报日期 / 行业事件）。'
    },
    {
      id: 'stock-technicals',
      name: '技术面解读',
      description: '基于 K 线 + 均线 + 量价数据，输出技术评分与多空信号',
      builtin: true,
      license: 'MIT',
      author: 'Stock Pulse',
      version: '2.0.0',
      systemPrompt: '你是一名纯技术派交易员，只基于 K 线、均线、量价数据做判断。不编造形态，只描述数据呈现的事实。使用中文回答。',
      userTemplate: '请对【{name}（{code}）】进行「技术面解读」。\n\n【行情】\n{quote}\n\n【近期 K 线（最近 {kline_count} 日）】\n{kline_recent}\n\n【K 线总体概览】\n{kline_summary}\n\n请严格按以下格式输出：\n\n## 技术评分: XX / 100\n（85+ 极强多 / 70-84 偏多 / 55-69 中性偏多 / 40-54 中性偏空 / 25-39 偏空 / <25 极空）\n\n## 信号\n📈 偏多 / ➡️ 观望 / 📉 偏空（明确给一个）\n\n## 趋势\n上升 / 下降 / 震荡 + 强度（强/弱）\n\n## 均线状态\nMA5/MA10/MA20 排列方向，是否有金叉/死叉。\n\n## 量价关系\n最近 5 日放量/缩量与涨跌是否配合。\n\n## 关键价位\n近期支撑位、阻力位（基于实际 K 线高低点给出具体数字）。\n\n## 交易建议\n- 短线（1-3 日）：偏多 / 偏空 / 观望\n- 波段（1-2 周）：偏多 / 偏空 / 观望'
    },
    {
      id: 'stock-risk-check',
      name: '风险与机会',
      description: '基于波动率 + 财务数据 + 资金流向，评估当前风险与机会',
      builtin: true,
      license: 'MIT',
      author: 'Stock Pulse',
      version: '2.0.0',
      systemPrompt: '你是一名风控意识强的投资顾问。所有风险判断必须基于提供的数据（K 线波动、财务指标、资金流向），不得编造。使用中文回答。',
      userTemplate: '请评估【{name}（{code}）】当前的「风险与机会」。\n\n【最新行情】\n{quote}\n\n【财务数据】\n{financials}\n\n【资金流向】\n{money_flow}\n\n【近期 K 线】\n{kline_recent}\n\n【最近公告】\n{news}\n\n请严格按以下格式输出：\n\n## 风险评分: X / 10\n（10 = 极高风险 / 1 = 极低风险）\n\n## 信号灯\n🟢 低风险 / 🟡 中等风险 / 🔴 高风险\n\n## 核心风险（2-3 条）\n每条必须有数据支撑（具体涨跌幅 / 估值水平 / 资金流出金额）。\n\n## 潜在机会（1-2 条）\n触发条件 + 确认信号。\n\n## 资金面\n主力资金近期动向，是否有异常。\n\n## 操作建议\n- 已持仓：持有 / 减仓 / 止损\n- 未持仓：是否可介入、什么条件触发'
    }
  ],

  // ===== 公共 API =====

  /**
   * 获取所有 skills（内置 + 用户），用户同名 skill 覆盖内置
   */
  async list() {
    const user = await DB.get(this._USER_SKILLS_KEY, []);
    const userById = new Map(user.map(s => [s.id, s]));
    const result = [];
    for (const b of this._BUILTIN) {
      const overrideId = b.id + '_user';
      result.push(userById.has(overrideId) ? userById.get(overrideId) : b);
    }
    for (const u of user) {
      // 跳过覆盖内置的 _user 副本（已在上面合并）
      if (u.id.endsWith('_user') && this._BUILTIN.find(b => b.id + '_user' === u.id)) continue;
      if (!u.builtin && !result.find(r => r.id === u.id)) result.push(u);
    }
    return result;
  },

  async get(id) {
    const all = await this.list();
    return all.find(s => s.id === id) || null;
  },

  /**
   * 保存用户 skill（新建或覆盖）
   */
  async save(skill) {
    const all = await DB.get(this._USER_SKILLS_KEY, []);
    // 标准化字段
    skill = this._normalize(skill);
    // 内置 skill 的 user 副本统一加 _user 后缀
    if (skill.builtin) {
      skill.id = skill.id + '_user';
      skill.builtin = false;
    }
    const idx = all.findIndex(s => s.id === skill.id);
    if (idx >= 0) all[idx] = skill;
    else all.push(skill);
    await DB.set(this._USER_SKILLS_KEY, all);
    return skill;
  },

  async remove(id) {
    let all = await DB.get(this._USER_SKILLS_KEY, []);
    all = all.filter(s => s.id !== id);
    await DB.set(this._USER_SKILLS_KEY, all);
    return all;
  },

  /**
   * 标准化 skill 对象，补齐缺失字段
   */
  _normalize(skill) {
    return {
      id: skill.id || ('user_' + Date.now()),
      name: skill.name || '未命名 Skill',
      description: skill.description || '',
      systemPrompt: skill.systemPrompt || '',
      userTemplate: skill.userTemplate || '',
      license: skill.license || this._DEFAULT_LICENSE,
      author: skill.author || 'User',
      version: skill.version || '1.0.0',
      attribution: skill.attribution || '',
      builtin: !!skill.builtin
    };
  },

  /**
   * 替换 skill 模板中的占位符
   */
  _fillTemplate(tpl, ctx) {
    return tpl.replace(/\{(\w+)\}/g, (_, key) => {
      if (ctx[key] === undefined || ctx[key] === null) return `{${key}}`;
      return String(ctx[key]);
    });
  },

  /**
   * 用 skill 对一只股票生成分析
   * @param {string} skillId
   * @param {Object} stock      { fullCode, code, name, market }
   * @param {Object} context    { quote, kline, enrichment }
   */
  async run(skillId, stock, context) {
    const skill = await this.get(skillId);
    if (!skill) throw new Error('Skill 不存在: ' + skillId);
    const ctx = this._buildContext(stock, context);
    const userPrompt = this._fillTemplate(skill.userTemplate, ctx);
    const res = await LLM.chat({
      system: skill.systemPrompt,
      user: userPrompt,
      temperature: 0.5
    });
    return { content: res.content, usage: res.usage, skill, context: ctx };
  },

  /**
   * 把行情 / K 线 / 基本面 / 公告数据转成可读摘要
   */
  _buildContext(stock, context) {
    const { quote = {}, kline = [], enrichment = {} } = context || {};
    return {
      code: stock.code,
      name: stock.name || stock.code,
      market: stock.market,
      fullCode: stock.fullCode,
      quote: this._formatQuote(quote, stock),
      kline_recent: this._formatKlineRecent(kline),
      kline_summary: this._formatKlineSummary(kline),
      kline_count: kline.length,
      financials: enrichment.financials || '暂无财务数据',
      news: enrichment.announcements || '暂无公司公告',
      money_flow: enrichment.moneyFlow || '暂无资金流向数据'
    };
  },

  _formatQuote(q, stock) {
    if (!q || !q.price) return '暂无行情';
    const sign = q.change >= 0 ? '+' : '';
    const dec = stock && stock.market === 'HK' ? 3 : 2;
    const lines = [
      `最新价：${q.price.toFixed(dec)} 元`,
      `涨跌：${sign}${q.change.toFixed(dec)} (${sign}${q.changePercent.toFixed(2)}%)`,
      `今开：${(q.open || 0).toFixed(dec)}`,
      `最高：${(q.high || 0).toFixed(dec)}`,
      `最低：${(q.low || 0).toFixed(dec)}`,
      `昨收：${(q.prevClose || 0).toFixed(dec)}`
    ];
    if (q.volume) {
      const vol = q.volume >= 1e8 ? (q.volume / 1e8).toFixed(2) + ' 亿'
                : q.volume >= 1e4 ? (q.volume / 1e4).toFixed(0) + ' 万'
                : q.volume;
      lines.push(`成交量：${vol} 股`);
    }
    return lines.join('\n');
  },

  _formatKlineRecent(kline) {
    if (!kline || !kline.length) return '暂无 K 线数据';
    const recent = kline.slice(-10);
    return recent.map(k => {
      const change = k.close - k.open;
      const changePct = k.open ? (change / k.open * 100) : 0;
      const sign = change >= 0 ? '+' : '';
      const color = change >= 0 ? '阳' : '阴';
      return `${k.time} ${color}线 开${k.open.toFixed(2)} 收${k.close.toFixed(2)} 幅${sign}${changePct.toFixed(2)}% 量${(k.volume/1e4).toFixed(0)}万`;
    }).join('\n');
  },

  _formatKlineSummary(kline) {
    if (!kline || !kline.length) return '暂无 K 线数据';
    const n = kline.length;
    const closes = kline.map(k => k.close);
    const max = Math.max(...closes);
    const min = Math.min(...closes);
    const first = kline[0].close;
    const last = kline[n - 1].close;
    const periodChange = first ? ((last - first) / first * 100) : 0;
    const sign = periodChange >= 0 ? '+' : '';

    const ma = (period) => {
      const slice = kline.slice(-period);
      if (!slice.length) return 0;
      return slice.reduce((s, k) => s + k.close, 0) / slice.length;
    };
    const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20);

    return [
      `区间：${kline[0].time} ~ ${kline[n-1].time}（共 ${n} 根）`,
      `区间最高：${max.toFixed(2)}，最低：${min.toFixed(2)}`,
      `区间累计涨跌：${sign}${periodChange.toFixed(2)}%`,
      `MA5：${ma5.toFixed(2)}，MA10：${ma10.toFixed(2)}，MA20：${ma20.toFixed(2)}`
    ].join('\n');
  },

  // =========================================================
  //  SKILL.md 互操作（YAML frontmatter，符合 Anthropic 开放规范）
  // =========================================================

  /**
   * 把 skill 序列化为标准 SKILL.md 格式
   * 包含 YAML frontmatter + Markdown body
   * 用户可以复制到剪贴板，粘贴到 Claude.ai / Cursor / ChatGPT / Gemini 等
   */
  toMarkdown(skill) {
    const s = this._normalize(skill);
    const fm = {
      name: this._toKebabCase(s.name),
      description: s.description || `${s.name} - Stock Pulse Skill`
    };
    if (s.license) fm.license = s.license;
    if (s.author) fm.author = s.author;
    if (s.version) fm.version = s.version;
    if (s.attribution) fm.attribution = s.attribution;

    const yaml = this._toYaml(fm);
    const body = [
      '# ' + s.name,
      '',
      '> Generated by [Stock Pulse](https://github.com/) v1.0.0',
      '> 本 skill 在 Stock Pulse 内可直接运行，复制后可在任何支持 SKILL.md 的 LLM 客户端使用。',
      '',
      '## 系统提示词（System Prompt）',
      '',
      '```',
      s.systemPrompt,
      '```',
      '',
      '## 用户提示词模板（User Template）',
      '',
      '可用占位符：`{code}` `{name}` `{market}` `{quote}` `{kline_recent}` `{kline_summary}` `{kline_count}` `{financials}` `{news}` `{money_flow}`',
      '',
      '```',
      s.userTemplate,
      '```',
      '',
      '## 使用说明',
      '',
      '1. 在 Stock Pulse 中：保存此 skill（系统会自动解析 frontmatter 和 body）',
      '2. 在 Claude.ai / Cursor / Gemini 等平台：直接把 `## 系统提示词` 部分贴入 "Custom Instructions"，把 `## 用户提示词模板` 部分在每次提问时使用，并手动替换占位符',
      ''
    ].join('\n');

    return `---\n${yaml}---\n\n${body}`;
  },

  /**
   * 从 SKILL.md 文本解析出 skill 对象
   * 容错处理：缺少 frontmatter / 字段缺失 / body 格式变化
   */
  fromMarkdown(md) {
    if (!md || typeof md !== 'string') throw new Error('内容为空');
    const text = md.trim();

    // 解析 YAML frontmatter
    let fm = {};
    let body = text;
    const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (fmMatch) {
      fm = this._fromYaml(fmMatch[1]);
      body = fmMatch[2].trim();
    }

    // 从 body 提取 systemPrompt / userTemplate
    // 匹配 "## 系统提示词" 后面代码块
    const sysMatch = body.match(/##\s*系统提示词[^\n]*\n+```[^\n]*\n([\s\S]*?)\n```/);
    const userMatch = body.match(/##\s*用户提示词模板[^\n]*\n+[\s\S]*?```[^\n]*\n([\s\S]*?)\n```/);

    const systemPrompt = sysMatch ? sysMatch[1].trim() : '';
    const userTemplate = userMatch ? userMatch[1].trim() : '';

    // 兜底：如果没匹配到代码块格式，尝试整段作为 userTemplate
    const fallback = !systemPrompt && !userTemplate;

    const name = fm.name || fm.title || '导入的 Skill';
    const id = this._toKebabCase(name) + '_' + Date.now().toString(36).slice(-4);

    return this._normalize({
      id,
      name,
      description: fm.description || '',
      systemPrompt: fallback ? '' : systemPrompt,
      userTemplate: fallback ? body : userTemplate,
      license: fm.license || this._DEFAULT_LICENSE,
      author: fm.author || 'Imported',
      version: fm.version || '1.0.0',
      attribution: fm.attribution || '',
      builtin: false
    });
  },

  /**
   * 简单 YAML 序列化（只处理 string 字段；支持双引号转义）
   */
  _toYaml(obj) {
    const escape = (v) => {
      v = String(v);
      // 包含特殊字符就用双引号
      if (/[:#&*?|<>=!%@`\[\]\{\},]/.test(v) || /^\s|\s$/.test(v) || v.includes('\n')) {
        return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
      }
      return v;
    };
    return Object.keys(obj).map(k => `${k}: ${escape(obj[k])}`).join('\n') + '\n';
  },

  /**
   * 简单 YAML 解析（只处理 key: value，支持双引号字符串）
   */
  _fromYaml(yaml) {
    const result = {};
    const lines = yaml.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) { i++; continue; }
      const key = m[1];
      let val = m[2].trim();
      // 去掉首尾引号
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      } else if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      result[key] = val;
      i++;
    }
    return result;
  },

  /**
   * 字符串转 kebab-case（适合作为 skill id / 文件名）
   */
  _toKebabCase(str) {
    if (!str) return 'skill';
    return String(str)
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9\-\u4e00-\u9fa5]/g, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'skill';
  }
};
