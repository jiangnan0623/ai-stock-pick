import http from 'node:http'
import nodemailer from 'nodemailer'

const port=Number(process.env.PORT||5201)
const tushareToken=process.env.TUSHARE_TOKEN||''
const tushareUrl=(process.env.TUSHARE_HTTP_URL||'http://api.tushare.pro').replace(/\/$/,'')
const xiaoshiKey=process.env.SHIZIXI_API_KEY||''
const xiaoshiBase='https://api.shizixi.com'
const mailTo=process.env.MAIL_TO||''
let lastPushDate=''

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data))}
const ymd=()=>new Date().toISOString().slice(0,10).replaceAll('-','')
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
async function recommendations(){
  const date=ymd(); let source='Tushare',fallback=false,fallbackReason=''; let rows=[]
  try{
    const pool=await tushare('limit_list_d',{trade_date:date,limit_type:'U'},'ts_code,trade_date,name,close,pct_chg,amount,open_times,up_stat')
    rows=pool
  }catch(e){
    try {
      const daily=await tushare('daily',{trade_date:date},'ts_code,trade_date,close,pct_chg,amount')
      rows=daily.filter(x=>{const code=x.ts_code||'';const pct=Number(x.pct_chg||0);if(code.endsWith('.BJ'))return pct>=29.5;if(code.startsWith('30')||code.startsWith('68'))return pct>=19.5;return pct>=9.5}).map(x=>({...x,name:x.ts_code,open_times:0,up_stat:'首板',recent10_verified:false}))
      source='Tushare daily fallback'; fallback=true; fallbackReason=`limit_list_d不可用：${e.message}`
    } catch(dailyError) {
    source='Xiaoshi fallback'; fallback=true; fallbackReason=`Tushare limit_list_d：${e.message}; daily：${dailyError.message}`
    try{
      const q=await xiaoshi(`/api/v3/market/quotes?market=CN&instrument=stock&limit=200`)
      const list=q?.data||q?.quotes||[]
      rows=list.filter(x=>Number(x.change_pct??x.pct_chg)>=9.5).map(x=>({ts_code:x.symbol||x.code,name:x.name,close:x.price,pct_chg:x.change_pct,amount:x.amount,trade_date:date,open_times:0,up_stat:'首板'}))
    }catch(x){return {date,source:'unavailable',fallback:true,fallbackReason:`Tushare: ${e.message}; Xiaoshi: ${x.message}`,recommendations:[],watch:[],updatedAt:new Date().toISOString()}}
    }
  }
  const result=await Promise.all(rows.slice(0,20).map(async x=>{
    const code=normalizeCode(x.ts_code); let quote=null,bars=[],announcements=[],minute=[]
    try { const q=await xiaoshi(`/api/v3/market/quote/${code}?market=CN&instrument=stock`); quote=q?.data||q?.quote||q } catch {}
    try { const k=await xiaoshi(`/api/v3/data/kline/${code}?market=CN&instrument=stock&period=daily&adjust=none&limit=20`); bars=k?.data||k?.bars||[] } catch {}
    try { const a=await xiaoshi(`/api/v3/stock/announcements/${code}?days=365&page=1&page_size=10`); announcements=a?.data||[] } catch {}
    try { const m=await xiaoshi(`/api/v3/stock/kline/${code}?market=CN&period=1min&adjust=none&limit=240`); minute=m?.data||m?.bars||[] } catch {}
    const closes=bars.map(b=>Number(b.close??b.c??b[4])).filter(Number.isFinite)
    const price=Number(quote?.price??quote?.last??x.close); const codeText=String(x.ts_code||code)
    const limitPct=codeText.includes('.BJ')?29.5:(codeText.startsWith('30')||codeText.startsWith('68')?19.5:9.5)
    const historyBars=bars.slice(-11); const recentBars=historyBars.slice(-10)
    const limitHits=recentBars.map((b,i)=>{const close=Number(b.close??b.c??b[4]);const prev=Number(historyBars[i]?.close??historyBars[i]?.c??historyBars[i]?.[4]);const pct=prev>0?(close/prev-1)*100:Number(b.pct_chg??b.change_pct??b.pct??0);return {index:i,date:b.trade_date||b.date,pct,isLimit:pct>=limitPct}}).filter(x=>x.isLimit)
    const limitDates=limitHits.map(x=>x.date).filter(Boolean); const limitCount=limitDates.length; const recent10=limitCount>0
    const priorLimit=[...limitHits].reverse().find(x=>x.index<recentBars.length-1); const postLimitBars=priorLimit?recentBars.slice(priorLimit.index+1):[]
    const limitBar=priorLimit?recentBars[priorLimit.index]:null; const limitPeak=Number(limitBar?.high??limitBar?.close??limitBar?.c??limitBar?.[2])
    const postLimitLow=postLimitBars.length?Math.min(...postLimitBars.map(b=>Number(b.low??b.close??b.c??b[3])).filter(Number.isFinite)):NaN
    const pullbackPct=limitPeak>0&&Number.isFinite(postLimitLow)?((limitPeak-postLimitLow)/limitPeak)*100:0
    const pullback=Boolean(priorLimit)&&postLimitBars.length>=1&&pullbackPct>=2&&pullbackPct<=18&&price>=postLimitLow*1.02
    const theme=announcements.some(a=>!/(风险提示|异常波动|回购注销|董事会|会议决议)/.test(a.title||'')); const quoteOk=Number.isFinite(price)&&price>0
    const total=(recent10?20:0)+(pullback?25:0)+(theme?25:8)+(quoteOk?15:0)+(minute.length>0?15:0); const eligible=recent10&&total>=78&&pullback&&theme&&quoteOk&&minute.length>0
    return {code:x.ts_code,name:quote?.name||x.name||x.ts_code,price:quoteOk?price:null,limit_up_count:limitCount,limit_up_dates:limitDates,score:total,status:eligible?'推荐':'观察',source,trade_date:x.trade_date,quote_timestamp:quote?.observed_at||quote?.timestamp||null,checks:{recent_limit_up:recent10?'已核验':'近10日无涨停',pullback:pullback?'涨停后回调通过':(priorLimit?'涨停后回调不通过':'只有当日涨停，尚无板后回调'),theme:theme?'有直接公告证据':'待正宗题材归因',quote:quoteOk?'已核验':'行情缺失',intraday:minute.length?'已确认':'待分时确认'},technical:{bars:closes.length,prior_limit_date:priorLimit?.date||null,post_limit_days:postLimitBars.length,pullback_low:Number.isFinite(postLimitLow)?postLimitLow:null,pullback_pct:Number(pullbackPct.toFixed(2)),minute_bars:minute.length},missing_fields:[...(recent10?[]:['近10日涨停历史']),...(pullback?[]:['涨停后的短暂回调与修复']),...(theme?[]:['正宗题材/触发事件归因']),...(quoteOk?[]:['行情快照']),...(minute.length?[]:['1分钟分时'])],trade_plan:quoteOk?{entry_trigger:'不追当日涨停；下一交易日回踩承接后重新放量再确认',entry_reference:price,take_profit_1:Number((price*1.08).toFixed(2)),take_profit_2:Number((price*1.15).toFixed(2)),stop_loss:Number.isFinite(postLimitLow)?Number((postLimitLow*.99).toFixed(2)):null,invalidation:['跌破涨停后回调低点','题材证据被证伪','板块退潮']} : null}
  }))
  return {date,source,fallback,fallbackReason,total:rows.length,recommendations:result.filter(x=>x.status==='推荐').slice(0,3),watch:result.filter(x=>x.status==='观察').slice(0,12),updatedAt:new Date().toISOString(),strategy:'ai-stock-pick'}
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
  if(req.url==='/api/health') return json(res,200,{ok:true,service:'ai-stock-pick-data',version:'1.1.0-xiaoshi-enrichment'})
  if(req.url==='/api/recommendations') try{return json(res,200,await recommendations())}catch(e){return json(res,500,{error:e.message})}
  if(req.url==='/api/push') try{const data=await recommendations();return json(res,200,{...(await pushRecommendations(data)),count:data.recommendations.length,date:data.date})}catch(e){return json(res,500,{error:e.message})}
  json(res,404,{error:'Not found'})
})
if(process.env.RUN_ONCE==='true'){
  try{
    const data=await recommendations(); const push=await pushRecommendations(data)
    console.log(JSON.stringify({date:data.date,source:data.source,recommendations:data.recommendations,push},null,2))
  }catch(e){console.error(e.message);process.exitCode=1}
}else{
  server.listen(port,()=>console.log(`ai-stock-pick data service: http://localhost:${port}`))
  setInterval(async()=>{const now=new Date();if(now.getDay()===0||now.getDay()===6||now.getHours()<9)return;try{const data=await recommendations();await pushRecommendations(data)}catch(e){console.error('QQ mail push failed:',e.message)}},60*1000)
}

