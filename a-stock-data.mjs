const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const ZTB_UT='7eea3edcaed734bea9cbfc24409ed989'
let lastEastmoneyCall=0
let eastmoneyQueue=Promise.resolve()

const normalizeCode=value=>String(value||'').replace(/^(sh|sz|bj)/i,'').replace(/\.(SZ|SH|BJ)$/i,'')
const prefix=code=>code.startsWith('92')?`bj${code}`:(code.startsWith('6')?`sh${code}`:`sz${code}`)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function eastmoneyFetch(url){
  const run=eastmoneyQueue.then(async()=>{const delay=1100-(Date.now()-lastEastmoneyCall);if(delay>0)await wait(delay);try{return await fetch(url,{headers:{'User-Agent':UA,Referer:'https://quote.eastmoney.com/'}})}finally{lastEastmoneyCall=Date.now()}})
  eastmoneyQueue=run.catch(()=>{});return run
}

export async function aStockLimitPool(date){
  const q=new URLSearchParams({ut:ZTB_UT,dpt:'wz.ztzt',Pageindex:'0',pagesize:'10000',sort:'fbt:asc',date})
  const r=await eastmoneyFetch(`https://push2ex.eastmoney.com/getTopicZTPool?${q}`); if(!r.ok)throw Error(`a-stock-data涨停池 HTTP ${r.status}`)
  const data=(await r.json())?.data; if(!data)return {available:false,rows:[]}
  return {available:true,rows:(data.pool||[]).map(p=>({ts_code:p.c,name:p.n,trade_date:date,close:Number(p.p)/1000,pct_chg:Number(p.zdp),amount:Number(p.amount),open_times:Number(p.zbc),up_stat:`${p.lbc||1}板`,limit_days:Number(p.lbc||1),first_seal:p.fbt,last_seal:p.lbt,seal_fund:Number(p.fund),industry:p.hybk||'',zt_stat:`${p.zttj?.days||'?'}天${p.zttj?.ct||'?'}板`,provider:'a-stock-data/Eastmoney push2ex'}))}
}

export async function aStockTencentQuotes(codes){
  const normalized=[...new Set(codes.map(normalizeCode).filter(Boolean))]; if(!normalized.length)return {}
  const query=normalized.map(prefix).join(','); const r=await fetch(`https://qt.gtimg.cn/q=${query}`,{headers:{'User-Agent':UA}}); if(!r.ok)throw Error(`a-stock-data腾讯行情 HTTP ${r.status}`)
  const text=new TextDecoder('gbk').decode(await r.arrayBuffer()); const out={}
  for(const line of text.split(';')){const match=line.match(/v_\w+="([^"]*)"/);if(!match)continue;const v=match[1].split('~');if(v.length<53)continue;const code=normalizeCode(v[2]);const price=Number(v[3]);const previous=Number(v[4]);const amountWan=Number(v[37]);out[code]={symbol:code,name:v[1],price,previous_close:previous,change_pct:Number(v[32]),amount:Number.isFinite(amountWan)?amountWan*10000:null,turnover_pct:Number(v[38]),pe_ttm:Number(v[39]),float_mcap_yi:Number(v[44]),mcap_yi:Number(v[45]),pb:Number(v[46]),limit_up:Number(v[47]),limit_down:Number(v[48]),volume_ratio:Number(v[49]),market:'CN',instrument:'stock',observed_at:new Date().toISOString(),is_stale:amountWan===0&&price===previous&&price>0,provider:'a-stock-data/Tencent'}}
  return out
}

export async function aStockTencentKline(code,limit=30){
  const key=prefix(normalizeCode(code));const q=new URLSearchParams({param:`${key},day,,,${limit},qfq`})
  const r=await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${q}`,{headers:{'User-Agent':UA,Referer:'https://gu.qq.com/'}});if(!r.ok)throw Error(`a-stock-data腾讯K线 HTTP ${r.status}`)
  const node=(await r.json())?.data?.[key]||{};const rows=node.qfqday||node.day||[]
  return rows.map(v=>({date:v[0],open:Number(v[1]),close:Number(v[2]),high:Number(v[3]),low:Number(v[4]),volume:Number(v[5]),provider:'a-stock-data/Tencent qfq'}))
}

export async function aStockEastmoneyKline(code,limit=3){
  const c=normalizeCode(code);const secid=`${c.startsWith('6')?'1':'0'}.${c}`;const q=new URLSearchParams({secid,klt:'101',fqt:'0',lmt:String(limit),end:'20500101',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f61'})
  const r=await eastmoneyFetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${q}`);if(!r.ok)throw Error(`a-stock-data东财日K HTTP ${r.status}`)
  return ((await r.json())?.data?.klines||[]).map(v=>{const a=String(v).split(',');return {date:a[0],open:Number(a[1]),close:Number(a[2]),high:Number(a[3]),low:Number(a[4]),volume:Number(a[5]),amount:Number(a[6]),provider:'a-stock-data/Eastmoney'}})
}

export async function aStockBaiduKline(code){
  const q=new URLSearchParams({all:'1',isIndex:'false',isBk:'false',isBlock:'false',isFutures:'false',isStock:'true',newFormat:'1',group:'quotation_kline_ab',finClientType:'pc',code:normalizeCode(code),start_time:'',ktype:'1'})
  const r=await fetch(`https://finance.pae.baidu.com/selfselect/getstockquotation?${q}`,{headers:{'User-Agent':UA,Accept:'application/vnd.finance-web.v1+json',Origin:'https://gushitong.baidu.com',Referer:'https://gushitong.baidu.com/'}});if(!r.ok)throw Error(`a-stock-data百度K线 HTTP ${r.status}`)
  const j=await r.json();if(String(j.ResultCode??j.Result?.ResultCode??0)!=='0')throw Error('a-stock-data百度K线返回异常')
  const md=j.Result?.newMarketData||{};const keys=md.keys||[];const raw=typeof md.marketData==='string'?md.marketData.split(';').filter(Boolean):(md.marketData||[])
  return raw.map(row=>{const values=Array.isArray(row)?row:String(row).split(',');return Object.fromEntries(keys.map((key,i)=>[key,/^(open|close|high|low|volume|amount|ma\d+avgprice)$/.test(key)?Number(values[i]):values[i]]))})
}

export async function aStockThsLimitReasons(date){
  const q=new URLSearchParams({page:'1',limit:'200',field:'199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004',filter:'HS,GEM2STAR',order_field:'330324',order_type:'0',date})
  const r=await fetch(`https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?${q}`,{headers:{'User-Agent':UA}});if(!r.ok)throw Error(`a-stock-data同花顺涨停原因 HTTP ${r.status}`)
  const info=(await r.json())?.data?.info||[];return new Map(info.map(x=>[normalizeCode(x.code),{reason:x.reason_type||'',board_type:x.limit_up_type||'',seal_rate:Number(x.limit_up_suc_rate),break_times:Number(x.open_num||0),seal_amount:Number(x.order_amount),high_days:x.high_days||'',provider:'a-stock-data/THS'}]))
}

