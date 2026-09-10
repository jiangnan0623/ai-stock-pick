import {loadRuntimeConfig} from './src/config/runtime.mjs'
import {dateValue,normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit,ymd} from './src/domain/market-rules.mjs'
import {createMarketClients} from './src/infrastructure/providers/market-clients.mjs'
import {createRecommendationMailer} from './src/delivery/email.mjs'
import {createHttpServer} from './src/delivery/http.mjs'
import {runService} from './src/application/service-runtime.mjs'
import {isChinaMarketOpenDay} from './src/application/market-calendar.mjs'
import {createStockPickingService} from './src/application/stock-picking.mjs'

const config=loadRuntimeConfig()
const clients=createMarketClients(config)
const {recommendations}=createStockPickingService({config,clients})
const pushRecommendations=createRecommendationMailer(config.mail)
const isTradingDay=(dateYmd=ymd())=>isChinaMarketOpenDay(dateYmd,{tushare:clients.tushare,holidays:config.marketHolidays})
const health=()=>({ok:true,service:'ai-stock-pick-data',version:'1.6.0-theme-session-gates',sources:{a_stock_data:true,tushare:Boolean(config.tushare.token),xiaoshi:Boolean(config.xiaoshi.key),serpapi:Boolean(config.serpApiKey),eastmoney:true}})
const server=createHttpServer({health,recommendations,push:pushRecommendations})
if(process.env.NODE_ENV!=='test')await runService({config,server,recommendations,push:pushRecommendations,isTradingDay,beijingYmd:ymd})
export {dateValue,normalizeBars,isFreshTimestamp,isSessionTimestamp,limitThreshold,mapLimit}
