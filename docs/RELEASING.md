# 构建、验收与 GitHub 发布

当前版本为 `1.4.0`。新版本先完成本地构建和验收，再提交 GitHub。版本号需同步更新 manifest、发布说明、CHANGELOG、README 和商店文案。

## 本地构建

```bash
python3 scripts/build_release.py --crx
cd dist/v1.4.0
sha256sum -c SHA256SUMS
```

- `*-webstore.zip`：商店上传包，`manifest.json` 在 ZIP 根目录。
- `*.crx`：本地签名 CRX3，安装受浏览器平台和策略限制。
- `*-install.zip`：解压加载用的验收包，内含安装说明。
- `BUILD.json`：版本、来源 HEAD、是否有未提交改动、运行文件哈希和产物哈希。
- `SHA256SUMS`：三个发布包的校验值。

已有输出目录不会覆盖。修改后重建同一版本时指定新目录，例如 `--output-dir dist/v1.4.0-candidate-2`，并明确交付哪一份。

用户确认前的候选包可以包含尚未提交的代码，`runtime_matches_git_head` 会为 `false`。正式 Release 附件应从最终合并提交重建，并核验该字段为 `true`。

签名使用 `.local/release/chrome-signing-key.pem`。保留该私钥可以保持后续本地 CRX 的扩展 ID；不应为了重建而更换密钥。商店扩展由商店签名，其身份以原商店条目为准。

## 用户确认后提交

1. 确认 `manifest.json`、README、CHANGELOG、商店文案和 `RELEASE_NOTES_v1.4.0.md` 的版本一致；将待发布状态更新为实际发布日期。
2. 从当前代码创建发布分支，只暂存本次功能、测试、打包与文档改动。不要提交 `dist/`、`.local/`、签名私钥、个人设置、旧 ZIP 或本地工具目录。
3. 使用清楚的 commit 信息，例如：

   ```text
   feat: add collapsible panels and historical K-lines (v1.4.0)

   Add collapsible market/chart panels and preserve list scroll position.
   Show daily portfolio changes and load earlier K-line history on demand.
   Prepare signed CRX, Web Store ZIP, and installation documentation.
   ```

4. 推送分支，通过 `gh pr create` 创建 PR；描述最终用户行为和实际验证结果。等待 CI 通过，再合并 PR。
5. 在最终合并提交上创建注释 tag `v1.4.0`，Release 标题为 `Stock Pulse v1.4.0 — 界面折叠与历史 K 线`。
6. 从最终提交重新构建，指定新目录，例如 `python3 scripts/build_release.py --crx --output-dir dist/v1.4.0-release`。检查 `BUILD.json` 中 `version` 为 `1.4.0`、`runtime_matches_git_head` 为 `true`，来源 HEAD 与 tag 一致。
7. 使用 `gh release create` 创建 GitHub Release，正文取自本版本发布说明，上传两个 ZIP、CRX、`SHA256SUMS` 和 `BUILD.json`。下载附件重新计算哈希，与本地构建逐个比较。

PR、tag、Release 和附件都完成并核验后，才能宣布 GitHub 发布完成。GitHub Release 不会自动上传 Chrome Web Store。

## Chrome Web Store

将 `*-webstore.zip` 上传到原有商店条目，填写 [商店文案](CHROME_WEB_STORE_LISTING.md)、截图和公开隐私政策 URL，再提交审核。新上传的版本号必须高于商店当前版本。

普通 Windows/macOS Chrome 的直接安装应通过商店；本地自签名 CRX 不保证可安装。发布前验收按 [安装说明](INSTALLATION.md#发布前本地验收与更新) 的解压加载流程进行。

官方参考：[打包要求](https://developer.chrome.com/docs/webstore/prepare)、[更新商店条目](https://developer.chrome.com/docs/webstore/update)、[本地安装限制](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)。
