---
name: ai-stock-pick
description: "Screen A-share stocks using a limit-up copy strategy: recent 10-day limit-up history, short pullback and rebound, theme/event evidence, stock character, liquidity, and market confirmation. Use when the user asks for stock picks, daily recommendations, limit-up review, board copying, entry/stop-loss/take-profit plans, or a reusable A-share screening workflow."
---

# AI Stock Pick

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
- Prefer Tushare for the 10-session limit-up pool and daily history.
- If Tushare is unavailable, unauthorized, times out, or returns malformed data, use Xiaoshi and preserve `source`, `fallback`, and `fallbackReason`.
- If both sources fail, return no recommendations and state the unavailable data.

## Strategy definition

Do not equate “today rose to the limit” or “there is an announcement” with a valid setup. The sequence is:

1. Build the last 10 trading-session limit-up table, including first board, consecutive board count, failed-board/open count, and the limit-up date. The hard gate is simple: at least one verified limit-up in any of those 10 sessions is enough for initial inclusion; repeated limit-ups are a preference and scoring bonus, not a requirement. A single current-day `daily` threshold is only an approximate pool and cannot satisfy the 10-session gate by itself.
2. Group the table by theme. Identify the event or policy that triggered the limit-up, then compare the event with the company’s main business. Direct main-business exposure is `正宗`; subsidiary/grandchild-company or loose concept exposure is `间接` and cannot receive full theme points.
3. Prioritize new themes with multiple first-board stocks, then rank candidates by theme centrality, board position, stock character, circulating market value, and turnover. Do not select isolated stocks solely because their percentage change is high.
4. From the prioritized pool, require a short pullback after the prior limit-up strength, followed by reclaim/repair. Reject extended moves, deep breaks, and stocks that have not actually pulled back.
5. Use intraday data only to confirm opening strength, volume-price repair, support, and re-sealing; do not use it to manufacture a theme or replace the 10-session review.

The recommended order is `题材主线 → 涨停梯队 → 正宗性 → 股性/市值/成交量 → 回调复制 → 分时确认`, not price-first ranking.

## Hard rejection rules

- Do not recommend from a single current-day涨停 record when the 10-session history has not been verified.
- Do not treat a generic risk-warning, abnormal-volatility, board-meeting, repurchase-cancellation, or personnel announcement as a bullish theme catalyst by itself.
- Do not award full theme points to a company whose main business does not directly cover the claimed concept; label it indirect and downgrade it.
- Do not recommend an isolated first-board stock when the same theme has no breadth, no clear leader/front-rank structure, or no identifiable trigger event.
- Do not recommend a stock that has not completed a real short pullback and rebound; a high price after continued acceleration is not “涨停复制”.
- If Tushare `limit_list_d` is unavailable and only one-day `daily` threshold data is available, mark the 10-session gate unverified and return observation only unless another source supplies the complete history.

## Tushare and Xiaoshi integration

Keep credentials outside this Skill in environment variables or a secret manager. Never print or commit tokens/API keys.

### Tushare primary source

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

### Source metadata contract

Every result must expose `source` (`Tushare`, `Xiaoshi fallback`, or `unavailable`), `fallback`, `fallbackReason`, `updatedAt`, and per-quote `quote_timestamp`. If the source cannot provide an identity-verified quote, downgrade the candidate to `观察`.

## Overview

Return no more than three A-share candidates as a research shortlist. Require recent limit-up history, a verified short pullback and rebound, theme/event evidence, stock character, liquidity, and current-market confirmation. Never present the result as a guaranteed trade or personalized investment advice.

## Core workflow

1. Confirm at least one limit-up in the last 10 trading sessions; prefer repeated limit-ups and stable closing behavior.
2. Confirm a 2%–18% short pullback after prior strength, preferably with shrinking volume, followed by a reclaim of the pullback low.
3. Identify the theme from company business, sectors/concepts, announcements, and news. Separate direct-main-business evidence from indirect association.
4. Score stock character from limit-up frequency, board continuity, recognizability, and failed-board behavior.
5. Check liquidity, market cap, turnover, volume ratio, quote freshness, and intraday evidence.
6. Recommend only when recent-limit-up, valid-pullback, theme evidence, and total score ≥78 are all present; otherwise classify as watch or exclude.

## Score and trade-plan contract

Weight theme/event 25%, pullback/rebound 25%, stock character 20%, liquidity/market-cap fit 15%, current-market confirmation 15%.

For each of at most three recommendations output: entry trigger, entry reference price and timestamp, take-profit 1/2 as planning levels, stop-loss below pullback low or a declared cap, invalidation conditions, evidence completeness, and missing fields. Use wording such as “计划价位/触发条件”, never a naked buy/sell command.

Use Xiaoshi for quotes, K-lines, announcements, sectors, and incremental news (`after_id`); preserve `market=CN` and `instrument=stock`. Use Tushare only as a fallback for daily or limit-up history. Never infer intraday承接、炸板、回封 or封单 from daily bars.

## Evidence gates

- K-line gate: use at least 20 daily bars; compute the pullback from the prior strength peak, require a 2%–18% drawdown and a rebound above the pullback low.
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

## Structuring This Skill

[TODO: Choose the structure that best fits this skill's purpose. Common patterns:

**1. Workflow-Based** (best for sequential processes)
- Works well when there are clear step-by-step procedures
- Example: DOCX skill with "Workflow Decision Tree" -> "Reading" -> "Creating" -> "Editing"
- Structure: ## Overview -> ## Workflow Decision Tree -> ## Step 1 -> ## Step 2...

**2. Task-Based** (best for tool collections)
- Works well when the skill offers different operations/capabilities
- Example: PDF skill with "Quick Start" -> "Merge PDFs" -> "Split PDFs" -> "Extract Text"
- Structure: ## Overview -> ## Quick Start -> ## Task Category 1 -> ## Task Category 2...

**3. Reference/Guidelines** (best for standards or specifications)
- Works well for brand guidelines, coding standards, or requirements
- Example: Brand styling with "Brand Guidelines" -> "Colors" -> "Typography" -> "Features"
- Structure: ## Overview -> ## Guidelines -> ## Specifications -> ## Usage...

**4. Capabilities-Based** (best for integrated systems)
- Works well when the skill provides multiple interrelated features
- Example: Product Management with "Core Capabilities" -> numbered capability list
- Structure: ## Overview -> ## Core Capabilities -> ### 1. Feature -> ### 2. Feature...

Patterns can be mixed and matched as needed. Most skills combine patterns (e.g., start with task-based, add workflow for complex operations).

Delete this entire "Structuring This Skill" section when done - it's just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here. See examples in existing skills:
- Code samples for technical skills
- Decision trees for complex workflows
- Concrete examples with realistic user requests
- References to scripts/templates/references as needed]

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

**Examples from other skills:**
- PDF skill: `fill_fillable_fields.py`, `extract_form_field_info.py` - utilities for PDF manipulation
- DOCX skill: `document.py`, `utilities.py` - Python modules for document processing

**Appropriate for:** Python scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Codex for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Codex's process and thinking.

**Examples from other skills:**
- Product management: `communication.md`, `context_building.md` - detailed workflow guides
- BigQuery: API reference documentation and query examples
- Finance: Schema documentation, company policies

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Codex should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Codex produces.

**Examples from other skills:**
- Brand styling: PowerPoint template files (.pptx), logo files
- Frontend builder: HTML/React boilerplate project directories
- Typography: Font files (.ttf, .woff2)

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Not every skill requires all three types of resources.**

