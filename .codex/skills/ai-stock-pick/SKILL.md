---
name: ai-stock-pick
description: "Screen A-share stocks using a limit-up copy strategy: recent 10-day limit-up history, short pullback and rebound, theme/event evidence, stock character, liquidity, and market confirmation. Use when the user asks for stock picks, daily recommendations, limit-up review, board copying, entry/stop-loss/take-profit plans, or a reusable A-share screening workflow."
---

# AI Stock Pick

## Architecture contract

- Keep deterministic market rules and normalization in `src/domain`; they must not read environment variables or call remote services.
- Keep source-specific HTTP parsing and fallback adapters in `src/infrastructure/providers`.
- Keep scheduling and run-once behavior in `src/application`, and HTTP/email transport in `src/delivery`.
- Treat `server.mjs` as the composition root. Do not add new provider parsing, SMTP rendering, or HTTP routing directly to it.
- Preserve provider metadata and downgrade semantics across layer boundaries; architecture cleanup must not relax any hard recommendation gate.

## User-defined trading system

Apply the user’s original rules as the primary strategy:

1. Prefer stocks that have appeared limit-up at least once during the latest 10 trading sessions. One verified limit-up is sufficient for initial inclusion; repeated limit-ups are only a stock-character bonus.
2. Wait for a short pullback after the limit-up strength, then look for a limit-up-copy continuation opportunity.
3. Treat theme, stock character, and intraday behavior as the three core review dimensions.
4. Compare every claimed concept with the company’s main business: direct main-business coverage is core/正宗; subsidiary or indirect association is secondary.
5. For multi-theme stocks, identify the specific announcement, policy, or event that actually triggered the limit-up; do not count a generic announcement as the catalyst.
6. Record the full limit-up board from first board through the highest consecutive board, annotate each stock’s catalyst theme, and identify the market’s main line.
7. Prioritize new themes with multiple first-board stocks. Mark core/正宗 names, then rank by stock character, market value, and turnover to find potential leaders.

## Data fallback

- Use the local service health endpoint `/api/health` before querying recommendations.
- Prefer the `a-stock-data` adapter for the 10-session limit-up pool, Tencent quote and unadjusted daily K-line for limit detection, Baidu K-line fallback, and THS limit-up reason. Never infer a limit-up from adjusted percentage changes around ex-rights dates.
- Fall back in order to Tushare, Xiaoshi, and the legacy Eastmoney quote/K-line adapter. Preserve `source`, `fallback`, and `fallbackReason`.
- If no source supplies a complete 10-session pool, return observation only.

## Strategy definition

Do not equate “today rose to the limit” or “there is an announcement” with a valid setup. The sequence is:

1. Build the union of all limit-up stocks across the last 10 trading sessions, including first board, consecutive board count, failed-board/open count, and every limit-up date. The hard gate is simple: at least one verified limit-up in any of those 10 sessions is enough for initial inclusion; repeated limit-ups are a preference and scoring bonus, not a requirement. Never build the candidate pool from current-day limit-ups alone.
   Resolve the latest completed trading session first. On weekends, holidays, or before daily data finishes, use the previous completed session as `as_of`.
2. Group the table by theme. Identify the event or policy that triggered the limit-up, then compare the event with the company’s main business. Direct main-business exposure is `正宗`; subsidiary/grandchild-company or loose concept exposure is `间接` and cannot receive full theme points.
3. Prioritize new themes with multiple first-board stocks, then rank candidates by theme centrality, board position, stock character, circulating market value, and turnover. Do not select isolated stocks solely because their percentage change is high.
4. From the prioritized pool, require a 1–5-session pullback after the prior limit-up, a 2%–18% drawdown, at least 35% recovery of the peak-to-low range, and no extension above 103% of the prior peak. Treat pullback volume at or below 90% of limit-up-day volume as confirmation, not a substitute for price repair.
5. Use intraday data only to confirm opening strength, volume-price repair, support, and re-sealing; do not use it to manufacture a theme or replace the 10-session review.

The recommended order is `题材主线 → 涨停梯队 → 正宗性 → 股性/市值/成交量 → 回调复制 → 分时确认`, not price-first ranking.

Implementation gates: preserve the complete 10-session union before structural filtering. Treat the first item in a multi-item limit-up reason as the core catalyst and the remaining items as overlays. Require at least two stocks sharing that core theme on the theme's latest appearance date; score a newly appearing cluster with at least two first boards above ordinary breadth, then a consecutive-board ladder, then broad participation. Verify the core theme—not any overlay—against `stock_company.main_business` or `business_scope`; treat missing business data as unverified. Score circulating market cap explicitly, with 20–200亿元 as the preferred range and 10–300亿元 as the secondary range. Quote freshness must use the provider's exchange timestamp, never the local request time. During live trading require quote/minute timestamps within 15 minutes, with a lunch-break allowance; pre-market may use the previous completed session and after close requires closing-stage data.

## Hard rejection rules

- Do not recommend from a single current-day涨停 record when the 10-session history has not been verified.
- Do not treat a generic risk-warning, abnormal-volatility, board-meeting, repurchase-cancellation, or personnel announcement as a bullish theme catalyst by itself.
- Do not award full theme points to a company whose main business does not directly cover the claimed concept; label it indirect and downgrade it.
- Do not recommend an isolated first-board stock when the same theme has no breadth, no clear leader/front-rank structure, or no identifiable trigger event.
- Do not recommend a stock that has not completed a real short pullback and rebound; a high price after continued acceleration is not “涨停复制”.
- Do not recommend a stock whose latest three-session average turnover is below CNY 100 million or unavailable; downgrade it to observation.
- Do not use data after the declared `as_of` timestamp. Apply A-share T+1, limit-up unbuyable, limit-down unsellable, suspension, transaction-cost, and slippage constraints when backtesting.
- Normalize every K-line response by parsing its date, removing duplicates, sorting ascending, and dropping bars after `as_of` before calculating any sequence.
- Require fresh quote and minute timestamps from the intended session; non-empty stale arrays do not satisfy market confirmation.
- If Tushare `limit_list_d` is unavailable and only one-day `daily` threshold data is available, mark the 10-session gate unverified and return observation only unless another source supplies the complete history.
- Handle main-board, ChiNext/STAR, Beijing, and ST limit rules explicitly. Exclude IPO/no-limit periods when the applicable limit cannot be verified.

## Data-source integration

Keep credentials outside this Skill in environment variables or a secret manager. Never print or commit tokens/API keys.

### a-stock-data primary source

- Follow `simonlin1212/a-stock-data` routing: use Eastmoney push2ex for limit-up pools, Tencent for batch quotes, market-cap fields, and unadjusted daily K-lines for limit detection, Baidu as K-line fallback, and THS for limit-up reasons. Use adjusted bars only for optional structural trend analysis.
- Build the 10-session union from complete dated push2ex pools. Treat `data=null` as an unavailable/non-trading date, not an empty trading session.
- Serialize Eastmoney requests with at least a one-second interval. Do not fan them out concurrently.
- Reject Tencent stale quotes, normalize `920xxx` as Beijing-market symbols, and preserve float market cap separately from total market cap.
- Use THS reason, board type, seal rate, and break count as limit-up catalyst/stock-character evidence, while still checking main-business authenticity separately.
- Preserve provider metadata as `a-stock-data/Eastmoney push2ex`, `a-stock-data/Tencent`, `a-stock-data/Baidu`, or `a-stock-data/THS`.

### Tushare fallback

- Read `TUSHARE_TOKEN` and optional `TUSHARE_HTTP_URL` from the runtime environment.
- Prefer the Python bridge when the configured Python runtime is valid; otherwise use the HTTP API with JSON POST bodies containing `api_name`, `token`, `params`, and `fields`.
- Use `limit_list_d` for verified limit-up history when permission is available.
- If `limit_list_d` is unavailable, use `daily` and apply exchange-specific limit thresholds only as a documented fallback; mark the result as approximate.
- Use `stock_basic` for names/industries and `daily_basic` for turnover, volume ratio, and market value when permitted.
- Treat HTTP 200 with a non-zero Tushare `code` as an API failure, not as valid data.

### Xiaoshi fallback and enrichment

- Read `SHIZIXI_API_KEY` from the runtime environment and send `Authorization: Bearer <key>`.
- Check `/api/v3/auth/api-key/check` and read `/api/v3/manifest` once per new task when the connector is available.
- Use explicit `market=CN` and `instrument=stock` for quotes and daily k-lines.
- Use batch quotes first; if a quote is missing or identity validation fails, call the single-stock quote endpoint.
- Use `/api/v3/data/kline/{code}` for at least 20 daily bars, `/api/v3/stock/kline/{code}` for 1-minute bars, and `/api/v3/stock/announcements/{code}` for company announcements.
- Read news incrementally with `after_id`; record the returned event ID, title, time, source, direction, and affected stock.
- Handle HTTP 429 by waiting for `Retry-After`; do not label it as a software defect.

### SerpAPI/Baidu real-time news enrichment

- Read `SERPAPI_KEY`; query `engine=baidu` with the exact stock name and code plus `股票 公告 政策 题材`, Simplified Chinese output, and a latest-seven-day time filter.
- Keep at most five deduplicated items and preserve title, snippet, link, publication time, original source, and `provider=SerpAPI/Baidu`.
- Require an exact stock-name/code match plus a catalyst keyword before news can support the event gate, then compare the event with the company’s main business to classify it as `正宗` or `间接`.
- Never use search news as quote, K-line, limit-up, market-cap, turnover, or intraday evidence. Missing credentials/results must degrade cleanly to Xiaoshi announcements/news.

### Source metadata contract

Every result must expose `source` (`Tushare`, `Xiaoshi fallback`, or `unavailable`), `fallback`, `fallbackReason`, `updatedAt`, and per-quote `quote_timestamp`. If the source cannot provide an identity-verified quote, downgrade the candidate to `观察`.

## Overview

Return no more than three A-share candidates as a research shortlist. Require recent limit-up history, a verified short pullback and rebound, theme/event evidence, stock character, liquidity, and current-market confirmation. Never present the result as a guaranteed trade or personalized investment advice.

## Core workflow

1. Confirm at least one limit-up in the last 10 trading sessions; prefer repeated limit-ups and stable closing behavior.
2. Confirm a 1–5-session, 2%–18% short pullback after prior strength, preferably with shrinking volume, followed by at least 35% peak-to-low recovery.
3. Identify the theme from company business, sectors/concepts, announcements, and news. Separate direct-main-business evidence from indirect association.
4. Score stock character from limit-up frequency, board continuity, recognizability, and failed-board behavior.
5. Check liquidity, market cap, turnover, volume ratio, quote freshness, and intraday evidence.
6. Recommend only when recent-limit-up, valid-pullback, theme evidence, and total score ≥78 are all present; otherwise classify as watch or exclude.

## Score and trade-plan contract

Weight theme/event 25%, pullback/rebound 25%, stock character 20%, liquidity/market-cap fit 15%, current-market confirmation 15%. Emit all five component scores; do not hide them behind a single total.

For each of at most three recommendations output: entry trigger, a structure-derived entry zone and reference midpoint, entry timestamp, take-profit 1/2 as planning levels, stop-loss below pullback low or a declared cap, invalidation conditions, evidence completeness, and missing fields. Do not copy the current quote directly into the entry field without calculating the pullback structure. Use wording such as “计划价位/触发条件”, never a naked buy/sell command.

Use Xiaoshi for quotes, K-lines, announcements, sectors, and incremental news (`after_id`); preserve `market=CN` and `instrument=stock`. Use Tushare only as a fallback for daily or limit-up history. Never infer intraday承接、炸板、回封 or封单 from daily bars.

## Evidence gates

- K-line gate: use at least 20 daily bars; compute the pullback from the prior strength peak, require a 2%–18% drawdown and a rebound above the pullback low.
- Liquidity gate: require latest-three-session average turnover of at least CNY 100 million. Keep the raw amount, unit, calculation window, and provider auditable.
- Volume gate: compare volume from the limit-up day through the pullback trough only; mark contraction at ≤90%. Evaluate rebound-day expansion separately. Treat missing or mismatched units as unverified.
- Event gate: fetch stock announcements and related news; record title, publication time, source, direction, and whether the evidence is direct or indirect. Missing event evidence means watch, not recommend.
- Intraday gate: fetch Xiaoshi 1-minute bars when available. Confirm data freshness and bar count; never infer order-flow behavior from daily bars. Missing intraday data means watch.
- Quote identity gate: request `market=CN&instrument=stock`, verify returned name/market/instrument, and record quote timestamp and freshness.

## Recommendation contract

Return at most three rows sorted by the declared score. Each row must include score components, evidence links or identifiers, missing fields, and a trade plan with entry trigger/reference price, two planning take-profit levels, stop-loss, and invalidation conditions. If fewer than three pass all gates, return fewer; do not fill the quota with weak candidates.

## Output rules

- Recommend only when all hard gates pass and score is at least 78/100.
- Return fewer than three when fewer than three candidates qualify; never fill the quota.
- Every recommendation must include data source, timestamp, score breakdown, evidence identifiers, missing fields, entry trigger/reference price, two planning take-profit levels, stop-loss, and invalidation conditions.
- 明确给出止盈、止损和失效条件；止损优先放在回调低点下方，或使用声明过的风险上限。
- Missing daily k-line, event evidence, quote freshness, or 1-minute data means `观察`, not `推荐`.
- Use “计划价位”“触发条件”“失效条件”, not a naked buy/sell instruction. State fallback status and risks.

