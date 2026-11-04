/** Deterministic fictional market data for isolated screenshots; never queries live providers. */
(() => {
  const stocks = [
    ['SH:600519', '贵州茅台', 1688.50, 1.26],
    ['SZ:300750', '宁德时代', 268.30, -0.84],
    ['HK:00700', '腾讯控股', 428.60, 1.42],
    ['US:AAPL', '苹果', 228.40, -0.65],
    ['US:NVDA', '英伟达', 142.80, 2.18],
    ['SH:601318', '中国平安', 52.36, 0.73],
    ['SZ:000333', '美的集团', 72.85, -0.42],
    ['SH:600036', '招商银行', 39.62, 0.56],
    ['US:MSFT', '微软', 424.20, 0.93],
    ['US:TSLA', '特斯拉', 256.30, -1.37],
    ['HK:09988', '阿里巴巴-W', 102.40, 1.65],
    ['HK:01810', '小米集团-W', 28.15, -0.53],
    ['SZ:002594', '比亚迪', 286.80, 1.05],
    ['SH:601012', '隆基绿能', 21.48, -1.12],
    ['SH:600900', '长江电力', 28.16, 0.32],
    ['SZ:002415', '海康威视', 32.78, -0.76],
    ['US:AMZN', '亚马逊', 208.65, 1.13],
    ['US:GOOGL', '谷歌', 176.40, -0.38]
  ].map(([fullCode, name, price, changePercent]) => ({
    fullCode, name, price, changePercent, market: fullCode.split(':')[0], code: fullCode.split(':')[1]
  }));
  const indices = [
    ['1.000001','上证指数',3368.42,0.68], ['0.399001','深证成指',10826.35,1.16],
    ['0.399006','创业板指',2258.16,0.94], ['100.HSI','恒生指数',21680.45,-0.47],
    ['100.NDX','纳指100',20842.68,1.08], ['100.N225','日经225',39526.84,-0.36],
    ['100.GDAXI','DAX',19284.72,0.52]
  ].map(([secid,name,price,changePercent])=>({secid,name,price,changePercent,code:secid.split('.')[1]}));
  const crypto = [
    { fullCode:'CRYPTO:BTCUSDT',code:'BTC',market:'CRYPTO',name:'BTC / USDT',price:76284.60,changePercent:1.37 },
    { fullCode:'CRYPTO:ETHUSDT',code:'ETH',market:'CRYPTO',name:'ETH / USDT',price:2684.32,changePercent:-0.82 }
  ];
  const prefixes={SH:'1',SZ:'0',HK:'116',US:'105'};
  const secids=new Map(stocks.map(s=>[prefixes[s.market]+'.'+s.code,s]));
  indices.forEach(s=>secids.set(s.secid,s));
  const round=n=>Math.round(n*100)/100;
  const dates=[];
  for(let d=new Date('2026-11-04T12:00:00Z');dates.length<1900;d.setUTCDate(d.getUTCDate()-1)) {
    if(d.getUTCDay() && d.getUTCDay()!==6) dates.unshift(d.toISOString().slice(0,10));
  }
  const caches=new Map();
  function daily(stock) {
    if(caches.has(stock.code)) return caches.get(stock.code);
    const seed=[...stock.code].reduce((sum,c)=>sum+c.charCodeAt(0),0);
    const wave=i=>Math.exp(i*.00011 + Math.sin(i/24+seed)*.065 + Math.sin(i/67+seed)*.11 + Math.sin(i/5+seed)*.008);
    const anchor=wave(dates.length-1);
    const data=dates.map((time,i)=>{
      const close=round(stock.price*wave(i)/anchor);
      const open=round((i?stock.price*wave(i-1)/anchor:close)*(1+Math.sin(i*1.7+seed)*.006));
      return {time,open,close,high:round(Math.max(open,close)*(1+.004+Math.abs(Math.sin(i+seed))*.009)),low:round(Math.min(open,close)*(1-.004-Math.abs(Math.cos(i+seed))*.009)),volume:Math.round((150000+seed*170)*(1+Math.abs(Math.sin(i/8))*.8)),amount:0};
    });
    caches.set(stock.code,data);
    return data;
  }
  function bars(stock,period,count) {
    const rows=daily(stock);
    if(period==='101') return rows.slice(-count);
    const groups=new Map();
    for(const row of rows) {
      let key=row.time.slice(0,7);
      if(period==='102') { const d=new Date(row.time+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));key=d.toISOString().slice(0,10); }
      const bar=groups.get(key);
      if(bar) {bar.time=row.time;bar.close=row.close;bar.high=Math.max(bar.high,row.high);bar.low=Math.min(bar.low,row.low);bar.volume+=row.volume;}
      else groups.set(key,{...row});
    }
    return [...groups.values()].slice(-count);
  }
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  const nativeFetch=window.fetch.bind(window);
  window.__marketingDemo={stocks,indices,crypto,blocked:[]};
  window.fetch=async (input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.protocol.startsWith('http')) return nativeFetch(input,options);
    if(url.hostname==='api.frankfurter.app') return json({rates:{USD:1,CNY:7.20,HKD:7.80,JPY:150,KRW:1380,EUR:.92,TWD:32,INR:84,VND:25000}});
    if(url.hostname==='searchapi.eastmoney.com') {
      const q=url.searchParams.get('input')||'';
      return json({QuotationCodeTable:{Data:stocks.filter(s=>s.code.includes(q)||s.name.includes(q)).map(s=>({Code:s.code,Name:s.name,MktNum:prefixes[s.market],Classify:s.market==='HK'?'HK':s.market==='US'?'UsStock':'AStock',SecurityTypeName:s.market==='HK'?'港股':s.market==='US'?'美股':'沪A'}))}});
    }
    if(url.pathname.includes('ulist.np')) return json({data:{diff:(url.searchParams.get('secids')||'').split(',').map(id=>secids.get(id)).filter(Boolean).map(s=>({f12:s.code,f14:s.name,f2:round(s.price*100),f3:round(s.changePercent*100),f4:round((s.price-s.price/(1+s.changePercent/100))*100),f15:round(s.price/(1+s.changePercent/100)*100),f16:round(s.price*.985*100),f17:round(s.price*1.015*100)}))}});
    if(url.pathname.includes('/kline/get')) {
      const s=secids.get(url.searchParams.get('secid'))||stocks[0];
      const data=bars(s,url.searchParams.get('klt'),Number(url.searchParams.get('lmt'))||120);
      return json({rc:0,data:{klines:data.map(r=>[r.time,r.open,r.close,r.high,r.low,r.volume,r.close*r.volume,0,0,0,1].join(','))}});
    }
    if(url.pathname.includes('/stock/get')) {
      const s=secids.get(url.searchParams.get('secid'))||stocks[0];
      const scale=s.market==='HK'?1000:100;
      return json({rc:0,data:{f57:s.code,f58:s.name,f59:s.market==='HK'?3:2,f43:Math.round(s.price*scale),f60:Math.round(s.price/(1+s.changePercent/100)*scale),f46:Math.round(s.price*.993*scale),f44:Math.round(s.price*1.014*scale),f45:Math.round(s.price*.987*scale),f47:628400,f48:518400000,f169:Math.round((s.price-s.price/(1+s.changePercent/100))*scale),f170:Math.round(s.changePercent*100)}});
    }
    if(url.hostname==='api.binance.com') {
      const s=crypto.find(s=>s.fullCode.endsWith(url.searchParams.get('symbol')))||crypto[0];
      if(url.pathname.endsWith('/ticker/24hr')) return json({lastPrice:String(s.price),prevClosePrice:String(s.price/(1+s.changePercent/100)),openPrice:String(s.price*.995),highPrice:String(s.price*1.018),lowPrice:String(s.price*.978),volume:'12840',quoteVolume:'982400000',priceChange:String(s.price-s.price/(1+s.changePercent/100)),priceChangePercent:String(s.changePercent)});
      if(url.pathname.endsWith('/klines')) {
        const period=url.searchParams.get('interval')==='1w'?'102':url.searchParams.get('interval')==='1M'?'103':'101';
        let data=bars(s,period,1900);
        const end=Number(url.searchParams.get('endTime'));
        if(end) data=data.filter(r=>Date.parse(r.time)<=end);
        return json(data.slice(-Number(url.searchParams.get('limit')||120)).map(r=>[Date.parse(r.time),String(r.open),String(r.high),String(r.low),String(r.close),String(r.volume),Date.parse(r.time)+86400000,String(r.volume*r.close)]));
      }
    }
    window.__marketingDemo.blocked.push(url.origin+url.pathname);
    throw new Error('Demo capture blocks external requests: '+url.hostname);
  };
})();
