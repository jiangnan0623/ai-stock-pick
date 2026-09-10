import {ymd} from '../domain/market-rules.mjs'

const holidayCnUrl=year=>`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`

export const parseHolidayList=value=>new Set(String(value||'').split(',').map(item=>item.replace(/\D/g,'')).filter(item=>item.length===8))

export function isWeekendYmd(value){
  const day=String(value||'').replace(/\D/g,'')
  if(day.length!==8)return false
  const date=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(4,6))-1,Number(day.slice(6,8))))
  const weekday=date.getUTCDay()
  return weekday===0||weekday===6
}

export async function isChinaMarketOpenDay(dateYmd,{tushare,holidays='',fetchImpl=fetch}={}){
  const day=String(dateYmd||ymd()).replace(/\D/g,'')
  if(day.length!==8)return false
  if(isWeekendYmd(day))return false
  if(parseHolidayList(holidays).has(day))return false
  if(typeof tushare==='function'){
    try{
      const rows=await tushare('trade_cal',{exchange:'SSE',start_date:day,end_date:day,is_open:''},'cal_date,is_open')
      const row=(rows||[]).find(item=>String(item.cal_date).replace(/\D/g,'')===day)
      if(row)return Number(row.is_open)===1
    }catch{}
  }
  try{
    const response=await fetchImpl(holidayCnUrl(Number(day.slice(0,4))),{signal:AbortSignal.timeout(8000)})
    if(response.ok){
      const payload=await response.json()
      const offDays=new Set((payload.days||[]).filter(item=>item.isOffDay).map(item=>String(item.date).replace(/\D/g,'')))
      if(offDays.has(day))return false
      if(offDays.size)return true
    }
  }catch{}
  return true
}
