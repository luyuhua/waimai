# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

美团外卖自动出餐助手 — auto-click "cook complete" on Meituan (`waimaie.meituan.com`) and Taobao Flash/饿了么 (`melody.shop.ele.me`).

## Repo structure

```
src/
  pageAnalyzer.js              # DOM→structured data extractor
  domExtractor.bookmarklet.js  # Meituan order extraction, auto-cook engine, floating panel UI, cloud sync
  domExtractor.loader.js       # Bookmarklet entry: chain-loads above two scripts
  bookmarklet.loader.js        # Unified auto-detect loader (Meituan + Taobao Flash)
  taobaoFlash.bookmarklet.js   # DEPRECATED (API path, dead — 霸下 blocks it)
  taobaoFlash.loader.js        # DEPRECATED
docs/
  index.html                   # GitHub Pages landing page with drag-to-bookmark install
cdp/
  cdp_poc.py                   # PoC (verified): CDP find + click button, watch mode
cdp-extension/
  manifest.json                # chrome.debugger CDP extension
  service-worker.js            # CDP engine: attach → find iframe → query → click → confirm
  popup.html / popup.js        # Control panel UI
extension/
  service-worker.js            # TEST ONLY: SW fetch() API experiment (blocked by X5)
  content-script.js            # TEST ONLY: cookie extraction
supabase_schema.sql            # Supabase DDL: orders, order_products, order_events + RLS policies
```

## Architecture: three routes for Taobao Flash

| Route | Anti-fraud | Data storage | Complexity | Status |
|---|---|---|---|---|
| Bookmarklet / SW `fetch()` API | 霸下 blocks `window.fetch` + X5 blocks server-side | N/A | Low | **Dead** |
| CDP `Input.dispatchMouseEvent` | `isTrusted:true`, minimal surface | Need Python for SQLite | Medium | **PoC verified** |
| Cloud cookie-forwarding + API | Needs TLS spoof, proxy pool, signature reverse-engineering | Cloud DB | High (ongoing maintenance) | Store-bang-zhu's route |

### Route 1: API (dead)

- 霸下 hooks `window.fetch` and `XMLHttpRequest` in page context
- Extension Service Worker `fetch()` bypasses client-side hook, but X5 server-side validation still blocks (`FAIL_SYS_USER_VALIDATE` + captcha)
- Even with full headers (Referer, Origin, `_m_h5_tk` cookie), `queryInProcessOrders` blocked
- Root cause: `_m_h5_tk` CSRF token requires signature computed by page JS at request time — copying the cookie value is insufficient
- `getPollingStrategy` works (no X5 protection), proving SW `fetch()` itself is fine

### Route 2: CDP click (our path)

- `Input.dispatchMouseEvent` goes through Chromium's real input pipeline → `isTrusted:true`
- `Page.createIsolatedWorld` creates execution context in cross-origin iframe → bypass SOP for DOM reading
- PoC flow verified end-to-end: find iframe → query button → click → confirm dialog → verify
- `chrome.debugger` extension built, basic test passed (attach → find iframe → query works), awaiting real order test
- Yellow debug banner appears briefly during `debugger.attach()`; short attach/detach cycles minimize visibility

### Route 3: Cloud cookie-forwarding (store-bang-zhu)

- Extension uploads cookies + page signatures to cloud → cloud server makes API calls
- Requires: TLS fingerprint simulation (curl_cffi), residential proxy pool, page signature extraction + recomputation, behavior timing simulation
- Ongoing cost: must update signature algorithm every time饿了么 changes frontend code
- Viable for commercial SaaS with paying users; overkill for single-shop use

### Final decision (2026-06-20)

**Python CDP service is the right architecture going forward.** It gives us:
- CDP WebSocket → real Chrome (zero anti-fraud maintenance)
- SQLite for order data (needed for future operations dashboard)
- Single process, no extension-as-middleware complexity

The `chrome.debugger` extension can stay as a lightweight alternative when SQLite isn't needed yet, but Native Messaging (extension + Python) adds unnecessary complexity — if we need Python anyway, cut the extension and go direct CDP.

## Cloud database (Supabase)

**Supabase project**: `ubnjwhavibtyafyicrdv` (free tier, PostgreSQL + PostgREST REST API)

| Credential | Value | Usage |
|---|---|---|
| URL | `https://ubnjwhavibtyafyicrdv.supabase.co` | REST API base |
| Anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmp3aGF2aWJ0eWFmeWljcmR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMDcxNzUsImV4cCI6MjA5NzU4MzE3NX0.7_3fuNhchNVuLaM6cSzDoKWMAk4ZBZI1PuwMxxj1V8M` | Browser-side sync (RLS-gated) |
| Service role | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmp3aGF2aWJ0eWFmeWljcmR2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjAwNzE3NSwiZXhwIjoyMDk3NTgzMTc1fQ.v_YM3rJP_NOSn7KAr9mQ_AFzt3cXXx4ginQkH6UCUIc` | Server-side (bypasses RLS) |
| DB password | `lyh13795319022` | PostgreSQL direct connection (pooler user: `postgres.ubnjwhavibtyafyicrdv`) |

### Schema (3 tables)

- **orders** — 30 columns, unique on `order_no`. Includes all 27 fields from `extractOrders()` plus `raw_json` (full order object), `first_seen_at`, `last_updated_at`
- **order_products** — `order_no` FK → orders, unique on `(order_no, name)`. Stores line items (name, unit_price, quantity, total_price)
- **order_events** — status change log: `order_no`, `from_status`, `to_status`, `event_time`

All tables have RLS enabled with `anon_all_*` policies permitting full CRUD to anon role.

### Sync flow (Meituan bookmarklet → Supabase)

1. `checkOrders()` calls `syncOrdersToCloud(allOrders)` every poll cycle
2. `syncOrdersToCloud()` content-hashes each order (orderNo + status + riderStatus + cookRemainingTime), skips unchanged
3. Upserts changed orders via `POST /rest/v1/orders?on_conflict=order_no` with `Prefer: resolution=merge-duplicates`
4. Upserts products via `POST /rest/v1/order_products?on_conflict=order_no,name`
5. `syncOrderEvent()` logs status transitions to `order_events`
6. `autoCookAll()` syncs again 500ms after completing clicks
7. All sync requests are fire-and-forget (async, non-blocking), errors logged to console

### DDL notes

- `supabase_schema.sql` contains the full CREATE TABLE + RLS SQL. Paste into Supabase SQL Editor if tables need rebuilding.
- PostgREST only supports DML (CRUD), not DDL. Table creation requires SQL Editor or direct PostgreSQL connection.
- Direct PostgreSQL DNS (`db.ubnjwhavibtyafyicrdv.supabase.co`) may not resolve; use PgBouncer pooler at `aws-0-<region>.pooler.supabase.com:6543` with user `postgres.ubnjwhavibtyafyicrdv`.

## Key technical details (Meituan)

- **iframe**: Meituan loads orders inside `<iframe id="hashframe">`. Queries must run in iframe document context.
- **CSS Modules hashes**: Use `[class*="order-card"]` attribute-contains selectors, never exact class matches.
- **Cook button is `<div>`**: `<div class*="submit-button">`, not `<button>`. Search both.
- **Two status dimensions**: Order status and rider status are independent, determined by full-text keyword matching.
- **Pre-orders**: `isPreOrder` orders lack `cookRemainingTime`; virtual time = suggested cook deadline − 20 min.
- **CSP bypass**: Bookmarklet uses `javascript:` URL protocol — browsers treat as navigation, not script injection.

## Key technical details (Taobao Flash CDP)

- **Button query JS**: runs via `Runtime.evaluate` with isolated world `contextId`, searches `button` and `div[class*="submit"]`
- **Visibility check**: uses `getComputedStyle` + `getBoundingClientRect` + viewport bounds (not `offsetParent` — fails for React portals)
- **Coordinates**: `Input.dispatchMouseEvent` uses page coordinates = iframe viewport coords + iframe offset in main page
- **iframe offset**: must be obtained from main page `document.querySelector('iframe[src*="napos-order-pc"]').getBoundingClientRect()` — `window.frameElement` is null cross-origin
- **Isolated world**: `arguments[0]` is undefined; parameters must be interpolated into JS template string
- **Confirmation dialog**: may appear after clicking "上报出餐" ("您备餐时间太短，请确认是否真实上报出餐？"), buttons "稍后上报" / "真实上报"
- **Jitter**: add ±2px random jitter and 40-150ms delays between mouse events
- **Minimum cook time**: 60 seconds (platform limit, source: 银豹 docs)

## No build, no tests

Vanilla JS + Python scripts. No package.json, no build tools. Syntax-check JS with `node --check <file>`. Test Python with `python3 <file>`. Test Supabase REST calls with Node.js `fetch()` (use `pg` package for direct DB access when needed).

## Git push via local proxy

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 git push origin main
```
