export const ymd=()=>new Date().toISOString().slice(0,10).replaceAll('-','')
export const daysAgoYmd=days=>{const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10).replaceAll('-','')}
export const dateValue=v=>{const s=String(v||'').replace(/\D/g,'').slice(0,8);return s.length===8?Number(s):0}
export const isoDateLike=value=>{const digits=String(value||'').replace(/\D/g,'').slice(0,8);if(digits.length===8)return `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?new Date(parsed).toISOString().slice(0,10):null}
export const normalizeCode=v=>String(v||'').replace(/^(sh|sz|bj)/i,'').replace(/\.(SZ|SH|BJ)$/i,'')
export const normalizeBars=bars=>[...new Map((Array.isArray(bars)?bars:[]).map(b=>[dateValue(b.trade_date||b.date||b.datetime||b.time),b]).filter(([d])=>d)).entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b)
export const isFreshTimestamp=(value,maxHours=18)=>{const t=Date.parse(value);return Number.isFinite(t)&&Date.now()-t>=0&&Date.now()-t<=maxHours*3600000}
export const isSessionTimestamp=(value,session)=>dateValue(value)===Number(session)
const shanghaiParts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]))
export function isMarketTimestampFresh(value,session,now=new Date()){
  const timestamp=new Date(value);if(!Number.isFinite(timestamp.getTime())||!isSessionTimestamp(value,session))return false
  const current=shanghaiParts(now);const today=Number(`${current.year}${current.month}${current.day}`);const sessionDate=Number(session)
  if(sessionDate!==today)return sessionDate<today
  const minutes=Number(current.hour)*60+Number(current.minute)
  const observed=shanghaiParts(timestamp);const observedMinutes=Number(observed.hour)*60+Number(observed.minute)
  if(minutes<570)return false
  if(minutes>915)return observedMinutes>=885
  const ageMinutes=(now.getTime()-timestamp.getTime())/60000
  if(minutes>=690&&minutes<780)return ageMinutes>=0&&ageMinutes<=105
  return ageMinutes>=0&&ageMinutes<=15
}
export const limitThreshold=(code,name='')=>{const value=String(code||'').toUpperCase();return /(ST|退)/i.test(name)?4.8:(value.includes('.BJ')||/^(43|82|83|87|88|92)/.test(value)?29.5:(value.startsWith('30')||value.startsWith('68')?19.5:9.5))}
export const toTsCode=value=>{const code=normalizeCode(value);return `${code}.${code.startsWith('6')?'SH':(code.startsWith('8')||code.startsWith('9')?'BJ':'SZ')}`}
export const extractCoreTheme=value=>String(value||'').trim().split(/[+、，,；;：:/|]/)[0].replace(/^[“”"']+|[“”"']+$/g,'').replace(/\s+/g,'')
export const normalizeTheme=extractCoreTheme
export function buildThemeStats(rows){
  const stats=new Map()
  for(const row of rows){
    const theme=normalizeTheme(row.reason)
    if(!theme)continue
    const current=stats.get(theme)||{theme,stocks:0,first_boards:0,max_board:0,first_seen:null,latest_date:null,latest_stocks:0,latest_first_boards:0,_codes:new Set(),_latest_codes:new Set()}
    const code=normalizeCode(row.ts_code||row.code||row.name);if(code)current._codes.add(code)
    const boards=Number(row.limit_days||String(row.up_stat||row.tag||'').match(/\d+/)?.[0]||1)
    if(boards===1)current.first_boards+=1
    current.max_board=Math.max(current.max_board,boards)
    const tradeDate=String(row.trade_date||'').replace(/\D/g,'').slice(0,8)
    if(tradeDate){
      current.first_seen=!current.first_seen||tradeDate<current.first_seen?tradeDate:current.first_seen
      if(!current.latest_date||tradeDate>current.latest_date){current.latest_date=tradeDate;current._latest_codes=new Set();current.latest_first_boards=0}
      if(tradeDate===current.latest_date){if(code)current._latest_codes.add(code);if(boards===1)current.latest_first_boards+=1}
    }
    stats.set(theme,current)
  }
  for(const value of stats.values()){value.stocks=value._codes.size;value.latest_stocks=value._latest_codes.size;delete value._codes;delete value._latest_codes}
  return stats
}
export function assessThemeAuthenticity(theme,profile={}){
  const business=String(`${profile.main_business||''} ${profile.business_scope||''}`).replace(/\s+/g,'')
  const coreTheme=extractCoreTheme(theme).replace(/概念|板块|题材|业务|产品/g,'')
  const aliases={商业航天:['商业航天','航天'],人工智能:['人工智能','AI','智能'],机器人:['机器人','机械臂'],固态电池:['固态电池','电池'],低空经济:['低空经济','低空','航空'],电网设备:['电网设备','电网','输配电','低压电器','配电'],电子特气:['电子特气','特种气体','电子气体','六氟化钨'],工业气体:['工业气体','气体','空分']}
  const variants=aliases[coreTheme]||[coreTheme];const matched=variants.filter(x=>x.length>=2&&business.includes(x))
  return {level:business&&matched.length?'direct':'unverified',core_theme:coreTheme,matched_keywords:matched,business_available:Boolean(business)}
}
export const scoreThemeStructure=stats=>stats?.latest_first_boards>=2&&stats?.first_seen===stats?.latest_date?5:(stats?.max_board>=2?3:(stats?.stocks>=3?2:0))
export const marketCapFitScore=value=>{const cap=Number(value);return !Number.isFinite(cap)||cap<=0?0:(cap>=20&&cap<=200?5:(cap>=10&&cap<=300?3:1))}
export const isRecommendationEligible=({technicalPass,total,themeQualified,intradayFresh})=>Boolean(technicalPass&&total>=78&&themeQualified&&intradayFresh)
export const hasVerifiedCatalyst=({announcementEvidence,newsEvidence}={})=>Boolean(announcementEvidence||newsEvidence)
export async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));return out}

