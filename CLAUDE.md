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

### `mealComplete` — Cook-complete endpoint (verified 2026-06-18)

The "上报出餐" button calls this API directly. **No DOM click needed.**

- **URL**: `https://app-api.shop.ele.me/fulfill/weborder/mealComplete/?method=ShipmentService.mealComplete`
- **Method**: POST
- **Headers**: `Content-Type: application/json;charset=UTF-8`, `x-shard: shopid=<shopId>`, cookies auto-included
- **Body**:
  ```json
  {
    "service": "ShipmentService",
    "method": "mealComplete",
    "params": { "orderId": "8075110341691783597", "shopId": 542990592 },
    "id": "30E8F24C0A4E46FCACA20200F8C24DD6|1781794687920",
    "metas": {
      "appVersion": "1.0.0",
      "appName": "melody",
      "ksid": "<from document.cookie>",
      "shopId": 542990592
    },
    "ncp": "2.0.0"
  }
  ```
- **Success response**:
  ```json
  {
    "ncp": "2.0.0",
    "id": "fulfill.order_prod^^30E8F24C0A4E46FCACA20200F8C24DD6|1781794687920",
    "result": { "orderId": "8075110341691783597", "toast": null },
    "error": null
  }
  ```
- **No signature parameter** required — `id` is a UUID-like timestamp, `metas.ksid` is the cookie value, `_m_h5_tk` is NOT needed in body.
- **Response error field is null on success**. The user confirmed by clicking — got `result.orderId` matching the request.

This means the entire auto-cook engine can be **pure API**, no DOM access, no iframe access, no new window. Both `queryInProcessOrders` and `mealComplete` are reachable from the main page (`melody.shop.ele.me`).

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

### Polling and timing

- **Official `queryInProcessOrders` polling interval is 120s** (from `getPollingStrategy: pollingInterval: 120000`). Same as our limit.
- **120s is the floor for `queryInProcessOrders` polling.** Lower rates risk captcha.
- **120s is also the practical floor for "after-order" auto-cook minimum delay.** Even if a user sets `afterOrderMinSec` lower than 120 in the panel, the script should clamp to ≥ 120s, because:
  1. We won't *see* a new order until the next poll tick.
  2. Firing `mealComplete` faster than the poll cycle wastes API calls and looks like a bot.
  3. The 4-minute cook window still leaves comfortable buffer.
- **No need to listen to `PushService.polling`** (long-poll for new-order push) — adds complexity, marginal latency win. Pure 120s polling is sufficient.

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

As of 2026-06-18, `taobaoFlash.bookmarklet.js` is at **API stage** (Phase 3 shipped). DOM-based extraction is gone.

**Architecture**:
- Pure JSON-RPC, no DOM, no iframe access, no new window.
- `apiCall(endpoint, service, method, params)` — generic POST to `https://app-api.shop.ele.me/fulfill/weborder/<endpoint>/?method=<Service>.<method>`. Auto-builds body with `metas.ksid` (from `document.cookie`), `metas.shopId` (from URL → cookie → pathname → hash), `metas.appName: 'melody'`. Sends header `x-shard: shopid=<shopId>`.
- `extractOrders()` → Promise. Calls `queryInProcessOrders` with `params: { shopId, queryType: 'ALL' }`. Parses `result.orderModelList || result.inProcessOrders || result.orders || []` (all three keys tried; backend key can vary).
- `mealComplete(orderNo)` → Promise. Calls `ShipmentService.mealComplete` with `params: { orderId, shopId }`. No sign parameter, no `_m_h5_tk` in body.
- `clickOrderButton` / `autoCookAll` / `monitorOrders` (inner) all route through `mealComplete`.
- `monitorOrders(intervalMs)` — `intervalMs` is **clamped to ≥ 120000** via `Math.max`. Default 120000. `afterOrderMinSec` also clamped to ≥ 120. Wind-up: if user enters lower value, monitor raises it to 120 silently.
- Captcha detection: when fetch response URL contains `_____tmd_____/punish`, sets `window.__captchaTriggered = true`. All subsequent `extractOrders` / `mealComplete` short-circuit and panel shows red "🚨 触发淘宝风控" message. User must refresh page after solving captcha.

**State mapping** (parseOrder):
- `mealPreparationInfo.mealComplete === true` OR status text matches 已出餐/已收餐/已送达/已完成 → `status: 'cooked'`
- status text matches 已取消/部分取消/整单取消 → `cancelled`
- status text matches 待接单/待支付 → `pending_accept`
- `mealPreparationInfo.showCompleteMealButton === true` OR status text matches 待出餐/商家未出餐/备餐中 → `pending_cook` (cook-able!)
- Field paths:
  - `id` → `orderNo`
  - `header.daySn` → `orderIndex` (e.g. `#25`)
  - `header.orderLatestStatus` → `riderStatus` / `statusText`
  - `header.orderPromptDesc` → `deliverTime` (e.g. `22:39 前送达`)
  - `header.orderType === 'BOOKING_ORDER_NORMAL'` → `isPreOrder: true`
  - `userInfo.consigneeName` → `customerName`
  - `activeTime` (ISO) → `orderTime` formatted as `MM-DD HH:mm`
  - `foodInfo.foodList[]` → `products[]` (each with `name`, `quantity`, `unitPrice`, `totalPrice`)
  - `settlementInfo.userPaidAmount` → `estimatedIncome`
  - `remarkInfo.remark` → `remark`

**Loader** (`bookmarklet.loader.js`):
- `melody.shop.ele.me` → load `taobaoFlash.bookmarklet.js` **directly in main page** (no more `window.open`).
- New-window approach was killed: Taobao's anti-fraud detects `window.opener` and refuses to load login state (shows "未登录"). Documented in this log.
- `pageAnalyzer.js` is still chain-loaded first (no behavioral dep, just keeps console output ordered).

**Bugs hit during Phase 3 development**:
1. `getShopId` initially only looked at `location.search` and `location.hash`. Real production URL is `/app/shop/542990592/order__processing#app.shop.order.processing` — shopId is in `pathname`, not hash. Fixed by adding `pathname` and `document.cookie` (cookie has `shopId=...` directly) as fallbacks. Order: search → `window.__shopId` cache → cookie → pathname → hash.
2. `parseOrderList(null)` threw because the call chain `result.orderModelList || result.inProcessOrders || result.orders || []` resolves to `[]` for a 0-order shop, but backend can also return `result: null` outright, which we need to tolerate. Wrapped in `Array.isArray(list)` check.

### Path forward (next steps after Phase 3 ships)

1. **Verify in real store with active orders** — current tests have been against 542990592 with `result: null` (no in-process orders). Need a run where `queryInProcessOrders` returns at least one `pending_cook` order to validate `parseOrder` field paths and `mealComplete` end-to-end.
2. **Field-path validation** — `foodList`, `userPaidAmount`, `remark.remark` are best-guess from one observed response. Real pending-cook order may have different key names. Add defensive `|| 0` / `|| ''` everywhere (mostly already done).
3. **Pre-order handling** — `isPreOrder: true` orders use `header.orderType === 'BOOKING_ORDER_NORMAL'`. Cook window should be relative to the *scheduled cook time*, not `activeTime`. Currently not implemented (parity with Meituan would need this).
4. **Re-introduce `notify`/`beep` on new pending-cook** — useful for operator awareness; not in scope yet.
5. **Consider `bookmarklet.loader.js` cacheBust on re-click** — currently `?t=Date.now()` is fixed at first load; user must re-drag the bookmark or manually re-inject to get new script. Could add a "reload" button in panel.

### Phase 4: Edge + 阿里霸下风控(2026-06-19,无解)

**User report**: 淘宝闪购脚本在 Chrome 上正常,在 Edge 上"启动就弹风控"。关闭 MetaMask 扩展后仍弹。

**Root cause investigation**:

Edge 页面加载到以下风控 SDK(从控制台 `bookmarklet.loader.js?t=...:72` 后续日志可见):
- `baxiaCommon.js` — **阿里霸下风控**,含 `HookBX$1.window.fetch`,**直接 hook 了 `window.fetch`**
- `et_f.js` / `app.f8ff7984.js` — 淘宝主程序,经霸下包装后用 `o.j.fetch(...)` 调用
- `fireyejs.js` — 同盾/数美一类设备指纹 SDK
- `securityHeader.min.js` — 淘宝请求安全头,加载外网配置 `https://xux-web-config.oss-accelerate.aliyuncs.com/aes-config/melody/qnrForm.json` 失败(`net::ERR_TIMED_OUT`)

霸下 hook 行为细节(从 `❌ 拉取订单失败: 网络错误: [object Response]` 反推):
- fetch reject 时,error 是一个 `Response` 对象(被霸下替换过)
- `e.message` 不可用,`(e.message || e)` 退到 `String(e)` 字符串化 Response → `[object Response]`
- **fetch 被劫持是表象,真因是霸下在另一通道同步通知淘宝后端"该请求来自脚本"**,所以弹风控

**XHR 实验**:`apiCall` 改用 `XMLHttpRequest` 后控制台出现:
```
[apiCall] XHR onerror status=200 readyState=4
```
**XHR 在 status=200 readyState=4(请求成功)时仍被调用 onerror** — 说明霸下同时 hook 了 `XHR` 的完成回调,在成功响应上伪造 onerror 触发风控。**XHR 路径也不行。**

**结论**:阿里霸下同时 hook `window.fetch` 和 `XMLHttpRequest`,在响应被消费前会判断请求来源,非交互上下文直接触发风控弹窗。**Edge UA + 该店铺账号的会话信任度被阿里风控标记**,跟脚本写法(headers / body / 鉴权)无关。Chrome 同一个店铺能用,说明这是**阿里针对不同 UA 的差异化风控策略**,不是脚本能解决的。

**用户实际能用的方案**(优先级降序):
1. **Chrome 跑淘宝,Edge 跑美团**(最优)— Chrome UA 对成熟店铺账号风控容忍度高很多
2. **重启 Edge + 重新登录淘宝 + 手动操作店铺 5-10 分钟**(浏览订单/接单),让霸下建立正常会话画像,再开脚本
3. **Edge InPrivate 窗口**(全新 cookie 池,无扩展)— 有概率过
4. **冷却几小时后再试** — 阿里风控"异常行为"标记通常 1-4 小时后自动重置

**脚本侧已做的退避(不能根除,只能减少触发)**:
- 启动前检查 `_m_h5_tk` / `ksid` / `shopId` 三个 cookie,缺失时红字提示"先在 Edge 正常打开店铺页面让人机验证一次"
- 触发风控时记录 `__lastCaptchaTime`,5 分钟内重启监控则间隔翻倍(最多 ×8 = 16 分钟)
- 错误响应 body 关键字匹配 `UNAUTHORIZED|未登录|验证|风控|滑动|机器|captcha|滑块`,识别到立即设 `__captchaTriggered` 暂停
- **冷启动模式**(2026-06-19 加入):启动时先发一次试探查询,失败就不开监控,避免 120s 循环反复触发风控;失败时面板显示 `🚨 冷启动失败: 触发风控。脚本不启动监控,请在 Edge 手动操作该店铺 5-10 分钟再重试`

**Path forward(本质是用户体验,不是脚本)**:
- **README/docs/index.html 显眼位置加 Edge 风控警告**,建议 Chrome 用户
- 不再尝试改 `apiCall` 的 transport 层 — fetch/XHR/script-tag 都被霸下覆盖或被判定
