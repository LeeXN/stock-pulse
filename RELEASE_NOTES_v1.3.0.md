# Stock Pulse v1.3.0

发布日期：2026-10-21。

点击顶部指数或 BTC/ETH，即可在现有 K 线主图中查看该标的。“市场”分组跟随设置中已勾选的项目，支持日、周、月、年 K，第一版暂不开放分时。

- “市场 / 持仓 / 自选”分别记住本次使用时上次选择的标的。
- 指数使用独立标识，保留正确行情编号，并以“点”显示。
- 指数使用东方财富，BTC/ETH 使用 Binance，不跟随个股数据源设置。
- 图表标明最近一根 K 线的日期；加密货币涨跌幅为近 24 小时口径。
- 请求失败时保留并标明上次成功数据，并提供重试入口。
- 修复快速切换或清空列表后旧响应覆盖图表、部分指数缺失时未执行回退和关闭自动刷新后指数仍刷新。
- 市场分组自动刷新当前 K 线；年 K 按月线聚合，历史范围取决于提供商实际返回的数据。

## 安装与发布

构建命令：`python3 scripts/build_release.py --crx`。

同版本需要生成另一份候选构建时，使用 `--output-dir dist/v1.3.0-candidate` 指定新目录；已有构建不会覆盖。

输出目录：`dist/v1.3.0/`。

| 文件 | 用途 |
| --- | --- |
| `stock-pulse-v1.3.0-install.zip` | 解压后打开 `INSTALL.txt`，在浏览器开发者模式中加载 `stock-pulse-v1.3.0` 文件夹 |
| `stock-pulse-v1.3.0-webstore.zip` | 上传 Chrome Web Store Developer Dashboard，根目录直接包含 `manifest.json` |
| `stock-pulse-v1.3.0.crx` | 本地签名包，用于允许商店外安装的环境 |
| `SHA256SUMS` | 发布文件 SHA-256 校验值 |
| `BUILD.json` | 文件清单、哈希和构建来源 |

普通 Windows/macOS Chrome 对商店外 CRX 安装有限制，手动安装请使用安装 ZIP 的“加载已解压的扩展程序”方式。CRX 使用本地签名身份，不代表已有商店条目的签名身份；商店更新请上传 webstore ZIP 到原条目。

签名私钥保存在 `.local/release/chrome-signing-key.pem`，不会进入发布目录。后续本地 CRX 更新需要保留该私钥。

打包不会发布到商店。商店审核还需要开发者账号、商店文案、截图、权限声明和可公开访问的隐私政策 URL。

## 验证

- 29 项自动化测试全部通过，所有运行 JavaScript 通过语法检查。
- 已在隔离 Chrome 配置中验证市场入口、各 K 线周期、分组记忆、缓存失败与重试恢复。
- 已验证取消全部市场勾选后的空列表，以及 390 像素宽侧栏布局。
- 发布构建会校验 ZIP 路径、运行文件清单、内容哈希和 CRX3 内嵌资源。

官方说明：[商店 ZIP 要求](https://developer.chrome.com/docs/webstore/prepare)、[本地安装限制](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)、[CRX 签名](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux)。
