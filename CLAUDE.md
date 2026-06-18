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

## Taobao Flash development log

### Goal

Add automatic cook-complete to Taobao Flash (饿了么商家版) merchant order page at `melody.shop.ele.me`. The order page uses a cross-domain iframe to render the order list.

### Phase 1: DOM-based approach (failed)

Initial attempt: query order cards from main page DOM using `[class*="order-card"]` selector and click buttons in the DOM.

**Failure**: the order list lives inside a cross-origin iframe.

- iframe src: `https://napos-order-pc.faas.ele.me/app/processing/all?shopId=...`
- iframe id: `app_shop_order_processing`
- main page: `https://melody.shop.ele.me/app/shop/<shopId>/order__processing#app.shop.order.processing`

**Verified blockers** (all confirmed via console in Chrome DevTools):

1. `iframe.contentDocument` is `null` — browser refuses cross-origin DOM access.
2. `iframe.contentWindow.eval(...)` throws `SecurityError: Blocked a frame with origin "https://melody.shop.ele.me" from accessing a cross-origin frame`.
3. `iframe.sandbox` is empty (no sandbox attribute), so this is a pure same-origin-policy block, not sandbox.
4. New window approach (`window.open(iframe.src)`) shows "未登录" — Taobao's anti-fraud detects `window.opener` and refuses to load login state.

### Phase 2: API-based approach (in progress, current path)

Taobao exposes a JSON-RPC style API at `https://app-api.shop.ele.me/fulfill/weborder/<endpoint>/?method=<Service>.<method>`.

**Verified call (200 OK from main page)**:

```js
const m = document.cookie.match(/ksid=([^;]+)/);
const ksid = m ? m[1] : null;
fetch('https://app-api.shop.ele.me/fulfill/weborder/unprocessedOrders/?method=PollingService.unprocessedOrders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-shard': 'shopid=542990592' },
  credentials: 'include',
  body: JSON.stringify({
    service: 'PollingService',
    method: 'unprocessedOrders',
    params: { shopId: 542990592 },
    id: 'x' + Date.now(),
    metas: { appVersion: '1.0.0', appName: 'melody', ksid, shopId: 542990592 },
    ncp: '2.0.0'
  })
}).then(r => r.text()).then(console.log);
```

Returns `{"ncp":"2.0.0","id":"...","result":{"newOrderCount":0,"newOrderModelList":null,"noDisturbingInRest":null},"error":null}`.

**Key facts**:

- CORS works: `access-control-allow-origin: https://napos-order-pc.faas.ele.me` but main page can still call (browser tolerates) — verified live.
- Auth: `ksid` from `document.cookie` + `_m_h5_tk` token. Without correct `metas.ksid` the call returns 401 `{"name":"UNAUTHORIZED","message":"未登录[2]"}`.
- The request needs `x-shard: shopid=<shopId>` header (shopId is also in the URL query but the header is required).
- Official polling interval: `PollingService.getPollingStrategy` returns `pollingInterval: 120000` (120s = 2 min). **Do not poll faster than this — Taobao has anti-fraud that triggers captcha on rapid repeated calls**.

### Discovered endpoints (status as of 2026-06-18)

| Endpoint | Status | Returns |
|----------|--------|---------|
| `OrderWebService.queryInProcessOrders` | 200, full order list | **PRIMARY** — returns all in-process orders with full details |
| `PollingService.unprocessedOrders` | 200, 0 orders | `newOrderCount`, `newOrderModelList` |
| `PollingService.nonCoreOrders` | 200, has counts | tab statistics |
| `PollingService.abnormalOrders` | 200, 0 | exception counts |
| `PollingService.getPollingStrategy` | 200 | `pollingInterval: 120000` |
| `ShopQueryService.queryDataByTab` | 200, result null | unknown — needs params |
| `ShopQueryService.queryHeadDataByInProcessQueryType` | 200, error 10004 | needs `queryType` param |

### `queryInProcessOrders` JSON structure (verified 2026-06-18)

`params: { shopId, queryType: 'ALL' }` works — returns an array of full order objects.

Top-level keys per order:
```
id, shopId, status, remindOrderType, activeTime, settledTime,
orderBusinessType, header, headerExtraInfo, liabilityInfo,
compensationInfo, compensationsInfo, reverseOrderInfo,
afterSaleViewModel, abnormalReportInfo, customerRemindInfo,
userInfo, mealPreparationInfoOld, mealPreparationInfo,
deliveryInfo, foodInfo, remarkInfo, settlementInfo, footer,
grayFeature, printDataInfo, insuranceInfo, noDisturbingInRest,
reissueDeliveryInfos, foodSafetyNegotiateInfo, compareDate,
ticketOrderIds, ticketCode, processing
```

Key field paths:
- `id` — order ID (e.g. `8095360342023930204`)
- `header.daySn` — sequential number shown in UI (e.g. `25`)
- `header.orderLatestStatus` — rider/order state (e.g. `骑士已取餐`, `商家已出餐`)
- `header.orderPromptDesc` — delivery time hint (e.g. `22:39 前送达`)
- `header.planDeliverTiming` — countdown seconds
- `header.orderType` — `ORDER_NORMAL` or `BOOKING_ORDER_NORMAL`
- `userInfo.consigneeName` — customer name (e.g. `Y**`, `鹿女士`)
- `activeTime` — ISO datetime
- `mealPreparationInfo.mealComplete` — `true` = already cooked, `false` = needs cooking
- `mealPreparationInfo.showCompleteMealButton` — controls "上报出餐" button visibility
- `mealPreparationInfo.enable` — whether button is enabled
- `mealPreparationInfo.timeCountDownType` — `"stop"` or `"countdown"`
- `mealPreparationInfo.minMealCompleteTimeCount` — seconds to minimum cook time (negative = overdue)
- `mealPreparationInfo.suggestContentTip` — status text shown in UI
- `foodInfo` — product list
- `settlementInfo` — fee breakdown
- `remarkInfo` — order notes

**What still needs figuring out** (no longer 1-5, updated to reflect what we now know):

1. **Cook-complete API endpoint** — what RPC does the "上报出餐" button call? The button only appears when `showCompleteMealButton` is truthy AND `mealComplete: false`. Need to capture this from Network panel when a real cooking-pending order arrives. Likely candidates: `OrderWebService.completeMeal`, `OrderWebService.reportCookComplete`, or similar — to be confirmed.
2. **Booking order IDs vs notification IDs** — `bookingNotice.orderIds: ["8099020341832918320"]` from `nonCoreOrders`. Comparing with the full response, `8099020341832918320` IS a real order ID. Good — booking orders are in the same list.
3. **Parameter signing** — `_m_h5_tk` is the time-based token. `ncp: 2.0.0` is the protocol version. The 200 responses work without additional `sign` field, so current auth is sufficient.

### Risk notes

- **Anti-fraud / captcha**: Repeated rapid API calls (we triggered a captcha by querying 6 endpoints in one batch) trigger Taobao's anti-bot protection. User must back off, clear cookies or solve captcha. **Polling should be ≥ 120s**, and ideally batched (one call per cycle).
- **Cookie sharing across subdomains**: `ksid` and `_m_h5_tk` are shared between `melody.shop.ele.me` and `napos-order-pc.faas.ele.me` (verified by comparing cookies from main page and iframe). So the auth model is "first-party subdomain", not "third-party iframe" — the cross-origin block is browser policy, not Taobao's choice.
- **"未登录" in new window** is anti-fraud, not actual logout. Cookie is identical between main page and new window except for `isg` (anti-fraud token) value.
- **Anti-fraud rewrites request URLs**: When captcha kicks in, the next `queryInProcessOrders` request gets rewritten to `/fulfill/weborder/queryInProcessOrders/_____tmd_____/punish?...&action=captcha` and the response is a captcha challenge instead of order data. The captcha URL pattern (`_____tmd_____/punish?x5secdata=...`) is the diagnostic for "I'm being rate-limited".

### All API endpoints seen in `app-api.shop.ele.me` (from `performance.getEntries()`)

```
/arena/invoke/?method=AssistantEntranceService.getValidPages
/xtop/xtop.arena.adp.service.gray.inGray/1.0
/xtop/xtop.arena.message.reachDelivery.queryDeliveryRules/1.0
/xtop/xtop.napos.keeper.shop.canManage/1.0
/shop/invoke/?method=AlscTagService.queryTagsByTagId
/xtop/xtop.napos.keeper.shop.queryShopTree/1.0
/xtop/xtop.napos.keeper.permissionManager.getMenuTree/1.0
/fulfill/device/controller/getAccsToken/?method=AuthCenterService.getToken
/xtop/xtop.arena.message.messageAccs.getAccsToken/1.0
/shop/invoke/?method=queryShop.getShopView
/ugc/invoke/?method=shopRating.countNewShopRating
/fulfill/weborder/queryAppealCenterMenuGray/invoke/?method=OrderWebService.queryAppealCenterMenuGray
/fulfill/weborder/grayMenuAppealCompensation2Gray/invoke/?method=GrayService.grayMenuAppealCompensation2Gray
/delivery/invoke/?method=GrayControlService.getConfigV2
/arena/invoke/?method=CrmOpenService.checkCrmEntry
/ugc/invoke/?method=ExportRatingTaskService.queryExportRatingTasks
/stats/invoke/?method=DownloadDataService.queryHistoryList
/arena/invoke/?method=KeeperService.getKeeper
/arena/invoke/?method=AssistantEntranceService.getAssistantEntranceInfo
/fulfill/weborder/countMenuOrder/?method=OrderWebService.countMenuOrder
/arena/invoke/?method=PushService.polling
/arena/invoke/?method=SceneManageService.getSpaceInfoBySpaceCodes
/fulfill/weborder/traceTimer/?method=TraceService.traceTimer
/fulfill/weborder/queryInProcessOrders/?method=OrderWebService.queryInProcessOrders
```

When a real "待出餐" order arrives, manually click "上报出餐" in the UI and capture the new request URL. Likely candidates to look for: any URL containing `completeMeal`, `reportCook`, `mealComplete`, `mealFinish`, `cookFinish`, or `submitMeal`.

### What works in the current code (taobaoFlash.bookmarklet.js)

The `taobaoFlash.*` scripts are at **DOM-extraction stage**, not API stage. Current implementation:

- `extractOrders()` queries `[class*="order-card"]` on `document` — returns 0 because cards live in cross-origin iframe.
- `switchToOrderTab()` clicks the "订单处理" tab via `div[data-aspm-param]` (works in main page sidebar).
- `createPanel()`, `panelLog()`, `updatePanelOrders()` copied from Meituan version with brand color `#ff6a00`.
- `monitorOrders()` runs 5s polling — but finds no orders because extraction is broken. **Polling interval also needs to be raised to 120s**.
- `isOnOrderTab()` was removed because the menu doesn't have a `selected`/`active` class.

### Path forward

1. Rewrite `extractOrders()` to call `queryInProcessOrders` API (with discovered `queryType`).
2. Derive `orderNo`, `status`, `customer`, `products` from API JSON instead of DOM regex.
3. Raise polling interval to 120s (match official `pollingInterval`).
4. For cook-complete action, either:
   - (a) find the API endpoint and call it directly, OR
   - (b) navigate the main page URL to the iframe URL (with hash) and click — but login state is preserved when navigating within the same tab.
5. Optional: postMessage from main page to iframe (iframe.contentWindow is accessible, even if contentDocument isn't) for cross-frame signaling, though Taobao's app doesn't listen to custom events.
