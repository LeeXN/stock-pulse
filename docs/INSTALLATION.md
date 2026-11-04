# 安装与更新

从 [v1.4.0 Release](https://github.com/LeeXN/stock-pulse/releases/tag/v1.4.0) 下载对应安装包，或按下方构建命令在本地生成。

| 文件 | 使用方式 |
| --- | --- |
| `stock-pulse-v1.4.0-webstore.zip` | 商店上传包，直接上传到 Chrome Web Store Developer Dashboard，无需解压或重新压缩 |
| `stock-pulse-v1.4.0.crx` | 签名 CRX3 包，供允许商店外安装的环境使用 |
| `stock-pulse-v1.4.0-install.zip` | 本地验收包，解压后使用“加载已解压的扩展程序” |

## Chrome Web Store 发布与安装

1. 开发者在 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) 打开原有条目，上传 `stock-pulse-v1.4.0-webstore.zip`；首次上架才新建条目。
2. 包内 `manifest.json` 位于 ZIP 根目录，版本为 `1.4.0`；商店现有版本必须低于此版本。
3. 按 [商店文案与权限说明](CHROME_WEB_STORE_LISTING.md) 填写详情、隐私政策和截图，再提交审核。
4. 审核通过并发布后，普通用户从商店页面点击“添加至 Chrome”安装，已安装用户按商店更新流程升级。

生成上传包不会自动上架，也不会得到商店签名的安装包。商店签名 CRX 可在上传后从 Developer Dashboard 下载。

## 签名 CRX 安装

`.crx` 是 Chrome 扩展安装包。

Linux 等允许商店外安装的环境，可打开 `chrome://extensions/`、开启“开发者模式”，将 `stock-pulse-v1.4.0.crx` 拖入页面并按提示确认；托管环境须按管理员策略安装。

普通 Windows/macOS Chrome 不支持任意本地自签名 CRX 的直接安装。遇到“只能通过 Chrome 应用商店安装”时，应使用商店安装，或按下节流程进行发布前验收；更改文件后缀无法解除此限制。见 [Chrome 官方安装说明](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)。

CRX 沿用本地签名私钥以保持原 CRX 身份；它不代表商店签名，也不保证与以前的解压版使用同一扩展 ID。

## 发布前本地验收与更新

1. 解压 `stock-pulse-v1.4.0-install.zip`，打开附带的 `INSTALL.txt`。
2. Chrome 打开 `chrome://extensions/`，开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的 `stock-pulse-v1.4.0` 文件夹，确保文件夹内直接有 `manifest.json`。不能直接选择 ZIP 文件。
4. 点击工具栏中的 Stock Pulse 图标打开侧边栏。

更新现有解压版时，先在插件设置中导出备份，将新版运行文件覆盖到原扩展目录，再点击该扩展的“重新加载”。保留原扩展目录与身份，避免因更换扩展 ID 而读不到原持仓；更换安装方式或 ID 时需导入备份。

## 构建与校验

```bash
python3 scripts/build_release.py --crx
cd dist/v1.4.0
sha256sum -c SHA256SUMS
```

构建会生成上述三种包、解压目录、`SHA256SUMS`、`BUILD.json` 和发布说明。已有输出目录不会覆盖；同版本重建可指定 `--output-dir dist/v1.4.0-candidate-2`。

签名私钥保存在本机 `.local/release/chrome-signing-key.pem`，请保留它以便后续 CRX 更新。私钥、个人设置、API Key 和开发目录不进入发布包。维护者按 [发布流程](RELEASING.md) 提交 GitHub、创建 tag 和 Release。

## 从源码安装

```bash
git clone https://github.com/LeeXN/stock-pulse.git
cd stock-pulse
```

然后按上面的本地验收步骤选择仓库根目录。需要 Chrome 114 或更高版本。
