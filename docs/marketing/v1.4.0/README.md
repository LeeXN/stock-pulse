# Stock Pulse v1.4.0 宣传素材

主宣传语：**把市场信息，放在手边。**

素材来自正式发布的 v1.4.0 扩展：在全新的临时 Chrome Profile 中加载发布 ZIP，使用固定的虚构行情、汇率、持仓和交易数据；没有读取个人账户、真实持仓或 API Key。AI 截图中的文字明确标为演示，未向模型发送请求。`CAPTURE.json` 记录发布包哈希与截图哈希。

## 上传 Chrome Web Store

使用 `screenshots/` 中的前 5 张原图，尺寸都是 **1280×800**。它们展示真实界面，没有添加额外文案边框，推荐按编号排序。

| 顺序 | 文件 | 展示重点 |
| --- | --- | --- |
| 1 | [01-global-markets.png](screenshots/01-global-markets.png) | 全球指数、BTC/ETH 入口和市场图表 |
| 2 | [02-history-and-focus.png](screenshots/02-history-and-focus.png) | 更早历史、带年份的时间轴、收起区域 |
| 3 | [03-portfolio-daily-change.png](screenshots/03-portfolio-daily-change.png) | 今日涨跌幅、成本、市值与累计盈亏 |
| 4 | [04-return-comparison.png](screenshots/04-return-comparison.png) | 按交易和费用计算的收益对比 |
| 5 | [05-ai-skills.png](screenshots/05-ai-skills.png) | 三个内置 Skill 与补充指令，示例内容已标注 |

备用原图：

- [06-watchlist.png](screenshots/06-watchlist.png)：分组自选股与多市场标的。
- [07-import-preview.png](screenshots/07-import-preview.png)：CSV/TSV 导入前核对、修改。
- [08-expanded-list.png](screenshots/08-expanded-list.png)：收起图表后展示更多标的。

可根据宣传重点，用备用图替换前 5 张之一；商店最多展示 5 张，不要上传全部 8 张。

## 社区宣传与品牌图

- `social/`：5 张 **1280×800** 带文案宣传图，围绕实际截图排版，适合社区、社交分享和介绍文章。
- [small-440x280.png](promotional/small-440x280.png)：商店小宣传图，以原有图标和品牌为主。
- [marquee-1400x560.png](promotional/marquee-1400x560.png)：商店横幅，以品牌与实际界面为主。
- [PREVIEW.png](PREVIEW.png)：整套宣传图预览。
- `social/` 是宣传排版，不是插件新增界面。主宣传图中出现的功能均来自原始截图。

图片展示的是虚构演示数据，不应解读为历史价格、投资建议或收益承诺。商店图片尺寸与用途已按 [官方图片说明](https://developer.chrome.com/docs/webstore/images) 核对。

## 最新文字

- [STORE_DESCRIPTION_ZH.txt](STORE_DESCRIPTION_ZH.txt)：完整商店介绍，可直接粘贴。
- [COPYWRITING_ZH.md](COPYWRITING_ZH.md)：主宣传语、简介建议、更新说明、社区文案及搜索可见性建议。

旧版“不上传任何用户信息”的表述已修正。行情查询会向数据源发送必要请求，主动使用 AI/OCR 时会向用户所选服务商发送相关内容；自选、持仓、记录和设置保存在本地。

名称和简短说明来自扩展 manifest，建议的新文字需配合下一次版本上传；本次素材制作没有修改已发布的 v1.4.0 安装包。

## 复现截图

需要本机 Chrome、Python、Playwright 和 Pillow；请先安装对应依赖，再运行：

```bash
python3 scripts/capture_marketing.py \
  --package dist/v1.4.0-release/stock-pulse-v1.4.0-webstore.zip
python3 scripts/render_marketing.py
```

也可以将 `--package` 指向从 [v1.4.0 Release](https://github.com/LeeXN/stock-pulse/releases/tag/v1.4.0) 下载的商店 ZIP。截图脚本只修改临时 Profile，不访问个人浏览器配置，并拦截演示页面的外部请求。生成的图片会覆盖此素材目录中的同名文件。

素材 ZIP 也附带 `scripts/` 和原有图标。解压后如需独立复现，在素材文件夹执行：

```bash
python3 scripts/capture_marketing.py --package /实际路径/stock-pulse-v1.4.0-webstore.zip --output .
python3 scripts/render_marketing.py --assets . --icon icons/icon128.png
```

脚本中的 `marketing_fixture.js` 只用于宣传演示，不进入扩展运行包。
