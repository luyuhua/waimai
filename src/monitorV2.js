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
 * @note UI 层采用 V1 风格的简单全局函数，数据层使用 orderStore + cookEngine
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
    constructor(config = {}) {
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
      if (this.running) { this.log('warning: monitor already running'); return this; }
      this.running = true;
      this.log('V2 monitor started');

      this._cleanStaleDomRefs();

      if (this.config.apiInterceptEnabled) {
        this.apiInterceptor.install();
        this.apiInterceptor.on('/order/list/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/mix/', (d) => this._onAPIData(d));
        this.apiInterceptor.on('/order/pre/', (d) => this._onAPIData(d));
        this.log('API interceptor installed');
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
      this.log('V2 monitor stopped');
      return this;
    }

    refresh() {
      this._domPoll();
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
        activeTimers: timers,
      };
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
      this.log('data cleared');
      if (this.running) this.cookEngine.start();
      return this;
    }

    log(msg) {
      console.log('[WM-V2]', msg);
      if (typeof window.panelLog === 'function') {
        window.panelLog(msg, 'gray');
      }
    }

    // ==================== localStorage 清理 ====================

    _cleanStaleDomRefs() {
      let cleaned = 0;
      for (const [, order] of this.store.orders) {
        if (order._element) { order._element = null; cleaned++; }
        if (order.buttons && order.buttons.length > 0) { order._buttonsStale = true; cleaned++; }
      }
      if (cleaned > 0) this.store.save();
    }

    // ==================== DOM 轮询 ====================

    _domPoll() {
      try {
        const domOrders = this._extractFromDOM();
        if (domOrders && domOrders.length > 0) {
          const count = this.store.updateFromDOM(domOrders);
          for (const o of domOrders) {
            const existing = this.store.get(o.orderNo);
            if (existing) existing._buttonsStale = false;
          }
        }
      } catch (e) {
        console.error('[WM-V2] DOM poll error:', e.message);
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
        order.suggestedCookTime = ctm ? ctm[1] + '分' + ctm[2] + '秒' : '';
        order.suggestedCookSeconds = ctm ? parseInt(ctm[1]) * 60 + parseInt(ctm[2]) : 0;
        order.isPreOrder = text.includes('预订单') || text.includes('预约单');
        order.suggestedCookDeadline = '';
        const dlMatch = text.match(/建议出餐时间(\d{2}-\d{2}\s+\d{2}:\d{2})前/);
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
        this.store.updateFromAPI(orderData);
      }
    }

    // ==================== 出餐操作 ====================

    _onCookTime(orderNo, order) {
      const success = this._clickCookButton(orderNo, order);
      if (success) {
        this.log('auto-cooked: ' + orderNo);
        this._notFoundOrders.delete(orderNo);
        if (typeof window.updatePanelOrders === 'function') {
          window.updatePanelOrders();
        }
      } else {
        const hasElement = !!order._element;
        if (!hasElement && !this._notFoundOrders.has(orderNo)) {
          this._notFoundOrders.add(orderNo);
          this.log('order not on current page: ' + orderNo + ' (manual cook needed)');
        }
      }
    }

    _clickCookButton(orderNo, order) {
      let doc = document;
      if (window.self === window.top) {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return false; }
        }
      }

      // 方法 1：通过 DOM 引用直接操作
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
        } catch (e) {}
      }

      // 方法 2：通过订单号在当前页面搜索
      const cards = doc.querySelectorAll('[class*="order-card"]');
      for (const card of cards) {
        const text = card.innerText || '';
        const match = text.match(/订单编号[：:]\s*(\d+)/);
        if (match && match[1] === orderNo) {
          for (const btn of card.querySelectorAll('button')) {
            const btnText = btn.innerText.trim();
            if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
              btn.click();
              return true;
            }
          }
        }
      }
      return false;
    }

    // ==================== 状态打印 ====================

    _onTimerUpdate(updates) {
      if (!this._lastPrintTime || Date.now() - this._lastPrintTime > 30000) {
        this._lastPrintTime = Date.now();
        this._printStats();
      }
    }

    _printStats() {
      const all = this.store.getAll();
      const pending = this.store.getPendingCook();
      const timers = this.cookEngine.getPendingTimers();
      console.log('[WM-V2] orders:', all.length, 'pending:', pending.length, 'timers:', timers.length);
      for (const t of timers) {
        console.log('[WM-V2]  timer:', t.orderNo, t.customerName || '', 'remaining:', Math.ceil(t.remainingMs / 1000) + 's');
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

  /**
   * 创建悬浮面板（只调一次）
   */
  window.createPanel = function() {
    if (document.getElementById('waimai-panel-container')) return;

    // 注入样式
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
      '.waimai-log-entry { padding: 1px 0; }',
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

    // 折叠按钮
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

    // 面板主体
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
      '  <div id="waimai-log-area"></div>',
      '</div>',
    ].join('');

    container.appendChild(panel);
    document.body.appendChild(container);

    // 绑定配置变更事件
    var radios = container.querySelectorAll('input[name="waimai-strategy"]');
    radios.forEach(function(r) {
      r.addEventListener('change', function() {
        window.__cookConfig = window.__cookConfig || {};
        window.__cookConfig.strategy = this.value;
        window.panelLog('strategy changed: ' + (this.value === 'manual' ? 'manual' : this.value === 'before_deadline' ? 'before deadline' : 'after order'), 'blue');
      });
    });

    var afterMinEl = document.getElementById('waimai-after-min-sec');
    var afterMaxEl = document.getElementById('waimai-after-max-sec');
    var beforeMinEl = document.getElementById('waimai-before-min-sec');
    var beforeMaxEl = document.getElementById('waimai-before-max-sec');

    if (afterMinEl) afterMinEl.addEventListener('change', function() { window.__cookConfig.afterOrderMinSec = parseInt(this.value) || 240; });
    if (afterMaxEl) afterMaxEl.addEventListener('change', function() { window.__cookConfig.afterOrderMaxSec = parseInt(this.value) || 300; });
    if (beforeMinEl) beforeMinEl.addEventListener('change', function() { window.__cookConfig.beforeDeadlineMinSec = parseInt(this.value) || 120; });
    if (beforeMaxEl) beforeMaxEl.addEventListener('change', function() { window.__cookConfig.beforeDeadlineMaxSec = parseInt(this.value) || 180; });

    // 回填已有配置到面板
    if (window.__cookConfig) {
      var cfg = window.__cookConfig;
      if (afterMinEl) afterMinEl.value = cfg.afterOrderMinSec || 240;
      if (afterMaxEl) afterMaxEl.value = cfg.afterOrderMaxSec || 300;
      if (beforeMinEl) beforeMinEl.value = cfg.beforeDeadlineMinSec || 120;
      if (beforeMaxEl) beforeMaxEl.value = cfg.beforeDeadlineMaxSec || 180;
      var currentStrategy = cfg.strategy || 'after_order';
      radios.forEach(function(r) { r.checked = (r.value === currentStrategy); });
    }
  };

  /**
   * 面板日志
   */
  window.panelLog = function(message, color) {
    console.log('%c[WM-V2] ' + message, 'color:' + (color === 'red' ? 'red' : color === 'green' ? 'green' : color === 'blue' ? '#667eea' : '#888') + ';font-weight:bold;');

    var logArea = document.getElementById('waimai-log-area');
    if (!logArea) return;
    var entry = document.createElement('div');
    entry.className = 'waimai-log-entry';
    var now = new Date();
    var ts = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    var colorClass = color ? 'waimai-log-' + color : '';
    entry.innerHTML = '<span style="color:#666">' + ts + '</span> <span class="' + colorClass + '">' + message + '</span>';
    logArea.appendChild(entry);
    while (logArea.childElementCount > 100) { logArea.removeChild(logArea.firstChild); }
    logArea.scrollTop = logArea.scrollHeight;
  };

  /**
   * 更新面板订单列表（去重：同一 orderNo 只显示一条）
   */
  window.updatePanelOrders = function() {
    var listEl = document.getElementById('waimai-order-list');
    var badge = document.getElementById('waimai-badge');
    if (!listEl) return;

    var inst = window.__wmV2Instance;
    var allOrders = inst ? inst.store.getAll() : [];
    var timers = inst ? inst.cookEngine.getPendingTimers() : [];

    if (allOrders.length === 0) {
      listEl.innerHTML = '<div style="color:#666;font-size:12px;">暂无订单数据</div>';
      if (badge) badge.textContent = '0';
      return;
    }

    // 去重：同一 orderNo 只显示一条，DOM 优先
    var seen = {};
    var deduped = [];
    for (var i = 0; i < allOrders.length; i++) {
      var o = allOrders[i];
      if (!seen[o.orderNo]) {
        seen[o.orderNo] = o;
        deduped.push(o);
      } else {
        // DOM 来源的覆盖 API 来源的
        var existing = seen[o.orderNo];
        if (o.source === 'dom' && existing.source === 'api') {
          seen[o.orderNo] = o;
          deduped[deduped.indexOf(existing)] = o;
        } else if (o.source === 'dom') {
          seen[o.orderNo] = o;
          deduped[deduped.indexOf(existing)] = o;
        }
      }
    }

    // 排序：待出餐在前，按 orderIndex 倒序
    deduped.sort(function(a, b) {
      if (a.status === 'pending_cook' && b.status !== 'pending_cook') return -1;
      if (a.status !== 'pending_cook' && b.status === 'pending_cook') return 1;
      return (b.orderIndex || 0) - (a.orderIndex || 0);
    });

    var pendingCount = 0;
    var html = '';
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
      var isPending = o.status === 'pending_cook';
      if (isPending) pendingCount++;

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
        detailHtml = '<div class="waimai-order-detail" data-timer-end="' + timerMatch.deadline + '">⏰ <span class="timer">' + (min > 0 ? min + '分' : '') + sec + '秒</span>后出餐</div>';
      } else if (isPending && o.suggestedCookSeconds > 0) {
        detailHtml = '<div class="waimai-order-detail">⏳ 建议 ' + o.suggestedCookTime + '</div>';
      } else if (o.status === 'cooked' || o.status === 'delivered') {
        detailHtml = '<div class="waimai-order-detail"><span class="done">✅ 已' + statusLabel + '</span></div>';
      } else if (o.isPreOrder && o.suggestedCookDeadline) {
        detailHtml = '<div class="waimai-order-detail">🕒 预约出餐 ' + o.suggestedCookDeadline + '</div>';
      }

      var name = o.customerName || '';
      html += '<div class="waimai-order-item">' +
        '<div class="waimai-order-top">' +
        '<span class="waimai-order-id">#' + (o.orderIndex || '?') + '</span> ' +
        '<span class="waimai-order-name">' + name + '</span> ' +
        statusTag +
        '</div>' +
        detailHtml +
        '</div>';
    }

    listEl.innerHTML = html;
    if (badge) badge.textContent = pendingCount;
    window.__pendingCount = pendingCount;

    // 更新折叠按钮
    var toggle = document.getElementById('waimai-panel-toggle');
    if (toggle) {
      var panelEl = document.getElementById('waimai-panel');
      var arrow = (panelEl && panelEl.style.display !== 'none') ? '▲' : '▼';
      toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ' + arrow;
    }
  };

  /**
   * 每秒更新倒计时显示
   */
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

  /**
   * 从面板启动监控
   */
  window.startMonitorFromPanel = function() {
    var cfg = window.__cookConfig || {};

    // 从面板读取最新值
    var afterMinEl = document.getElementById('waimai-after-min-sec');
    var afterMaxEl = document.getElementById('waimai-after-max-sec');
    var beforeMinEl = document.getElementById('waimai-before-min-sec');
    var beforeMaxEl = document.getElementById('waimai-before-max-sec');

    if (afterMinEl) cfg.afterOrderMinSec = parseInt(afterMinEl.value) || 240;
    if (afterMaxEl) cfg.afterOrderMaxSec = parseInt(afterMaxEl.value) || 300;
    if (beforeMinEl) cfg.beforeDeadlineMinSec = parseInt(beforeMinEl.value) || 120;
    if (beforeMaxEl) cfg.beforeDeadlineMaxSec = parseInt(beforeMaxEl.value) || 180;

    var radios = document.querySelectorAll('input[name="waimai-strategy"]');
    radios.forEach(function(r) { if (r.checked) cfg.strategy = r.value; });

    window.__cookConfig = cfg;

    // 映射 V1 配置名 → V2 配置名
    var v2Strategy = cfg.strategy === 'after_order' ? 'afterOrder' : cfg.strategy === 'before_deadline' ? 'beforeCook' : 'manual';
    window.__WM_START({ cook: {
      strategy: v2Strategy,
      cookAfterXs: cfg.afterOrderMinSec || 240,
      cookBeforeYs: cfg.afterOrderMaxSec || 300,
      cookBeforeYsBeforeCook: cfg.beforeDeadlineMinSec || 120,
      cookAfterXsBeforeCook: cfg.beforeDeadlineMaxSec || 180,
      virtualOrderOffsetSeconds: 1200,
    }});

    window.panelLog('monitoring started, strategy: ' + (v2Strategy === 'manual' ? 'manual' : v2Strategy === 'beforeCook' ? 'before deadline' : 'after order'), 'green');

    var startBtn = document.getElementById('waimai-btn-start');
    var stopBtn = document.getElementById('waimai-btn-stop');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    setTimeout(function() { window.updatePanelOrders(); }, 1500);
  };

  /**
   * 停止监控
   */
  window.stopOrderMonitor = function() {
    window.__WM_STOP();

    window.panelLog('monitoring stopped', 'red');

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
    console.log('[WM-V2] panel loaded (non-meituan page, monitor not auto-started)');
    console.log('[WM-V2] usage: __WM_START() to start, __WM_STOP() to stop, __WM_STATUS() for status');
  }

})();
