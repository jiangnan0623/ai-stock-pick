import {normalizeCode} from '../../domain/market-rules.mjs'

export function createMarketClients(config){
  async function tushare(api_name,params,fields){
    if(!config.tushare.token)throw Error('未配置 TUSHARE_TOKEN')
    const response=await fetch(config.tushare.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_name,token:config.tushare.token,params,fields})})
    const payload=await response.json()
    if(payload.code!==0)throw Error(payload.msg||`Tushare ${api_name} 失败`)
    const names=payload.data?.fields||[]
    return (payload.data?.items||[]).map(row=>Object.fromEntries(names.map((name,index)=>[name,row[index]])))
  }

  async function xiaoshi(path,options={}){
    if(!config.xiaoshi.key)throw Error('未配置 SHIZIXI_API_KEY')
    const response=await fetch(`${config.xiaoshi.baseUrl}${path}`,{...options,headers:{Authorization:`Bearer ${config.xiaoshi.key}`,'Content-Type':'application/json',...(options.headers||{})}})
    if(response.status===429)throw Error(`小石限流，Retry-After=${response.headers.get('retry-after')||'unknown'}`)
    if(!response.ok)throw Error(`小石请求失败 HTTP ${response.status}`)
    return response.json()
  }

  const eastmoneySecid=value=>{const code=normalizeCode(value);return `${code.startsWith('6')?'1':'0'}.${code}`}
  async function eastmoneyQuote(code){
    const fields='f43,f57,f58,f59,f60,f124,f170'
    const response=await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecid(code)}&fields=${fields}`)
    if(!response.ok)throw Error(`东方财富行情 HTTP ${response.status}`)
    const data=(await response.json())?.data
    if(!data)throw Error('东方财富行情为空')
    const scale=10**Number(data.f59??2)
    return {symbol:data.f57,name:data.f58,price:Number(data.f43)/scale,previous_close:Number(data.f60)/scale,change_pct:Number(data.f170)/100,market:'CN',instrument:'stock',observed_at:data.f124?new Date(Number(data.f124)*1000).toISOString():null,provider:'Eastmoney'}
  }

  async function eastmoneyKline(code,limit=20){
    const response=await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${eastmoneySecid(code)}&klt=101&fqt=0&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f61`)
    if(!response.ok)throw Error(`东方财富日线 HTTP ${response.status}`)
    return ((await response.json())?.data?.klines||[]).map(value=>{const row=String(value).split(',');return {date:row[0],open:Number(row[1]),close:Number(row[2]),high:Number(row[3]),low:Number(row[4]),volume:Number(row[5]),amount:Number(row[6]),provider:'Eastmoney'}})
  }

  async function serpNews(code,name){
    if(!config.serpApiKey)return []
    const end=Math.floor(Date.now()/1000);const start=end-7*24*60*60
    const params=new URLSearchParams({engine:'baidu',q:`${name} ${code} 股票 公告 政策 题材`,api_key:config.serpApiKey,ct:'2',rn:'10',gpc:`stf=${start},${end}|stftype=1`,no_cache:'true',output:'json'})
    const response=await fetch(`https://serpapi.com/search.json?${params}`)
    if(!response.ok)throw Error(`SerpAPI HTTP ${response.status}`)
    const payload=await response.json();if(payload.error)throw Error(`SerpAPI: ${payload.error}`)
    const seen=new Set();const items=[...(payload.news_results||[]),...(payload.organic_results||[])]
    return items.map(item=>({title:item.title||'',link:item.link||'',snippet:item.snippet||item.summary||'',source:item.source||item.displayed_link||'百度',published_at:item.date||item.published_date||null,provider:'SerpAPI/Baidu'})).filter(item=>item.title&&item.link&&!seen.has(item.link)&&seen.add(item.link)).slice(0,5)
  }

  return {tushare,xiaoshi,eastmoneyQuote,eastmoneyKline,serpNews}
}

