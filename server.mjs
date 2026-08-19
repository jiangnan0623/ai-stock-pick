import {loadRuntimeConfig} from './src/config/runtime.mjs'
import {ymd,daysAgoYmd,dateValue,normalizeCode,normalizeBars,isFreshTimestamp,isSessionTimestamp,isMarketTimestampFresh,isoDateLike,limitThreshold,toTsCode,normalizeTheme,buildThemeStats,assessThemeAuthenticity,scoreThemeStructure,marketCapFitScore,isTechnicalSetupEligible,isThemeQualified,isRecommendationEligible,hasVerifiedCatalyst,mapLimit} from './src/domain/market-rules.mjs'
import {aStockLimitPool,aStockTencentQuotes,aStockTencentKline,aStockEastmoneyKline,aStockBaiduKline,aStockThsLimitReasons} from './src/infrastructure/providers/a-stock-data.mjs'
import {createMarketClients} from './src/infrastructure/providers/market-clients.mjs'
import {createRecommendationMailer} from './src/delivery/email.mjs'
import {createHttpServer} from './src/delivery/http.mjs'
import {runService} from './src/application/service-runtime.mjs'

const config=loadRuntimeConfig()
const {serpApiKey}=config
const tushareToken=config.tushare.token
const xiaoshiKey=config.xiaoshi.key
const {tushare,xiaoshi,eastmoneyQuote,eastmoneyKline,eastmoneyCompanyProfile,eastmoneyMinute,serpNews}=createMarketClients(config)
async function aStockPrimaryPool(endDate){
  let dates=[]
  try{dates=(await tushare('trade_cal',{exchange:'SSE',start_date:daysAgoYmd(35),end_date:endDate,is_open:'1'},'cal_date,is_open')).map(x=>x.cal_date).sort().reverse()}catch{
    for(let i=0;i<35;i++){const d=new Date();d.setUTCDate(d.getUTCDate()-i);if(d.getUTCDay()>0&&d.getUTCDay()<6)dates.push(d.toISOString().slice(0,10).replaceAll('-',''))}
  }
  const sessions=[],pool=[],reasons=new Map()
  for(const d of dates){if(sessions.length===10)break;const result=await aStockLimitPool(d);if(!result.available)continue;sessions.push(d);pool.push(...result.rows)}
  sessions.sort();if(sessions.length<10)throw Error(`a-stock-data仅取得${sessions.length}个完整交易日`)
  await Promise.all(sessions.map(async d=>{try{const m=await aStockThsLimitReasons(d);for(const [code,value] of m)reasons.set(`${d}:${code}`,value)}catch{}}))
  const themeEvents=pool.map(x=>({...x,...reasons.get(`${x.trade_date}:${normalizeCode(x.ts_code)}`)}))
  const latestByCode=new Map();themeEvents.sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date))).forEach(x=>latestByCode.set(x.ts_code,x))
  const rows=[...latestByCode.values()].map(x=>({...x,pool_limit_dates:pool.filter(p=>p.ts_code===x.ts_code).map(p=>p.trade_date).sort()}))
  return {date:sessions.at(-1),rows,themeEvents}
}
async function recommendations(){
  let date=ymd(); let source='a-stock-data',fallback=false,fallbackReason='',poolVerified=false; let rows=[],themeEvents=[]
  try{
    const primary=await aStockPrimaryPool(date);date=primary.date;rows=primary.rows;themeEvents=primary.themeEvents;poolVerified=true
  }catch(e){
    try {
      let pool=[];let poolProvider='Tushare limit_list_ths'
      try{pool=await tushare('limit_list_ths',{start_date:daysAgoYmd(20),end_date:date,limit_type:'涨停池'},'ts_code,trade_date,name,price,pct_chg,open_num,lu_desc,tag,status,turnover,sum_float')}catch{
        poolProvider='Tushare limit_list_d';pool=await tushare('limit_list_d',{start_date:daysAgoYmd(20),end_date:date,limit_type:'U'},'ts_code,trade_date,name,close,pct_chg,amount,open_times,up_stat')
      }
      pool=pool.map(x=>({...x,close:x.close??x.price,amount:x.amount??x.turnover,open_times:x.open_times??x.open_num,up_stat:x.up_stat??x.tag,reason:x.reason??x.lu_desc,provider:poolProvider}))
      const sessions=[...new Set(pool.map(x=>x.trade_date))].sort().slice(-10);date=sessions.at(-1)||date;const latestByCode=new Map();pool.filter(x=>sessions.includes(x.trade_date)).sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date))).forEach(x=>latestByCode.set(x.ts_code,x))
      themeEvents=pool.filter(x=>sessions.includes(x.trade_date));rows=[...latestByCode.values()].map(x=>({...x,pool_limit_dates:themeEvents.filter(p=>p.ts_code===x.ts_code).map(p=>p.trade_date).sort()}));poolVerified=sessions.length===10
      source=poolProvider;fallback=true;fallbackReason=`a-stock-data不可用：${e.message}`
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
  const themeStats=buildThemeStats(themeEvents.length?themeEvents:rows)
  let primaryQuotes={};try{primaryQuotes=await aStockTencentQuotes(rows.map(x=>x.ts_code))}catch{}
  const result=await mapLimit(rows,12,async x=>{
    const code=normalizeCode(x.ts_code); let quote=null,bars=[],liquidityBars=[],announcements=[],minute=[],realtimeNews=[],companyProfile={}; const providers={pool:source,quote:null,kline:null,liquidity:null,theme:x.reason?(String(x.provider||'').startsWith('Tushare')?x.provider:'a-stock-data/THS'):null,company:null,announcements:null,news:null,intraday:null}
    quote=primaryQuotes[code]&&!primaryQuotes[code].is_stale?primaryQuotes[code]:null;if(quote)providers.quote='a-stock-data/Tencent'
    if(!quote)try { const q=await xiaoshi(`/api/v3/market/quote/${code}?market=CN&instrument=stock`); quote=q?.data||q?.quote||q; if(quote)providers.quote='Xiaoshi' } catch {}
    if(!quote||!Number(quote?.price??quote?.last)){try{quote=await eastmoneyQuote(code);providers.quote='Eastmoney'}catch{}}
    try { bars=normalizeBars(await aStockTencentKline(code,30,'none'));if(bars.length)providers.kline='a-stock-data/Tencent none' } catch {}
    if(bars.length<20)try { bars=normalizeBars(await aStockBaiduKline(code));if(bars.length)providers.kline='a-stock-data/Baidu' } catch {}
    if(bars.length<20)try { const k=await xiaoshi(`/api/v3/data/kline/${code}?market=CN&instrument=stock&period=daily&adjust=none&limit=20`); bars=normalizeBars(k?.data||k?.bars||[]); if(bars.length)providers.kline='Xiaoshi' } catch {}
    if(bars.length<20){try{bars=await eastmoneyKline(code,20);if(bars.length)providers.kline='Eastmoney'}catch{}}
    bars=normalizeBars(bars).filter(b=>dateValue(b.trade_date||b.date)<=Number(date))
    const closes=bars.map(b=>Number(b.close??b.c??b[4])).filter(Number.isFinite)
    const price=Number(quote?.price??quote?.last??x.close); const codeText=String(x.ts_code||code)
    const limitPct=limitThreshold(codeText,quote?.name||x.name)
    const barDate=b=>b?.trade_date||b?.date||b?.datetime||b?.time
    const historyBars=bars.slice(-11); const recentBars=historyBars.slice(-10)
    const limitHits=recentBars.map((b,i)=>{const close=Number(b.close??b.c??b[4]);const prev=Number(historyBars[i]?.close??historyBars[i]?.c??historyBars[i]?.[4]);const pct=prev>0?(close/prev-1)*100:Number(b.pct_chg??b.change_pct??b.pct??0);return {index:i,date:barDate(b),pct,isLimit:pct>=limitPct}}).filter(x=>x.isLimit)
    const limitDates=limitHits.map(x=>x.date).filter(Boolean); const poolLimitDates=Array.isArray(x.pool_limit_dates)?x.pool_limit_dates.filter(Boolean):[]; const recentStart=dateValue(barDate(recentBars[0])); const poolRecentDates=poolLimitDates.filter(d=>dateValue(d)>=recentStart&&dateValue(d)<=Number(date)); const limitCount=Math.max(limitDates.length,poolRecentDates.length); const recent10=poolRecentDates.length>0||limitCount>0
    const klinePriorLimit=[...limitHits].reverse().find(x=>x.index<recentBars.length-1); const poolPriorDate=[...poolRecentDates].reverse().find(d=>dateValue(d)<Number(date)); const poolPriorIndex=poolPriorDate?recentBars.findIndex(b=>dateValue(barDate(b))===dateValue(poolPriorDate)): -1; const priorLimit=klinePriorLimit|| (poolPriorIndex>=0?{index:poolPriorIndex,date:poolPriorDate,pct:limitPct,isLimit:true}:null); const postLimitBars=priorLimit?recentBars.slice(priorLimit.index+1):[]; const pullbackWindowBars=postLimitBars.slice(0,5)
    const limitBar=priorLimit?recentBars[priorLimit.index]:null; const limitPeak=Number(limitBar?.high??limitBar?.close??limitBar?.c??limitBar?.[2])
    const postLimitLow=pullbackWindowBars.length?Math.min(...pullbackWindowBars.map(b=>Number(b.low??b.close??b.c??b[3])).filter(Number.isFinite)):NaN
    const pullbackPct=limitPeak>0&&Number.isFinite(postLimitLow)?((limitPeak-postLimitLow)/limitPeak)*100:0
    const barVolume=b=>Number(b?.volume??b?.vol??b?.v??b?.[5]); const barAmount=b=>Number(b?.amount??b?.turnover??b?.[6])
    const troughIndex=pullbackWindowBars.findIndex(b=>Number(b.low??b.close??b.c??b[3])===postLimitLow); const pullbackLeg=troughIndex>=0?pullbackWindowBars.slice(0,troughIndex+1):pullbackWindowBars
    const limitVolume=barVolume(limitBar); const postVolumes=pullbackLeg.map(barVolume).filter(v=>Number.isFinite(v)&&v>0)
    const pullbackAvgVolume=postVolumes.length?postVolumes.reduce((a,b)=>a+b,0)/postVolumes.length:NaN
    const volumeContracted=Number.isFinite(limitVolume)&&limitVolume>0&&Number.isFinite(pullbackAvgVolume)?pullbackAvgVolume<=limitVolume*.9:false
    const recoveryRatio=limitPeak>postLimitLow?Math.max(0,Math.min(1,(price-postLimitLow)/(limitPeak-postLimitLow))):0
    const shortWindow=postLimitBars.length>=1&&postLimitBars.length<=5
    const pullback=Boolean(priorLimit)&&shortWindow&&pullbackPct>=2&&pullbackPct<=18&&recoveryRatio>=.35&&price<=limitPeak*1.03
    const paperPullback=Boolean(priorLimit)&&shortWindow&&pullbackPct>=2&&pullbackPct<=18&&recoveryRatio>=.25&&price<=limitPeak*1.03
    const quoteTimestamp=quote?.observed_at||quote?.timestamp; const quoteIdentity=normalizeCode(quote?.symbol||quote?.code||code)===code&&(!quote?.market||quote.market==='CN')&&(!quote?.instrument||quote.instrument==='stock')
    const quoteFresh=isMarketTimestampFresh(quoteTimestamp,date); const quoteOk=Number.isFinite(price)&&price>0&&quoteFresh&&quoteIdentity
    if(poolVerified&&recent10&&paperPullback&&quoteOk)try { liquidityBars=await aStockEastmoneyKline(code,3); if(liquidityBars.length)providers.liquidity='a-stock-data/Eastmoney (CNY)' } catch {}
    if(liquidityBars.length<3&&bars.slice(-3).every(b=>Number.isFinite(barAmount(b))&&barAmount(b)>0)){liquidityBars=bars.slice(-3);providers.liquidity=`${providers.kline} amount (CNY)`}
    const recentAmounts=liquidityBars.slice(-3).map(barAmount).filter(v=>Number.isFinite(v)&&v>0); const avgAmount3=recentAmounts.length===3?recentAmounts.reduce((a,b)=>a+b,0)/recentAmounts.length:NaN
    const liquid=Number.isFinite(avgAmount3)&&avgAmount3>=100000000
    const paperLiquid=Number.isFinite(avgAmount3)&&avgAmount3>=50000000
    const klineVerified=closes.length>=20
    const technicalPass=isTechnicalSetupEligible({poolVerified,recentLimitUp:recent10,klineVerified,pullback,liquid,quoteFresh:quoteOk})
    const paperTechnicalPass=isTechnicalSetupEligible({poolVerified,recentLimitUp:recent10,klineVerified,pullback:paperPullback,liquid:paperLiquid,quoteFresh:quoteOk})
    if(technicalPass||paperTechnicalPass){
      try { companyProfile=(await tushare('stock_company',{ts_code:toTsCode(x.ts_code)},'ts_code,main_business,business_scope'))[0]||{}; if(companyProfile.main_business||companyProfile.business_scope)providers.company='Tushare stock_company' } catch {}
      if(!companyProfile.main_business&&!companyProfile.business_scope)try { companyProfile=await eastmoneyCompanyProfile(code); providers.company='Eastmoney F10' } catch {}
      try { const a=await xiaoshi(`/api/v3/stock/announcements/${code}?days=30&page=1&page_size=20`); announcements=Array.isArray(a?.data)?a.data:[]; if(announcements.length)providers.announcements='Xiaoshi' } catch {}
      try { realtimeNews=await serpNews(code,quote?.name||x.name||code); if(realtimeNews.length)providers.news='SerpAPI/Baidu' } catch {}
      try { const m=await xiaoshi(`/api/v3/stock/kline/${code}?market=CN&period=1min&adjust=none&limit=240`); minute=Array.isArray(m?.data)?m.data:(Array.isArray(m?.bars)?m.bars:[]); if(minute.length)providers.intraday='Xiaoshi' } catch {}
      if(!minute.length)try { minute=await eastmoneyMinute(code); if(minute.length)providers.intraday='Eastmoney' } catch {}
    }
    const generic=/(风险提示|异常波动|回购注销|董事会|会议决议|人事变动)/; const catalyst=/(中标|签约|政策|订单|业绩|重组|收购|涨价|产业|项目|获批|合作|投产)/
    const limitTime=Date.parse(isoDateLike(priorLimit?.date)||''); const nearLimit=d=>{const t=Date.parse(isoDateLike(d)||'');return Number.isFinite(t)&&Number.isFinite(limitTime)&&Math.abs(t-limitTime)<=14*86400000}
    const companyName=quote?.name||x.name||''
    const announcementEvidence=announcements.find(a=>nearLimit(a.publish_time||a.date||a.ann_date)&&!generic.test(a.title||'')&&catalyst.test(`${a.title||''} ${a.summary||''}`))
    const newsEvidence=realtimeNews.find(n=>nearLimit(n.published_at)&&catalyst.test(`${n.title} ${n.snippet}`)&&(String(n.title).includes(code)||String(n.snippet).includes(code)||(companyName&&String(n.title).includes(companyName))))
    const poolThemeEvidence=x.reason?{type:'limit-up-reason',title:x.reason,time:x.pool_limit_dates?.at(-1)||null,source:providers.theme,board_type:x.board_type||null,seal_rate:Number.isFinite(x.seal_rate)?x.seal_rate:null}:null
    const themeBreadth=themeStats.get(normalizeTheme(x.reason))||{theme:normalizeTheme(x.reason)||null,stocks:0,first_boards:0,max_board:0,latest_stocks:0,latest_first_boards:0,first_seen:null,latest_date:null}
    const authenticity=assessThemeAuthenticity(x.reason,companyProfile)
    const reasonEventVerified=Boolean(poolThemeEvidence&&catalyst.test(String(poolThemeEvidence.title||''))&&Array.isArray(x.pool_limit_dates)&&x.pool_limit_dates.some(d=>dateValue(d)===dateValue(priorLimit?.date)))
    const eventVerified=hasVerifiedCatalyst({announcementEvidence,newsEvidence})||reasonEventVerified; const theme=Boolean(poolThemeEvidence||eventVerified); const themeQualified=isThemeQualified({eventVerified,latestStocks:themeBreadth.latest_stocks,authenticity:authenticity.level})
    const minuteTimestamp=minute.at(-1)?.datetime||minute.at(-1)?.time||minute.at(-1)?.timestamp||minute.at(-1)?.date; const intradayFresh=minute.length>0&&isMarketTimestampFresh(minuteTimestamp,date)
    const themeStructureScore=scoreThemeStructure(themeBreadth);const capScore=marketCapFitScore(quote?.float_mcap_yi); const openTimes=Number(x.open_times); const scoreBreakdown={theme_event:themeQualified?20+themeStructureScore:(theme?10:0),pullback_rebound:pullback?20+(volumeContracted?5:0):0,stock_character:Math.min(20,8+limitCount*4+(Number.isFinite(openTimes)?Math.max(0,4-openTimes):0)),liquidity_market_cap:liquid?10+capScore:0,market_confirmation:quoteOk&&intradayFresh?15:0}
    const total=Object.values(scoreBreakdown).reduce((a,b)=>a+b,0)
    const stopLoss=Number.isFinite(postLimitLow)?Number((postLimitLow*.99).toFixed(2)):null
    const entryLow=Number.isFinite(postLimitLow)?Number(Math.max(postLimitLow*1.02,price*.97).toFixed(2)):null; const entryHigh=Number.isFinite(limitPeak)?Number(Math.min(limitPeak*.99,price*1.01).toFixed(2)):null; const entryReference=entryLow&&entryHigh&&entryLow<=entryHigh?Number(((entryLow+entryHigh)/2).toFixed(2)):price
    const entryRisk=stopLoss&&entryReference>stopLoss?entryReference-stopLoss:NaN; const takeProfit1=Number(Math.max(limitPeak||0,entryReference+(Number.isFinite(entryRisk)?entryRisk*1.5:entryReference*.08)).toFixed(2)); const takeProfit2=Number(Math.max(entryReference*1.15,entryReference+(Number.isFinite(entryRisk)?entryRisk*2.5:entryReference*.15)).toFixed(2)); const hasValidPlan=quoteOk&&paperPullback&&Number.isFinite(entryLow)&&Number.isFinite(entryHigh)&&entryLow<=entryHigh&&Number.isFinite(stopLoss)&&stopLoss<entryReference
    const paperThemeQualified=Boolean(poolThemeEvidence)&&authenticity.business_available
    const themeBonus=paperThemeQualified&&!themeQualified?(authenticity.level==='direct'?10:5):0
    const paperScore=total+themeBonus+(paperLiquid&&!liquid?5:0)+(paperPullback&&!pullback?5:0)
    const eligible=isRecommendationEligible({technicalPass:paperTechnicalPass,total:paperScore,themeEvidence:Boolean(poolThemeEvidence),businessAvailable:authenticity.business_available,intradayFresh,validPlan:hasValidPlan})
    return {code:x.ts_code,name:quote?.name||x.name||x.ts_code,price:quoteOk?price:null,limit_up_count:limitCount,limit_up_dates:limitDates.length?limitDates:(x.pool_limit_dates||[]),score:eligible?paperScore:total,paper_score:paperScore,score_breakdown:scoreBreakdown,status:eligible?'推荐':'观察',risk_level:eligible?(authenticity.level==='direct'?'中高':'高'):null,max_position_pct:eligible?10:null,source,providers,trade_date:date,quote_timestamp:quote?.observed_at||quote?.timestamp||null,theme_evidence:poolThemeEvidence||(announcementEvidence?{type:'announcement',title:announcementEvidence.title,time:announcementEvidence.publish_time||announcementEvidence.date||null,source:providers.announcements}:newsEvidence?{type:'news',...newsEvidence}:null),theme_analysis:{breadth:themeBreadth,authenticity,structure_score:themeStructureScore,is_new_cluster:themeBreadth.latest_first_boards>=2&&themeBreadth.first_seen===themeBreadth.latest_date},related_news:realtimeNews,checks:{pool:poolVerified?'近10交易日完整池':'候选池不完整',kline:klineVerified?'至少20根日线已核验':'日线不足20根',recent_limit_up:recent10?'已核验':'近10日无涨停',pullback:paperPullback?'高风险正式回调门槛通过（修复≥25%）':(priorLimit?'涨停后回调窗口/幅度/修复不通过':'只有当日涨停，尚无板后回调'),volume:volumeContracted?'回调阶段缩量':'回调缩量未确认',liquidity:paperLiquid?'高风险正式成交额门槛通过（≥5000万元）':'近3日成交额不足或缺失',market_cap:capScore>=3?'流通市值适配':'流通市值偏离或缺失',theme:paperThemeQualified?(authenticity.level==='direct'?'主营直接匹配':'主营资料存在，题材正宗性未确认'):'主营资料缺失',theme_breadth:themeBreadth.latest_stocks>=2?'题材最新日宽度通过':'题材宽度不足（风险提示，不否决）',theme_structure:themeStructureScore===5?'新题材首板集群':(themeBreadth.max_board>=2?'存在连板梯队':'普通题材宽度'),quote:quoteOk?'行情新鲜':'行情缺失或过期',intraday:intradayFresh?'当日分时新鲜':'分时缺失或过期'},technical:{bars:closes.length,prior_limit_date:priorLimit?.date||null,limit_up_price:Number.isFinite(limitPeak)?limitPeak:null,post_limit_days:postLimitBars.length,pullback_low:Number.isFinite(postLimitLow)?postLimitLow:null,pullback_pct:Number(pullbackPct.toFixed(2)),recovery_ratio:Number((recoveryRatio*100).toFixed(2)),volume_contracted:volumeContracted,avg_amount_3d:Number.isFinite(avgAmount3)?Number(avgAmount3.toFixed(0)):null,float_market_cap_yi:Number.isFinite(Number(quote?.float_mcap_yi))?Number(quote.float_mcap_yi):null,minute_bars:minute.length},missing_fields:[...(poolVerified?[]:['完整近10交易日涨停池']),...(klineVerified?[]:['至少20根日线']),...(recent10?[]:['近10日涨停历史']),...(paperPullback?[]:['涨停后1-5日短回调与至少25%修复']),...(volumeContracted?[]:['回调缩量']),...(paperLiquid?[]:['近3日日均成交额≥5000万元']),...(theme?[]:['涨停附近的题材/触发事件']),...(authenticity.business_available?[]:['主营业务资料']),...(quoteOk?[]:['新鲜行情快照']),...(intradayFresh?[]:['新鲜1分钟分时'])],trade_plan:hasValidPlan?{entry_trigger:'高风险宽松标准；仅在价格进入计划区间、回踩不破修复位且板块未退潮时确认，单只仓位不超过10%',entry_zone_low:entryLow,entry_zone_high:entryHigh,entry_reference:entryReference,take_profit_1:takeProfit1,take_profit_2:takeProfit2,stop_loss:stopLoss,risk_reward_1:Number.isFinite(entryRisk)&&entryRisk>0?Number(((takeProfit1-entryReference)/entryRisk).toFixed(2)):null,risk_reward_2:Number.isFinite(entryRisk)&&entryRisk>0?Number(((takeProfit2-entryReference)/entryRisk).toFixed(2)):null,invalidation:['跌破涨停后回调低点','行情或分时过期','近3日流动性跌破5000万元','题材证据被证伪','板块退潮']} : null}
  })
  return {date,source,fallback,fallbackReason,poolVerified,total:rows.length,recommendations:result.filter(x=>x.status==='推荐').sort((a,b)=>b.score-a.score).slice(0,3),paperCandidates:[],watch:result.filter(x=>x.status==='观察').sort((a,b)=>b.paper_score-a.paper_score).slice(0,12),updatedAt:new Date().toISOString(),strategy:'ai-stock-pick-v7-high-risk-relaxed'}
}
const pushRecommendations=createRecommendationMailer(config.mail)
const health=()=>({ok:true,service:'ai-stock-pick-data',version:'1.6.0-theme-session-gates',sources:{a_stock_data:true,tushare:Boolean(tushareToken),xiaoshi:Boolean(xiaoshiKey),serpapi:Boolean(serpApiKey),eastmoney:true}})
const server=createHttpServer({health,recommendations,push:pushRecommendations})
if(process.env.NODE_ENV!=='test')await runService({config,server,recommendations,push:pushRecommendations})
export {dateValue,normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit}

