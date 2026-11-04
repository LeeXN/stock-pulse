# Chrome Web Store 上架素材 — Stock Pulse v1.4.0

本文件中的文案可直接复制到 Chrome Web Store Developer Dashboard。实际提交时请同时更新“商店详情”和“隐私权规范”页面。

## 基本信息

**名称**

Stock Pulse - K线行情助手

**建议分类**

生产力工具

**简短说明**

浏览器侧边栏行情与持仓助手，支持全球指数与 BTC/ETH K 线、多市场股票、自选分组、交易流水、AI 分析和视觉 OCR。

## 最新可复制语料

- [商店完整介绍（纯文本）](marketing/v1.4.0/STORE_DESCRIPTION_ZH.txt)：直接替换旧版详细介绍，包含 v1.4.0 的折叠、历史加载和持仓涨跌幅。
- [宣传语料与搜索建议](marketing/v1.4.0/COPYWRITING_ZH.md)：主宣传语、建议名称与简介、更新说明、社区长短文案。
- [整套图片与使用说明](marketing/v1.4.0/README.md)：8 张原始截图、5 张带文案宣传图，以及两种尺寸的品牌图。

当前名称和简短说明与 v1.4.0 manifest 一致。建议的新名称和简介需在后续新版本中同步 manifest；详细介绍和图片可单独更新。

旧文案中的“不上传任何用户信息”不能沿用：行情请求会发送到数据源，AI/OCR 内容会发送给用户配置的服务商。最新纯文本介绍已写明数据去向。

## v1.4.0 更新内容

- 全球市场可收起为一行、横向滚动；K 线区可单独收起以展开多标的列表，并记住收起状态。
- 改善行情列表滚轮行为，避免跳过中间标的，重绘列表保留滚动位置。
- 持仓列表显示每只标的的今日涨跌幅并支持排序；加密资产注明近 24 小时口径。
- 拖动图表查看更早日期时继续加载历史 K 线，也可点击“加载更早”；保持日期位置和缩放，失败可重试。
- 周 K、月 K、年 K 横轴包含年份，改善跨年度查看。

## 详情截图

以下为 v1.4.0 正式发布包在隔离 Chrome 中的实际界面，使用虚构行情、持仓和交易。所有原图均为 1280×800 PNG、方角、无外边距；AI 页明确标注示例内容，未实际调用模型。

商店最多上传 5 张，推荐顺序：

1. [全球指数与市场图表](marketing/v1.4.0/screenshots/01-global-markets.png)
2. [历史加载、带年份的日期和折叠视图](marketing/v1.4.0/screenshots/02-history-and-focus.png)
3. [持仓与今日涨跌幅](marketing/v1.4.0/screenshots/03-portfolio-daily-change.png)
4. [实际持仓收益对比](marketing/v1.4.0/screenshots/04-return-comparison.png)
5. [AI 分析 Skill 与补充指令](marketing/v1.4.0/screenshots/05-ai-skills.png)

备用： [分组自选股](marketing/v1.4.0/screenshots/06-watchlist.png)、[导入预览](marketing/v1.4.0/screenshots/07-import-preview.png)、[收起图表后的标的列表](marketing/v1.4.0/screenshots/08-expanded-list.png)。

小宣传图使用 [440×280 品牌图](marketing/v1.4.0/promotional/small-440x280.png)，横幅使用 [1400×560 品牌图](marketing/v1.4.0/promotional/marquee-1400x560.png)。带文案的 `social/` 图片用于社区和介绍文章，商店详情优先使用上述原始界面截图。

旧的 `docs/screenshots/` 保留为历史文档配图，上架时使用本次素材。

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

- [ ] 上传 `dist/v1.4.0/stock-pulse-v1.4.0-webstore.zip`。
- [ ] 确认压缩包根目录直接包含 `manifest.json`。
- [ ] 确认 manifest 版本为 `1.4.0`，高于商店当前版本。
- [ ] 上传 128×128 商店图标 `icons/icon128.png`。
- [ ] 按推荐顺序上传 5 张 1280×800 详情截图。
- [ ] 粘贴简短说明、详细说明和 v1.4.0 更新内容。
- [ ] 更新隐私政策 URL 和隐私权规范声明。
- [ ] 复核 Host 权限与数据使用披露。
- [ ] 使用未登录、无历史数据的 Chrome Profile 做一次安装验证。
- [x] 已生成并核对 v1.4.0 截图，包含折叠、历史加载、持仓涨跌幅。
- [ ] 将最新介绍和图片实际保存到商店后台。

本地构建不等于已提交或审核通过。更新已有条目时保持原商店条目和扩展 ID；本地签名 CRX 不能替代 webstore ZIP 上传。签名 CRX 的安装范围见 [安装文档](INSTALLATION.md#签名-crx-安装)。

官方参考：

- [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- [Supplying Images](https://developer.chrome.com/docs/webstore/images)
- [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update)
