# ai-stock-pick

A-share limit-up-copy stock screening workflow. GitHub Actions runs at 09:00 Asia/Shanghai on weekdays, analyzes candidates with Tushare and Xiaoshi, and emails qualified recommendations through QQ SMTP.

Required repository Actions secrets:

- `TUSHARE_TOKEN`
- `SHIZIXI_API_KEY`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_TO`

The workflow can also be started manually from the Actions tab.

