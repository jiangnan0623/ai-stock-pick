import test from 'node:test'
import assert from 'node:assert/strict'

const {normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit}=await import('../src/domain/market-rules.mjs')
const {loadRuntimeConfig}=await import('../src/config/runtime.mjs')
const {aStockTencentQuotes}=await import('../a-stock-data.mjs')
const {buildRecommendationEmail}=await import('../src/delivery/email.mjs')

test('normalizes daily bars to unique ascending trading dates',()=>{
  const bars=normalizeBars([{date:'2026-08-17',close:2},{trade_date:'20260815',close:1},{date:'2026-08-17',close:3}])
  assert.deepEqual(bars.map(x=>x.close),[1,3])
})

test('uses board-specific and ST limit thresholds',()=>{
  assert.equal(limitThreshold('600000.SH','普通股份'),9.5)
  assert.equal(limitThreshold('300001.SZ','普通股份'),19.5)
  assert.equal(limitThreshold('920001.BJ','普通股份'),29.5)
  assert.equal(limitThreshold('600000.SH','*ST示例'),4.8)
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

test('renders the requested recommendation email columns and Beijing limit-up time',()=>{
  const email=buildRecommendationEmail({date:'20260817',source:'a-stock-data',recommendations:[{name:'示例股份',code:'600000.SH',price:10.5,technical:{prior_limit_date:'20260814',limit_up_price:11,pullback_pct:5,pullback_low:9.8,post_limit_days:2,volume_contracted:true},checks:{intraday:'当日分时新鲜'},theme_evidence:{title:'主营业务中标'},trade_plan:{entry_reference:10.3,take_profit_1:11.5,take_profit_2:12,stop_loss:9.7,entry_trigger:'回踩确认'}}]})
  assert.match(email.html,/AI选股推荐/)
  assert.match(email.html,/2026年08月14日 15时00分（收盘确认）/)
  for(const heading of ['涨停价格','回调','当前价格','建仓价','止盈','止损','简要分析'])assert.match(email.html,new RegExp(heading))
})

test('parses a-stock-data Tencent quote fields and units',async()=>{
  const original=globalThis.fetch;const fields=Array(53).fill('');fields[1]='示例股份';fields[2]='600000';fields[3]='10.5';fields[4]='10';fields[32]='5';fields[37]='12345';fields[44]='50';fields[45]='80';fields[46]='2';fields[47]='11';fields[48]='9';fields[49]='1.2'
  globalThis.fetch=async()=>new Response(new TextEncoder().encode(`v_sh600000="${fields.join('~')}";`))
  try{const q=(await aStockTencentQuotes(['600000.SH']))['600000'];assert.equal(q.price,10.5);assert.equal(q.amount,123450000);assert.equal(q.float_mcap_yi,50);assert.equal(q.mcap_yi,80);assert.equal(q.provider,'a-stock-data/Tencent')}finally{globalThis.fetch=original}
})

