# Stock Pulse — K 线行情助手

轻量级 Chrome Side Panel 扩展，A 股 / 港股实时行情、K 线图、持仓管理、AI 智能分析。

## 功能

### 行情与 K 线
- 多周期 K 线：分时 / 日 K / 周 K / 月 K / 年 K
- MA5 / MA10 / MA20 均线 + 成交量副图
- 技术指标：BOLL / MACD / KDJ，一键开关
- **多股行情表格**（同花顺风格）：每只股票一行，显示代码/名称/最新价/涨跌幅/成交量/30 日走势 Sparkline
- **大盘指数条**：上证 / 深证 / 创业 / 恒生，10s 自动刷新

### 自选股
- 搜索添加 / 批量文本导入 / OCR 截图识别
- 浏览器右键菜单快速添加
- 分组管理（自定义分组 + 按组过滤）
- 实时行情列表，涨跌排序

### 持仓
- 买卖交易记录，自动计算持仓均价、市值、盈亏
- 总市值 / 今日盈亏 / 总盈亏汇总
- K 线上自动标记买卖点
- 批量文本 / OCR 导入

### AI 智能分析
- **大模型集成**：OpenAI 兼容协议，预设 DeepSeek / 通义千问 / 月之暗面 / OpenRouter / Gemini + 自定义
- **3 个内置 Skill**，均有真实数据支撑：
  - **基本面速读** — 财务数据（营收/净利/ROE/毛利率/资产负债率）+ 资金流向 + 公司公告
  - **技术面解读** — K 线 / 均线 / 量价分析
  - **风险与机会** — 波动 + 财务 + 资金面综合评估
- **自动数据注入**：运行 Skill 时自动拉取财报、公告、资金流向，无需手动输入
- **跨 LLM 互操作**：一键导出 / 导入 SKILL.md 格式，可在 Claude / ChatGPT / Cursor / Gemini 间复用
- **OCR（大模型视觉）**：截图识别股票代码，持仓模式自动识别「代码 买入价 数量」

### 其他
- 弹窗模式：Side Panel 可弹出为独立窗口，自由调整大小
- 浏览器角标：自选 + 持仓按涨跌着色
- 暗色 / 亮色主题 + 自定义强调色
- 数据导出 / 导入备份

## 安装

1. 克隆或下载本仓库
2. Chrome 打开 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录
5. 点击工具栏 Stock Pulse 图标打开 Side Panel

> 需要 Chrome ≥ 114。Side Panel 跟随当前标签页，新标签页需重新点击图标打开。

## 数据源

两个独立维度，可在设置中分别切换：

### 实时报价

| Provider | 批量 | 说明 |
| --- | --- | --- |
| 腾讯财经（默认） | ✅ | qt.gtimg.cn，速度最快 |
| 东方财富 | ❌ | push2.eastmoney.com |
| 新浪财经 | ✅ | hq.sinajs.cn |
| Tushare Pro | ❌ | 需 Token，免费 200 次/天 |
| 聚合数据 | ❌ | 需 Key，仅 A 股 |

### K 线 / 分时

| Provider | 说明 |
| --- | --- |
| 东方财富（默认） | push2his.eastmoney.com |
| 新浪财经 | quotes.sina.cn |
| Tushare Pro | 需 Token |
| 聚合数据 | 需 Key，仅 A 股 |

> 默认组合「腾讯报价 + 东财 K 线」是速度与覆盖面的最优解。

### AI / 大模型

支持 OpenAI 兼容协议的任何服务商。预设：OpenAI / DeepSeek / 通义千问 / 月之暗面 / OpenRouter / Gemini / 自定义。

部分厂商（OpenAI / Anthropic）不支持浏览器 CORS 直连，需配置 CORS 代理。详见 FAQ。

## 目录结构

```
stock-pulse/
├── manifest.json
├── panel.html
├── css/style.css
├── js/
│   ├── background.js   # service worker：右键菜单、角标、LLM 中转、弹窗
│   ├── storage.js      # chrome.storage.local 抽象
│   ├── api.js          # 多 Provider 行情接口
│   ├── chart.js        # Lightweight Charts 封装（BOLL/MACD/KDJ）
│   ├── portfolio.js    # 持仓计算
│   ├── ocr.js          # OCR（大模型视觉）
│   ├── market.js       # 大盘指数（A 股 + 港股）
│   ├── llm.js          # 大模型调用层
│   ├── skills.js       # Skills 系统（3 内置 + 用户自定义）
│   ├── enrichment.js   # 数据增强（财报 + 公告 + 资金流向）
│   └── app.js          # 主控制器
├── lib/
│   └── lightweight-charts.standalone.js
└── icons/
```

## FAQ

**Q: 点击图标没反应？**
A: 确保 Chrome ≥ 114。检查 `chrome://extensions/` 中扩展是否启用。

**Q: K 线 / 大盘指数不显示？**
A: 打开 F12 控制台查看报错。常见原因：网络问题（免费接口偶尔超时）、数据源限流。切换数据源或稍后重试。

**Q: OCR 识别率低？**
A: 上传清晰截图，数字区域对比度越高越好。识别结果可手动编辑后再导入。

**Q: LLM 测试连接提示「Failed to fetch」？**
A: 这是浏览器 CORS 拦截。DeepSeek / 通义千问 / 月之暗面 / OpenRouter / Gemini 支持直连。OpenAI 等需要 CORS 代理：

```js
// Cloudflare Worker 示例（5 行，每天 10 万次免费）
export default {
  async fetch(request) {
    const url = new URL(request.url).searchParams.get('url');
    const resp = await fetch(url, { method: request.method, headers: request.headers, body: request.body });
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { status: resp.status, headers });
  }
};
```

把代理 URL 填到设置「CORS 代理 URL」字段，例如 `https://your-name.workers.dev/?url=`。

**Q: 数据怎么备份？**
A: 设置 → 导出数据，下载 JSON 备份文件。可随时导入恢复。

**Q: 怎么分享 Skill 到其他平台？**
A: Skills 管理 → 点击 skill 卡片「📋 复制」→ 粘贴到 Claude / ChatGPT / Cursor 等平台。也可「📥 导入」别人的 SKILL.md。

## Privacy

- 所有数据存储在 `chrome.storage.local`，仅本机
- Token / Key 仅在调用时直传对应服务商，不经过任何中间服务器
- 不收集、不上传任何用户数据

## License

MIT
