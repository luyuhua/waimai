# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

美团外卖自动出餐助手 (Meituan Waimai Auto-Cook Assistant) — a bookmarklet that injects into the Meituan merchant order page (`waimaie.meituan.com`) to automatically monitor orders and click the "cook complete" button on a timer.

Now also supports **淘宝闪购 (饿了么商家版, `melody.shop.ele.me`)** with the `taobaoFlash.*` scripts.

## Repo structure

```
src/
  pageAnalyzer.js              # Standalone DOM→structured data extractor (from alibaba/page-agent)
  domExtractor.bookmarklet.js  # Main business logic: order extraction, auto-cook engine, floating panel UI
  domExtractor.loader.js       # Chain loader: loads pageAnalyzer.js then bookmarklet.js
  taobaoFlash.bookmarklet.js   # 淘宝闪购业务逻辑（骨架版，等待订单 HTML 补完）
  taobaoFlash.loader.js        # 淘宝闪购 loader
docs/
  index.html                   # GitHub Pages landing page with drag-to-bookmark install button
```

## Architecture

Two independent scripts loaded sequentially — neither imports the other:

1. **`pageAnalyzer.js`** — pure DOM analysis tool. Exposes `window.domExtractor()`, `window.getInteractiveElements()`, `window.findElementByText()`. Runs once on load, prints results to console. Does NOT reference any Meituan business logic.

2. **`domExtractor.bookmarklet.js`** — all Meituan-specific business logic. Order extraction from DOM (`extractOrders()`), auto-cook rule engine, floating control panel UI, order monitoring loop. Uses `window.__` prefixed globals for state (`__orders`, `__monitorInterval`, `__cookTimers`, etc.).

3. **`domExtractor.loader.js`** — the bookmarklet entry point. Creates `<script>` tags to chain-load pageAnalyzer.js then bookmarklet.js from GitHub Pages CDN.

## Deployment

Static files served via GitHub Pages at `https://luyuhua.github.io/waimai/src/`. The bookmarklet `href` loads `domExtractor.loader.js` from this CDN. No build step — edit JS directly, commit, push.

## Key technical details

- **iframe**: The Meituan order page loads content inside `<iframe id="hashframe">`. All order DOM queries must run in the iframe's document context. `extractOrders()` auto-detects whether it's inside or outside the iframe.
- **CSS Modules hashes**: All Meituan class names have hash suffixes (e.g., `order-card_a1b2c`). Use `[class*="order-card"]` attribute-contains selectors, never exact class matches.
- **Cook button is `<div>`**: The "出餐完成" button is `<div class*="submit-button">`, not `<button>`. `getCardButtons()` searches both.
- **Two status dimensions**: Order status (`pending_accept` → `pending_cook` → `cooked`) and rider status (`待分配骑手` → `骑手已到店` → `骑手已取餐`) are independent. Status is determined by full-text keyword matching, NOT from `baseInfoRight` element.
- **Pre-orders**: `isPreOrder` orders lack `cookRemainingTime`; virtual order time = suggested cook deadline − 20 minutes.
- **CSP bypass**: Bookmarklet uses `javascript:` URL protocol (inline code), which browsers treat as navigation rather than script injection — bypasses Content Security Policy. Dynamic `<script>` tags would be blocked on strict-CSP sites.

## No build, no tests

This is vanilla JS with no package.json, no build tools, no test framework. To verify changes: push to `main`, then load the bookmarklet on the Meituan merchant page and test manually. Syntax-check with `node --check <file>`.

## Git push via local proxy

`git push` goes through local proxy at `http://127.0.0.1:7890` (HTTP/HTTPS). If the proxy is down or not running, push will hang on connection. Set on the command line:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 git push origin main
```
