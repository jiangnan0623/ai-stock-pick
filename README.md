# ai-stock-pick

A 股“涨停复制”选股与 QQ 邮件推送工具。GitHub Actions 在工作日北京时间 09:00 自动运行，电脑关机也不影响。

## 选股逻辑

1. 以近 10 个交易日全部涨停股的完整并集建立候选池；至少一次即可入池，多次涨停作为股性加分，不在建池阶段按涨停距今天数裁剪。
2. 定位最近一次非当日涨停，只计算其后 1–5 个交易日的回调；要求回撤 2%–18%、至少修复峰谷区间的 35%，并排除重新加速过度的股票。
3. 以涨停原因第一项作为核心题材，将其余项目视为叠加概念；正式推荐要求该核心题材最新出现日至少 2 只股票共同涨停，并通过 Tushare `stock_company` 核验核心题材由主营直接覆盖。子公司、间接关联或主营资料缺失时降级观察。
4. 检查回调是否缩量，并要求近 3 日日均成交额至少 1 亿元；流通市值 20–200 亿元获得最高适配分，10–300 亿元获得次级分。综合题材、股性、流动性、行情快照和 1 分钟分时确认。
5. 最多推荐 3 只；未通过全部硬门槛时只列观察，不凑数。

系统先从数据中确定最近一个完整交易日，再构建近 10 个交易日涨停池。仅保留距基准日 1–5 个交易日的涨停标的进入结构计算，不再按成交额预先截断前 30 只。所有 K 线统一去重并按日期升序排列；盘前 09:00 使用上一完整交易日的行情和分时，盘中则要求当天实时数据。

当完整涨停池、行情身份、时间戳或分时无法核验时，结果自动降级为“观察”。ST、创业板/科创板、北交所分别使用对应涨停阈值；无法确认涨跌幅制度的新股阶段不应进入正式推荐。

盘中行情和分时要求距离当前时间不超过 15 分钟；午间休市允许使用上午收盘附近数据；盘前使用上一完整交易日，收盘后要求当天 14:45 之后的收盘阶段数据。Tushare 降级时优先使用 `limit_list_ths` 补齐涨停原因、首板集群和梯队，权限不足才退回普通涨停榜。

每天都会发送邮件：没有股票通过全部硬门槛时，邮件明确写明“今日无正式推荐”，并列出最多 3 只重点观察及其缺失条件。

推荐结果包含近 10 日涨停日期、五维评分明细、板后回调天数、回调低点、回调幅度、修复比例、缩量状态、近 3 日成交额、参考价、两档止盈、结构止损和失效条件。

## 数据源

- a-stock-data（最高优先级）：东财 push2ex 近 10 日涨停池、腾讯批量行情/市值、腾讯不复权日 K（用于涨停识别）、百度备用日 K、同花顺涨停原因；除权结构分析不得把复权涨跌幅当作涨停事实。
- Tushare：当 a-stock-data 不可用时，降级获取涨停池和日线基础数据。
- 小石金融：行情快照、20 日日线、公告和 1 分钟分时。
- 东方财富：当小石行情快照或日线不可用时，作为独立的行情/K 线降级源。
- SerpAPI（百度搜索）：补充候选股最近 7 天的实时金融新闻、政策和事件线索；新闻不替代行情或涨停事实。
- Tushare `limit_list_d` 无权限时自动使用 `daily`，并由小石 K 线补齐近 10 日涨停记录。

`a-stock-data` 接入采用 Node.js 适配器，不需要安装 Python 或 mootdx；东财端点已串行限流。上游项目采用 Apache License 2.0，归因见 `THIRD_PARTY_NOTICES.md`。

每只候选都会返回 `providers`，分别标明股票池、行情、日线、公告、新闻和分时实际采用的数据源；`related_news` 保留标题、摘要、链接、时间和来源。

## GitHub Actions

工作流文件：`.github/workflows/daily-stock-pick.yml`

- 自动执行：周一至周五，`Asia/Shanghai` 09:05；避开整点高峰，GitHub 仍可能因平台负载延迟。
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

## 项目架构

```text
server.mjs                         # 组合根：装配策略、数据源与交付层
src/
  config/runtime.mjs              # 环境变量与运行配置
  domain/market-rules.mjs         # 无副作用的市场规则和数据标准化
  infrastructure/providers/       # a-stock-data 与其他外部金融数据源客户端
  application/service-runtime.mjs # 单次任务、常驻服务与定时推送编排
  delivery/http.mjs               # HTTP API
  delivery/email.mjs              # QQ SMTP 邮件交付
test/strategy.test.mjs            # 领域规则与数据适配回归测试
```

依赖方向保持为“入口 → 应用/交付/基础设施 → 领域规则”。新增数据源应放入 `infrastructure/providers`，选股门槛与计算规则放入 `domain`，HTTP 和邮件不得承载策略判断。根目录 `a-stock-data.mjs` 暂作为兼容入口，由基础设施层统一转出，避免破坏已有脚本。

## 风险提示

本项目输出是规则筛选和计划价位，不构成投资建议或收益保证。涨停策略存在跳空、流动性、炸板、题材退潮和无法按计划止损等风险。

