const beijingParts=(value=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))

export function isBeijingTradingWindow(value=new Date(),{openHour=9,closeHour=16}={}){
  const parts=beijingParts(value)
  if(parts.weekday==='Sat'||parts.weekday==='Sun')return false
  const hour=Number(parts.hour)
  return hour>=openHour&&hour<closeHour
}

export async function runService({config,server,recommendations,push,logger=console,pollIntervalMs=5*60*1000}){
  if(config.runOnce){
    try{
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
    try{
      const data=await recommendations()
      await push(data)
    }catch(error){
      logger.error('QQ mail push failed:',error.message)
    }
  },pollIntervalMs)
}
