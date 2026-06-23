# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

美团外卖自动出餐助手 — auto-click "cook complete" on Meituan (`waimaie.meituan.com`) and Taobao Flash/饿了么 (`melody.shop.ele.me`).

## Architecture

### Meituan → Bookmarklet (browser JS injection)

User clicks bookmark → `domExtractor.bookmarklet.js` injects into page:
- **DOM extraction** (`extractOrders`) → queries inside iframe `#hashframe`, CSS Modules fuzzy match (`[class*="..."]`)
- **Auto-cook** (`autoCookAll`) → direct `element.click()`, `isTrusted:true`
- **Voice announcement** (Web Speech API) → new order remarks after 5s delay, repeated 2×, filters boilerplate
- **Cloud sync** (`syncOrdersToCloud`) → Supabase PostgREST REST API, fire-and-forget

### Taobao Flash (饿了么) → Chrome Extension + chrome.debugger (CDP)

`cdp-extension/` extension:
- `chrome.debugger.attach()` → `Page.enable` / `Runtime.enable`
- `Page.getFrameTree` → walk tree for iframe `napos-order-pc.faas.ele.me`
- `Page.createIsolatedWorld` → create JS execution context in cross-origin iframe (bypass SOP)
- `Runtime.evaluate` → query `button` / `div[class*="submit"]`, verify visibility with `getComputedStyle` + `getBoundingClientRect` + viewport bounds
- `Input.dispatchMouseEvent` (page coords = iframe coords + iframe offset, ±2px jitter + 40-150ms delays)
- Confirmation dialog detection → click "真实上报"
- `chrome.alarms` periodic polling, `chrome.debugger.detach()` after each cycle

`cdp/cdp_poc.py` — same logic via direct CDP WebSocket (PoC verified end-to-end).

### Cloud DB (Supabase)

Supabase project `ubnjwhavibtyafyicrdv` (free tier, PostgreSQL + PostgREST). 3 tables: `orders` (30 columns, unique on `order_no`), `order_products` (FK → orders), `order_events` (status change log). RLS enabled with `anon_all_*` policies (full CRUD for anon role). See `supabase_schema.sql` for DDL.

Sync flow: `checkOrders()` → hash orders by (orderNo+status+riderStatus+cookRemainingTime) → skip unchanged → upsert via `POST /rest/v1/orders?on_conflict=order_no` with `Prefer: resolution=merge-duplicates` → upsert products → log status transitions. All fire-and-forget.

## Repo structure

```
src/
  pageAnalyzer.js              # DOM → structured data extractor
  domExtractor.bookmarklet.js  # Meituan engine: extract, auto-cook, voice, cloud sync, UI panel
  domExtractor.loader.js       # Bookmarklet entry: chain-loads pageAnalyzer + domExtractor
  bookmarklet.loader.js        # Unified loader (auto-detect Meituan vs Taobao Flash)
cdp/
  cdp_poc.py                   # Python CDP PoC: find + click button, watch mode (verified)
  chrome_launcher.sh           # Chrome launch helper for CDP debugging
cdp-extension/
  manifest.json                # chrome.debugger extension manifest
  service-worker.js            # CDP engine: attach → find iframe → query → click → confirm
  popup.html / popup.js        # Control panel UI
docs/
  index.html                   # GitHub Pages landing page with drag-to-bookmark install
supabase_schema.sql            # Supabase DDL: orders, order_products, order_events + RLS
```

## Key technical details (Meituan)

- **iframe**: Orders load inside `<iframe id="hashframe">`. All DOM queries must run in iframe document context.
- **CSS Modules**: Use `[class*="order-card"]` attribute-contains selectors. Never match exact class names.
- **Cook button is `<div>`**: `<div class*="submit-button">`, not `<button>`. Search both.
- **Two status dimensions**: Order status and rider status are independent, determined by keyword matching.
- **Pre-orders**: `isPreOrder` orders lack `cookRemainingTime`; virtual time = suggested cook deadline − 20 min.
- **CSP bypass**: Bookmarklet loads via `javascript:` URL — browsers treat as navigation, not script injection.

## Key technical details (Taobao Flash CDP)

- **Button query**: runs via `Runtime.evaluate` with isolated world `contextId`, searches `button` and `div[class*="submit"]`
- **Visibility**: uses `getComputedStyle` + `getBoundingClientRect` + viewport bounds (NOT `offsetParent` — fails for React portals)
- **Coordinates**: page coords = iframe viewport coords + iframe offset from main page `getBoundingClientRect()`
- **iframe offset**: must query from main page — `window.frameElement` is null in cross-origin iframe
- **Isolated world**: `arguments[0]` is undefined; interpolate parameters into JS template string directly
- **Jitter**: ±2px random jitter + 40-150ms delays between mouse events
- **Min cook time**: 60 seconds (platform limit)

## No build, no tests

Vanilla JS + Python. No package.json, no build tools. Syntax-check JS with `node --check <file>`. Test Python with `python3 <file>`.

## Git push via local proxy

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 git push origin main
```
