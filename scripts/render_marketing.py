#!/usr/bin/env python3
"""Render marketing layouts around real screenshots, plus two branded Web Store tiles."""
import argparse
import asyncio
import base64
import html
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent.parent
SCENES=[
 ('01-global-markets','全球行情，\n随手打开就看','在浏览器里跟踪指数与数字资产，\n选中标的，即可查看价格与走势。','全球指数 / BTC · ETH / 多周期', '01-global-markets.png'),
 ('02-historical-data','向前看，\n不止半年行情','拖动图表加载更早历史。\n周、月、年周期带年份，跨年更清楚。','历史加载 / 技术指标 / 自由折叠', '02-history-and-focus.png'),
 ('03-portfolio','今日涨跌，\n持仓盈亏一起看','均价、市值、交易记录集中查看。\n分清当天波动与累计盈亏。','持仓管理 / 今日涨跌 / 多币种', '03-portfolio-daily-change.png'),
 ('04-return-comparison','你的收益，\n按真实交易算','结合买卖记录与费用计算收益，\n也能切换查看标的价格表现。','实际收益 / 价格表现 / 标的对比', '04-return-comparison.png'),
 ('05-ai-skills','把关注点，\n交给你的 AI','基本面速读、技术面解读、风险与机会。\n连接自选模型，补充你关心的问题。','三个内置 Skill / 自定义指令', '05-ai-skills.png'),
]

def data(path):
 return 'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()

BASE='''*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif;color:#edf6ff;background:#071427}.brand{display:flex;align-items:center;gap:12px;font-weight:650;letter-spacing:-.8px}.brand img{width:42px;height:42px}.muted{color:#8babc3}.grid{position:absolute;inset:0;background-image:linear-gradient(#28425a30 1px,transparent 1px),linear-gradient(90deg,#28425a30 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(90deg,transparent,#000)}'''

async def main(args):
 OUT=args.assets.resolve()
 promo=OUT/'promotional';social=OUT/'social';promo.mkdir(exist_ok=True);social.mkdir(exist_ok=True)
 logo=data(args.icon)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
  page=await browser.new_page(device_scale_factor=1)
  async def render(name,width,height,content,css):
   await page.set_viewport_size({'width':width,'height':height})
   await page.set_content(f'<!doctype html><meta charset="utf-8"><style>{BASE}{css}</style>{content}')
   await page.evaluate('document.fonts.ready')
   await page.screenshot(path=str(name),animations='disabled')
   print('Rendered',name.name,flush=True)
  for index,(name,title,description,tags,shot) in enumerate(SCENES,1):
   content=f'''<div class="grid"></div><div class="glow"></div><header><div class="brand"><img src="{logo}">Stock Pulse</div><span class="version">CHROME EXTENSION · v1.4.0</span></header><main><div class="copy"><div class="number">0{index} / 05</div><h1>{html.escape(title).replace(chr(10),'<br>')}</h1><p>{html.escape(description).replace(chr(10),'<br>')}</p><div class="tags">{html.escape(tags)}</div></div><div class="screen"><img src="{data(OUT/'screenshots'/shot)}"></div></main><footer><span>股票行情 · K线 · 持仓管理</span><span>实际扩展界面 · 演示数据，非实时行情{(' · AI 内容为示例' if index==5 else '')}</span></footer>'''
   css='''body{background:linear-gradient(120deg,#071427,#0d2238)}header{position:absolute;top:42px;left:48px;right:48px;display:flex;justify-content:space-between;align-items:center}.brand{font-size:27px}.version{font:12px Arial;letter-spacing:2px;color:#8ca5bb}.glow{position:absolute;right:-220px;top:60px;width:800px;height:800px;background:radial-gradient(ellipse,#166c8240,transparent 64%)}main{position:absolute;top:182px;left:48px;right:0;display:flex;align-items:center;gap:28px}.copy{width:312px;flex-shrink:0}.number{font:12px Arial;letter-spacing:3px;color:#53c8f7;margin-bottom:28px}h1{font-size:41px;line-height:1.48;letter-spacing:-1.6px;margin:0 0 25px;font-weight:700}p{font-size:15px;line-height:1.95;color:#a6bed1;margin:0}.tags{margin-top:36px;color:#65cee9;font-size:11px;letter-spacing:.7px}.screen{width:860px;flex-shrink:0;border:1px solid #41627c;box-shadow:0 28px 90px #0006}.screen img{display:block;width:860px;height:auto}footer{position:absolute;bottom:33px;left:48px;right:48px;display:flex;justify-content:space-between;font-size:11px;color:#7896ad}.grid{opacity:.5}'''
   await render(social/(name+'.png'),1280,800,content,css)
  candles=''.join(f'<i style="--h:{40+(i*47)%130}px;--y:{50+(i*17)%85}px;--c:{"#4fc3f7" if i%3 else "#ef5350"}"></i>' for i in range(14))
  await render(promo/'small-440x280.png',440,280,f'''<div class="grid"></div><div class="halo"></div><img class="icon" src="{logo}"><h1>Stock Pulse</h1><div class="candles">{candles}</div>''','''body{background:linear-gradient(130deg,#08182d,#103753)}.halo{position:absolute;width:250px;height:250px;top:-50px;left:-30px;background:radial-gradient(#38c9f735,transparent 68%)}.icon{position:absolute;width:116px;height:116px;left:36px;top:42px;z-index:2}h1{position:absolute;left:36px;bottom:34px;margin:0;font:600 36px Arial;letter-spacing:-1.3px;z-index:2}.candles{position:absolute;right:13px;top:17px;display:flex;gap:9px;transform:rotate(-12deg);opacity:.35}.candles i{display:block;position:relative;width:10px;height:var(--h);background:var(--c);margin-top:var(--y)}.candles i:after{content:"";position:absolute;left:4px;top:-18px;bottom:-14px;width:2px;background:var(--c)}''')
  await render(promo/'marquee-1400x560.png',1400,560,f'''<div class="grid"></div><div class="brand"><img src="{logo}">Stock Pulse</div><div class="words">市场信息，<br>就在手边。</div><div class="tags">股票行情 · K线 · 持仓管理</div><div class="screen"><img src="{data(OUT/'screenshots/01-global-markets.png')}"></div><div class="demo">演示数据 · 非实时行情</div>''','''body{background:linear-gradient(120deg,#071427,#0f3650)}.brand{position:absolute;left:60px;top:59px;font-size:34px}.brand img{width:57px;height:57px}.words{position:absolute;top:174px;left:60px;font-size:53px;line-height:1.5;font-weight:700;letter-spacing:-2px}.tags{position:absolute;left:64px;bottom:72px;font-size:16px;color:#9cbbd1;letter-spacing:2px}.screen{position:absolute;left:550px;top:22px;width:810px;box-shadow:0 25px 70px #0006;border:1px solid #527793}.screen img{display:block;width:810px}.demo{position:absolute;right:44px;bottom:13px;font-size:11px;color:#94afc3}''')
  await browser.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--assets',type=Path,default=ROOT/'docs/marketing/v1.4.0')
 parser.add_argument('--icon',type=Path,default=ROOT/'icons/icon128.png')
 asyncio.run(main(parser.parse_args()))
