# ai-stock-pick

A 股“涨停复制”选股与 QQ 邮件推送工具。GitHub Actions 在工作日北京时间 09:00 自动运行，电脑关机也不影响。

## 选股逻辑

1. 以近 10 个交易日全部涨停股的并集建立候选池；至少一次即可入池，多次涨停作为股性加分。
2. 定位最近一次非当日涨停，只计算其后 1–5 个交易日的回调；要求回撤 2%–18%、至少修复峰谷区间的 35%，并排除重新加速过度的股票。
3. 从公告、新闻、政策和主营业务判断涨停触发题材；主营直接覆盖为正宗题材，子公司或间接关联降级处理。
4. 检查回调是否缩量，并要求近 3 日日均成交额至少 1 亿元；综合题材、股性、流动性、行情快照和 1 分钟分时确认。
5. 最多推荐 3 只；未通过全部硬门槛时只列观察，不凑数。

系统先从数据中确定最近一个完整交易日，再构建近 10 个交易日涨停池。仅保留距基准日 1–5 个交易日的涨停标的进入结构计算，不再按成交额预先截断前 30 只。所有 K 线统一去重并按日期升序排列；盘前 09:00 使用上一完整交易日的行情和分时，盘中则要求当天实时数据。

当完整涨停池、行情身份、时间戳或分时无法核验时，结果自动降级为“观察”。ST、创业板/科创板、北交所分别使用对应涨停阈值；无法确认涨跌幅制度的新股阶段不应进入正式推荐。

推荐结果包含近 10 日涨停日期、五维评分明细、板后回调天数、回调低点、回调幅度、修复比例、缩量状态、近 3 日成交额、参考价、两档止盈、结构止损和失效条件。

## 数据源

- a-stock-data（最高优先级）：东财 push2ex 近 10 日涨停池、腾讯批量行情/市值/前复权日 K、百度备用日 K、同花顺涨停原因。
- Tushare：当 a-stock-data 不可用时，降级获取涨停池和日线基础数据。
- 小石金融：行情快照、20 日日线、公告和 1 分钟分时。
- 东方财富：当小石行情快照或日线不可用时，作为独立的行情/K 线降级源。
- SerpAPI（百度搜索）：补充候选股最近 7 天的实时金融新闻、政策和事件线索；新闻不替代行情或涨停事实。
- Tushare `limit_list_d` 无权限时自动使用 `daily`，并由小石 K 线补齐近 10 日涨停记录。

`a-stock-data` 接入采用 Node.js 适配器，不需要安装 Python 或 mootdx；东财端点已串行限流。上游项目采用 Apache License 2.0，归因见 `THIRD_PARTY_NOTICES.md`。

每只候选都会返回 `providers`，分别标明股票池、行情、日线、公告、新闻和分时实际采用的数据源；`related_news` 保留标题、摘要、链接、时间和来源。

## GitHub Actions

工作流文件：`.github/workflows/daily-stock-pick.yml`

- 自动执行：周一至周五，`Asia/Shanghai` 09:00。
- 手动执行：进入仓库 `Actions → Daily AI Stock Pick → Run workflow`。
- 云端运行：使用 Node.js 24、`actions/checkout@v7`、`actions/setup-node@v7`。

## Actions Secrets

在 `Settings → Secrets and variables → Actions` 配置：

- `TUSHARE_TOKEN`：Tushare Token。
- `SHIZIXI_API_KEY`：小石 API Key。
- `SERPAPI_KEY`：SerpAPI API Key，用于百度实时金融新闻检索。
- `SMTP_USER`：用于发信的 QQ 邮箱。
- `SMTP_PASS`：QQ 邮箱 SMTP 授权码，不是登录密码。
- `MAIL_TO`：接收推荐结果的邮箱。

密钥不得写入代码、README 或提交记录。

## 本地运行

```powershell
npm install
npm start
```

健康检查：`http://localhost:5201/api/health`

手动生成并推送：`http://localhost:5201/api/push`

运行逻辑测试：

```powershell
npm test
```

## 风险提示

本项目输出是规则筛选和计划价位，不构成投资建议或收益保证。涨停策略存在跳空、流动性、炸板、题材退潮和无法按计划止损等风险。

