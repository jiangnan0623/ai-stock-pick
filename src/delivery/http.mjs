import http from 'node:http'

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data))}

export function createHttpServer({health,recommendations,push}){
  return http.createServer(async(req,res)=>{
    if(req.url==='/api/health')return json(res,200,health())
    if(req.url==='/api/recommendations')try{return json(res,200,await recommendations())}catch(e){return json(res,500,{error:e.message})}
    if(req.url==='/api/push')try{const data=await recommendations();return json(res,200,{...(await push(data)),count:data.recommendations.length,date:data.date})}catch(e){return json(res,500,{error:e.message})}
    return json(res,404,{error:'Not found'})
  })
}

