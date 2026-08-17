import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV='test'
const {normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit}=await import('../server.mjs')

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

