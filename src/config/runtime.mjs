export function loadRuntimeConfig(env=process.env){
  return {
    port:Number(env.PORT||5201),
    runOnce:env.RUN_ONCE==='true',
    tushare:{token:env.TUSHARE_TOKEN||'',url:(env.TUSHARE_HTTP_URL||'http://api.tushare.pro').replace(/\/$/,'')},
    xiaoshi:{key:env.SHIZIXI_API_KEY||'',baseUrl:'https://api.shizixi.com'},
    serpApiKey:env.SERPAPI_KEY||'',
    mail:{host:env.SMTP_HOST||'smtp.qq.com',port:Number(env.SMTP_PORT||465),user:env.SMTP_USER||'',pass:env.SMTP_PASS||'',to:env.MAIL_TO||''}
  }
}

