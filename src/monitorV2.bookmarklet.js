/**
 * @file 美团外卖自动出餐助手 V2 — Bookmarklet 版本
 * @description 将所有 V2 模块合并为一个文件，作为浏览器书签使用
 * @usage
 *   方式一：Bookmarklet（推荐）
 *     1. 创建书签，URL 填入：
 *        javascript:void((function(){var s=document.createElement('script');s.src='https://luyuhua.github.io/waimai/src/monitorV2.bookmarklet.js?t='+Date.now();document.body.appendChild(s);})())
 *     2. 在美团商家版页面点击书签即可启动
 *
 *   方式二：控制台
 *     1. 复制本文件全部内容到浏览器控制台执行
 *     2. 执行 __WM_START() 启动监控
 */

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
        const order = new OrderData({
          ...raw,
          source: 'dom',
          updatedAt: Date.now(),
          // 保留 API 独有的字段（DOM 无法提供的）
          _cookDeadline: existing?._cookDeadline || 0,
          _element: raw._element || existing?._element || null,
          isPreOrder: existing?.isPreOrder || raw.isPreOrder || false,
          preOrderShowInTabTime: existing?.preOrderShowInTabTime || 0,
          orderTimestamp: existing?.orderTimestamp || raw.orderTimestamp || 0,
          deliverTimestamp: existing?.deliverTimestamp || raw.deliverTimestamp || 0,
          confirmTimestamp: existing?.confirmTimestamp || 0,
          suggestedCookSeconds: raw.suggestedCookSeconds || existing?.suggestedCookSeconds || 0,
          apiStatus: existing?.apiStatus || 0,
          wmOrderViewId: existing?.wmOrderViewId || '',
          wmOrderId: existing?.wmOrderId || '',
          statusDesc: existing?.statusDesc || '', // 保留 API 的精确状态描述
          // DOM 能提供但 API 不能的字段，直接用 DOM 的值
          customerName: raw.customerName || existing?.customerName || '',
          phoneTail: raw.phoneTail || existing?.phoneTail || '',
          riderName: raw.riderName || existing?.riderName || '',
          suggestedCookTime: raw.suggestedCookTime || existing?.suggestedCookTime || '',
          cookTime: raw.cookTime || existing?.cookTime || '',
          isNewCustomer: raw.isNewCustomer ?? existing?.isNewCustomer ?? false,
          customerOrderCount: raw.customerOrderCount ?? existing?.customerOrderCount ?? 0,
          isFavCustomer: raw.isFavCustomer ?? existing?.isFavCustomer ?? false,
          isFlashDelivery: raw.isFlashDelivery ?? existing?.isFlashDelivery ?? false,
          estimatedIncome: raw.estimatedIncome ?? existing?.estimatedIncome ?? 0,
          products: raw.products?.length > 0 ? raw.products : (existing?.products || []),
          buttons: raw.buttons?.length > 0 ? raw.buttons : (existing?.buttons || []),
        });

        this.orders.set(orderNo, order);
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
        const commonInfo = typeof rawOrder.commonInfo === 'string'
          ? JSON.parse(rawOrder.commonInfo) : (rawOrder.commonInfo || {});
        const orderInfoStr = rawOrder.orderInfo;
        const orderInfo = typeof orderInfoStr === 'string'
          ? JSON.parse(orderInfoStr) : (rawOrder.orderInfo || {});
        const uoi = orderInfo.unifiedOrderInfo || {};
        const basicVo = uoi.basicVo || {};
        const foodInfo = uoi.foodInfo || {};

        const orderNo = String(commonInfo.wm_order_id_view || uoi.wmOrderViewId || rawOrder.wmOrderViewId || '');
        const statusDesc = uoi.statusDesc || '';
        const status = this._resolveStatus(basicVo.status, statusDesc);

        const orderTimestamp = basicVo.orderTime || commonInfo.order_time || 0;
        const deliverTimestamp = basicVo.estimateArrivalTime || commonInfo.estimateArrivalTime || 0;
        const confirmTimestamp = basicVo.confirmTime || commonInfo.confirmTime || 0;

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
 *     预订单：送达时间 - cookBeforeYs ~ 送达时间 - cookAfterXs
 *
 *   预订单的虚拟下单时间 = 送达时间 - virtualOrderOffsetSeconds
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
     *     预订单：送达时间    - cookBeforeYs 起，- cookAfterXs 止
     *
     * 'manual' — 不自动出餐，仅提醒
     */
    strategy: 'afterOrder',

    // ---- 策略 A: "下单后" 模式的参数 ----
    /** 下单后最少等待秒数（窗口起点） */
    cookAfterXs: 60,          // 下单后 60 秒开始可以出餐
    /** 下单后最晚等待秒数（窗口终点，即建议出餐时间） */
    cookBeforeYs: 600,        // 下单后 600 秒（10分钟）必须出餐
    /** 即时单的 cookBeforeYs 是否使用"建议出餐时长"，true=用建议时长，false=用固定 cookBeforeYs */
    useSuggestedCookTime: true, // 即时单：true 时 cookBeforeYs 不生效，改用 suggestedCookSeconds

    // ---- 策略 B: "出餐前" 模式的参数 ----
    /** 出餐截止前 XX 秒开始出餐（窗口起点） */
    cookBeforeYsBeforeCook: 300, // 出餐截止前 5 分钟开始
    /** 出餐截止前 YY 秒必须出餐（窗口终点） */
    cookAfterXsBeforeCook: 30,   // 出餐截止前 30 秒必须出

    // ---- 预订单参数 ----
    /**
     * 预订单虚拟下单时间偏移（秒）：
     *   虚拟下单时间 = 送达时间 - virtualOrderOffsetSeconds
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
      console.log(`[WM-V2] 即时单: 下单后 ${this.config.cookAfterXs}s ~ ${this.config.useSuggestedCookTime ? '建议时长' : this.config.cookBeforeYs + 's'}`);
      console.log(`[WM-V2] 预订单: 虚拟下单时间 = 送达时间 - ${this.config.virtualOrderOffsetSeconds}s (${this.config.virtualOrderOffsetSeconds / 60}分钟)`);
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
        remainingMs: Math.max(0, info.deadline - Date.now()),
      }));
    }

    // -------- 核心计算逻辑 --------

    _checkAll() {
      const now = Date.now();
      const ORDER_STATUS = V2.ORDER_STATUS || { PENDING_COOK: 'pending_cook', CANCELLED: 'cancelled' };
      const pendingOrders = this.store.getPendingCook();
      const preOrders = this.store.getPreOrders().filter(o => o.status !== ORDER_STATUS.CANCELLED);

      const ordersToCheck = [...pendingOrders, ...preOrders.filter(o => !pendingOrders.find(p => p.orderNo === o.orderNo))];
      const updates = [];

      for (const order of ordersToCheck) {
        const window = this._calculateCookWindow(order, now);
        if (!window) continue; // 无法计算

        order._cookDeadline = window.deadline;

        const remaining = window.deadline - now;
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
        // 预订单：虚拟下单时间 = 送达时间 - virtualOrderOffsetSeconds
        const deliverTime = order.deliverTimestamp || TimeUtils.parseOrderTime(order.deliverTime, now);
        if (!deliverTime) return null;
        baseTime = deliverTime - this.config.virtualOrderOffsetSeconds * 1000;
      } else {
        // 即时单：真实下单时间
        baseTime = order.orderTimestamp || TimeUtils.parseOrderTime(order.orderTime, now);
        if (!baseTime) return null;
      }

      // 建议出餐截止时间（用于"出餐前"策略）
      const cookDeadline = isPreOrder
        ? (order.deliverTimestamp || TimeUtils.parseOrderTime(order.deliverTime, now))
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
          if (this.config.useSuggestedCookTime && cookSec > 0) {
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
 * 重要设计决策：
 *   1. 不自动切换 Tab — 切 tab 可能找不到订单且切不回来影响正常单
 *   2. 只操作当前页面上可见的订单 — 不在当前页的订单只记录告警
 *   3. localStorage 恢复后自动清除 DOM 引用 — _element/buttons 刷新后失效，
 *      需要下一次 DOM 轮询重新匹配
 *   4. 用 orderNo 作为唯一 Key 合并 API 和 DOM 数据
 *
 * @note 与 V1 完全独立，可随时切换回 V1 的纯 DOM 模式
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

  const deps = ['ApiInterceptor', 'OrderStore', 'CookEngine', 'TimeUtils', 'ORDER_STATUS'];
  const missing = deps.filter(d => !V2[d]);
  if (missing.length > 0) {
    console.error('[WM-V2] 缺少依赖模块:', missing.join(', '));
    return;
  }

  // ==================== 配置 ====================
  const MONITOR_CONFIG = {
    domPollInterval: 5000,
    apiRefreshInterval: 30000,
    maxCookWindow: 30 * 60 * 1000,
    domPollEnabled: true,
    apiInterceptEnabled: true,
    /** 自动切换 Tab — 已移除，不再自动切 tab */
    autoSwitchTab: false,

    cook: {
      strategy: 'afterOrder',
      cookAfterXs: 60,
      cookBeforeYs: 600,
      useSuggestedCookTime: true,
      virtualOrderOffsetSeconds: 1200,
      minWaitSeconds: 10,
      checkInterval: 5000,
    },
  };

  // ==================== MonitorV2 主类 ====================
  class MonitorV2 {
    constructor(config = {}) {
      this.config = { ...MONITOR_CONFIG, ...config, cook: { ...MONITOR_CONFIG.cook, ...(config.cook || {}) } };
      this.running = false;

      this.apiInterceptor = new V2.ApiInterceptor();
      this.apiRequester = new V2.ApiRequester();
      this.store = new V2.OrderStore();
      this.cookEngine = new V2.CookEngine(this.store, this.config.cook);

      this._domPollTimer = null;
      this._logLines = [];
      this._maxLogLines = 200;
      this._lastPrintTime = 0;
      this._notFoundOrders = new Set(); // 记录找不到的订单号，避免重复告警

      this.cookEngine.onCook((orderNo, order) => this._onCookTime(orderNo, order));
      this.cookEngine.onUpdate((updates) => this._onTimerUpdate(updates));
    }

    start() {
      if (this.running) { this.log('⚠️ 监控已在运行中'); return this; }
      this.running = true;
      this.log('🚀 V2 混合模式监控已启动');
      this.log(`📊 策略: ${this.config.cook.strategy === 'afterOrder' ? '下单后模式' : this.config.cook.strategy === 'beforeCook' ? '出餐前模式' : '手动模式'}`);
      this.log(`⏰ 即时单: 下单后 ${this.config.cook.cookAfterXs}s ~ ${this.config.cook.useSuggestedCookTime ? '建议时长' : this.config.cook.cookBeforeYs + 's'}`);
      this.log(`📋 预订单: 虚拟下单 = 送达时间 - ${this.config.cook.virtualOrderOffsetSeconds / 60}分钟`);
      this.log(`🚫 不会自动切换 Tab，只操作当前页面可见的订单`);

      // 清除 localStorage 中失效的 DOM 引用
      this._cleanStaleDomRefs();

      // 安装 API 拦截器
      if (this.config.apiInterceptEnabled) {
        this.apiInterceptor.install();
        this.apiInterceptor.on('/order/list/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/mix/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/pre/', (d) => this._onAPIData(d));
        this.log('📡 API 拦截器已安装');
      }

      // 初始 DOM 扫描
      this._domPoll();

      // 定时 DOM 轮询
      this._domPollTimer = setInterval(() => this._domPoll(), this.config.domPollInterval);
      this.log(`📊 DOM 轮询间隔: ${this.config.domPollInterval / 1000}s`);

      // 启动出餐引擎
      this.cookEngine.start();
      this.log('🔥 出餐引擎已启动');

      this._printStats();
      return this;
    }

    stop() {
      if (!this.running) return this;
      this.running = false;
      if (this._domPollTimer) clearInterval(this._domPollTimer);
      this.cookEngine.stop();
      this.apiInterceptor.off();
      this.log('🛑 V2 监控已停止');
      return this;
    }

    refresh() {
      this._domPoll();
      this.log('🔄 手动刷新完成');
      this._printStats();
      return this;
    }

    getStatus() {
      const all = this.store.getAll();
      const pending = this.store.getPendingCook();
      const timers = this.cookEngine.getPendingTimers();
      return {
        running: this.running,
        totalOrders: all.length,
        pendingCookCount: pending.length,
        pendingCookOrders: pending.map(o => ({
          orderNo: o.orderNo,
          orderIndex: o.orderIndex,
          customerName: o.customerName,
          status: o.status,
          statusDesc: o.statusDesc,
          isPreOrder: o.isPreOrder,
          suggestedCookTime: o.suggestedCookTime,
          suggestedCookSeconds: o.suggestedCookSeconds,
          deliverTime: o.deliverTime,
          source: o.source,
          hasButtons: (o.buttons?.length || 0) > 0,
          hasElement: !!o._element,
        })),
        activeTimers: timers,
        logs: this._logLines.slice(-20),
      };
    }

    updateCookConfig(cfg) {
      Object.assign(this.config.cook, cfg);
      this.cookEngine.config = { ...this.cookEngine.config, ...cfg };
      this.log('⚙️ 出餐配置已更新:', cfg);
      return this;
    }

    reset() {
      this.cookEngine.stop();
      this.store.clear();
      this._notFoundOrders.clear();
      this.log('♻️ 已清空所有数据');
      if (this.running) this.cookEngine.start();
      return this;
    }

    // ==================== 清除 localStorage 中失效的 DOM 引用 ====================

    _cleanStaleDomRefs() {
      let cleaned = 0;
      for (const [, order] of this.store.orders) {
        if (order._element) {
          order._element = null;  // DOM 引用刷新后必失效
          cleaned++;
        }
        if (order.buttons && order.buttons.length > 0) {
          // buttons 数组本身可以保留，但里面不再有 DOM 元素引用
          // 不过刷新后这些按钮可能已不存在，标记来源为 stale
          order._buttonsStale = true;
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.log(`🧹 已清除 ${Math.ceil(cleaned / 2)} 条订单的失效 DOM 引用`);
        this.store.save();
      }
    }

    // ==================== DOM 轮询 ====================

    _domPoll() {
      try {
        const domOrders = this._extractFromDOM();
        if (domOrders && domOrders.length > 0) {
          const count = this.store.updateFromDOM(domOrders);
          if (count > 0) {
            this.log(`📊 DOM 提取: ${domOrders.length} 单，更新 ${count} 单`);
          }
          // DOM 提取成功后，清除 _buttonsStale 标记
          for (const o of domOrders) {
            const existing = this.store.get(o.orderNo);
            if (existing) existing._buttonsStale = false;
          }
        }
      } catch (e) {
        this.log(`❌ DOM 轮询错误: ${e.message}`);
      }
    }

    _extractFromDOM() {
      let doc = document, win = window;
      if (window.self === window.top) {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; win = iframe.contentWindow; } catch (e) {}
        }
      }

      if (typeof win.extractOrders === 'function') return win.extractOrders();

      const cards = doc.querySelectorAll('[class*="order-card"]');
      if (!cards || cards.length === 0) return [];

      const orders = [];
      for (const card of cards) {
        const text = card.innerText || '';
        const orderNoMatch = text.match(/订单编号[：:]\s*(\d+)/);
        if (!orderNoMatch) continue;

        const order = {};
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
        const ctm = text.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
        order.suggestedCookTime = ctm ? `${ctm[1]}分${ctm[2]}秒` : '';
        order.suggestedCookSeconds = ctm ? parseInt(ctm[1]) * 60 + parseInt(ctm[2]) : 0;
        order.isPreOrder = text.includes('预订单') || text.includes('预约单');
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
        for (const btn of card.querySelectorAll('button')) {
          order.buttons.push({ text: btn.innerText.trim(), className: btn.className || '' });
        }
        order._element = card;
        order.source = 'dom';
        order.updatedAt = Date.now();
        orders.push(order);
      }
      return orders;
    }

    // ==================== API 数据处理 ====================

    _onAPIData(data) {
      if (!data || !data.response || data.response.code !== 0) return;
      const orderData = data.response.data;
      if (orderData) {
        const count = this.store.updateFromAPI(orderData);
        if (count > 0) {
          this.log(`📡 API 更新: ${count} 条订单 [${data.path.substring(0, 40)}]`);
        }
      }
    }

    // ==================== 出餐操作 ====================

    _onCookTime(orderNo, order) {
      this.log(`🔔 🔴🔴🔴 出餐时间到！订单 ${orderNo} (${order.customerName || ''}${order.isPreOrder ? ', 预订单' : ''})`);

      const success = this._clickCookButton(orderNo, order);

      if (success) {
        this.log(`✅ 已自动出餐: 订单 ${orderNo}`);
        this._notFoundOrders.delete(orderNo);
      } else {
        // 检查是否有 DOM 按钮数据
        const hasButtons = (order.buttons?.length || 0) > 0;
        const hasElement = !!order._element;
        const isStale = order._buttonsStale;

        if (!hasButtons && !hasElement) {
          // 这个订单完全不在当前页面上（可能在第二页或不同 tab）
          if (!this._notFoundOrders.has(orderNo)) {
            this._notFoundOrders.add(orderNo);
            this.log(`⚠️ 订单 ${orderNo} 不在当前页面上（可能需要手动出餐）`);
            this.log(`   💡 提示：该订单可能是第二页订单或不同 tab 的预订单`);
            this.log(`   💡 请在美团商家版中找到该订单，手动点击出餐`);
          }
        } else if (isStale) {
          this.log(`⚠️ 订单 ${orderNo} 的按钮数据已过期（页面刷新后），等待下次 DOM 轮询更新`);
        } else {
          this.log(`❌ 订单 ${orderNo} 找不到出餐按钮（按钮文本可能不匹配）`);
        }
      }
    }

    /** 点击出餐按钮 — 只操作当前页面可见的订单 */
    _clickCookButton(orderNo, order) {
      let doc = document;
      if (window.self === window.top) {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return false; }
        }
      }

      // 方法 1：通过 DOM 引用直接操作（最快最准）
      if (order?._element) {
        try {
          const buttons = order._element.querySelectorAll('button');
          for (const btn of buttons) {
            const t = btn.innerText.trim();
            if (t === '出餐完成' || t === '出餐' || t === '确认出餐') {
              btn.click();
              return true;
            }
          }
        } catch (e) {
          // DOM 引用过期，继续用方法2
        }
      }

      // 方法 2：通过订单号在当前页面搜索
      const cards = doc.querySelectorAll('[class*="order-card"]');
      for (const card of cards) {
        const text = card.innerText || '';
        const match = text.match(/订单编号[：:]\s*(\d+)/);
        if (match && match[1] === orderNo) {
          // 先找 button
          for (const btn of card.querySelectorAll('button')) {
            const btnText = btn.innerText.trim();
            if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
              btn.click();
              return true;
            }
          }
          // 再找 div 按钮
          for (const div of card.querySelectorAll('div[class*="btn"]')) {
            const divText = div.innerText.trim();
            if (divText === '出餐完成' || divText === '出餐' || divText === '确认出餐') {
              div.click();
              return true;
            }
          }
        }
      }
      return false;
    }

    // ==================== 状态打印 ====================

    _onTimerUpdate(updates) {
      const now = Date.now();
      if (!this._lastPrintTime || now - this._lastPrintTime > 30000) {
        this._lastPrintTime = now;
        this._printStats();
      }
    }

    _printStats() {
      const all = this.store.getAll();
      const pending = this.store.getPendingCook();
      const timers = this.cookEngine.getPendingTimers();
      const apiCnt = all.filter(o => o.source === 'api').length;
      const domCnt = all.filter(o => o.source === 'dom').length;

      this.log(`📊 状态: 共 ${all.length} 单 | 待出餐 ${pending.length} 单 | ⏰ 计时 ${timers.length} 单 (API:${apiCnt} DOM:${domCnt})`);

      for (const t of timers) {
        const remaining = V2.TimeUtils.formatDuration(Math.ceil(t.remainingMs / 1000));
        const deadline = V2.TimeUtils.formatTime(t.deadline);
        this.log(`  ⏰ ${t.orderNo} ${t.customerName || ''} ${t.isPreOrder ? '(预)' : ''} → ${remaining}后出餐(${deadline})`);
      }

      // 打印不在当前页面的订单
      for (const orderNo of this._notFoundOrders) {
        this.log(`  ⚠️ ${orderNo} 不在当前页面，需手动出餐`);
      }
    }

    log(msg) {
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      this._logLines.push(`[${ts}] ${msg}`);
      if (this._logLines.length > this._maxLogLines) this._logLines.shift();
      console.log(`[WM-V2] ${msg}`);
    }
  }

  // ==================== 导出 & 快捷函数 ====================
  V2.MonitorV2 = MonitorV2;
  V2.MONITOR_CONFIG = MONITOR_CONFIG;

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
    return window.__wmV2Instance ? window.__wmV2Instance.getStatus() : 'V2 监控未启动';
  };

  console.log('[WM-V2] ✅ monitorV2 模块已加载（v2.2 - 不切换Tab + DOM引用刷新清理）');
  console.log('[WM-V2] 使用方法:');
  console.log('  __WM_START()                                          — 启动监控');
  console.log('  __WM_START({ cook: { strategy: "beforeCook" } })     — 使用出餐前模式');
  console.log('  __WM_START({ cook: { virtualOrderOffsetSeconds: 900 }}) — 虚拟下单时间=送达-15分钟');
  console.log('  __WM_STOP()                                           — 停止监控');
  console.log('  __WM_STATUS()                                         — 查看状态');
  console.log('');
  console.log('[WM-V2] ⚠️ 不会自动切换 Tab，只操作当前页面可见的订单');
})();
