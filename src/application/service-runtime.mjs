export async function runService({config,server,recommendations,push,logger=console}){
  if(config.runOnce){
    try{
      const data=await recommendations()
      const pushResult=await push(data)
      logger.log(JSON.stringify({date:data.date,source:data.source,recommendations:data.recommendations,push:pushResult},null,2))
    }catch(error){
      logger.error(error.message)
      process.exitCode=1
    }
    return
  }

  server.listen(config.port,()=>logger.log(`ai-stock-pick data service: http://localhost:${config.port}`))
  setInterval(async()=>{
    const now=new Date()
    if(now.getDay()===0||now.getDay()===6||now.getHours()<9)return
    try{
      const data=await recommendations()
      await push(data)
    }catch(error){
      logger.error('QQ mail push failed:',error.message)
    }
  },60*1000)
}

