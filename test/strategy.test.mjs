import test from 'node:test'
import assert from 'node:assert/strict'

const {normalizeBars,isFreshTimestamp,isSessionTimestamp,isMarketTimestampFresh,isoDateLike,hasVerifiedCatalyst,limitThreshold,extractCoreTheme,buildThemeStats,assessThemeAuthenticity,scoreThemeStructure,marketCapFitScore,isRecommendationEligible,mapLimit}=await import('../src/domain/market-rules.mjs')
const {loadRuntimeConfig}=await import('../src/config/runtime.mjs')
const {aStockTencentQuotes,parseTencentTimestamp}=await import('../a-stock-data.mjs')
const {buildRecommendationEmail}=await import('../src/delivery/email.mjs')

test('normalizes daily bars to unique ascending trading dates',()=>{
  const bars=normalizeBars([{date:'2026-08-17',close:2},{trade_date:'20260815',close:1},{date:'2026-08-17',close:3}])
  assert.deepEqual(bars.map(x=>x.close),[1,3])
})

test('uses board-specific and ST limit thresholds',()=>{
  assert.equal(limitThreshold('600000.SH','普通股份'),9.5)
  assert.equal(limitThreshold('300001.SZ','普通股份'),19.5)
  assert.equal(limitThreshold('920001.BJ','普通股份'),29.5)
  assert.equal(limitThreshold('920001','普通股份'),29.5)
  assert.equal(limitThreshold('600000.SH','*ST示例'),4.8)
})

test('normalizes compact dates used by announcements and news',()=>{
  assert.equal(isoDateLike('20260814'),'2026-08-14')
  assert.equal(isoDateLike('2026-08-14T10:00:00+08:00'),'2026-08-14')
  assert.equal(isoDateLike('not-a-date'),null)
})

test('requires a verified announcement or news catalyst',()=>{
  assert.equal(hasVerifiedCatalyst({announcementEvidence:null,newsEvidence:null}),false)
  assert.equal(hasVerifiedCatalyst({announcementEvidence:{title:'订单'},newsEvidence:null}),true)
})

test('does not treat a plain theme label as an event catalyst',()=>{
  assert.equal(hasVerifiedCatalyst({announcementEvidence:null,newsEvidence:null}),false)
})

test('rejects stale timestamps',()=>{
  assert.equal(isFreshTimestamp(new Date().toISOString(),1),true)
  assert.equal(isFreshTimestamp(new Date(Date.now()-2*3600000).toISOString(),1),false)
})

test('accepts the latest completed session for pre-market analysis',()=>{
  assert.equal(isSessionTimestamp('2026-08-14T15:00:00+08:00','20260814'),true)
  assert.equal(isSessionTimestamp('2026-08-13T15:00:00+08:00','20260814'),false)
})

test('bounded mapper preserves result order',async()=>{
  const result=await mapLimit([3,1,2],2,async x=>{await new Promise(r=>setTimeout(r,x));return x*2})
  assert.deepEqual(result,[6,2,4])
})

test('loads runtime configuration without leaking transport concerns into domain rules',()=>{
  const config=loadRuntimeConfig({PORT:'5300',RUN_ONCE:'true',SMTP_USER:'sender@example.com'})
  assert.equal(config.port,5300)
  assert.equal(config.runOnce,true)
  assert.equal(config.mail.user,'sender@example.com')
  assert.equal(config.tushare.url,'http://api.tushare.pro')
})

test('requires theme breadth and verifies direct main-business coverage',()=>{
  const stats=buildThemeStats([{ts_code:'600001.SH',trade_date:'20260814',reason:'商业航天+军工',limit_days:1},{ts_code:'600002.SH',trade_date:'20260814',reason:'商业航天+卫星',limit_days:1},{ts_code:'600003.SH',trade_date:'20260815',reason:'孤立题材',limit_days:1}])
  assert.equal(extractCoreTheme('商业航天+军工'),'商业航天')
  assert.deepEqual(stats.get('商业航天'),{theme:'商业航天',stocks:2,first_boards:2,max_board:1,first_seen:'20260814',latest_date:'20260814',latest_stocks:2,latest_first_boards:2})
  assert.equal(stats.get('孤立题材').stocks,1)
  assert.equal(assessThemeAuthenticity('商业航天+军工',{main_business:'商业航天装备与军工电子产品'}).level,'direct')
  assert.equal(assessThemeAuthenticity('商业航天+军工',{main_business:'航天装备制造'}).level,'direct')
  assert.equal(assessThemeAuthenticity('商业航天+军工',{main_business:'军工电子产品'}).level,'unverified')
  assert.equal(assessThemeAuthenticity('商业航天+军工',{main_business:'食品饮料'}).level,'unverified')
  assert.equal(scoreThemeStructure(stats.get('商业航天')),5)
})

test('enforces live-session freshness while allowing completed-session data',()=>{
  assert.equal(isMarketTimestampFresh('2026-08-17T10:00:00+08:00','20260817',new Date('2026-08-17T10:10:00+08:00')),true)
  assert.equal(isMarketTimestampFresh('2026-08-17T09:30:00+08:00','20260817',new Date('2026-08-17T10:10:00+08:00')),false)
  assert.equal(isMarketTimestampFresh('2026-08-14T15:00:00+08:00','20260814',new Date('2026-08-17T09:00:00+08:00')),true)
  assert.equal(isMarketTimestampFresh('2026-08-17T09:30:00+08:00','20260817',new Date('2026-08-17T16:00:00+08:00')),false)
  assert.equal(isMarketTimestampFresh('2026-08-17T15:00:00+08:00','20260817',new Date('2026-08-17T16:00:00+08:00')),true)
})

test('scores circulating market-cap fit explicitly',()=>{
  assert.equal(marketCapFitScore(80),5)
  assert.equal(marketCapFitScore(250),3)
  assert.equal(marketCapFitScore(null),0)
})

test('applies the complete final recommendation gate',()=>{
  assert.equal(isRecommendationEligible({technicalPass:true,total:80,themeQualified:true,intradayFresh:true}),true)
  assert.equal(isRecommendationEligible({technicalPass:true,total:80,themeQualified:false,intradayFresh:true}),false)
  assert.equal(isRecommendationEligible({technicalPass:true,total:77,themeQualified:true,intradayFresh:true}),false)
})

test('uses Tencent exchange timestamp instead of request time',()=>{
  assert.equal(parseTencentTimestamp('20260817145930'),'2026-08-17T14:59:30+08:00')
  assert.equal(parseTencentTimestamp(''),null)
})

test('renders the requested recommendation email columns and Beijing limit-up time',()=>{
  const email=buildRecommendationEmail({date:'20260817',source:'a-stock-data',recommendations:[{name:'示例股份',code:'600000.SH',price:10.5,technical:{prior_limit_date:'20260814',limit_up_price:11,pullback_pct:5,pullback_low:9.8,post_limit_days:2,volume_contracted:true},checks:{intraday:'当日分时新鲜'},theme_evidence:{title:'主营业务中标'},theme_analysis:{breadth:{stocks:3,first_boards:2},authenticity:{level:'direct',matched_keywords:['电网设备']}},trade_plan:{entry_zone_low:10.1,entry_zone_high:10.4,entry_reference:10.25,take_profit_1:11.5,take_profit_2:12,stop_loss:9.7,entry_trigger:'回踩确认'}}]})
  assert.match(email.html,/AI选股推荐/)
  assert.match(email.html,/2026年08月14日 15时00分（收盘确认）/)
  for(const heading of ['涨停价格','回调','当前价格','建仓价','止盈','止损','简要分析'])assert.match(email.html,new RegExp(heading))
})

test('renders a daily result even when no stock qualifies',()=>{
  const email=buildRecommendationEmail({date:'20260817',source:'a-stock-data',recommendations:[],watch:[{name:'观察股份',missing_fields:['主营业务直接覆盖核心题材']}]})
  assert.match(email.html,/今日没有股票同时通过全部硬门槛/)
  assert.match(email.html,/观察股份/)
})

test('parses a-stock-data Tencent quote fields and units',async()=>{
  const original=globalThis.fetch;const fields=Array(53).fill('');fields[1]='示例股份';fields[2]='600000';fields[3]='10.5';fields[4]='10';fields[30]='20260817145930';fields[32]='5';fields[37]='12345';fields[44]='50';fields[45]='80';fields[46]='2';fields[47]='11';fields[48]='9';fields[49]='1.2'
  globalThis.fetch=async()=>new Response(new TextEncoder().encode(`v_sh600000="${fields.join('~')}";`))
  try{const q=(await aStockTencentQuotes(['600000.SH']))['600000'];assert.equal(q.price,10.5);assert.equal(q.amount,123450000);assert.equal(q.float_mcap_yi,50);assert.equal(q.mcap_yi,80);assert.equal(q.observed_at,'2026-08-17T14:59:30+08:00');assert.equal(q.provider,'a-stock-data/Tencent')}finally{globalThis.fetch=original}
})

