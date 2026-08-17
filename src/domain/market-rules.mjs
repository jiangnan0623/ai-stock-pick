export const ymd=()=>new Date().toISOString().slice(0,10).replaceAll('-','')
export const daysAgoYmd=days=>{const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10).replaceAll('-','')}
export const dateValue=v=>{const s=String(v||'').replace(/\D/g,'').slice(0,8);return s.length===8?Number(s):0}
export const normalizeCode=v=>String(v||'').replace(/^(sh|sz|bj)/i,'').replace(/\.(SZ|SH|BJ)$/i,'')
export const normalizeBars=bars=>[...new Map((Array.isArray(bars)?bars:[]).map(b=>[dateValue(b.trade_date||b.date||b.datetime||b.time),b]).filter(([d])=>d)).entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b)
export const isFreshTimestamp=(value,maxHours=18)=>{const t=Date.parse(value);return Number.isFinite(t)&&Date.now()-t>=0&&Date.now()-t<=maxHours*3600000}
export const isSessionTimestamp=(value,session)=>dateValue(value)===Number(session)
export const limitThreshold=(code,name='')=>/(ST|退)/i.test(name)?4.8:(String(code).includes('.BJ')?29.5:(String(code).startsWith('30')||String(code).startsWith('68')?19.5:9.5))
export async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));return out}

