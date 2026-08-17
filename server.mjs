import http from 'node:http'
import nodemailer from 'nodemailer'
import {aStockLimitPool,aStockTencentQuotes,aStockTencentKline,aStockEastmoneyKline,aStockBaiduKline,aStockThsLimitReasons} from './a-stock-data.mjs'

const port=Number(process.env.PORT||5201)
const tushareToken=process.env.TUSHARE_TOKEN||''
const tushareUrl=(process.env.TUSHARE_HTTP_URL||'http://api.tushare.pro').replace(/\/$/,'')
const xiaoshiKey=process.env.SHIZIXI_API_KEY||''
const xiaoshiBase='https://api.shizixi.com'
const serpApiKey=process.env.SERPAPI_KEY||''
const mailTo=process.env.MAIL_TO||''
let lastPushDate=''

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data))}
const ymd=()=>new Date().toISOString().slice(0,10).replaceAll('-','')
const daysAgoYmd=days=>{const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10).replaceAll('-','')}
const dateValue=v=>{const s=String(v||'').replace(/\D/g,'').slice(0,8);return s.length===8?Number(s):0}
const normalizeBars=bars=>[...new Map((Array.isArray(bars)?bars:[]).map(b=>[dateValue(b.trade_date||b.date||b.datetime||b.time),b]).filter(([d])=>d)).entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b)
const isFreshTimestamp=(value,maxHours=18)=>{const t=Date.parse(value);return Number.isFinite(t)&&Date.now()-t>=0&&Date.now()-t<=maxHours*3600000}
const isSessionTimestamp=(value,session)=>dateValue(value)===Number(session)
const limitThreshold=(code,name='')=>/(ST|退)/i.test(name)?4.8:(String(code).includes('.BJ')?29.5:(String(code).startsWith('30')||String(code).startsWith('68')?19.5:9.5))
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));return out}
async function tushare(api_name,params,fields){
  if(!tushareToken) throw Error('未配置 TUSHARE_TOKEN')
  const r=await fetch(tushareUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_name,token:tushareToken,params,fields})})
  const j=await r.json(); if(j.code!==0) throw Error(j.msg||`Tushare ${api_name} 失败`)
  const fs=j.data?.fields||[]; return (j.data?.items||[]).map(row=>Object.fromEntries(fs.map((f,i)=>[f,row[i]])))
}
async function xiaoshi(path,options={}){
  if(!xiaoshiKey) throw Error('未配置 SHIZIXI_API_KEY')
  const r=await fetch(`${xiaoshiBase}${path}`,{...options,headers:{Authorization:`Bearer ${xiaoshiKey}`,'Content-Type':'application/json',...(options.headers||{})}})
  if(r.status===429) throw Error(`小石限流，Retry-After=${r.headers.get('retry-after')||'unknown'}`)
  if(!r.ok) throw Error(`小石请求失败 HTTP ${r.status}`)
  return r.json()
}
function normalizeCode(v){return String(v||'').replace(/\.(SZ|SH|BJ)$/i,'')}
function eastmoneySecid(value){const code=normalizeCode(value);return `${code.startsWith('6')?'1':'0'}.${code}`}
async function eastmoneyQuote(code){
  const fields='f43,f57,f58,f59,f60,f124,f170'; const r=await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecid(code)}&fields=${fields}`)
  if(!r.ok) throw Error(`东方财富行情 HTTP ${r.status}`); const d=(await r.json())?.data; if(!d) throw Error('东方财富行情为空')
  const scale=10**Number(d.f59??2); return {symbol:d.f57,name:d.f58,price:Number(d.f43)/scale,previous_close:Number(d.f60)/scale,change_pct:Number(d.f170)/100,market:'CN',instrument:'stock',observed_at:d.f124?new Date(Number(d.f124)*1000).toISOString():null,provider:'Eastmoney'}
}
async function eastmoneyKline(code,limit=20){
  const fields1='f1,f2,f3,f4,f5,f6'; const fields2='f51,f52,f53,f54,f55,f56,f57,f61'; const r=await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${eastmoneySecid(code)}&klt=101&fqt=0&lmt=${limit}&end=20500101&fields1=${fields1}&fields2=${fields2}`)
  if(!r.ok) throw Error(`东方财富日线 HTTP ${r.status}`); const rows=(await r.json())?.data?.klines||[]
  return rows.map(v=>{const a=String(v).split(',');return {date:a[0],open:Number(a[1]),close:Number(a[2]),high:Number(a[3]),low:Number(a[4]),volume:Number(a[5]),amount:Number(a[6]),provider:'Eastmoney'}})
}
async function serpNews(code,name){
  if(!serpApiKey) return []
  const end=Math.floor(Date.now()/1000); const start=end-7*24*60*60
  const params=new URLSearchParams({engine:'baidu',q:`${name} ${code} 股票 公告 政策 题材`,api_key:serpApiKey,ct:'2',rn:'10',gpc:`stf=${start},${end}|stftype=1`,no_cache:'true',output:'json'})
  const r=await fetch(`https://serpapi.com/search.json?${params}`)
  if(!r.ok) throw Error(`SerpAPI HTTP ${r.status}`)
  const j=await r.json(); if(j.error) throw Error(`SerpAPI: ${j.error}`)
  const seen=new Set(); const items=[...(j.news_results||[]),...(j.organic_results||[])]
  return items.map(x=>({title:x.title||'',link:x.link||'',snippet:x.snippet||x.summary||'',source:x.source||x.displayed_link||'百度',published_at:x.date||x.published_date||null,provider:'SerpAPI/Baidu'})).filter(x=>x.title&&x.link&&!seen.has(x.link)&&seen.add(x.link)).slice(0,5)
}
async function aStockPrimaryPool(endDate){
  let dates=[]
  try{dates=(await tushare('trade_cal',{exchange:'SSE',start_date:daysAgoYmd(35),end_date:endDate,is_open:'1'},'cal_date,is_open')).map(x=>x.cal_date).sort().reverse()}catch{
    for(let i=0;i<35;i++){const d=new Date();d.setUTCDate(d.getUTCDate()-i);if(d.getUTCDay()>0&&d.getUTCDay()<6)dates.push(d.toISOString().slice(0,10).replaceAll('-',''))}
  }
  const sessions=[],pool=[],reasons=new Map()
  for(const d of dates){if(sessions.length===10)break;const result=await aStockLimitPool(d);if(!result.available)continue;sessions.push(d);pool.push(...result.rows)}
  sessions.sort();if(sessions.length<10)throw Error(`a-stock-data仅取得${sessions.length}个完整交易日`)
  await Promise.all(sessions.slice(-6,-1).map(async d=>{try{const m=await aStockThsLimitReasons(d);for(const [code,value] of m)reasons.set(`${d}:${code}`,value)}catch{}}))
  const latestByCode=new Map();pool.sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date))).forEach(x=>latestByCode.set(x.ts_code,x))
  const rows=[...latestByCode.values()].map(x=>{const poolDates=pool.filter(p=>p.ts_code===x.ts_code).map(p=>p.trade_date).sort();const reason=reasons.get(`${poolDates.at(-1)}:${normalizeCode(x.ts_code)}`);return {...x,...reason,pool_limit_dates:poolDates}}).filter(x=>{const age=sessions.length-1-sessions.indexOf(x.pool_limit_dates.at(-1));return age>=1&&age<=5})
  return {date:sessions.at(-1),rows}
}
async function recommendations(){
  let date=ymd(); let source='a-stock-data',fallback=false,fallbackReason='',poolVerified=false; let rows=[]
  try{
    const primary=await aStockPrimaryPool(date);date=primary.date;rows=primary.rows;poolVerified=true
  }catch(e){
    try {
      const pool=await tushare('limit_list_d',{start_date:daysAgoYmd(20),end_date:date,limit_type:'U'},'ts_code,trade_date,name,close,pct_chg,amount,open_times,up_stat')
      const sessions=[...new Set(pool.map(x=>x.trade_date))].sort().slice(-10);date=sessions.at(-1)||date;const latestByCode=new Map();pool.filter(x=>sessions.includes(x.trade_date)).sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date))).forEach(x=>latestByCode.set(x.ts_code,x))
      rows=[...latestByCode.values()].map(x=>({...x,pool_limit_dates:pool.filter(p=>p.ts_code===x.ts_code&&sessions.includes(p.trade_date)).map(p=>p.trade_date).sort()})).filter(x=>{const age=sessions.length-1-sessions.indexOf(x.pool_limit_dates.at(-1));return age>=1&&age<=5});poolVerified=sessions.length===10
      source='Tushare fallback';fallback=true;fallbackReason=`a-stock-data不可用：${e.message}`
    } catch(dailyError) {
    source='Xiaoshi fallback'; fallback=true; fallbackReason=`a-stock-data：${e.message}; Tushare：${dailyError.message}`
    try{
      const q=await xiaoshi(`/api/v3/market/quotes?market=CN&instrument=stock&limit=200`)
      const list=q?.data||q?.quotes||[]
      rows=list.filter(x=>Number(x.change_pct??x.pct_chg)>=9.5).map(x=>({ts_code:x.symbol||x.code,name:x.name,close:x.price,pct_chg:x.change_pct,amount:x.amount,trade_date:date,open_times:0,up_stat:'首板'}))
    }catch(x){return {date,source:'unavailable',fallback:true,fallbackReason:`Tushare: ${e.message}; Xiaoshi: ${x.message}`,recommendations:[],watch:[],updatedAt:new Date().toISOString()}}
    }
  }
  rows.sort((a,b)=>String(b.trade_date).localeCompare(String(a.trade_date))||Number(b.amount||0)-Number(a.amount||0))
  let primaryQuotes={};try{primaryQuotes=await aStockTencentQuotes(rows.map(x=>x.ts_code))}catch{}
  const result=await mapLimit(rows,12,async x=>{
    const code=normalizeCode(x.ts_code); let quote=null,bars=[],liquidityBars=[],announcements=[],minute=[],realtimeNews=[]; const providers={pool:source,quote:null,kline:null,liquidity:null,theme:x.reason?'a-stock-data/THS':null,announcements:null,news:null,intraday:null}
    quote=primaryQuotes[code]&&!primaryQuotes[code].is_stale?primaryQuotes[code]:null;if(quote)providers.quote='a-stock-data/Tencent'
    if(!quote)try { const q=await xiaoshi(`/api/v3/market/quote/${code}?market=CN&instrument=stock`); quote=q?.data||q?.quote||q; if(quote)providers.quote='Xiaoshi' } catch {}
    if(!quote||!Number(quote?.price??quote?.last)){try{quote=await eastmoneyQuote(code);providers.quote='Eastmoney'}catch{}}
    try { bars=normalizeBars(await aStockTencentKline(code,30));if(bars.length)providers.kline='a-stock-data/Tencent qfq' } catch {}
    if(bars.length<20)try { bars=normalizeBars(await aStockBaiduKline(code));if(bars.length)providers.kline='a-stock-data/Baidu' } catch {}
    if(bars.length<20)try { const k=await xiaoshi(`/api/v3/data/kline/${code}?market=CN&instrument=stock&period=daily&adjust=none&limit=20`); bars=normalizeBars(k?.data||k?.bars||[]); if(bars.length)providers.kline='Xiaoshi' } catch {}
    if(bars.length<20){try{bars=await eastmoneyKline(code,20);if(bars.length)providers.kline='Eastmoney'}catch{}}
    bars=normalizeBars(bars).filter(b=>dateValue(b.trade_date||b.date)<=Number(date))
    const closes=bars.map(b=>Number(b.close??b.c??b[4])).filter(Number.isFinite)
    const price=Number(quote?.price??quote?.last??x.close); const codeText=String(x.ts_code||code)
    const limitPct=limitThreshold(codeText,quote?.name||x.name)
    const historyBars=bars.slice(-11); const recentBars=historyBars.slice(-10)
    const limitHits=recentBars.map((b,i)=>{const close=Number(b.close??b.c??b[4]);const prev=Number(historyBars[i]?.close??historyBars[i]?.c??historyBars[i]?.[4]);const pct=prev>0?(close/prev-1)*100:Number(b.pct_chg??b.change_pct??b.pct??0);return {index:i,date:b.trade_date||b.date,pct,isLimit:pct>=limitPct}}).filter(x=>x.isLimit)
    const limitDates=limitHits.map(x=>x.date).filter(Boolean); const limitCount=limitDates.length; const recent10=limitCount>0
    const priorLimit=[...limitHits].reverse().find(x=>x.index<recentBars.length-1); const postLimitBars=priorLimit?recentBars.slice(priorLimit.index+1):[]
    const limitBar=priorLimit?recentBars[priorLimit.index]:null; const limitPeak=Number(limitBar?.high??limitBar?.close??limitBar?.c??limitBar?.[2])
    const postLimitLow=postLimitBars.length?Math.min(...postLimitBars.map(b=>Number(b.low??b.close??b.c??b[3])).filter(Number.isFinite)):NaN
    const pullbackPct=limitPeak>0&&Number.isFinite(postLimitLow)?((limitPeak-postLimitLow)/limitPeak)*100:0
    const barVolume=b=>Number(b?.volume??b?.vol??b?.v??b?.[5]); const barAmount=b=>Number(b?.amount??b?.turnover??b?.[6])
    const troughIndex=postLimitBars.findIndex(b=>Number(b.low??b.close??b.c??b[3])===postLimitLow); const pullbackLeg=troughIndex>=0?postLimitBars.slice(0,troughIndex+1):postLimitBars
    const limitVolume=barVolume(limitBar); const postVolumes=pullbackLeg.map(barVolume).filter(v=>Number.isFinite(v)&&v>0)
    const pullbackAvgVolume=postVolumes.length?postVolumes.reduce((a,b)=>a+b,0)/postVolumes.length:NaN
    const volumeContracted=Number.isFinite(limitVolume)&&limitVolume>0&&Number.isFinite(pullbackAvgVolume)?pullbackAvgVolume<=limitVolume*.9:false
    const recoveryRatio=limitPeak>postLimitLow?Math.max(0,Math.min(1,(price-postLimitLow)/(limitPeak-postLimitLow))):0
    const shortWindow=postLimitBars.length>=1&&postLimitBars.length<=5
    const pullback=Boolean(priorLimit)&&shortWindow&&pullbackPct>=2&&pullbackPct<=18&&recoveryRatio>=.35&&price<=limitPeak*1.03
    const quoteTimestamp=quote?.observed_at||quote?.timestamp; const quoteIdentity=normalizeCode(quote?.symbol||quote?.code||code)===code&&(!quote?.market||quote.market==='CN')&&(!quote?.instrument||quote.instrument==='stock')
    const quoteFresh=isFreshTimestamp(quoteTimestamp)||isSessionTimestamp(quoteTimestamp,date); const quoteOk=Number.isFinite(price)&&price>0&&quoteFresh&&quoteIdentity
    if(poolVerified&&recent10&&pullback&&quoteOk)try { liquidityBars=await aStockEastmoneyKline(code,3); if(liquidityBars.length)providers.liquidity='a-stock-data/Eastmoney (CNY)' } catch {}
    const recentAmounts=liquidityBars.slice(-3).map(barAmount).filter(v=>Number.isFinite(v)&&v>0); const avgAmount3=recentAmounts.length===3?recentAmounts.reduce((a,b)=>a+b,0)/recentAmounts.length:NaN
    const liquid=Number.isFinite(avgAmount3)&&avgAmount3>=100000000
    const technicalPass=poolVerified&&recent10&&pullback&&liquid&&quoteOk
    if(technicalPass){
      try { const a=await xiaoshi(`/api/v3/stock/announcements/${code}?days=30&page=1&page_size=20`); announcements=Array.isArray(a?.data)?a.data:[]; if(announcements.length)providers.announcements='Xiaoshi' } catch {}
      try { realtimeNews=await serpNews(code,quote?.name||x.name||code); if(realtimeNews.length)providers.news='SerpAPI/Baidu' } catch {}
      try { const m=await xiaoshi(`/api/v3/stock/kline/${code}?market=CN&period=1min&adjust=none&limit=240`); minute=Array.isArray(m?.data)?m.data:(Array.isArray(m?.bars)?m.bars:[]); if(minute.length)providers.intraday='Xiaoshi' } catch {}
    }
    const generic=/(风险提示|异常波动|回购注销|董事会|会议决议|人事变动)/; const catalyst=/(中标|签约|政策|订单|业绩|重组|收购|涨价|产业|项目|获批|合作|投产)/
    const limitTime=Date.parse(String(priorLimit?.date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')); const nearLimit=d=>{const t=Date.parse(d);return Number.isFinite(t)&&Number.isFinite(limitTime)&&Math.abs(t-limitTime)<=14*86400000}
    const companyName=quote?.name||x.name||''
    const announcementEvidence=announcements.find(a=>nearLimit(a.publish_time||a.date||a.ann_date)&&!generic.test(a.title||'')&&catalyst.test(`${a.title||''} ${a.summary||''}`))
    const newsEvidence=realtimeNews.find(n=>nearLimit(n.published_at)&&catalyst.test(`${n.title} ${n.snippet}`)&&(String(n.title).includes(code)||String(n.snippet).includes(code)||(companyName&&String(n.title).includes(companyName))))
    const poolThemeEvidence=x.reason?{type:'limit-up-reason',title:x.reason,time:x.pool_limit_dates?.at(-1)||null,source:'a-stock-data/THS',board_type:x.board_type||null,seal_rate:Number.isFinite(x.seal_rate)?x.seal_rate:null}:null
    const theme=Boolean(poolThemeEvidence||announcementEvidence||newsEvidence)
    const minuteTimestamp=minute.at(-1)?.datetime||minute.at(-1)?.time||minute.at(-1)?.timestamp||minute.at(-1)?.date; const intradayFresh=minute.length>0&&(isFreshTimestamp(minuteTimestamp,8)||isSessionTimestamp(minuteTimestamp,date))
    const openTimes=Number(x.open_times); const scoreBreakdown={theme_event:theme?25:0,pullback_rebound:pullback?20+(volumeContracted?5:0):0,stock_character:Math.min(20,8+limitCount*4+(Number.isFinite(openTimes)?Math.max(0,4-openTimes):0)),liquidity:liquid?15:0,market_confirmation:quoteOk&&intradayFresh?15:0}
    const total=Object.values(scoreBreakdown).reduce((a,b)=>a+b,0); const eligible=technicalPass&&total>=78&&theme&&intradayFresh
    const stopLoss=Number.isFinite(postLimitLow)?Number((postLimitLow*.99).toFixed(2)):null; const risk=stopLoss&&price>stopLoss?price-stopLoss:NaN
    const takeProfit1=Number(Math.max(limitPeak||0,price+(Number.isFinite(risk)?risk*1.5:price*.08)).toFixed(2)); const takeProfit2=Number(Math.max(price*1.15,price+(Number.isFinite(risk)?risk*2.5:price*.15)).toFixed(2))
    return {code:x.ts_code,name:quote?.name||x.name||x.ts_code,price:quoteOk?price:null,limit_up_count:limitCount,limit_up_dates:limitDates.length?limitDates:(x.pool_limit_dates||[]),score:total,score_breakdown:scoreBreakdown,status:eligible?'推荐':'观察',source,providers,trade_date:date,quote_timestamp:quote?.observed_at||quote?.timestamp||null,theme_evidence:poolThemeEvidence||(announcementEvidence?{type:'announcement',title:announcementEvidence.title,time:announcementEvidence.publish_time||announcementEvidence.date||null,source:providers.announcements}:newsEvidence?{type:'news',...newsEvidence}:null),related_news:realtimeNews,checks:{pool:poolVerified?'近10交易日完整池':'候选池不完整',recent_limit_up:recent10?'已核验':'近10日无涨停',pullback:pullback?'涨停后短回调与修复通过':(priorLimit?'涨停后回调窗口/幅度/修复不通过':'只有当日涨停，尚无板后回调'),volume:volumeContracted?'回调阶段缩量':'回调缩量未确认',liquidity:liquid?'近3日成交额通过':'近3日成交额不足或缺失',theme:theme?'有临近涨停日的事件证据':'待正宗题材归因',quote:quoteOk?'行情新鲜':'行情缺失或过期',intraday:intradayFresh?'当日分时新鲜':'分时缺失或过期'},technical:{bars:closes.length,prior_limit_date:priorLimit?.date||null,post_limit_days:postLimitBars.length,pullback_low:Number.isFinite(postLimitLow)?postLimitLow:null,pullback_pct:Number(pullbackPct.toFixed(2)),recovery_ratio:Number((recoveryRatio*100).toFixed(2)),volume_contracted:volumeContracted,avg_amount_3d:Number.isFinite(avgAmount3)?Number(avgAmount3.toFixed(0)):null,minute_bars:minute.length},missing_fields:[...(poolVerified?[]:['完整近10交易日涨停池']),...(recent10?[]:['近10日涨停历史']),...(pullback?[]:['涨停后1-5日短回调与至少35%修复']),...(volumeContracted?[]:['回调缩量']),...(liquid?[]:['近3日日均成交额≥1亿元']),...(theme?[]:['涨停附近的正宗题材/触发事件']),...(quoteOk?[]:['新鲜行情快照']),...(intradayFresh?[]:['新鲜1分钟分时'])],trade_plan:quoteOk?{entry_trigger:'不追高；回踩不破修复位并重新放量，且板块强度未退潮时再确认',entry_reference:price,take_profit_1:takeProfit1,take_profit_2:takeProfit2,stop_loss:stopLoss,risk_reward_1:Number.isFinite(risk)&&risk>0?Number(((takeProfit1-price)/risk).toFixed(2)):null,risk_reward_2:Number.isFinite(risk)&&risk>0?Number(((takeProfit2-price)/risk).toFixed(2)):null,invalidation:['跌破涨停后回调低点','行情或分时过期','近3日流动性跌破门槛','题材证据被证伪','板块退潮']} : null}
  })
  return {date,source,fallback,fallbackReason,poolVerified,total:rows.length,recommendations:result.filter(x=>x.status==='推荐').sort((a,b)=>b.score-a.score).slice(0,3),watch:result.filter(x=>x.status==='观察').sort((a,b)=>b.score-a.score).slice(0,12),updatedAt:new Date().toISOString(),strategy:'ai-stock-pick-v3'}
}
async function pushRecommendations(data){
  if(!data.recommendations?.length) return {sent:false,reason:'无正式推荐'}
  if(lastPushDate===data.date) return {sent:false,reason:'今日已推送'}
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS||!mailTo) throw Error('未配置 SMTP_USER、SMTP_PASS 或 MAIL_TO')
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.qq.com',port:Number(process.env.SMTP_PORT||465),secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})
  const rows=data.recommendations.map(x=>`<tr><td>${x.name}<br>${x.code}</td><td>${x.limit_up_dates.join('<br>')}</td><td>${x.technical.prior_limit_date||'—'} / ${x.technical.post_limit_days}日 / ${x.technical.pullback_pct}%</td><td>${x.trade_plan.entry_reference}</td><td>${x.trade_plan.take_profit_1} / ${x.trade_plan.take_profit_2}</td><td>${x.trade_plan.stop_loss}</td><td>${x.trade_plan.entry_trigger}</td></tr>`).join('')
  await transporter.sendMail({from:process.env.SMTP_USER,to:mailTo,subject:`ai-stock-pick 推荐｜${data.date}`,html:`<h2>涨停复制推荐</h2><p>数据源：${data.source}</p><table border="1" cellpadding="8" cellspacing="0"><tr><th>股票</th><th>近10日涨停</th><th>前次涨停/回调</th><th>参考价</th><th>止盈</th><th>止损</th><th>触发条件</th></tr>${rows}</table><p>仅为策略筛选，不构成投资建议。</p>`})
  lastPushDate=data.date; return {sent:true,to:mailTo.replace(/^(.{3}).*(@.*)$/,'$1***$2')}
}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/health') return json(res,200,{ok:true,service:'ai-stock-pick-data',version:'1.4.0-a-stock-data-primary',sources:{a_stock_data:true,tushare:Boolean(tushareToken),xiaoshi:Boolean(xiaoshiKey),serpapi:Boolean(serpApiKey),eastmoney:true}})
  if(req.url==='/api/recommendations') try{return json(res,200,await recommendations())}catch(e){return json(res,500,{error:e.message})}
  if(req.url==='/api/push') try{const data=await recommendations();return json(res,200,{...(await pushRecommendations(data)),count:data.recommendations.length,date:data.date})}catch(e){return json(res,500,{error:e.message})}
  json(res,404,{error:'Not found'})
})
if(process.env.NODE_ENV!=='test'&&process.env.RUN_ONCE==='true'){
  try{
    const data=await recommendations(); const push=await pushRecommendations(data)
    console.log(JSON.stringify({date:data.date,source:data.source,recommendations:data.recommendations,push},null,2))
  }catch(e){console.error(e.message);process.exitCode=1}
}else if(process.env.NODE_ENV!=='test'){
  server.listen(port,()=>console.log(`ai-stock-pick data service: http://localhost:${port}`))
  setInterval(async()=>{const now=new Date();if(now.getDay()===0||now.getDay()===6||now.getHours()<9)return;try{const data=await recommendations();await pushRecommendations(data)}catch(e){console.error('QQ mail push failed:',e.message)}},60*1000)
}
export {dateValue,normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit}

