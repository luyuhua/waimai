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
      this.suggestedCookDeadline = data.suggestedCookDeadline || '';

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
          existing.suggestedCookDeadline = raw.suggestedCookDeadline || existing.suggestedCookDeadline;
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

          // DOM 状态始终覆盖 API — 页面是实时真值，API 可能滞后
          if (raw.status && raw.status !== 'unknown') {
            existing.status = raw.status;
          }

          existing.updatedAt = Date.now();
        } else {
          // 新订单：完全由 DOM 数据填充
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
        // wm_order_id_view 是 19 位数字，超过 JS 安全整数范围 (2^53)
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

        // API 返回的是 Unix 秒，JS 需要毫秒
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
