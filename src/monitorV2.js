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
