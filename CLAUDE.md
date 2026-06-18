# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

美团外卖自动出餐助手 (Meituan Waimai Auto-Cook Assistant) — a bookmarklet that injects into the Meituan merchant order page (`waimaie.meituan.com`) to automatically monitor orders and click the "cook complete" button on a timer.

Now also supports **淘宝闪购 (饿了么商家版, `melody.shop.ele.me`)** with the `taobaoFlash.*` scripts. See [Taobao Flash development log](#taobao-flash-development-log) for the full history of architectural decisions and pitfalls.

## Repo structure

```
src/
  pageAnalyzer.js              # Standalone DOM→structured data extractor (from alibaba/page-agent)
  domExtractor.bookmarklet.js  # Main business logic: order extraction, auto-cook engine, floating panel UI
  domExtractor.loader.js       # Chain loader: loads pageAnalyzer.js then bookmarklet.js (Meituan only)
  bookmarklet.loader.js        # Unified auto-detect loader (Meituan + Taobao Flash)
  taobaoFlash.bookmarklet.js   # DEPRECATED (Phase 3 API script, kept for reference, no longer developed)
  taobaoFlash.loader.js        # DEPRECATED (Taobao-only loader, kept for reference)
docs/
  index.html                   # GitHub Pages landing page with drag-to-bookmark install button
```

**Note on Taobao Flash scripts**: The bookmarklet-based approach is dead (霸下风控 blocks both DOM and API paths). Future Taobao Flash work will live in a separate `cdp/` directory outside `src/`, since CDP-based automation is a local service, not a browser script.

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

## Taobao Flash development log

### Goal

Add automatic cook-complete to Taobao Flash (饿了么商家版) merchant order page at `melody.shop.ele.me`.

### Current architecture decision (2026-06-19): CDP 接管用户 Chrome

**死路**:纯 JS 脚本(无论 DOM 还是 API)在阿里霸下风控面前都失效。
- 霸下 hook 了 `window.fetch` 和 `XMLHttpRequest` 的完成回调,会判断请求是否来自用户点击上下文
- 脚本里 `fetch()` / `XHR.send()` / `el.click()`(程序化点击 `isTrusted=false`) 全部会被识别为脚本操作,触发风控
- 阿里针对不同 UA 有差异化风控(Chrome 比 Edge 容忍度高),即使完全换写法也救不回来
- "未登录" 在 `window.open(iframe.src)` 出现是反爬检测 `window.opener` 的结果,不是真的登出

**生路**:**CDP 接管用户已登录的 Chrome**,用真实鼠标输入事件点 iframe 里的"上报出餐"按钮。
- `Input.dispatchMouseEvent` 走 Chromium `RenderWidgetHostInputDelegate` 真实输入管道,产生的事件 `isTrusted: true`,调用栈里有正常 click 事件,霸下识别为用户操作
- `Runtime.evaluate` + iframe 的 `executionContextId` 可以跑 JS 进跨域 iframe,效果等价于"关 SOP 读 DOM"
- 关键:**用用户已养好画像的 Chrome**,不重新启动新会话(避免新会话的低信任度)
- 跨域 iframe 的 `executionContextId` 通过 `Page.createIsolatedWorld` 在跨域 frame 里建执行上下文取得

#### PoC 计划

1. 启动用户 Chrome 时加 `--remote-debugging-port=9222`
2. Python/Node 脚本连 `ws://127.0.0.1:9222/devtools/page/<targetId>`
3. 用 `Page.getFrameTree` 找 `napos-order-pc.faas.ele.me` 的 frame
4. `Page.createIsolatedWorld` 在该 frame 建执行上下文
5. `Runtime.evaluate` 查询"上报出餐"按钮位置 (`getBoundingClientRect`)
6. `Input.dispatchMouseEvent` 发 `mouseMoved` → `mousePressed` → `mouseReleased`,加 50-150ms 随机延迟模拟人手
7. **等真实 pending_cook 订单到来时手动触发一次,只点一单,观察风控是否弹**
8. 单点成功后,扩成 120s 轮询 + 多订单节流

#### 风险点(预判)

- **霸下有"行为画像"**:用用户已养熟的 Chrome,不要新装/隐身模式
- **淘宝改版**:按钮文案可能变,`includes('出餐')` 比精确匹配稳
- **多订单节流**:不要 1 秒内点 5 单,加 1-3s 随机间隔
- **CDP 协议本身公开标准**,Chromium 不在 `navigator` 留指纹,但霸下未来可能加检测,长期需要备用方案

### Phase 1–4 历史(已废,仅供复盘)

**Phase 1 (DOM-based, 失败)**:跨域 iframe 阻挡 `contentDocument` / `eval`;`window.open` 被反爬检测 `window.opener` 报"未登录"。

**Phase 2 (API 摸清, 成功)**:确认 `app-api.shop.ele.me/fulfill/weborder/<endpoint>/` JSON-RPC 可用,主要端点:
- `OrderWebService.queryInProcessOrders` (PRIMARY,完整订单列表)
- `ShipmentService.mealComplete` (上报出餐)
- `PollingService.getPollingStrategy` 返回 `pollingInterval: 120000`
- 鉴权:`metas.ksid` 从 `document.cookie` 取 + `x-shard: shopid=<shopId>` header

**Phase 3 (API 脚本写完, 失败)**:在 `taobaoFlash.bookmarklet.js` 里实现了 `apiCall` / `extractOrders` / `mealComplete` / `monitorOrders`,加了 120s 轮询下限、captcha 关键字识别、5min 退避(×2 → ×8)、冷启动试探。Chrome 上对没有 in-process 订单的店铺能跑通骨架。

**Phase 4 (Edge + 霸下风控, 死路)**:Edge 一启动就弹风控。调查发现 `baxiaCommon.js / HookBX$1.window.fetch` hook 了 fetch,XHR 也被 hook(`onerror status=200 readyState=4`)。fetch reject 的 error 是个 `Response` 对象(`[object Response]`)。**根因**:霸下在另一通道同步通知淘宝后端"该请求来自脚本",跟 fetch/XHR 的实现细节无关,跟 Edge UA 的会话信任度也无关(只是触发条件之一)。

**已尝试且失败的反风控措施**(都不要重复做):
- 改用 XHR ✗
- 加 120s 轮询下限 ✗(仍然累加触发)
- 加 captcha URL 模式识别 + 关键字匹配 ✗(只能事后停止)
- 加 5min 退避(×2 → ×8) ✗
- 冷启动试探(失败就不开监控) ✗
- Edge 换 InPrivate 窗口 ✗
- 关闭 MetaMask 扩展 ✗(无关)

### 后续若 CDP 也走不通时的备选

按"侵入性"升序:

1. **CDP + 真实点击** (首选) — PoC 验证中
2. **Chrome 扩展 + content script 进 iframe** — 能读 DOM,但 `el.click()` isTrusted=false,赌霸下不查 isTrusted
3. **Electron 内嵌 Chromium** — 用 `webPreferences.websecurity:false` 关 SOP + `webContents.sendInputEvent` 走真实输入管道(等价 CDP);代价是 Electron UA/Canvas 指纹会被霸下识别
4. **完全放弃自动化,只保留策略建议面板** — 用户手动点出餐,脚本只做时间提醒
