/**
 * @file 美团外卖自动出餐助手 V2 — Bookmarklet 合并版本
 * @description 所有 V2 模块合并为一个文件，浏览器书签直接使用
 * @usage 通过书签加载 monitorV2.loader.js，自动加载此文件
 */

;(function () {
  'use strict';
  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

/**
 * @file 美团外卖商家版 — API 拦截与请求层 (V2)
 * @description 拦截美团商家版的 XHR/Fetch 请求，捕获订单相关 API 响应数据；
 *              同时提供主动请求能力，复用当前 session 发起订单列表查询。
 * @note 本模块是 V2 混合架构的一部分，可独立启用/禁用，不影响原有 DOM 提取逻辑。
 *
 * 已验证的 API 端点（2026-06-09）：
 *   - POST /gw/api/unified/r/order/list/page/unprocessed
 *     Body: tag=all&pageParam={"pageSize":10,"pageNum":1,"sort":0,"nextLabel":"","lastLabel":""}&extParam={"phfRollback":0,"searchMealTag":""}
 *     tag 可选值: all, 或各个状态 tab
 *     响应: { code: 0, data: { orderList: [...], pageInfo: { totalCount, pageCount }, orderIndex: [...] } }
 *   - POST /gw/api/unified/r/order/list/count
 *   - POST /gw/api/unified/r/order/list/interval
 *   - GET /gw/api/order/mix/unprocessed/count/common
 *   - GET /v2/order/pre/r/notify/v2
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

  const CONFIG = {
    interceptPaths: [
      '/gw/api/unified/r/order/list/page',
      '/gw/api/unified/r/order/list/interval',
      '/gw/api/unified/r/order/list/count',
      '/gw/api/order/mix/unprocessed/count',
      '/v2/order/pre/r/notify',
    ],
  };

  // ==================== API 拦截器 ====================
  class ApiInterceptor {
    constructor() {
      this._listeners = [];
      this._installed = false;
      this._capturedResponses = [];
      this._maxCaptured = 50;
    }

    install() {
      if (this._installed) return this;
      this._installed = true;
      this._interceptXHR();
      this._interceptFetch();
      console.log('[WM-V2] API 拦截器已安装');
      return this;
    }

    on(path, callback) {
      this._listeners.push({ path, callback });
      return this;
    }

    off(path) {
      if (path) {
        this._listeners = this._listeners.filter(l => l.path !== path);
      } else {
        this._listeners = [];
      }
      return this;
    }

    getCaptured() { return this._capturedResponses.slice(); }

    _isTargetUrl(url) {
      if (!url) return false;
      const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
      return CONFIG.interceptPaths.some(p => path.startsWith(p));
    }

    _notify(url, data) {
      for (const l of this._listeners) {
        if (url.includes(l.path)) {
          try { l.callback(data, url); } catch (e) {
            console.error('[WM-V2] listener error:', e);
          }
        }
      }
    }

    _interceptXHR() {
      const self = this;
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const origOpen = win.XMLHttpRequest.prototype.open;
      const origSend = win.XMLHttpRequest.prototype.send;

      win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__wmUrl = url;
        this.__wmMethod = method;
        return origOpen.apply(this, [method, url, ...rest]);
      };

      win.XMLHttpRequest.prototype.send = function (body) {
        const xhr = this;
        const url = xhr.__wmUrl || '';
        const method = xhr.__wmMethod || 'GET';

        if (self._isTargetUrl(url)) {
          xhr.addEventListener('load', function () {
            try {
              const resp = JSON.parse(xhr.responseText);
              const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
              const record = {
                source: 'xhr',
                method,
                path,
                url: url.substring(0, 300),
                requestBody: typeof body === 'string' ? body.substring(0, 2000) : null,
                response: resp,
                timestamp: Date.now(),
              };
              self._capturedResponses.push(record);
              if (self._capturedResponses.length > self._maxCaptured) {
                self._capturedResponses.shift();
              }
              self._notify(url, record);
            } catch (e) { /* 非 JSON 响应 */ }
          });
        }

        return origSend.apply(this, [body]);
      };
    }

    _interceptFetch() {
      const self = this;
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const origFetch = win.fetch;

      win.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const opts = args[1] || {};
        const method = opts.method || 'GET';

        const promise = origFetch.apply(this, args);

        if (self._isTargetUrl(url)) {
          promise.then(resp => {
            resp.clone().json().then(data => {
              const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
              const record = {
                source: 'fetch',
                method,
                path,
                url: url.substring(0, 300),
                requestBody: typeof opts.body === 'string' ? opts.body.substring(0, 2000) : null,
                response: data,
                timestamp: Date.now(),
              };
              self._capturedResponses.push(record);
              if (self._capturedResponses.length > self._maxCaptured) {
                self._capturedResponses.shift();
              }
              self._notify(url, record);
            }).catch(() => {});
          }).catch(() => {});
        }

        return promise;
      };
    }

    _getIframe() {
      try {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe && iframe.contentDocument && iframe.contentWindow) return iframe;
      } catch (e) {}
      return null;
    }
  }

  // ==================== 主动请求层 ====================
  class ApiRequester {
    /**
     * 主动请求订单列表
     * @param {Object} params
     * @param {string} [params.tag='all'] - 订单标签: 'all', 'pending_cook' 等
     * @param {number} [params.pageSize=10] - 每页数量
     * @param {number} [params.pageNum=1] - 页码
     * @returns {Promise<Object>} API 响应数据
     */
    async fetchOrderList({ tag = 'all', pageSize = 10, pageNum = 1 } = {}) {
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const doc = iframe ? iframe.contentDocument : document;

      // 从 cookie 提取认证参数
      const cookies = this._parseCookies(doc.cookie);
      const regionId = cookies.region_id || '';
      const regionVersion = cookies.region_version || '';

      const url = `${win.location.origin}/gw/api/unified/r/order/list/page/unprocessed?region_id=${regionId}&region_version=${regionVersion}`;

      const pageParam = JSON.stringify({ pageSize, pageNum, sort: 0, nextLabel: '', lastLabel: '' });
      const extParam = JSON.stringify({ phfRollback: 0, searchMealTag: '' });

      // 使用 XHR（因为美团使用了 mtgsig 签名，直接 fetch 可能缺少签名）
      // 更好的方式是触发页面自身发请求，而非手动构造
      // 但我们仍然尝试构造一个基本请求，如果失败则 fallback 到 DOM 提取
      try {
        const resp = await win.fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `tag=${tag}&pageParam=${encodeURIComponent(pageParam)}&extParam=${encodeURIComponent(extParam)}`,
        });
        const data = await resp.json();
        console.log(`[WM-V2] 主动请求订单列表: tag=${tag}, code=${data.code}`);
        return data;
      } catch (e) {
        console.warn('[WM-V2] 主动请求失败，需要 mtgsig 签名:', e.message);
        console.warn('[WM-V2] 将使用 DOM + 拦截方式获取数据');
        return null;
      }
    }

    /**
     * 通过模拟 tab 切换来触发页面自身的 API 请求
     * 这是 fallback 策略：不直接调 API，而是让页面自己重新拉取数据
     * @param {string} tabName - 'all' | 'pending_cook' | 'pending_accept' 等
     */
    triggerTabSwitch(tabName) {
      const iframe = this._getIframe();
      if (!iframe) return false;
      const doc = iframe.contentDocument;

      const tabMap = {
        'all': '全部',
        'pending_cook': '待出餐',
        'pending_accept': '待接单',
        'delivering': '配送中',
        'cancelled': '已取消',
      };

      const targetText = tabMap[tabName] || tabName;
      const buttons = doc.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.innerText.trim().includes(targetText)) {
          btn.click();
          console.log(`[WM-V2] 切换到 tab: ${targetText}`);
          return true;
        }
      }
      console.warn(`[WM-V2] 未找到 tab: ${targetText}`);
      return false;
    }

    _parseCookies(cookieStr) {
      const obj = {};
      if (!cookieStr) return obj;
      cookieStr.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        obj[k.trim()] = v.join('=');
      });
      return obj;
    }

    _getIframe() {
      try {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe && iframe.contentDocument && iframe.contentWindow) return iframe;
      } catch (e) {}
      return null;
    }
  }

  // ==================== 导出 ====================
  V2.ApiInterceptor = ApiInterceptor;
  V2.ApiRequester = ApiRequester;
  V2.apiConfig = CONFIG;

  console.log('[WM-V2] orderApi 模块已加载（v2.1 - 含订单列表主动请求）');
})();

/**
 * @file 美团外卖商家版 — 订单数据存储层 (V2)
 * @description 统一管理订单数据，API 数据优先、DOM 提取兜底。
 *              支持本地持久化（localStorage），页面刷新不丢数据。
 *
 * 合并策略：
 *   API 来源的数据，只覆盖 API 能提供的字段；
 *   API 不提供的字段（如 customerName, phoneTail, suggestedCookTime 等），
 *   保留 DOM 来源的值，不会被 API 的空值覆盖。
 *
 * API 字段覆盖范围：
 *   ✅ API 独有：isPreOrder, preOrderShowInTabTime, apiStatus, statusDesc,
 *      orderTimestamp, deliverTimestamp, confirmTimestamp, wmOrderViewId, wmOrderId
 *   ✅ API 功能更强：orderNo(精确), orderTime(毫秒时间戳), deliverTime(毫秒时间戳),
 *      orderIndex, status(数字码+文字)
 *   ❌ API 不提供（保留 DOM 值）：customerName, phoneTail, riderName,
 *      suggestedCookTime, suggestedCookSeconds, cookTime, isNewCustomer,
 *      isFavCustomer, customerOrderCount, isFlashDelivery, estimatedIncome,
 *      products, remark, deliveryType, buttons, _element
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

  // ==================== 订单状态常量 ====================
  const ORDER_STATUS = {
    PENDING_ACCEPT: 'pending_accept',
    PENDING_COOK: 'pending_cook',
    COOKED: 'cooked',
    DELIVERING: 'delivering',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    UNKNOWN: 'unknown',
  };

  const API_STATUS_MAP = {
    2: 'pending_accept',
    4: 'processing',      // 处理中（需配合 statusDesc 细分）
    8: 'delivered',
  };

  const STATUS_DESC_MAP = {
    '待接单': ORDER_STATUS.PENDING_ACCEPT,
    '待出餐': ORDER_STATUS.PENDING_COOK,
    '已出餐': ORDER_STATUS.COOKED,
    '出餐中': ORDER_STATUS.COOKED,
    '骑手已取餐': ORDER_STATUS.DELIVERING,
    '骑手已送达': ORDER_STATUS.DELIVERING,
    '配送中': ORDER_STATUS.DELIVERING,
    '已送达': ORDER_STATUS.DELIVERED,
    '用户已收餐': ORDER_STATUS.DELIVERED,
    '已取消': ORDER_STATUS.CANCELLED,
  };

  // ==================== 单条订单数据 ====================
  class OrderData {
    constructor(data = {}) {
      // ========== 基础信息 ==========
      this.orderNo = data.orderNo || '';
      this.orderIndex = data.orderIndex || 0;
      this.orderTime = data.orderTime || '';
      this.deliverTime = data.deliverTime || '';
      this.customerName = data.customerName || '';
      this.phoneTail = data.phoneTail || '';
      this.remark = data.remark || '';

      // ========== 顾客信息（DOM 独有，API 不提供）==========
      this.isNewCustomer = data.isNewCustomer || false;
      this.customerOrderCount = data.customerOrderCount || 0;
      this.isFavCustomer = data.isFavCustomer || false;

      // ========== 状态与时间 ==========
      this.status = data.status || ORDER_STATUS.UNKNOWN;
      this.statusDesc = data.statusDesc || '';
      this.cookTime = data.cookTime || '';
      this.suggestedCookTime = data.suggestedCookTime || '';

      // ========== 配送信息 ==========
      this.deliveryType = data.deliveryType || '';
      this.isFlashDelivery = data.isFlashDelivery || false;
      this.riderName = data.riderName || '';

      // ========== 费用（DOM 独有，API 有 costInfo 但结构不同）==========
      this.estimatedIncome = data.estimatedIncome || 0;
      this.products = data.products || [];

      // ========== V2 新增：API 独有字段 ==========
      this.isPreOrder = data.isPreOrder || false;
      this.preOrderShowInTabTime = data.preOrderShowInTabTime || 0;
      this.orderTimestamp = data.orderTimestamp || 0;
      this.deliverTimestamp = data.deliverTimestamp || 0;
      this.confirmTimestamp = data.confirmTimestamp || 0;
      this.suggestedCookSeconds = data.suggestedCookSeconds || 0;
      this.apiStatus = data.apiStatus || 0;
      this.wmOrderViewId = data.wmOrderViewId || '';
      this.wmOrderId = data.wmOrderId || '';

      // ========== 出餐计时相关 ==========
      this._cookDeadline = data._cookDeadline || 0;
      this._cookTimerId = null;

      // ========== 数据来源标记 ==========
      this.source = data.source || 'dom';
      this.updatedAt = data.updatedAt || Date.now();

      // ========== DOM 操作相关（DOM 独有）==========
      this.buttons = data.buttons || [];
      this._element = data._element || null;

      // ========== API 原始数据（调试用）==========
      this._raw = data._raw || null;
    }

    toJSON() {
      const { _cookTimerId, _raw, ...rest } = this;
      return rest;
    }

    static fromJSON(json) {
      return new OrderData(json);
    }
  }

  // ==================== OrderStore ====================
  class OrderStore {
    constructor() {
      this.orders = new Map();
      this._listeners = [];
      this._persistKey = '__WM_V2_orders';
      this._maxPersistAge = 24 * 60 * 60 * 1000;
      this._loadFromStorage();
    }

    // ==================== 从 API 更新（只覆盖 API 能提供的字段）====================

    updateFromAPIResponse(apiResponse) {
      if (!apiResponse) return 0;

      let orderList = [];
      if (apiResponse.orderList && Array.isArray(apiResponse.orderList)) {
        orderList = apiResponse.orderList;
      } else if (apiResponse.data && apiResponse.data.orderList) {
        orderList = apiResponse.data.orderList;
      }

      let count = 0;
      for (const rawOrder of orderList) {
        const parsed = this._morphAPIOrder(rawOrder);
        if (!parsed || !parsed.orderNo) continue;

        const existing = this.orders.get(parsed.orderNo);

        if (existing) {
          // ===== 关键：API 只覆盖它有的字段，DOM 独有字段保留 =====
          // API 能提供的字段 → 用 API 的值覆盖
          existing.orderNo = parsed.orderNo;
          existing.orderIndex = parsed.orderIndex;
          existing.orderTime = parsed.orderTime || existing.orderTime;
          existing.deliverTime = parsed.deliverTime || existing.deliverTime;
          existing.status = parsed.status;
          existing.statusDesc = parsed.statusDesc || existing.statusDesc;
          existing.isPreOrder = parsed.isPreOrder;
          existing.preOrderShowInTabTime = parsed.preOrderShowInTabTime;
          existing.orderTimestamp = parsed.orderTimestamp || existing.orderTimestamp;
          existing.deliverTimestamp = parsed.deliverTimestamp || existing.deliverTimestamp;
          existing.confirmTimestamp = parsed.confirmTimestamp || existing.confirmTimestamp;
          existing.apiStatus = parsed.apiStatus;
          existing.wmOrderViewId = parsed.wmOrderViewId;
          existing.wmOrderId = parsed.wmOrderId;
          existing.source = 'api';
          existing.updatedAt = Date.now();
          existing._raw = parsed._raw;

          // 以下字段 API 不提供，保留 DOM 的值（不覆盖为空）：
          // customerName, phoneTail, riderName, suggestedCookTime,
          // suggestedCookSeconds, cookTime, isNewCustomer, isFavCustomer,
          // customerOrderCount, isFlashDelivery, estimatedIncome,
          // products, remark, deliveryType, buttons, _element
        } else {
          // 新订单，API 数据直接写入
          this.orders.set(parsed.orderNo, parsed);
        }
        count++;
      }

      if (count > 0) this._notify('update', { source: 'api', count });
      return count;
    }

    updateFromAPI(apiData) {
      return this.updateFromAPIResponse(apiData);
    }

    // ==================== 从 DOM 更新（补充 API 不提供的字段）====================

    updateFromDOM(domOrders) {
      if (!Array.isArray(domOrders)) return 0;

      let count = 0;
      for (const raw of domOrders) {
        const orderNo = raw.orderNo;
        if (!orderNo) continue;

        const existing = this.orders.get(orderNo);

        if (existing) {
          // ===== 关键：DOM 只更新它独有的字段，不覆盖 API 的字段 =====
          // DOM 独有字段 → 用 DOM 的值更新
          existing.customerName = raw.customerName || existing.customerName;
          existing.phoneTail = raw.phoneTail || existing.phoneTail;
          existing.riderName = raw.riderName || existing.riderName;
          existing.suggestedCookTime = raw.suggestedCookTime || existing.suggestedCookTime;
          existing.suggestedCookSeconds = raw.suggestedCookSeconds || existing.suggestedCookSeconds;
          existing.cookTime = raw.cookTime || existing.cookTime;
          existing.isNewCustomer = raw.isNewCustomer ?? existing.isNewCustomer;
          existing.customerOrderCount = raw.customerOrderCount ?? existing.customerOrderCount;
          existing.isFavCustomer = raw.isFavCustomer ?? existing.isFavCustomer;
          existing.isFlashDelivery = raw.isFlashDelivery ?? existing.isFlashDelivery;
          existing.estimatedIncome = raw.estimatedIncome ?? existing.estimatedIncome;
          existing.products = raw.products?.length > 0 ? raw.products : existing.products;
          existing.buttons = raw.buttons?.length > 0 ? raw.buttons : existing.buttons;
          existing.deliveryType = raw.deliveryType || existing.deliveryType;
          existing.remark = raw.remark || existing.remark;

          // DOM 的 DOM 引用和元素
          if (raw._element) existing._element = raw._element;
          if (raw._buttonsStale !== undefined) existing._buttonsStale = raw._buttonsStale;

          // DOM 能提供的状态和时间（不覆盖 API 更精确的值，除非 API 没设置）
          if (!existing.orderTimestamp && raw.orderTimestamp) existing.orderTimestamp = raw.orderTimestamp;
          if (!existing.deliverTimestamp && raw.deliverTimestamp) existing.deliverTimestamp = raw.deliverTimestamp;

          // DOM 来源的 isPreOrder 可能是启发式推断，API 的值更准确
          // 只在 API 未设置 isPreOrder 时使用 DOM 的值
          if (!existing.isPreOrder && raw.isPreOrder) {
            existing.isPreOrder = true;
          }

          // 只在不冲突时更新状态（API 状态更精确，DOM 可能有延迟）
          if (!existing.source || existing.source !== 'api') {
            if (raw.status && raw.status !== 'unknown') existing.status = raw.status;
          }
          if (existing.source === 'api' && (!existing.status || existing.status === 'unknown')) {
            if (raw.status && raw.status !== 'unknown') existing.status = raw.status;
          }

          existing.updatedAt = Date.now();
        } else {
          const order = new OrderData({
            ...raw,
            source: 'dom',
            updatedAt: Date.now(),
          });
          this.orders.set(orderNo, order);
        }
        count++;
      }

      if (count > 0) this._notify('update', { source: 'dom', count });
      return count;
    }

    // ==================== 数据查询 ====================

    getAll() { return [...this.orders.values()]; }
    get(orderNo) { return this.orders.get(orderNo); }
    getByStatus(status) { return this.getAll().filter(o => o.status === status); }
    getPendingCook() { return this.getByStatus(ORDER_STATUS.PENDING_COOK); }
    getPreOrders() { return this.getAll().filter(o => o.isPreOrder); }
    get size() { return this.orders.size; }

    // ==================== 监听变更 ====================

    onChange(callback) {
      this._listeners.push(callback);
      return () => { this._listeners = this._listeners.filter(l => l !== callback); };
    }

    // ==================== 持久化 ====================

    save() {
      try {
        const data = {};
        for (const [key, val] of this.orders) {
          data[key] = val.toJSON();
        }
        localStorage.setItem(this._persistKey, JSON.stringify({
          version: 2,
          savedAt: Date.now(),
          orders: data,
        }));
      } catch (e) {
        console.warn('[WM-V2] 保存失败:', e.message);
      }
    }

    _loadFromStorage() {
      try {
        const raw = localStorage.getItem(this._persistKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.version !== 2) return;
        const now = Date.now();
        for (const [key, val] of Object.entries(parsed.orders || {})) {
          if (now - (val.updatedAt || 0) > this._maxPersistAge) continue;
          const order = OrderData.fromJSON(val);
                // 页面刷新后 DOM 引用必失效，清除
                order._element = null;
                order._buttonsStale = true;
                this.orders.set(key, order);
        }
        console.log(`[WM-V2] 从本地缓存恢复了 ${this.orders.size} 条订单数据`);
      } catch (e) {
        console.warn('[WM-V2] 加载失败:', e.message);
      }
    }

    clear() {
      this.orders.clear();
      localStorage.removeItem(this._persistKey);
      this._notify('clear');
    }

    _notify(event, detail) {
      for (const l of this._listeners) {
        try { l(event, detail); } catch (e) {
          console.error('[WM-V2] listener error:', e);
        }
      }
      this.save();
    }

    // ==================== API 数据解析 ====================

    _morphAPIOrder(rawOrder) {
      if (!rawOrder) return null;

      try {
        const commonInfoStr = typeof rawOrder.commonInfo === 'string' ? rawOrder.commonInfo : '';
        const commonInfo = commonInfoStr ? JSON.parse(commonInfoStr) : (rawOrder.commonInfo || {});
        const orderInfoStr = rawOrder.orderInfo;
        const orderInfo = typeof orderInfoStr === 'string'
          ? JSON.parse(orderInfoStr) : (rawOrder.orderInfo || {});
        const uoi = orderInfo.unifiedOrderInfo || {};
        const basicVo = uoi.basicVo || {};
        const foodInfo = uoi.foodInfo || {};

        // 从 raw JSON 字符串中提取 orderNo 避免 JS Number 精度丢失
        let orderNo = '';
        if (commonInfoStr) {
          const idMatch = commonInfoStr.match(/"wm_order_id_view"\s*:\s*(\d+)/);
          if (idMatch) orderNo = idMatch[1];
        }
        if (!orderNo) {
          orderNo = String(uoi.wmOrderViewId || rawOrder.wmOrderViewId || '');
        }
        const statusDesc = uoi.statusDesc || '';
        const status = this._resolveStatus(basicVo.status, statusDesc);

        const orderTimestamp = (basicVo.orderTime || commonInfo.order_time || 0) * 1000;
        const deliverTimestamp = (basicVo.estimateArrivalTime || commonInfo.estimateArrivalTime || 0) * 1000;
        const confirmTimestamp = (basicVo.confirmTime || commonInfo.confirmTime || 0) * 1000;

        // 从 foodInfo 提取备注
        const remark = foodInfo.remark || '';

        // 从 costInfo 提取收入
        let estimatedIncome = 0;
        const costInfo = uoi.costInfo || {};
        const settleInfo = costInfo.settleInfo || {};
        const chargeInfoList = settleInfo.chargeInfoList || [];
        for (const charge of chargeInfoList) {
          if (charge.chargeName && charge.chargeName.includes('预计收入')) {
            estimatedIncome = parseFloat((charge.totalCharge || '0').replace('￥', '')) || 0;
          }
        }

        // 从 foodInfo 提取商品列表
        const products = [];
        const cartDetailVos = foodInfo.cartDetailVos || [];
        for (const cart of cartDetailVos) {
          for (const item of (cart.details || [])) {
            products.push({
              name: item.foodName || '',
              unitPrice: item.originFoodPrice || 0,
              quantity: item.count || 0,
              totalPrice: item.foodPrice || 0,
            });
          }
        }

        return new OrderData({
          orderNo,
          orderIndex: commonInfo.wm_poi_order_dayseq || 0,
          orderTime: commonInfo.order_time_fmt || '',
          deliverTime: deliverTimestamp
            ? `${String(new Date(deliverTimestamp).getMonth() + 1).padStart(2, '0')}-${String(new Date(deliverTimestamp).getDate()).padStart(2, '0')} ${String(new Date(deliverTimestamp).getHours()).padStart(2, '0')}:${String(new Date(deliverTimestamp).getMinutes()).padStart(2, '0')}`
            : '',
          // API 能提供的字段：
          status,
          statusDesc,
          isPreOrder: basicVo.isPreOrder || false,
          preOrderShowInTabTime: commonInfo.preOrderShowInTabTime || 0,
          orderTimestamp,
          deliverTimestamp,
          confirmTimestamp,
          apiStatus: basicVo.status || 0,
          wmOrderViewId: String(uoi.wmOrderViewId || commonInfo.wm_order_id_view || ''),
          wmOrderId: String(uoi.wmOrderId || ''),
          remark,
          estimatedIncome,
          products,
          // API 不能提供的字段，留空，等 DOM 补充：
          customerName: '',
          phoneTail: '',
          riderName: '',
          suggestedCookTime: '',
          suggestedCookSeconds: 0,
          cookTime: '',
          isNewCustomer: false,
          customerOrderCount: 0,
          isFavCustomer: false,
          isFlashDelivery: false,
          deliveryType: basicVo.shippingService === 1020 ? 'meituan' : '',
          source: 'api',
          updatedAt: Date.now(),
          _raw: rawOrder,
        });
      } catch (e) {
        console.warn('[WM-V2] 解析 API 订单数据失败:', e);
        return null;
      }
    }

    _resolveStatus(apiStatus, statusDesc) {
      for (const [keyword, status] of Object.entries(STATUS_DESC_MAP)) {
        if (statusDesc.includes(keyword)) return status;
      }
      if (apiStatus === 2) return ORDER_STATUS.PENDING_ACCEPT;
      if (apiStatus === 8) return ORDER_STATUS.DELIVERED;
      if (apiStatus === 4) {
        if (statusDesc.includes('出餐')) return ORDER_STATUS.COOKED;
        if (statusDesc.includes('取餐') || statusDesc.includes('送达') || statusDesc.includes('配送')) return ORDER_STATUS.DELIVERING;
        return ORDER_STATUS.PENDING_COOK;
      }
      return ORDER_STATUS.UNKNOWN;
    }
  }

  // ==================== 导出 ====================
  V2.OrderData = OrderData;
  V2.OrderStore = OrderStore;
  V2.ORDER_STATUS = ORDER_STATUS;
  V2.API_STATUS_MAP = API_STATUS_MAP;
  V2.STATUS_DESC_MAP = STATUS_DESC_MAP;

  console.log('[WM-V2] orderStore 模块已加载（v2.2 - API/DOM 合并策略修复）');
})();

/**
 * @file 美团外卖商家版 — 出餐计时引擎 (V2)
 * @description 出餐计时逻辑，支持两种策略：
 *
 *   策略 A — "下单后 XX秒 ~ YY秒"：
 *     即时单：下单时间 + cookAfterXs ~ 下单时间 + cookBeforeYs
 *     预订单：虚拟下单时间 + cookAfterXs ~ 虚拟下单时间 + cookBeforeYs
 *
 *   策略 B — "出餐前 XX秒 ~ YY秒"：
 *     即时单：建议出餐时间 - cookBeforeYs ~ 建议出餐时间 - cookAfterXs
 *     预订单：建议出餐时间 - cookBeforeYs ~ 建议出餐时间 - cookAfterXs
 *
 *   预订单的虚拟下单时间 = 建议出餐时间 - virtualOrderOffsetSeconds
 *     默认 virtualOrderOffsetSeconds = 1200 (20分钟)
 *     (老版本为 600 = 10分钟，现调整为 1200 = 20分钟)
 *
 * @note 本模块是 V2 混合架构的一部分。
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

  // ==================== 时间解析工具 ====================
  const TimeUtils = {
    /** "06-09 16:50" → 毫秒时间戳 */
    parseOrderTime(timeStr, now) {
      now = now || Date.now();
      if (!timeStr) return 0;
      const match = timeStr.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      if (!match) return 0;
      const [, month, day, hour, minute] = match;
      const year = new Date(now).getFullYear();
      return new Date(year, parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute)).getTime();
    },
    /** "09分59秒" | "10:00" | 纯数字 → 秒数 */
    parseCookDuration(str) {
      if (!str) return 0;
      let match = str.match(/(\d+)分(\d+)秒/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
      match = str.match(/(\d+):(\d+)/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
      match = str.match(/^(\d+)$/);
      if (match) return parseInt(match[1]);
      return 0;
    },
    /** 秒数 → "3分16秒" */
    formatDuration(seconds) {
      if (seconds <= 0) return '0秒';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (m > 0) return `${m}分${s}秒`;
      return `${s}秒`;
    },
    /** 毫秒时间戳 → "HH:MM:SS" */
    formatTime(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    },
    /** 毫秒时间戳 → "MM-DD HH:MM" */
    formatDateTime(ts) {
      const d = new Date(ts);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
  };

  // ==================== 出餐配置 ====================
  const DEFAULT_COOK_CONFIG = {
    /**
     * 出餐策略选择：'afterOrder' | 'beforeCook' | 'manual'
     *
     * 'afterOrder'  — "下单后 XX秒 ~ YY秒出餐"
     *     即时单：真实下单时间 + cookAfterXs 起，+ cookBeforeYs 止
     *     预订单：虚拟下单时间 + cookAfterXs 起，+ cookBeforeYs 止
     *
     * 'beforeCook'  — "建议出餐前 XX秒 ~ YY秒出餐"
     *     即时单：建议出餐截止 - cookBeforeYs 起，- cookAfterXs 止
     *     预订单：建议出餐截止 - cookBeforeYs 起，- cookAfterXs 止
     *
     * 'manual' — 不自动出餐，仅提醒
     */
    strategy: 'afterOrder',

    // ---- 策略 A: "下单后" 模式的参数 ----
    /** 下单后最少等待秒数（窗口起点） */
    cookAfterXs: 240,          // 下单后 240 秒开始可以出餐
    /** 下单后最晚等待秒数（窗口终点，即建议出餐时间） */
    cookBeforeYs: 300,        // 下单后 300 秒（5分钟）必须出餐

    // ---- 策略 B: "出餐前" 模式的参数 ----
    /** 出餐截止前 XX 秒开始出餐（窗口起点） */
    cookBeforeYsBeforeCook: 300, // 出餐截止前 5 分钟开始
    /** 出餐截止前 YY 秒必须出餐（窗口终点） */
    cookAfterXsBeforeCook: 30,   // 出餐截止前 30 秒必须出

    // ---- 预订单参数 ----
    /**
     * 预订单虚拟下单时间偏移（秒）：
     *   虚拟下单时间 = 建议出餐时间 - virtualOrderOffsetSeconds
     *   老版本默认 600 (10分钟)，现调整为 1200 (20分钟)
     */
    virtualOrderOffsetSeconds: 1200, // 20分钟

    // ---- 通用参数 ----
    /** 轮询间隔（毫秒） */
    checkInterval: 5000,
    /** 最大等待时间（毫秒），超过则停止监控 */
    maxWaitMs: 12 * 60 * 60 * 1000,
  };

  // ==================== 出餐计时引擎 ====================
  class CookEngine {
    constructor(orderStore, config = {}) {
      this.store = orderStore;
      this.config = { ...DEFAULT_COOK_CONFIG, ...config };
      this._timers = new Map();
      this._running = false;
      this._intervalId = null;
      this._onCook = null;
      this._onUpdate = null;
      this.store.onChange((event) => {
        if (event === 'update' && this._running) this._checkAll();
      });
    }

    onCook(callback) { this._onCook = callback; return this; }
    onUpdate(callback) { this._onUpdate = callback; return this; }

    start() {
      if (this._running) return this;
      this._running = true;
      console.log('[WM-V2] 出餐引擎已启动');
      console.log(`[WM-V2] 策略: ${this.config.strategy === 'afterOrder' ? '下单后模式' : this.config.strategy === 'beforeCook' ? '出餐前模式' : '手动模式'}`);
      console.log(`[WM-V2] 即时单: 下单后 ${this.config.cookAfterXs}s ~ ${this.config.cookBeforeYs}s`);
      console.log(`[WM-V2] 预订单: 虚拟下单时间 = 建议出餐时间 - ${this.config.virtualOrderOffsetSeconds}s (${this.config.virtualOrderOffsetSeconds / 60}分钟)`);
      this._checkAll();
      this._intervalId = setInterval(() => this._checkAll(), this.config.checkInterval);
      return this;
    }

    stop() {
      if (this._intervalId) clearInterval(this._intervalId);
      this._intervalId = null;
      for (const [, info] of this._timers) { if (info.timerId) clearTimeout(info.timerId); }
      this._timers.clear();
      this._running = false;
      console.log('[WM-V2] 出餐引擎已停止');
      return this;
    }

    getPendingTimers() {
      return [...this._timers.entries()].map(([orderNo, info]) => ({
        orderNo, ...info,
        remainingMs: Math.max(0, info.windowStart - Date.now()),
      }));
    }

    // -------- 核心计算逻辑 --------

    _checkAll() {
      const now = Date.now();
      const ORDER_STATUS = V2.ORDER_STATUS || { PENDING_COOK: 'pending_cook', CANCELLED: 'cancelled' };
      const ordersToCheck = this.store.getPendingCook();
      const updates = [];

      for (const order of ordersToCheck) {
        const window = this._calculateCookWindow(order, now);
        if (!window) continue; // 无法计算

        order._cookDeadline = window.deadline;

        const remaining = window.start - now;  // 距实际出餐触发点的时间
        const remainingSec = Math.max(0, Math.ceil(remaining / 1000));

        updates.push({
          orderNo: order.orderNo,
          customerName: order.customerName,
          status: order.status,
          isPreOrder: order.isPreOrder,
          deadline: window.deadline,
          remainingMs: remaining,
          remainingSec,
          deadlineStr: TimeUtils.formatTime(window.deadline),
          windowStart: window.start,
          windowStartStr: TimeUtils.formatTime(window.start),
          strategy: window.strategy,
          virtualOrderTime: window.virtualOrderTime,
        });

        // 是否在出餐窗口内？
        if (now >= window.start && now <= window.deadline + 5000) {
          if (!this._timers.has(order.orderNo)) {
            this._cook(order);
          }
        } else if (window.start > now) {
          this._setTimer(order, window.start - now, window);
        }
      }

      if (this._onUpdate) this._onUpdate(updates);
      this.store.save();
    }

    /**
     * 计算出餐窗口 [start, deadline]
     * 返回 { start, deadline, strategy, virtualOrderTime? } 或 null
     */
    _calculateCookWindow(order, now = Date.now()) {
      if (this.config.strategy === 'manual') return null; // 不自动出餐

      const cookSec = order.suggestedCookSeconds || TimeUtils.parseCookDuration(order.suggestedCookTime);
      const isPreOrder = order.isPreOrder;

      // 计算基准时间点
      let baseTime; // "下单时间"（即时单=真实下单时间，预订单=虚拟下单时间）

      if (isPreOrder) {
        // 预订单：虚拟下单时间 = 建议出餐时间 - virtualOrderOffsetSeconds
        const deadline = TimeUtils.parseOrderTime(order.suggestedCookDeadline, now) || order.deliverTimestamp || TimeUtils.parseOrderTime(order.deliverTime, now);
        if (!deadline) return null;
        baseTime = deadline - this.config.virtualOrderOffsetSeconds * 1000;
      } else {
        // 即时单：真实下单时间
        baseTime = order.orderTimestamp || TimeUtils.parseOrderTime(order.orderTime, now);
        if (!baseTime) return null;
      }

      // 建议出餐截止时间（用于"出餐前"策略）
      const cookDeadline = isPreOrder
        ? (TimeUtils.parseOrderTime(order.suggestedCookDeadline, now) || order.deliverTimestamp || TimeUtils.parseOrderTime(order.deliverTime, now))
        : (baseTime + (cookSec > 0 ? cookSec * 1000 : 600000)); // 默认 10 分钟

      let start, deadline, strategy;

      if (this.config.strategy === 'afterOrder') {
        // ===== 策略 A: "下单后 XX秒 ~ YY秒" =====
        if (isPreOrder) {
          // 预订单：虚拟下单时间 + cookAfterXs ~ 虚拟下单时间 + cookBeforeYs
          start = baseTime + this.config.cookAfterXs * 1000;
          deadline = baseTime + this.config.cookBeforeYs * 1000;
        } else {
          // 即时单：下单时间 + cookAfterXs ~ 下单时间 + (建议时长 or cookBeforeYs)
          start = baseTime + this.config.cookAfterXs * 1000;
          if (cookSec > 0) {
            deadline = baseTime + cookSec * 1000;
          } else {
            deadline = baseTime + this.config.cookBeforeYs * 1000;
          }
        }
        strategy = 'afterOrder';
      } else if (this.config.strategy === 'beforeCook') {
        // ===== 策略 B: "出餐前 XX秒 ~ YY秒" =====
        if (!cookDeadline) return null;
        // 出餐截止前 cookBeforeYsBeforeCook 秒 ~ 出餐截止前 cookAfterXsBeforeCook 秒
        start = cookDeadline - this.config.cookBeforeYsBeforeCook * 1000;
        deadline = cookDeadline - this.config.cookAfterXsBeforeCook * 1000;
        strategy = 'beforeCook';
      } else {
        return null;
      }

      return {
        start,
        deadline,
        strategy,
        baseTime,
        cookDeadline,
        virtualOrderTime: isPreOrder ? baseTime : undefined,
      };
    }

    /** 设置一次性定时器，在窗口开始时间触发 */
    _setTimer(order, delayMs, window) {
      const existing = this._timers.get(order.orderNo);
      if (existing && existing.timerId && Math.abs(existing.delay - delayMs) < 5000) return;
      if (existing?.timerId) clearTimeout(existing.timerId);

      const timerId = setTimeout(() => this._checkAll(), Math.min(delayMs, 30000)); // 最多30秒检查一次
      this._timers.set(order.orderNo, {
        deadline: window.deadline,
        windowStart: window.start,
        delay: delayMs,
        timerId,
        orderNo: order.orderNo,
        customerName: order.customerName,
        isPreOrder: order.isPreOrder,
        strategy: window.strategy,
      });

      const desc = order.isPreOrder
        ? `(预订单, 虚拟下单${TimeUtils.formatTime(window.virtualOrderTime)})`
        : '';
      console.log(
        `[WM-V2] ⏰ ${order.orderNo} ${desc}` +
        ` → ${window.strategy === 'afterOrder' ? '下单后' : '出餐前'}模式` +
        ` | 窗口: ${TimeUtils.formatTime(window.start)} ~ ${TimeUtils.formatTime(window.deadline)}` +
        ` | ${TimeUtils.formatDuration(Math.ceil(delayMs / 1000))}后检查`
      );
    }

    /** 执行出餐（在 _checkAll 中判定在窗口内时直接调用） */
    _cook(order) {
      const timer = this._timers.get(order.orderNo);
      if (timer?.timerId) clearTimeout(timer.timerId);
      this._timers.delete(order.orderNo);

      console.log(`[WM-V2] 🔔 出餐时间到！订单 ${order.orderNo} (${order.customerName || ''}${order.isPreOrder ? ', 预订单' : ''})`);

      if (this._onCook) {
        this._onCook(order.orderNo, order);
      }
    }
  }

  const ORDER_STATUS = V2.ORDER_STATUS || { PENDING_COOK: 'pending_cook' };

  // ==================== 导出 ====================
  V2.CookEngine = CookEngine;
  V2.TimeUtils = TimeUtils;
  V2.DEFAULT_COOK_CONFIG = DEFAULT_COOK_CONFIG;

  console.log('[WM-V2] cookEngine 模块已加载（v2.2 - 双策略 + 预订单虚拟下单时间）');
})();

/**
 * @file 美团外卖商家版 — 混合模式监控脚本 (V2)
 * @description API 数据优先 + DOM 兜底 + 本地数据层 + 独立出餐计时
 *              架构：orderApi（拦截/请求） → orderStore（存储） → cookEngine（计时） → DOM（操作）
 *
 * @note UI 层采用 V1 风格的简单全局函数，数据层使用 orderStore + cookEngine
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  var V2 = window.__WM_V2;

  // ==================== 配置 ====================
  var MONITOR_CONFIG = {
    domPollInterval: 5000,
    apiRefreshInterval: 30000,
    maxCookWindow: 30 * 60 * 1000,
    domPollEnabled: true,
    apiInterceptEnabled: true,
    autoSwitchTab: false,

    cook: {
      strategy: 'afterOrder',
      cookAfterXs: 240,
      cookBeforeYs: 300,
      virtualOrderOffsetSeconds: 1200,
      minWaitSeconds: 10,
      checkInterval: 5000,
    },
  };

  // ==================== MonitorV2 主类（纯数据层编排，不含 UI） ====================
  class MonitorV2 {
    constructor(config) {
      config = config || {};
      this.config = { ...MONITOR_CONFIG, ...config, cook: { ...MONITOR_CONFIG.cook, ...(config.cook || {}) } };
      this.running = false;

      this.apiInterceptor = new V2.ApiInterceptor();
      this.apiRequester = new V2.ApiRequester();
      this.store = new V2.OrderStore();
      this.cookEngine = new V2.CookEngine(this.store, this.config.cook);

      this._domPollTimer = null;
      this._lastPrintTime = 0;
      this._notFoundOrders = new Set();

      this.cookEngine.onCook((orderNo, order) => this._onCookTime(orderNo, order));
      this.cookEngine.onUpdate((updates) => this._onTimerUpdate(updates));
    }

    start() {
      if (this.running) { this.log('⚠️ 监控已在运行中'); return this; }
      this.running = true;
      this.log('🚀 监控已启动');

      this._cleanStaleDomRefs();

      if (this.config.apiInterceptEnabled) {
        this.apiInterceptor.install();
        this.apiInterceptor.on('/order/list/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/mix/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/pre/', (d) => this._onAPIData(d));
      }

      this._domPoll();
      this._domPollTimer = setInterval(() => this._domPoll(), this.config.domPollInterval);
      this.cookEngine.start();
      this._printStats();
      return this;
    }

    stop() {
      if (!this.running) return this;
      this.running = false;
      if (this._domPollTimer) clearInterval(this._domPollTimer);
      this.cookEngine.stop();
      this.apiInterceptor.off();
      this.log('🛑 监控已停止');
      return this;
    }

    refresh() {
      this._domPoll();
      this._printStats();
      return this;
    }

    getStatus() {
      var all = this.store.getAll();
      var pending = this.store.getPendingCook();
      var timers = this.cookEngine.getPendingTimers();
      return { running: this.running, totalOrders: all.length, pendingCookCount: pending.length, activeTimers: timers };
    }

    updateCookConfig(cfg) {
      Object.assign(this.config.cook, cfg);
      if (this.cookEngine) this.cookEngine.updateConfig(this.config.cook);
      return this;
    }

    reset() {
      this.cookEngine.stop();
      this.store.clear();
      this._notFoundOrders.clear();
      this.log('♻️ 数据已清空');
      if (this.running) this.cookEngine.start();
      return this;
    }

    log(msg, category) {
      console.log('[WM-V2]', msg);
      if (typeof window.panelLog === 'function') window.panelLog(msg, 'gray', category);
    }

    _cleanStaleDomRefs() {
      var cleaned = 0;
      var orders = this.store.orders;
      for (var _i = 0, _entries = orders.entries(); _i < orders.size; _i++) {
        var entry = _entries.next();
        if (entry.done) break;
        var order = entry.value[1];
        if (order._element) { order._element = null; cleaned++; }
        if (order.buttons && order.buttons.length > 0) { order._buttonsStale = true; cleaned++; }
      }
      if (cleaned > 0) this.store.save();
    }

    _domPoll() {
      try {
        var domOrders = this._extractFromDOM();
        if (domOrders && domOrders.length > 0) {
          this.store.updateFromDOM(domOrders);
          for (var i = 0; i < domOrders.length; i++) {
            var existing = this.store.get(domOrders[i].orderNo);
            if (existing) existing._buttonsStale = false;
          }
        }
      } catch (e) {
        console.error('[WM-V2] DOM poll error:', e.message);
      }
    }

    _extractFromDOM() {
      var doc = document, win = window;
      if (window.self === window.top) {
        var iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; win = iframe.contentWindow; } catch (e) {}
        }
      }

      if (typeof win.extractOrders === 'function') return win.extractOrders();

      var cards = doc.querySelectorAll('[class*="order-card"]');
      if (!cards || cards.length === 0) return [];

      var orders = [];
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var text = card.innerText || '';
        var orderNoMatch = text.match(/订单编号[：:]\s*(\d+)/);
        if (!orderNoMatch) continue;

        var order = {};
        order.orderNo = orderNoMatch[1];
        order.orderIndex = parseInt((text.match(/#(\d+)/) || [])[1]) || 0;
        order.orderTime = (text.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})\s*下单/) || [])[1] || '';
        order.deliverTime = (text.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})\s*前送达/) || [])[1] || '';
        order.customerName = (text.match(/([^\s]{1,4}(?:先生|女士))/) || [])[1] || '';
        order.phoneTail = (text.match(/手机尾号(\d{4})/) || [])[1] || '';
        order.remark = (text.match(/备注\s*([\s\S]*?)(?=\d种商品|$)/) || [])[1]?.trim() || '';
        order.estimatedIncome = parseFloat((text.match(/预计收入\s*￥([\d.]+)/) || [])[1]) || 0;

        if (text.includes('待出餐')) order.status = 'pending_cook';
        else if (text.includes('待接单')) order.status = 'pending_accept';
        else if (text.includes('已出餐')) order.status = 'cooked';
        else if (text.includes('配送中') || text.includes('骑手已取餐')) order.status = 'delivering';
        else if (text.includes('已送达') || text.includes('用户已收餐')) order.status = 'delivered';
        else if (text.includes('已取消')) order.status = 'cancelled';
        else order.status = 'unknown';

        order.cookTime = (text.match(/用时(\d{2}):(\d{2})/) || []).slice(1).join(':') || '';
        var ctm = text.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
        order.suggestedCookTime = ctm ? ctm[1] + '分' + ctm[2] + '秒' : '';
        order.suggestedCookSeconds = ctm ? parseInt(ctm[1]) * 60 + parseInt(ctm[2]) : 0;
        order.isPreOrder = text.includes('预订单') || text.includes('预约单');
        order.suggestedCookDeadline = '';
        var dlMatch = text.match(/建议出餐时间(\d{2}-\d{2}\s+\d{2}:\d{2})前/);
        if (dlMatch) order.suggestedCookDeadline = dlMatch[1].trim();
        order.orderTimestamp = V2.TimeUtils.parseOrderTime(order.orderTime);
        order.deliverTimestamp = V2.TimeUtils.parseOrderTime(order.deliverTime);
        if (!order.isPreOrder && order.orderTimestamp > 0 && order.deliverTimestamp > 0 && (order.deliverTimestamp - order.orderTimestamp) > 2 * 3600000) {
          order.isPreOrder = true;
        }
        order.deliveryType = text.includes('美团配送') ? 'meituan' : '';
        order.isFlashDelivery = text.includes('闪电送') || text.includes('15分钟更近');
        order.isNewCustomer = text.includes('门店新客');
        order.isFavCustomer = text.includes('收藏店铺');
        order.riderName = (text.match(/([一-龥]{2,4})\s*\n\s*美团配送/) || [])[1] || '';

        order.buttons = [];
        var btns = card.querySelectorAll('button');
        for (var j = 0; j < btns.length; j++) {
          order.buttons.push({ text: btns[j].innerText.trim(), className: btns[j].className || '' });
        }
        order._element = card;
        order.source = 'dom';
        order.updatedAt = Date.now();
        orders.push(order);
      }
      return orders;
    }

    _onAPIData(data) {
      if (!data || !data.response || data.response.code !== 0) return;
      var orderData = data.response.data;
      if (orderData) this.store.updateFromAPI(orderData);
    }

    _onCookTime(orderNo, order) {
      var success = this._clickCookButton(orderNo, order);
      if (success) {
        this.log('✅ 自动出餐: ' + orderNo);
        this._notFoundOrders.delete(orderNo);
        var stored = this.store.get(orderNo);
        if (stored) { stored.status = 'cooked'; stored.statusDesc = ''; }
        if (typeof window.updatePanelOrders === 'function') window.updatePanelOrders();
      } else {
        if (!order._element && !this._notFoundOrders.has(orderNo)) {
          this._notFoundOrders.add(orderNo);
          this.log('⚠️ 订单不在当前页面: ' + orderNo + ' (需手动出餐)');
        }
      }
    }

    _clickCookButton(orderNo, order) {
      var doc = document;
      if (window.self === window.top) {
        var iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return false; }
        }
      }

      if (order && order._element) {
        try {
          var buttons = order._element.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) {
            var t = buttons[i].innerText.trim();
            if (t === '出餐完成' || t === '出餐' || t === '确认出餐') {
              buttons[i].click();
              return true;
            }
          }
        } catch (e) {}
      }

      var cards = doc.querySelectorAll('[class*="order-card"]');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var text = card.innerText || '';
        var match = text.match(/订单编号[：:]\s*(\d+)/);
        if (match && match[1] === orderNo) {
          var btns = card.querySelectorAll('button');
          for (var j = 0; j < btns.length; j++) {
            var btnText = btns[j].innerText.trim();
            if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
              btns[j].click();
              return true;
            }
          }
        }
      }
      return false;
    }

    _onTimerUpdate(updates) {
      if (!this._lastPrintTime || Date.now() - this._lastPrintTime > 30000) {
        this._lastPrintTime = Date.now();
        this._printStats();
      }
    }

    _printStats() {
      var all = this.store.getAll();
      var pending = this.store.getPendingCook();
      var timers = this.cookEngine.getPendingTimers();
      this.log('💓 心跳: ' + all.length + '单 待出餐' + pending.length + '单 计时' + timers.length + '单', 'heartbeat');
      for (var i = 0; i < timers.length; i++) {
        var remaining = Math.ceil(timers[i].remainingMs / 1000);
        var min = Math.floor(remaining / 60);
        var sec = remaining % 60;
        this.log('  ⏰ #' + timers[i].orderNo + ' ' + (timers[i].customerName || '') + ' → ' + (min > 0 ? min + '分' : '') + sec + '秒', 'heartbeat');
      }
    }
  }

  // ==================== 导出 ====================
  V2.MonitorV2 = MonitorV2;
  V2.MONITOR_CONFIG = MONITOR_CONFIG;

  // ==================== 全局实例管理 ====================
  window.__WM_START = function (config) {
    if (window.__wmV2Instance) { window.__wmV2Instance.stop(); }
    window.__wmV2Instance = new MonitorV2(config);
    window.__wmV2Instance.start();
    return window.__wmV2Instance;
  };
  window.__WM_STOP = function () {
    if (window.__wmV2Instance) { window.__wmV2Instance.stop(); window.__wmV2Instance = null; }
  };
  window.__WM_STATUS = function () {
    return window.__wmV2Instance ? window.__wmV2Instance.getStatus() : null;
  };

  // ==================== UI 面板（独立于 MonitorV2 类，V1 风格） ====================

  window.__cookConfig = window.__cookConfig || {
    strategy: 'after_order',
    afterOrderMinSec: 240,
    afterOrderMaxSec: 300,
    beforeDeadlineMinSec: 120,
    beforeDeadlineMaxSec: 180
  };

  window.createPanel = function() {
    if (document.getElementById('waimai-panel-container')) return;

    var style = document.createElement('style');
    style.id = 'waimai-panel-styles';
    style.textContent = [
      '#waimai-panel-container { position: fixed; bottom: 20px; right: 20px; z-index: 2147483640; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; }',
      '#waimai-panel-toggle { background: rgba(26,26,46,0.95); color: #fff; border: none; border-radius: 20px; padding: 10px 18px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 20px rgba(102,126,234,0.4); transition: transform 0.2s; }',
      '#waimai-panel-toggle:hover { transform: scale(1.05); }',
      '#waimai-panel-toggle .badge { background: #f59e0b; color: #1a1a2e; border-radius: 10px; padding: 1px 7px; font-size: 12px; font-weight: bold; }',
      '#waimai-panel { display: none; background: rgba(26,26,46,0.97); color: #e0e0e0; border-radius: 12px; width: 380px; max-height: 80vh; box-shadow: 0 8px 40px rgba(0,0,0,0.4); overflow: hidden; margin-bottom: 8px; }',
      '#waimai-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }',
      '#waimai-panel-header h3 { margin: 0; font-size: 15px; color: #fff; }',
      '#waimai-panel-header .header-btns { display: flex; gap: 8px; }',
      '#waimai-panel-header .header-btns button { background: none; border: 1px solid rgba(255,255,255,0.2); color: #aaa; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }',
      '#waimai-panel-header .header-btns button:hover { color: #fff; border-color: #fff; }',
      '.waimai-section { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }',
      '.waimai-section-title { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }',
      '.waimai-section-title button { background: none; border: none; color: #667eea; cursor: pointer; font-size: 12px; padding: 0; }',
      '.waimai-order-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }',
      '.waimai-order-item:last-child { border-bottom: none; }',
      '.waimai-order-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }',
      '.waimai-order-id { font-weight: bold; color: #fff; }',
      '.waimai-order-name { color: #e0e0e0; }',
      '.waimai-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }',
      '.waimai-tag-pending { background: rgba(239,68,68,0.2); color: #f87171; }',
      '.waimai-tag-preorder { background: rgba(251,146,60,0.2); color: #fb923c; }',
      '.waimai-tag-cooked { background: rgba(34,197,94,0.2); color: #4ade80; }',
      '.waimai-tag-rider { background: rgba(59,130,246,0.2); color: #60a5fa; }',
      '.waimai-tag-other { background: rgba(156,163,175,0.2); color: #9ca3af; }',
      '.waimai-order-detail { font-size: 12px; color: #888; padding-left: 4px; }',
      '.waimai-order-detail .timer { color: #f59e0b; font-weight: bold; }',
      '.waimai-order-detail .done { color: #4ade80; }',
      '.waimai-detail-toggle { font-size: 10px; color: #667eea; cursor: pointer; margin-left: auto; white-space: nowrap; user-select: none; }',
      '.waimai-detail-toggle:hover { color: #8b9cf7; }',
      '.waimai-order-debug { font-size: 11px; color: #888; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; display: none; }',
      '#waimai-order-list { max-height: 150px; overflow-y: auto; }',
      '#waimai-order-list.expanded { max-height: 400px; }',
      '.waimai-strategy { margin-top: 6px; }',
      '.waimai-strategy label { display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer; color: #ccc; font-size: 13px; }',
      '.waimai-strategy input[type="radio"] { accent-color: #667eea; }',
      '.waimai-strategy input[type="number"] { width: 50px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; padding: 2px 4px; font-size: 13px; text-align: center; }',
      '.waimai-btn-row { display: flex; gap: 8px; margin-top: 8px; }',
      '.waimai-btn { border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.2s; }',
      '.waimai-btn:hover { opacity: 0.85; }',
      '.waimai-btn-start { background: #4CAF50; color: #fff; }',
      '.waimai-btn-stop { background: #f44336; color: #fff; }',
      '.waimai-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
      '#waimai-log-area { height: 120px; overflow-y: auto; font-size: 12px; font-family: "SF Mono", Menlo, Consolas, monospace; line-height: 1.6; }',
      '.waimai-log-tabs { display: flex; gap: 2px; margin-bottom: 6px; }',
      '.waimai-log-tab { font-size: 11px; padding: 2px 10px; border-radius: 3px; cursor: pointer; color: #888; background: rgba(255,255,255,0.05); }',
      '.waimai-log-tab:hover { color: #ccc; }',
      '.waimai-log-tab.active { color: #fff; background: rgba(102,126,234,0.3); }',
      '.waimai-log-entry { padding: 1px 0; }',
      '.waimai-log-entry.hidden { display: none; }',
      '.waimai-log-red { color: #f87171; }',
      '.waimai-log-green { color: #4ade80; }',
      '.waimai-log-blue { color: #60a5fa; }',
      '.waimai-log-orange { color: #f59e0b; }',
      '.waimai-log-gray { color: #9ca3af; }',
      '#waimai-log-area::-webkit-scrollbar { width: 6px; }',
      '#waimai-log-area::-webkit-scrollbar-track { background: transparent; }',
      '#waimai-log-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }',
      '#waimai-order-list::-webkit-scrollbar { width: 6px; }',
      '#waimai-order-list::-webkit-scrollbar-track { background: transparent; }',
      '#waimai-order-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }',
    ].join('\n');
    document.head.appendChild(style);

    var container = document.createElement('div');
    container.id = 'waimai-panel-container';

    var toggle = document.createElement('button');
    toggle.id = 'waimai-panel-toggle';
    toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">0</span> 待出餐 ▼';
    toggle.onclick = function() {
      var panel = document.getElementById('waimai-panel');
      if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + (window.__pendingCount || 0) + '</span> 待出餐 ▲';
      } else {
        panel.style.display = 'none';
        toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + (window.__pendingCount || 0) + '</span> 待出餐 ▼';
      }
    };
    container.appendChild(toggle);

    var panel = document.createElement('div');
    panel.id = 'waimai-panel';
    panel.innerHTML = [
      '<div id="waimai-panel-header">',
      '  <h3>🛵 美团出餐助手 <span style="font-size:10px;background:#667eea;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px;">V2</span></h3>',
      '  <div class="header-btns">',
      '    <button onclick="document.getElementById(\'waimai-panel\').style.display=\'none\'; document.getElementById(\'waimai-panel-toggle\').innerHTML=\'🛵 <span class=badge id=waimai-badge>\' + (window.__pendingCount||0) + \'</span> 待出餐 ▼\';">收起</button>',
      '  </div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title">',
      '    <span>📋 订单列表</span>',
      '    <button onclick="var l=document.getElementById(\'waimai-order-list\');l.classList.toggle(\'expanded\');this.textContent=l.classList.contains(\'expanded\')?\'收起\':\'展开\';">展开</button>',
      '  </div>',
      '  <div id="waimai-order-list">暂无订单数据</div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title"><span>⏰ 出餐策略</span></div>',
      '  <div class="waimai-strategy">',
      '    <label><input type="radio" name="waimai-strategy" value="after_order" checked> 下单后 <input type="number" id="waimai-after-min-sec" value="240" min="0" max="1800" style="width:50px">~<input type="number" id="waimai-after-max-sec" value="300" min="0" max="1800" style="width:50px"> 秒</label>',
      '    <label><input type="radio" name="waimai-strategy" value="before_deadline"> 建议出餐前 <input type="number" id="waimai-before-min-sec" value="120" min="0" max="600" style="width:50px">~<input type="number" id="waimai-before-max-sec" value="180" min="0" max="600" style="width:50px"> 秒</label>',
      '    <label><input type="radio" name="waimai-strategy" value="manual"> 手动出餐</label>',
      '  </div>',
      '  <div class="waimai-btn-row">',
      '    <button class="waimai-btn waimai-btn-start" id="waimai-btn-start" onclick="window.startMonitorFromPanel()">开始监控</button>',
      '    <button class="waimai-btn waimai-btn-stop" id="waimai-btn-stop" onclick="window.stopOrderMonitor()" disabled>停止监控</button>',
      '  </div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title">',
      '    <span>📝 日志</span>',
      '    <button onclick="document.getElementById(\'waimai-log-area\').innerHTML=\'\';">清空</button>',
      '  </div>',
      '  <div class="waimai-log-tabs">',
      '    <span class="waimai-log-tab active" data-filter="all" onclick="window.filterLogs(\'all\', this)">全部</span>',
      '    <span class="waimai-log-tab" data-filter="op" onclick="window.filterLogs(\'op\', this)">操作</span>',
      '    <span class="waimai-log-tab" data-filter="hb" onclick="window.filterLogs(\'hb\', this)">心跳</span>',
      '  </div>',
      '  <div id="waimai-log-area"></div>',
      '</div>',
    ].join('');

    container.appendChild(panel);
    document.body.appendChild(container);

    var radios = container.querySelectorAll('input[name="waimai-strategy"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function() {
        window.__cookConfig = window.__cookConfig || {};
        window.__cookConfig.strategy = this.value;
        window.panelLog('🔄 策略切换: ' + this.value, 'blue');
      });
    }

    var afterMinEl = document.getElementById('waimai-after-min-sec');
    var afterMaxEl = document.getElementById('waimai-after-max-sec');
    var beforeMinEl = document.getElementById('waimai-before-min-sec');
    var beforeMaxEl = document.getElementById('waimai-before-max-sec');

    if (afterMinEl) afterMinEl.addEventListener('change', function() { window.__cookConfig.afterOrderMinSec = parseInt(this.value) || 240; });
    if (afterMaxEl) afterMaxEl.addEventListener('change', function() { window.__cookConfig.afterOrderMaxSec = parseInt(this.value) || 300; });
    if (beforeMinEl) beforeMinEl.addEventListener('change', function() { window.__cookConfig.beforeDeadlineMinSec = parseInt(this.value) || 120; });
    if (beforeMaxEl) beforeMaxEl.addEventListener('change', function() { window.__cookConfig.beforeDeadlineMaxSec = parseInt(this.value) || 180; });

    if (window.__cookConfig) {
      var cfg = window.__cookConfig;
      if (afterMinEl) afterMinEl.value = cfg.afterOrderMinSec || 240;
      if (afterMaxEl) afterMaxEl.value = cfg.afterOrderMaxSec || 300;
      if (beforeMinEl) beforeMinEl.value = cfg.beforeDeadlineMinSec || 120;
      if (beforeMaxEl) beforeMaxEl.value = cfg.beforeDeadlineMaxSec || 180;
      var currentStrategy = cfg.strategy || 'after_order';
      for (var i = 0; i < radios.length; i++) { radios[i].checked = (radios[i].value === currentStrategy); }
    }
  };

  window.panelLog = function(message, color, category) {
    console.log('%c[WM-V2] ' + message, 'color:' + (color === 'red' ? 'red' : color === 'green' ? 'green' : color === 'blue' ? '#667eea' : '#888') + ';font-weight:bold;');

    var logArea = document.getElementById('waimai-log-area');
    if (!logArea) return;
    var entry = document.createElement('div');
    entry.className = 'waimai-log-entry';
    if (category === 'heartbeat') entry.classList.add('waimai-log-hb');
    else entry.classList.add('waimai-log-op');

    var activeTab = document.querySelector('.waimai-log-tab.active');
    var currentFilter = activeTab ? activeTab.getAttribute('data-filter') : 'all';
    if (currentFilter === 'op' && category === 'heartbeat') entry.classList.add('hidden');
    if (currentFilter === 'hb' && category !== 'heartbeat') entry.classList.add('hidden');

    var now = new Date();
    var ts = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    var colorClass = color ? 'waimai-log-' + color : '';
    entry.innerHTML = '<span style="color:#666">' + ts + '</span> <span class="' + colorClass + '">' + message + '</span>';
    logArea.appendChild(entry);
    while (logArea.childElementCount > 100) { logArea.removeChild(logArea.firstChild); }
    logArea.scrollTop = logArea.scrollHeight;
  };

  window.filterLogs = function(filter, tabEl) {
    var tabs = document.querySelectorAll('.waimai-log-tab');
    for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('active'); }
    if (tabEl) tabEl.classList.add('active');

    var entries = document.querySelectorAll('#waimai-log-area .waimai-log-entry');
    for (var i = 0; i < entries.length; i++) {
      var el = entries[i];
      if (filter === 'all') {
        el.classList.remove('hidden');
      } else if (filter === 'op') {
        el.classList.toggle('hidden', el.classList.contains('waimai-log-hb'));
      } else if (filter === 'hb') {
        el.classList.toggle('hidden', !el.classList.contains('waimai-log-hb'));
      }
    }
  };

  window.updatePanelOrders = function() {
    var listEl = document.getElementById('waimai-order-list');
    var badge = document.getElementById('waimai-badge');
    if (!listEl) return;

    var sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;

    var inst = window.__wmV2Instance;
    var allOrders = inst ? inst.store.getAll() : [];
    var timers = inst ? inst.cookEngine.getPendingTimers() : [];

    if (allOrders.length === 0) {
      listEl.innerHTML = '<div style="color:#666;font-size:12px;">暂无订单数据</div>';
      if (badge) badge.textContent = '0';
      return;
    }

    // 去重 + 数据合并：同一 orderNo 只显示一条
    var seen = {};
    var deduped = [];
    for (var i = 0; i < allOrders.length; i++) {
      var o = allOrders[i];
      if (!seen[o.orderNo]) {
        seen[o.orderNo] = o;
        deduped.push(o);
      } else {
        var existing = seen[o.orderNo];
        if (o.customerName && !existing.customerName) {
          seen[o.orderNo] = o;
          deduped[deduped.indexOf(existing)] = o;
        } else if (o.source === 'dom' && existing.source !== 'dom') {
          seen[o.orderNo] = o;
          deduped[deduped.indexOf(existing)] = o;
        }
      }
    }

    // 二次去重：按 orderIndex 合并 API/DOM 可能 orderNo 不同的同一订单
    var byIndex = {};
    var merged = [];
    for (var i = 0; i < deduped.length; i++) {
      var o = deduped[i];
      var idx = o.orderIndex;
      if (!idx || !byIndex[idx]) {
        if (idx) byIndex[idx] = o;
        merged.push(o);
      } else {
        var exist = byIndex[idx];
        if (o.customerName && !exist.customerName) {
          merged[merged.indexOf(exist)] = o;
          byIndex[idx] = o;
        } else if (o.source === 'dom' && exist.source !== 'dom') {
          merged[merged.indexOf(exist)] = o;
          byIndex[idx] = o;
        }
      }
    }
    deduped = merged;

    deduped.sort(function(a, b) {
      if (a.status === 'pending_cook' && b.status !== 'pending_cook') return -1;
      if (a.status !== 'pending_cook' && b.status === 'pending_cook') return 1;
      return (b.orderIndex || 0) - (a.orderIndex || 0);
    });

    var pendingCount = 0;
    var html = '';
    var fmtTime = function(ts) {
      if (!ts) return '--:--:--';
      var d = new Date(ts);
      return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
    };
    var statusLabels = {
      'pending_cook': '待出餐', 'pending_accept': '待接单',
      'cooked': '已出餐', 'delivering': '配送中',
      'delivered': '已送达', 'cancelled': '已取消', 'unknown': '未知'
    };
    var tagClassMap = {
      'pending_cook': 'waimai-tag-pending', 'pending_accept': 'waimai-tag-other',
      'cooked': 'waimai-tag-cooked', 'delivering': 'waimai-tag-rider',
      'delivered': 'waimai-tag-cooked', 'cancelled': 'waimai-tag-other', 'unknown': 'waimai-tag-other'
    };

    for (var i = 0; i < deduped.length; i++) {
      var o = deduped[i];
      if (o.status === 'pending_cook') pendingCount++;

      var statusLabel = o.statusDesc || statusLabels[o.status] || o.status;
      var tagClass = tagClassMap[o.status] || 'waimai-tag-other';
      var statusTag = '<span class="waimai-tag ' + tagClass + '">' + statusLabel + '</span>';

      if (o.isPreOrder) {
        statusTag += ' <span class="waimai-tag waimai-tag-preorder">预订单</span>';
      }

      var detailHtml = '';
      var timerMatch = null;
      for (var t = 0; t < timers.length; t++) {
        if (timers[t].orderNo === o.orderNo) { timerMatch = timers[t]; break; }
      }
      if (timerMatch) {
        var remaining = Math.ceil(timerMatch.remainingMs / 1000);
        var min = Math.floor(remaining / 60);
        var sec = remaining % 60;
        detailHtml = '<div class="waimai-order-detail" data-timer-end="' + timerMatch.windowStart + '">⏰ <span class="timer">' + (min > 0 ? min + '分' : '') + sec + '秒</span>后出餐' +
          (timerMatch.windowStart ? ' <span style="font-size:10px;color:#fb923c">⏱ ' + fmtTime(timerMatch.windowStart) + '</span>' : '') +
          '</div>';
      } else if (o.status === 'pending_cook' && o.suggestedCookSeconds > 0) {
        detailHtml = '<div class="waimai-order-detail">⏳ 建议 ' + o.suggestedCookTime + '</div>';
      } else if (o.status === 'cooked' || o.status === 'delivered') {
        detailHtml = '<div class="waimai-order-detail"><span class="done">✅ ' + statusLabel + '</span></div>';
      } else if (o.isPreOrder && o.suggestedCookDeadline) {
        detailHtml = '<div class="waimai-order-detail">🕒 预约出餐 ' + o.suggestedCookDeadline + '</div>';
      }

      var orderTimeFull = o.orderTimestamp ? fmtTime(o.orderTimestamp) : (o.orderTime || '');
      var debugInfo = 'orderNo: ' + (o.orderNo || '?') +
        ' | source: ' + (o.source || '?') +
        ' | status: ' + (o.status || '?') + (o.apiStatus !== undefined ? ' (api=' + o.apiStatus + ')' : '') +
        ' | isPreOrder: ' + (o.isPreOrder ? 'Y' : 'N') +
        ' | 下单: ' + orderTimeFull +
        (o.deliverTime ? ' | 送达: ' + o.deliverTime : '') +
        (o.suggestedCookTime ? ' | 建议出餐: ' + o.suggestedCookTime : '') +
        (o.suggestedCookDeadline ? ' | 预约出餐: ' + o.suggestedCookDeadline : '') +
        (timerMatch ? ' | 自动出餐时间: ' + fmtTime(timerMatch.windowStart) : '') +
        ((o.status === 'cooked' || o.status === 'delivered') && o.cookTime ? ' | 出餐用时: ' + o.cookTime : '') +
        (o.phoneTail ? ' | 尾号: ' + o.phoneTail : '') +
        (o.riderName ? ' | 骑手: ' + o.riderName : '') +
        (o.deliveryType ? ' | 配送: ' + o.deliveryType : '') +
        (o.estimatedIncome ? ' | 预计收入: ¥' + o.estimatedIncome : '') +
        (o.remark ? ' | 备注: ' + o.remark : '') +
        (o.buttons && o.buttons.length > 0 ? ' | btns: ' + o.buttons.map(function(b){return b.text}).join(',') : '') +
        (o.isNewCustomer ? ' | 新客' : '') +
        (o.isFavCustomer ? ' | 收藏' : '') +
        (o.isFlashDelivery ? ' | 闪电送' : '');

      html += '<div class="waimai-order-item">' +
        '<div class="waimai-order-top">' +
        '<span class="waimai-order-id">#' + (o.orderIndex || '?') + '</span> ' +
        '<span class="waimai-order-name">' + (o.customerName || '') + '</span> ' +
        statusTag +
        '<span class="waimai-detail-toggle" onclick="var d=this.parentElement.parentElement.querySelector(\'.waimai-order-debug\');var v=d.style.display===\'none\'||!d.style.display;d.style.display=v?\'block\':\'none\';this.textContent=v?\'收起 ▾\':\'详情 ▸\'">详情 ▸</span>' +
        '</div>' +
        detailHtml +
        '<div class="waimai-order-debug" data-orderno="' + o.orderNo + '">' + debugInfo + '</div>' +
        '</div>';
    }

    // 保存展开状态
    var expandedOrderNos = {};
    var currentDebugEls = listEl.querySelectorAll('.waimai-order-debug');
    for (var e = 0; e < currentDebugEls.length; e++) {
      if (currentDebugEls[e].style.display === 'block') {
        var eno = currentDebugEls[e].getAttribute('data-orderno');
        if (eno) expandedOrderNos[eno] = true;
      }
    }

    listEl.innerHTML = html;

    // 恢复展开状态
    for (var eno in expandedOrderNos) {
      var debugEl = listEl.querySelector('.waimai-order-debug[data-orderno="' + eno + '"]');
      if (debugEl) {
        debugEl.style.display = 'block';
        var toggle = debugEl.parentElement.querySelector('.waimai-detail-toggle');
        if (toggle) toggle.textContent = '收起 ▾';
      }
    }
    if (badge) badge.textContent = pendingCount;
    window.__pendingCount = pendingCount;

    var toggle = document.getElementById('waimai-panel-toggle');
    if (toggle) {
      var panelEl = document.getElementById('waimai-panel');
      var arrow = (panelEl && panelEl.style.display !== 'none') ? '▲' : '▼';
      toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ' + arrow;
    }
  };

  window.updatePanelTimers = function() {
    var timerItems = document.querySelectorAll('#waimai-order-list [data-timer-end]');
    for (var i = 0; i < timerItems.length; i++) {
      var el = timerItems[i];
      var endTime = parseInt(el.getAttribute('data-timer-end'));
      var remain = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      if (remain <= 0) {
        el.innerHTML = '⏰ 出餐中...';
        el.removeAttribute('data-timer-end');
      } else {
        var min = Math.floor(remain / 60);
        var sec = remain % 60;
        el.innerHTML = '⏰ <span class="timer">' + (min > 0 ? min + '分' : '') + sec + '秒</span>后出餐';
      }
    }
  };

  window.startMonitorFromPanel = function() {
    var cfg = window.__cookConfig || {};

    var afterMinEl = document.getElementById('waimai-after-min-sec');
    var afterMaxEl = document.getElementById('waimai-after-max-sec');
    var beforeMinEl = document.getElementById('waimai-before-min-sec');
    var beforeMaxEl = document.getElementById('waimai-before-max-sec');

    if (afterMinEl) cfg.afterOrderMinSec = parseInt(afterMinEl.value) || 240;
    if (afterMaxEl) cfg.afterOrderMaxSec = parseInt(afterMaxEl.value) || 300;
    if (beforeMinEl) cfg.beforeDeadlineMinSec = parseInt(beforeMinEl.value) || 120;
    if (beforeMaxEl) cfg.beforeDeadlineMaxSec = parseInt(beforeMaxEl.value) || 180;

    var radios = document.querySelectorAll('input[name="waimai-strategy"]');
    for (var i = 0; i < radios.length; i++) { if (radios[i].checked) cfg.strategy = radios[i].value; }

    window.__cookConfig = cfg;

    var v2Strategy = cfg.strategy === 'after_order' ? 'afterOrder' : cfg.strategy === 'before_deadline' ? 'beforeCook' : 'manual';
    window.__WM_START({ cook: {
      strategy: v2Strategy,
      cookAfterXs: cfg.afterOrderMinSec || 240,
      cookBeforeYs: cfg.afterOrderMaxSec || 300,
      cookBeforeYsBeforeCook: cfg.beforeDeadlineMinSec || 120,
      cookAfterXsBeforeCook: cfg.beforeDeadlineMaxSec || 180,
      virtualOrderOffsetSeconds: 1200,
    }});

    window.panelLog('✅ 监控已启动', 'green');

    var startBtn = document.getElementById('waimai-btn-start');
    var stopBtn = document.getElementById('waimai-btn-stop');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    setTimeout(function() { window.updatePanelOrders(); }, 1500);
  };

  window.stopOrderMonitor = function() {
    window.__WM_STOP();
    window.panelLog('🛑 监控已停止', 'red');

    var startBtn = document.getElementById('waimai-btn-start');
    var stopBtn = document.getElementById('waimai-btn-stop');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;

    window.updatePanelOrders();
  };

  // ==================== 定时器（全局） ====================

  var _panelOrderInterval = null;
  var _panelTimerInterval = null;

  function ensurePanelTimers() {
    if (!_panelOrderInterval) {
      _panelOrderInterval = setInterval(function() { window.updatePanelOrders(); }, 5000);
    }
    if (!_panelTimerInterval) {
      _panelTimerInterval = setInterval(function() { window.updatePanelTimers(); }, 1000);
    }
  }

  // ==================== 自动启动 ====================

  var currentHost = window.location.hostname || '';
  var isMeituan = currentHost.indexOf('meituan') !== -1 || currentHost.indexOf('waimai') !== -1;

  window.createPanel();
  ensurePanelTimers();

  if (isMeituan) {
    console.log('[WM-V2] detected meituan page, auto-starting monitor');
    setTimeout(function() {
      window.startMonitorFromPanel();
    }, 1000);
  } else {
    console.log('[WM-V2] panel loaded (non-meituan page)');
  }

})();

})();
