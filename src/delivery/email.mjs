import nodemailer from 'nodemailer'

const escapeHtml=value=>String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const price=value=>Number.isFinite(Number(value))?Number(value).toFixed(2):'—'
const beijingLimitTime=value=>{
  const digits=String(value||'').replace(/\D/g,'').slice(0,8)
  if(digits.length!==8)return '—'
  return `${digits.slice(0,4)}年${digits.slice(4,6)}月${digits.slice(6,8)}日 15时00分（收盘确认）`
}
const briefAnalysis=item=>[
  item.theme_evidence?.title?`题材：${item.theme_evidence.title}`:null,
  `板后回调${item.technical?.post_limit_days??'—'}日，幅度${item.technical?.pullback_pct??'—'}%`,
  item.technical?.volume_contracted?'回调缩量':'缩量尚未确认',
  item.checks?.intraday||null,
  item.trade_plan?.entry_trigger||null
].filter(Boolean).join('；')

export function buildRecommendationEmail(data){
  const rows=data.recommendations.map(item=>`<tr><td>${escapeHtml(item.name)}<br>${escapeHtml(item.code)}</td><td>${beijingLimitTime(item.technical?.prior_limit_date)}</td><td>${price(item.technical?.limit_up_price)}</td><td>${escapeHtml(item.technical?.pullback_pct)}%<br>低点 ${price(item.technical?.pullback_low)}</td><td>${price(item.price)}</td><td>${price(item.trade_plan?.entry_reference)}</td><td>${price(item.trade_plan?.take_profit_1)} / ${price(item.trade_plan?.take_profit_2)}</td><td>${price(item.trade_plan?.stop_loss)}</td><td>${escapeHtml(briefAnalysis(item))}</td></tr>`).join('')
  return {
    subject:`AI选股推荐｜${data.date}`,
    html:`<h2>AI选股推荐</h2><p>数据源：${escapeHtml(data.source)}</p><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>股票</th><th>上一次涨停板时间（北京时间）</th><th>涨停价格</th><th>回调</th><th>当前价格</th><th>建仓价</th><th>止盈</th><th>止损</th><th>简要分析</th></tr></thead><tbody>${rows}</tbody></table><p>说明：日线源不提供实际封板分钟时，时间显示为当日15时收盘确认，不代表首次封板时刻。</p><p>仅为策略筛选和计划价位，不构成投资建议。</p>`
  }
}

export function createRecommendationMailer(config){
  let lastPushDate=''
  return async function pushRecommendations(data){
    if(!data.recommendations?.length)return {sent:false,reason:'无正式推荐'}
    if(lastPushDate===data.date)return {sent:false,reason:'今日已推送'}
    if(!config.user||!config.pass||!config.to)throw Error('未配置 SMTP_USER、SMTP_PASS 或 MAIL_TO')
    const transporter=nodemailer.createTransport({host:config.host,port:config.port,secure:true,auth:{user:config.user,pass:config.pass}})
    const content=buildRecommendationEmail(data)
    await transporter.sendMail({from:config.user,to:config.to,...content})
    lastPushDate=data.date;return {sent:true,to:config.to.replace(/^(.{3}).*(@.*)$/,'$1***$2')}
  }
}

