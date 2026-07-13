# Stock Pulse v1.1.0 Release Notes

## 中文（CN）

### 新增
- 新增加密货币支持：可搜索并添加 `BTC/ETH` 等主流币种，支持通过名称、代码和 `0x...` Web3 地址添加。
- 大盘指数栏新增 Crypto 分组，可在设置中勾选显示 `BTC`、`ETH`。
- 行情聚合新增 Crypto Provider（Binance + DexScreener），接入报价、K 线、分时流程。

### 优化
- 国际市场价格显示增加币种单位（如 `USD`、`HKD`、`JPY` 等）。
- 价格格式与涨跌展示逻辑统一，摘要表与列表展示更一致。
- 批量添加流程升级为“标的”导向，支持股票与加密货币混合输入。

### 修复
- 修复国际行情缩放错误（如美股价格/涨跌幅显示异常）。
- 修复大盘指数部分映射与缩放问题，提升多市场指数稳定性。
- 修复快速多次切换股票后 K 线偶发不刷新的并发竞态问题。

### 测试
- 新增并通过 EastMoney 归一化回归测试。
- 新增并通过 Crypto 搜索/报价与市场栏混合拉取测试。

---

## English (EN)

### Added
- Added cryptocurrency support: search and add major assets like `BTC/ETH`, including by name, symbol, and `0x...` Web3 address.
- Added a Crypto group in the market bar settings, with selectable `BTC` and `ETH`.
- Introduced a Crypto provider layer (Binance + DexScreener) integrated with quote, K-line, and realtime flows.

### Improved
- Added market currency suffixes for international prices (for example `USD`, `HKD`, `JPY`).
- Unified price/change formatting across summary tables and list views.
- Upgraded batch add flow to support mixed stock + crypto targets.

### Fixed
- Fixed international quote normalization/scaling issues (for example US price and change percent display).
- Fixed market index mapping/scaling reliability for multi-market indices.
- Fixed a chart concurrency race where repeated stock switching could stop K-line refresh.

### Tests
- Added and passed EastMoney normalization regression tests.
- Added and passed Crypto search/quote and market-bar integration tests.
