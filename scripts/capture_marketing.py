#!/usr/bin/env python3
"""Capture v1.4.0 UI in an isolated Chrome profile with fictional, deterministic data.

Requires Playwright and Pillow. Uses an existing release ZIP; never opens the user's profile.
"""
import argparse
import asyncio
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent

async def capture(args):
    output = args.output.resolve()
    shots = output / 'screenshots'
    shots.mkdir(parents=True, exist_ok=True)
    errors = []
    records = []
    with tempfile.TemporaryDirectory(prefix='stock-pulse-marketing-') as tmp:
        extension = Path(tmp) / 'extension'
        with zipfile.ZipFile(args.package) as archive:
            assert json.loads(archive.read('manifest.json'))['version'] == '1.4.0'
            assert all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in archive.namelist())
            archive.extractall(extension)
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                str(Path(tmp)/'profile'), executable_path=args.chrome, headless=True,
                ignore_default_args=['--disable-extensions'],
                viewport={'width':1024,'height':640}, device_scale_factor=1.25,
                args=['--no-sandbox','--enable-unsafe-extension-debugging'])
            await context.add_init_script(path=str(ROOT/'scripts/marketing_fixture.js'))
            cdp = await context.browser.new_browser_cdp_session()
            extension_id = (await cdp.send('Extensions.loadUnpacked',{'path':str(extension)}))['id']
            page = await context.new_page()
            page.on('pageerror',lambda error: errors.append(str(error)))
            await context.route('https://**/*',lambda route:route.abort())
            await page.goto(f'chrome-extension://{extension_id}/panel.html')
            await page.wait_for_selector('#toggleMarketBtn')
            await page.evaluate('''async () => {
              const demo=window.__marketingDemo;
              const portfolio=demo.stocks.slice(0,5).map((s,i)=>({...s,colorIndex:i,trades:[
                {id:'demo-buy-'+i,direction:'buy',price:Number((s.price*(i%2?1.08:.94)).toFixed(2)),quantity:i<2?100:50,date:'2026-06-01',time:'10:00',commission:5,stampTax:0,note:'演示交易',timestamp:Date.parse('2026-06-01T02:00:00Z')}
              ]}));
              const watchlist=[...demo.stocks,...demo.crypto].map((s,i)=>({...s,groupId:i<8?'core':'global',addedAt:Date.now()}));
              const settings={refreshInterval:0,klineCount:120,theme:'dark',quoteProvider:'eastmoney',klineProvider:'eastmoney',intlQuoteProvider:'eastmoney',intlKlineProvider:'eastmoney',llmVisionModel:'',llmApiKey:'',portfolioBaseCurrency:'CNY',timezoneMode:'exchange',marketIndices:['1.000001','0.399001','100.HSI','100.NDX','100.N225','100.GDAXI','CRYPTO:BTCUSDT','CRYPTO:ETHUSDT']};
              await chrome.storage.local.set({portfolio,watchlist,settings,stockGroups:[{id:'core',name:'核心关注'},{id:'global',name:'全球观察'}],currentStock:demo.stocks[0],chartLayout:{marketCollapsed:false,chartCollapsed:false,chartSummaryCollapsed:false}});
            }''')
            await page.reload()
            await page.wait_for_selector('#stockSummaryTable tbody tr')
            await page.wait_for_function('() => ChartManager.candleSeries?.data().length > 20')
            async def shot(name,feature):
                await page.mouse.move(1010,630)
                await page.wait_for_timeout(180)
                await page.evaluate("document.getElementById('marketTime').textContent='演示数据 · 非实时行情'")
                path=shots/name
                await page.screenshot(path=str(path),animations='disabled')
                records.append({'file':'screenshots/'+name,'feature':feature,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
                print('Captured',name,flush=True)
            await page.locator('[data-src=market]').click()
            await page.locator('.market-item[data-full-code="INDEX:100.NDX"]').click()
            await page.locator('#toggleSummaryBtn').click()
            await page.wait_for_function('() => ChartManager.candleSeries?.data().length === 120')
            await shot('01-global-markets.png','Global index K-lines and customizable market bar')
            await page.locator('#toggleMarketBtn').click()
            await page.locator('[data-period=weekly]').click()
            await page.wait_for_function('() => ChartManager._period === "weekly"')
            await page.locator('#chartHistoryBtn').click()
            await page.wait_for_function('() => ChartManager.candleSeries.data().length > 120')
            await page.evaluate('ChartManager.chart.timeScale().setVisibleLogicalRange({from:90,to:230})')
            await page.locator('[data-ind=boll]').click()
            await shot('02-history-and-focus.png','Earlier historical candles, visible years, and collapsed market/summary areas')
            await page.locator('[data-tab=portfolio]').click()
            await page.wait_for_selector('.pos-day-change')
            assert await page.locator('.pos-day-change').count()==5
            await shot('03-portfolio-daily-change.png','Daily changes, total P/L, costs, and trade records')
            await page.locator('[data-view=overlay]').click()
            await page.wait_for_function('() => Object.keys(ChartManager.overlaySeries).length >= 3')
            await shot('04-return-comparison.png','Actual holding returns calculated from trades and costs')
            await page.locator('[data-src=portfolio]').evaluate("e=>e.click()")
            await page.locator('[data-tab=chart]').click()
            await page.locator('#aiBtn').click()
            await page.wait_for_selector('#aiModal input[name=ai-skill]')
            await page.locator('input[name=ai-skill][value=stock-technicals]').check()
            await page.locator('#aiExtraPrompt').fill('重点解释均线与成交量，列出数据不足之处')
            await page.evaluate('''() => {
              document.getElementById('aiResultText').value='【演示内容，未调用模型】\\n\\n技术面解读会结合所选标的的行情、历史价格、均线与成交量，整理趋势、风险和需要继续核对的信息。\\n\\n可切换基本面速读、技术面解读、风险与机会，也可追加自己的关注点。\\n\\n实际输出取决于你配置的模型及可用数据，不构成投资建议。';
              document.getElementById('aiStatus').textContent='示例内容 · 未发送数据';
            }''')
            await shot('05-ai-skills.png','Three built-in AI Skills; visibly labeled illustrative text, no model request')
            await page.locator('#aiModal .modal-close').click()
            await page.locator('[data-tab=watchlist]').click()
            await page.wait_for_selector('.wl-row')
            await shot('06-watchlist.png','Grouped watchlist across stocks and crypto')
            await page.locator('[data-tab=portfolio]').click()
            await page.locator('[data-view=list]').click()
            await page.locator('#batchPortfolioBtn').click()
            await page.locator('#batchPortfolioInput').fill('日期,代码,方向,价格,数量,手续费,印花税,备注\n2026-10-28,600519,买入,1580,100,5,0,演示交易\n2026-10-29,00700,买入,416,100,5,0,演示交易')
            await page.locator('#batchPortfolioSubmit').click()
            await page.wait_for_selector('#batchPortfolioPreviewTable tbody tr')
            await shot('07-import-preview.png','Editable CSV/TSV trade preview before confirmation')
            await page.locator('#batchPortfolioModal .modal-close').click()
            await page.locator('[data-tab=chart]').click()
            await page.locator('[data-src=watchlist]').click()
            if await page.locator('#toggleSummaryBtn').text_content()=='展开':
                await page.locator('#toggleSummaryBtn').click()
            await page.locator('#toggleChartBtn').click()
            await page.wait_for_selector('#stockSummaryTable tbody tr')
            await shot('08-expanded-list.png','Expanded instrument list after collapsing the chart')
            assert not errors,errors
            await context.close()
    manifest={'version':'1.4.0','source_commit':'71c4c261e131bf6a08459727ebc1875b17aeb377','package_sha256':hashlib.sha256(args.package.read_bytes()).hexdigest(),'capture':'real Chrome extension with synthetic network responses','data':'Fictional quotes, holdings, trades and FX. AI sample is static and labeled; no model request, credentials or user profile.','size':[1280,800],'screenshots':records,'page_errors':errors}
    (output/'CAPTURE.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,default=ROOT/'dist/v1.4.0-release/stock-pulse-v1.4.0-webstore.zip')
    parser.add_argument('--output',type=Path,default=ROOT/'docs/marketing/v1.4.0')
    parser.add_argument('--chrome',default='/usr/bin/google-chrome')
    asyncio.run(capture(parser.parse_args()))
