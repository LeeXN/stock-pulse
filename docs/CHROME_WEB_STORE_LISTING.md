# Chrome Web Store 上架素材 — Stock Pulse v1.2.1

本文件中的文案可直接复制到 Chrome Web Store Developer Dashboard。实际提交时请同时更新“商店详情”和“隐私权规范”页面。

## 基本信息

**名称**

Stock Pulse - K线行情助手

**建议分类**

生产力工具

**简短说明**

轻量级股票 K 线与持仓助手，支持多市场行情、交易流水导入、真实收益对比、AI Skills 和视觉 OCR。

## 详细说明

Stock Pulse 是一款运行在 Chrome Side Panel 中的本地优先行情与持仓工具。无需离开当前网页，即可查看 A 股、港股、美股等市场行情、分时与多周期 K 线，并管理个人自选股和交易流水。

核心功能：

- 分时、日 K、周 K、月 K、年 K，以及 MA、BOLL、MACD、KDJ 和成交量。
- 多标的行情总览，展示最新价、涨跌幅、成交量和 30 日走势。
- 自选股搜索、批量导入、分组、排序和浏览器右键快捷加入。
- 买入/卖出交易流水、手续费、印花税、持仓成本、市值和盈亏计算。
- CSV、TSV、券商复制文本和截图 OCR 导入，支持导入预览、修改、校验和去重。
- 按真实交易流水计算的持仓收益对比，也可切换为纯股价表现。
- 基本面速读、技术面解读、风险与机会 3 个内置 AI Skill。
- OpenAI 兼容模型、用户自定义 Skill 和视觉模型 OCR。
- 腾讯、东方财富、新浪、Tushare、聚合数据以及 Binance/Dex 多数据源。
- 暗色/亮色主题、自定义强调色、交易所时区和多币种汇总。

数据与隐私：

- 自选股、持仓、设置和 Skill 保存在本机 Chrome 存储中。
- API Key 和 Token 只在调用用户选择的服务时发送给对应服务商。
- OCR 截图会发送到用户主动配置的视觉模型服务商。
- 数据备份默认不包含 API Key 和 Token。

Stock Pulse 用于行情查看和个人研究，不构成投资建议。免费行情接口可能受到网络状态、频率限制或服务可用性影响。

## v1.2.1 更新内容

- 批量交易导入改为整批校验和原子写入，避免部分导入。
- 阻止超持仓卖出，支持重复流水去重和严格日期/数值校验。
- 修复错误股票标的、股票代码误匹配加密货币和右键加入自选丢失。
- 修复美股 K 线备用市场、海外行情降级、年 K 聚合和缓存更新。
- K 线、成交价和实时价统一为未复权口径。
- OCR 必须使用视觉模型，CSV 支持引号和多行字段。
- 备份默认移除密钥，并补充 OCR 隐私披露。
- 改善窄屏布局、错误状态、重试、搜索和设置体验。

## 详情截图

Chrome Web Store 最多上传 5 张截图，推荐按以下顺序使用：

1. [`01-market-overview.png`](screenshots/01-market-overview.png) — 多标的行情总览、K 线、均线和买卖点。
2. [`02-watchlist.png`](screenshots/02-watchlist.png) — 自选股、排序、批量操作和实时报价。
3. [`03-portfolio.png`](screenshots/03-portfolio.png) — 持仓汇总、成本、市值和盈亏。
4. [`04-batch-import-preview.png`](screenshots/04-batch-import-preview.png) — CSV/TSV 交易流水解析与导入前预览。
5. [`05-ai-skills.png`](screenshots/05-ai-skills.png) — 内置 AI Skills 和自定义关注重点。

备用图片：[`06-settings-providers.png`](screenshots/06-settings-providers.png) — 多 Provider、OCR 和 AI 设置。

全部截图为 1280×800 PNG、方角、无外边距，适合作为商店详情图。上传前可按目标语言选择对应图片，避免图片中出现任何真实账户、密钥或个人资产信息。

## 权限用途说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 在本机保存自选股、持仓、设置和 Skill |
| `alarms` | 定时刷新角标和行情状态 |
| `sidePanel` | 在 Chrome Side Panel 中显示主界面 |
| `contextMenus` | 将网页中选中的股票代码加入自选股 |
| 行情站点 Host 权限 | 直接请求用户选择的行情、K 线、汇率和公告数据源 |
| LLM 站点 Host 权限 | 在用户主动运行 AI/OCR 时请求所配置的模型服务商 |

## 隐私权规范填写要点

- 单一用途：在浏览器侧边栏提供市场行情、持仓记录和用户主动触发的 AI 分析。
- 本地存储：自选、持仓、设置、Skill、缓存。
- 外部传输：行情代码发送给行情 Provider；AI 提示词发送给用户配置的 LLM；OCR 图片发送给用户配置的视觉模型。
- 不出售用户数据，不用于广告，不传给插件作者控制的分析服务器。
- 隐私政策页面：仓库中的 `privacy.html`，发布时应提供可公开访问的 HTTPS URL。

## 上架检查清单

- [ ] 上传 `stock-pulse-v1.2.1-chrome.zip`。
- [ ] 确认压缩包根目录直接包含 `manifest.json`。
- [ ] 确认 manifest 版本为 `1.2.1`，高于商店当前版本。
- [ ] 上传 128×128 商店图标 `icons/icon128.png`。
- [ ] 按推荐顺序上传 5 张 1280×800 详情截图。
- [ ] 粘贴简短说明、详细说明和 v1.2.1 更新内容。
- [ ] 更新隐私政策 URL 和隐私权规范声明。
- [ ] 复核 Host 权限与数据使用披露。
- [ ] 使用未登录、无历史数据的 Chrome Profile 做一次安装验证。

官方参考：

- [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- [Supplying Images](https://developer.chrome.com/docs/webstore/images)
- [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update)
