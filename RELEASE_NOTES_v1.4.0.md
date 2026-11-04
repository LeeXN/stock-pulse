# Stock Pulse v1.4.0

发布日期：2026-11-04。

本版本改善多标的列表浏览，并支持继续加载更早的历史 K 线。

## 界面与行情

- 全球市场指数区可收起为一行，超出宽度时可横向滚动；展开后恢复多行。
- K 线区可独立收起，让行情列表占用剩余空间；重新打开插件后保留收起状态。
- 行情概览独立滚动，单次滚轮不会越过整个可见列表；重绘列表时保留滚动位置。
- 每只持仓展示今日涨跌幅，并支持排序；没有有效报价时显示 `--`，加密资产注明近 24 小时口径。

## 历史 K 线

- 设置中的 K 线数量控制首次加载；向历史方向拖动图表，接近左边界时自动请求更早的数据。
- 也可点击“加载更早”；加载失败可重试，数据源没有更早数据时显示“已到最早可用数据”。
- 补充历史后保留正在查看的日期和缩放比例；行情刷新保留已加载的历史。
- 快速切换标的、周期或数据源时，迟到响应不会覆盖当前图表。
- 周 K 横轴显示 `YYYY-MM-DD`，月 K 显示 `YYYY-MM`，年 K 显示 `YYYY`；十字光标保留完整日期。
- Binance 历史超过单次 1000 根的限制时继续分页；可用历史范围取决于数据源。

## 安装与商店上传

```bash
python3 scripts/build_release.py --crx
```

输出目录：`dist/v1.4.0/`。已有构建不会覆盖；同版本重建使用 `--output-dir dist/v1.4.0-candidate-2`。

| 文件 | 用途 |
| --- | --- |
| `stock-pulse-v1.4.0-webstore.zip` | 上传 Chrome Web Store Developer Dashboard；根目录直接包含 `manifest.json` |
| `stock-pulse-v1.4.0.crx` | 使用既有本地私钥签名的 CRX3 包，供允许商店外安装的环境使用 |
| `stock-pulse-v1.4.0-install.zip` | 解压后在开发者模式中加载附带的 `stock-pulse-v1.4.0` 文件夹 |
| `SHA256SUMS` | 安装包和上传包的 SHA-256 校验值 |
| `BUILD.json` | 版本、构建来源、运行文件与产物哈希 |

普通 Windows/macOS Chrome 的直接安装应使用 Chrome Web Store。自签名 CRX 无法绕过商店外安装限制；发布前验收请按 [安装说明](docs/INSTALLATION.md) 加载已解压的扩展程序。

更新现有解压版时，先导出备份，将新版运行文件覆盖到原扩展目录后点击“重新加载”。更换扩展 ID 会使用另一套本地存储；本地 CRX 签名身份也不等同于商店身份。商店版本应上传到原有条目。

私钥继续保存在 `.local/release/chrome-signing-key.pem`，不进入 Git、ZIP、CRX 内嵌资源或 Release。所有包只包含运行资源，不包含用户持仓、个人设置、API Key、测试或本地工具。

## 验证与发布

- 34 项自动化测试及所有运行 JavaScript 的语法检查。
- 隔离 Chrome 中验证收起状态、滚轮、持仓涨跌幅、历史加载和窄侧栏；交互回归使用模拟行情，不代表外部数据源始终可用。
- 构建检查 ZIP 完整性、文件白名单、内容哈希与 CRX3 头及内嵌 ZIP。
- 已校验 CRX3 数字签名，与 v1.3.0 本地 CRX 使用相同身份；商店 ZIP 解压后已在隔离 Chrome 中实际加载，验证真实扩展存储和收起状态恢复。
- GitHub Release 使用最终合并提交构建的附件，`BUILD.json` 记录来源提交和运行文件哈希。
- Chrome Web Store 上传包已准备好，不代表已上传、审核通过或上架；上传时还需开发者账号、商店详情、截图和公开隐私政策 URL。

官方参考：[商店 ZIP 要求](https://developer.chrome.com/docs/webstore/prepare)、[本地安装限制](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)、[CRX 签名与更新](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux)。
