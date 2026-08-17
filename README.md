# ai-stock-pick

A 股“涨停复制”选股与 QQ 邮件推送工具。GitHub Actions 在工作日北京时间 09:00 自动运行，电脑关机也不影响。

## 选股逻辑

1. 初筛近 10 个交易日内至少出现过一次涨停的股票；多次涨停作为股性加分，不是硬要求。
2. 定位最近一次非当日涨停，只计算该涨停之后的短暂回调和修复，避免把涨停前回调误判为涨停复制。
3. 从公告、新闻、政策和主营业务判断涨停触发题材；主营直接覆盖为正宗题材，子公司或间接关联降级处理。
4. 综合题材、股性、市值、成交量、行情快照和 1 分钟分时确认。
5. 最多推荐 3 只；未通过全部硬门槛时只列观察，不凑数。

推荐结果包含近 10 日涨停日期、板后回调天数、回调低点、回调幅度、参考价、两档止盈、结构止损和失效条件。

## 数据源

- Tushare：涨停池和日线基础数据。
- 小石金融：行情快照、20 日日线、公告和 1 分钟分时。
- 东方财富：当小石行情快照或日线不可用时，作为独立的行情/K 线降级源。
- Tushare `limit_list_d` 无权限时自动使用 `daily`，并由小石 K 线补齐近 10 日涨停记录。

每只候选都会返回 `providers`，分别标明股票池、行情、日线、公告和分时实际采用的数据源，便于核验和排查降级情况。

## GitHub Actions

工作流文件：`.github/workflows/daily-stock-pick.yml`

- 自动执行：周一至周五，`Asia/Shanghai` 09:00。
- 手动执行：进入仓库 `Actions → Daily AI Stock Pick → Run workflow`。
- 云端运行：使用 Node.js 24、`actions/checkout@v7`、`actions/setup-node@v7`。

## Actions Secrets

在 `Settings → Secrets and variables → Actions` 配置：

- `TUSHARE_TOKEN`：Tushare Token。
- `SHIZIXI_API_KEY`：小石 API Key。
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

## 风险提示

本项目输出是规则筛选和计划价位，不构成投资建议或收益保证。涨停策略存在跳空、流动性、炸板、题材退潮和无法按计划止损等风险。

