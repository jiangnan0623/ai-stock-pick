import {ymd} from '../domain/market-rules.mjs'

const beijingParts=(value=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))

export function isBeijingTradingWindow(value=new Date(),{openHour=9,closeHour=16}={}){
  const parts=beijingParts(value)
  if(parts.weekday==='Sat'||parts.weekday==='Sun')return false
  const hour=Number(parts.hour)
  return hour>=openHour&&hour<closeHour
}

async function skipIfNotTradingDay({isTradingDay,beijingYmd,logger,verbose=false}){
  if(typeof isTradingDay!=='function')return false
  const date=beijingYmd()
  try{
    const open=await isTradingDay(date)
    if(!open){
      if(verbose)logger.log(JSON.stringify({skipped:true,reason:'非交易日（周末或法定节假日）',date},null,2))
      return true
    }
  }catch(error){
    logger.error('交易日检查失败，继续执行:',error.message)
  }
  return false
}

export async function runService({config,server,recommendations,push,logger=console,pollIntervalMs=5*60*1000,isTradingDay,beijingYmd=ymd}){
  if(config.runOnce){
    try{
      if(await skipIfNotTradingDay({isTradingDay,beijingYmd,logger,verbose:true}))return
      const data=await recommendations()
      const pushResult=await push(data)
      logger.log(JSON.stringify({date:data.date,source:data.source,recommendations:data.recommendations,paperCandidates:data.paperCandidates,push:pushResult},null,2))
    }catch(error){
      logger.error(error.message)
      process.exitCode=1
    }
    return
  }

  server.listen(config.port,()=>logger.log(`ai-stock-pick data service: http://localhost:${config.port}`))
  setInterval(async()=>{
    if(!isBeijingTradingWindow())return
    if(await skipIfNotTradingDay({isTradingDay,beijingYmd,logger}))return
    try{
      const data=await recommendations()
      await push(data)
    }catch(error){
      logger.error('QQ mail push failed:',error.message)
    }
  },pollIntervalMs)
}
