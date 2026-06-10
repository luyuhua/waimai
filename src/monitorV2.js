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
      this.log(`⏰ 即时单: 下单后 ${this.config.cook.cookAfterXs}s ~ ${this.config.cook.cookBeforeYs}s`);
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

      this.createPanel();
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
      this._updatePanel();
      return this;
    }

    refresh() {
      this._domPoll();
      this.log('🔄 手动刷新完成');
      this.createPanel();
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
        this.createPanel();
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
      // 同时输出到面板
      let color = 'gray';
      if (msg.includes('❗') || msg.includes('❓') || msg.includes('⚠') || msg.includes('🔴')) color = 'red';
      else if (msg.includes('✅') || msg.includes('📊') || msg.includes('🔥')) color = 'green';
      else if (msg.includes('📡') || msg.includes('📋')) color = 'blue';
      else if (msg.includes('⏰') || msg.includes('⚡')) color = 'orange';
      this._panelLog(msg, color);
    }
  
  /**
   * 创建悬浮控制面板（与 V1 产品形态一致）
   */
  createPanel() {
    // 防止重复创建
    if (document.getElementById('waimai-panel-container')) {
      return;
    }

    var self = this;

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
      '.waimai-order-top { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; flex-wrap: wrap; }',
      '.waimai-order-id { font-weight: bold; color: #fff; }',
      '.waimai-order-name { color: #e0e0e0; }',
      '.waimai-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }',
      '.waimai-tag-pending { background: rgba(239,68,68,0.2); color: #f87171; }',
      '.waimai-tag-preorder { background: rgba(251,146,60,0.2); color: #fb923c; }',
      '.waimai-tag-cooked { background: rgba(34,197,94,0.2); color: #4ade80; }',
      '.waimai-tag-rider { background: rgba(59,130,246,0.2); color: #60a5fa; }',
      '.waimai-tag-other { background: rgba(156,163,175,0.2); color: #9ca3af; }',
      '.waimai-tag-api { background: rgba(168,85,247,0.2); color: #c084fc; }',
      '.waimai-order-detail { font-size: 12px; color: #888; padding-left: 4px; }',
      '.waimai-order-detail .timer { color: #f59e0b; font-weight: bold; }',
      '.waimai-order-detail .done { color: #4ade80; }',
      '#waimai-order-list { max-height: 150px; overflow-y: auto; }',
      '#waimai-order-list.expanded { max-height: 400px; }',
      '.waimai-strategy { margin-top: 6px; }',
      '.waimai-strategy label { display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer; color: #ccc; font-size: 13px; }',
      '.waimai-strategy input[type="radio"] { accent-color: #667eea; }',
      '.waimai-strategy input[type="number"] { width: 50px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; padding: 2px 4px; font-size: 13px; text-align: center; }',
      '.waimai-strategy .param-group { display: none; margin-left: 22px; padding: 4px 0; }',
      '.waimai-strategy .param-group.active { display: block; }',
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
      '.waimai-v2-tag { font-size: 10px; background: #667eea; color: white; padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }',
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

    // 折叠按钮（放在 panel 上方，和 V1 一致）
    var toggleBtn = document.createElement('button');
    toggleBtn.id = 'waimai-panel-toggle';
    toggleBtn.innerHTML = '🛵 <span class="badge" id="waimai-badge">0</span> 待出餐 ▼';

    // 面板主体
    var panel = document.createElement('div');
    panel.id = 'waimai-panel';
    panel.innerHTML = [
      '<div id="waimai-panel-header">',
      '  <h3>🛵 美团出餐助手 <span class="waimai-v2-tag">V2</span></h3>',
      '  <div class="header-btns">',
      '    <button id="waimai-btn-collapse">收起</button>',
      '  </div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title">',
      '    <span>📋 订单列表 <span id="waimai-order-count" style="font-weight:normal;color:#aaa;">0 单</span></span>',
      '    <button id="waimai-btn-expand">展开</button>',
      '  </div>',
      '  <div id="waimai-order-list">暂无订单数据</div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title"><span>⏰ 出餐策略</span></div>',
      '  <div class="waimai-strategy">',
      '    <label><input type="radio" name="waimai-strategy" value="after_order" checked> 下单后 <input type="number" id="waimai-after-min-sec" value="180" min="0" max="1800" style="width:50px">~<input type="number" id="waimai-after-max-sec" value="240" min="0" max="1800" style="width:50px"> 秒</label>',
      '    <label><input type="radio" name="waimai-strategy" value="before_deadline"> 建议出餐前 <input type="number" id="waimai-before-min-sec" value="120" min="0" max="600" style="width:50px">~<input type="number" id="waimai-before-max-sec" value="180" min="0" max="600" style="width:50px"> 秒</label>',
      '    <label><input type="radio" name="waimai-strategy" value="manual"> 手动出餐</label>',
      '    <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">',
      '      <label style="font-size:11px;color:#888;margin-top:2px;"><input type="checkbox" id="waimai-show-advanced"> 高级选项</label>',
      '      <div id="waimai-advanced-params" style="display:none;margin-left:22px;margin-top:4px;">',
      '        <label style="font-size:11px;color:#fb923c;">📋 预订单虚拟下单 = 送达前 <input type="number" id="waimai-virtual-offset" value="1200" min="60" max="3600" style="width:55px"> 秒</label>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="waimai-btn-row">',
      '    <button class="waimai-btn waimai-btn-start" id="waimai-btn-start">开始监控</button>',
      '    <button class="waimai-btn waimai-btn-stop" id="waimai-btn-stop" disabled>停止监控</button>',
      '  </div>',
      '</div>',
      '<div class="waimai-section">',
      '  <div class="waimai-section-title">',
      '    <span>📝 日志</span>',
      '    <button id="waimai-btn-clear-log">清空</button>',
      '  </div>',
      '  <div id="waimai-log-area"></div>',
      '</div>',
    ].join('');

    container.appendChild(toggleBtn);
    container.appendChild(panel);
    document.body.appendChild(container);

    // ==================== 事件绑定 ====================

    // 切换面板显示
    toggleBtn.addEventListener('click', function() {
      var p = document.getElementById('waimai-panel');
      var isHidden = p.style.display === 'none' || !p.style.display;
      p.style.display = isHidden ? 'block' : 'none';
      var arrow = isHidden ? '▲' : '▼';
      var pendingCount = self.store ? self.store.getPendingCook().length : 0;
      toggleBtn.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ' + arrow;
    });

    // 折叠面板
    var collapseBtn = document.getElementById('waimai-btn-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function() {
        var p = document.getElementById('waimai-panel');
        p.style.display = 'none';
        var pendingCount = self.store ? self.store.getPendingCook().length : 0;
        toggleBtn.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ▼';
      });
    }

    // 展开/收起订单列表
    var expandBtn = document.getElementById('waimai-btn-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', function() {
        var listEl = document.getElementById('waimai-order-list');
        if (listEl) {
          listEl.classList.toggle('expanded');
          this.textContent = listEl.classList.contains('expanded') ? '收起' : '展开';
        }
      });
    }

    // 高级选项切换
    var showAdvancedEl = document.getElementById('waimai-show-advanced');
    if (showAdvancedEl) {
      showAdvancedEl.addEventListener('change', function() {
        var advancedEl = document.getElementById('waimai-advanced-params');
        if (advancedEl) advancedEl.style.display = this.checked ? 'block' : 'none';
      });
    }

    // 策略切换（显示/隐藏相关参数）
    var radios = document.querySelectorAll('input[name="waimai-strategy"]');
    radios.forEach(function(r) {
      r.addEventListener('change', function() {
        // V2 策略值映射：after_order→afterOrder, before_deadline→beforeCook, manual→manual
        var v2Strategy = self._mapStrategyToV2(this.value);
        self.log('🔄 策略已切换为: ' + (v2Strategy === 'manual' ? '手动出餐' : v2Strategy === 'beforeCook' ? '建议出餐前' : '下单后'), 'blue');
        if (self.running) {
          self._applyPanelConfig();
        }
      });
    });

    // 启动按钮
    var startBtn = document.getElementById('waimai-btn-start');
    var stopBtn = document.getElementById('waimai-btn-stop');

    if (startBtn) {
      startBtn.addEventListener('click', function() {
        self._applyPanelConfig();
        var config = self._readPanelConfig();
        window.__WM_START({ cook: config });
        startBtn.disabled = true;
        stopBtn.disabled = false;
        self._updatePanel();
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        window.__WM_STOP();
        startBtn.disabled = false;
        stopBtn.disabled = true;
        self._updatePanel();
      });
    }

    // 清空日志
    var clearLogBtn = document.getElementById('waimai-btn-clear-log');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', function() {
        var logArea = document.getElementById('waimai-log-area');
        if (logArea) logArea.innerHTML = '';
      });
    }

    // 参数变更时更新运行中的配置
    var paramIds = ['waimai-after-min-sec', 'waimai-after-max-sec', 'waimai-before-min-sec', 'waimai-before-max-sec', 'waimai-virtual-offset'];
    paramIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function() {
          if (!self.running) return;
          self._applyPanelConfig();
          self._updatePanel();
        });
      }
    });

    // 如果已经在运行，回填面板状态
    if (this.running) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    }

    // 启动面板定时更新
    this._panelTimer = setInterval(function() { self._updatePanel(); }, 3000);
    this._updatePanel();
  }

  /** 将 V1 策略名映射为 V2 内部策略名 */
  _mapStrategyToV2(panelStrategy) {
    if (panelStrategy === 'after_order') return 'afterOrder';
    if (panelStrategy === 'before_deadline') return 'beforeCook';
    return 'manual';
  }

  /** 将 V2 内部策略名映射回 V1 策略名 */
  _mapStrategyToPanel(v2Strategy) {
    if (v2Strategy === 'afterOrder') return 'after_order';
    if (v2Strategy === 'beforeCook') return 'before_deadline';
    return 'manual';
  }

  /** 从面板读取配置 */
  _readPanelConfig() {
    var afterMinEl = document.getElementById('waimai-after-min-sec');
    var afterMaxEl = document.getElementById('waimai-after-max-sec');
    var beforeMinEl = document.getElementById('waimai-before-min-sec');
    var beforeMaxEl = document.getElementById('waimai-before-max-sec');
    var virtualEl = document.getElementById('waimai-virtual-offset');

    var radios = document.querySelectorAll('input[name="waimai-strategy"]');
    var panelStrategy = 'after_order';
    radios.forEach(function(r) { if (r.checked) panelStrategy = r.value; });

    return {
      strategy: this._mapStrategyToV2(panelStrategy),
      cookAfterXs: parseInt(afterMinEl ? afterMinEl.value : 180) || 180,
      cookBeforeYs: parseInt(afterMaxEl ? afterMaxEl.value : 240) || 240,
      cookBeforeYsBeforeCook: parseInt(beforeMinEl ? beforeMinEl.value : 120) || 120,
      cookAfterXsBeforeCook: parseInt(beforeMaxEl ? beforeMaxEl.value : 180) || 180,
      virtualOrderOffsetSeconds: parseInt(virtualEl ? virtualEl.value : 1200) || 1200,
    };
  }

  /** 将面板配置应用到运行中的引擎 */
  _applyPanelConfig() {
    var config = this._readPanelConfig();
    this.updateCookConfig(config);
  }

  /** 面板日志 - 重写 log 使其同时输出到面板 */
  _panelLog(message, color) {
    var logArea = document.getElementById('waimai-log-area');
    if (logArea) {
      var entry = document.createElement('div');
      entry.className = 'waimai-log-entry';
      var now = new Date();
      var ts = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
      var colorClass = color ? ' waimai-log-' + color : '';
      entry.innerHTML = '<span style="color:#666">' + ts + '</span> <span class="' + colorClass + '">' + message + '</span>';
      logArea.appendChild(entry);
      while (logArea.childElementCount > 100) {
        logArea.removeChild(logArea.firstChild);
      }
      logArea.scrollTop = logArea.scrollHeight;
    }
  }

  /** 更新面板数据 */
  _updatePanel() {
    var listEl = document.getElementById('waimai-order-list');
    var badge = document.getElementById('waimai-badge');
    var countEl = document.getElementById('waimai-order-count');
    var toggle = document.getElementById('waimai-panel-toggle');

    if (!listEl) return;

    // 从 store 获取所有订单
    var allOrders = this.store ? this.store.getAll() : [];
    var timers = this.cookEngine ? this.cookEngine.getPendingTimers() : [];

    var apiCount = 0, domCount = 0;
    for (var i = 0; i < allOrders.length; i++) {
      if (allOrders[i].source === 'api') apiCount++;
      else if (allOrders[i].source === 'dom') domCount++;
    }

    // 按 orderIndex 从大到小排序
    allOrders.sort(function(a, b) { return (b.orderIndex || 0) - (a.orderIndex || 0); });

    var pendingCount = 0;
    var html = '';

    if (allOrders.length === 0) {
      html = '<div style="color:#666;font-size:12px;">暂无订单数据</div>';
    } else {
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

      for (var i = 0; i < allOrders.length; i++) {
        var o = allOrders[i];
        var isPending = o.status === 'pending_cook';
        if (isPending) pendingCount++;

        var statusLabel = o.statusDesc || statusLabels[o.status] || o.status;
        var tagClass = tagClassMap[o.status] || 'waimai-tag-other';
        var statusTag = '<span class="waimai-tag ' + tagClass + '">' + statusLabel + '</span>';

        if (o.isPreOrder) {
          statusTag += ' <span class="waimai-tag waimai-tag-preorder">预订单</span>';
        }
        if (o.source === 'api') {
          statusTag += ' <span class="waimai-tag waimai-tag-api">API</span>';
        }

        var detailHtml = '';

        // 倒计时信息
        var timerMatch = null;
        for (var t = 0; t < timers.length; t++) {
          if (timers[t].orderNo === o.orderNo) {
            timerMatch = timers[t];
            break;
          }
        }
        if (timerMatch) {
          var remaining = V2.TimeUtils.formatDuration(Math.ceil(timerMatch.remainingMs / 1000));
          detailHtml = '<div class="waimai-order-detail" data-timer-end="' + timerMatch.deadline + '">⏰ <span class="timer">' + remaining + '</span>后出餐</div>';
        } else if (isPending && o.suggestedCookSeconds > 0) {
          detailHtml = '<div class="waimai-order-detail">⏳ 建议 ' + o.suggestedCookTime + '</div>';
        } else if (o.status === 'cooked' || o.status === 'delivered') {
          detailHtml = '<div class="waimai-order-detail"><span class="done">✅ ' + statusLabel + '</span></div>';
        } else if (o.isPreOrder && o.deliverTime) {
          detailHtml = '<div class="waimai-order-detail">📋 送达 ' + o.deliverTime + '</div>';
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
    }

    listEl.innerHTML = html;
    if (badge) badge.textContent = pendingCount;
    if (countEl) countEl.textContent = allOrders.length + ' 单 (API:' + apiCount + ' DOM:' + domCount + ')';

    // 更新折叠按钮文字
    if (toggle) {
      var panelEl = document.getElementById('waimai-panel');
      var arrow = (panelEl && panelEl.style.display !== 'none') ? '▲' : '▼';
      toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ' + arrow;
    }

    // 同步按钮状态
    var startBtn = document.getElementById('waimai-btn-start');
    var stopBtn = document.getElementById('waimai-btn-stop');
    if (startBtn) startBtn.disabled = this.running;
    if (stopBtn) stopBtn.disabled = !this.running;

    // 如果正在运行，回填策略参数
    if (this.running) {
      var cfg = this.config.cook;
      var afterMinEl = document.getElementById('waimai-after-min-sec');
      var afterMaxEl = document.getElementById('waimai-after-max-sec');
      var beforeMinEl = document.getElementById('waimai-before-min-sec');
      var beforeMaxEl = document.getElementById('waimai-before-max-sec');
      var virtualEl = document.getElementById('waimai-virtual-offset');
      var showAdvancedEl = document.getElementById('waimai-show-advanced');
      if (afterMinEl) afterMinEl.value = cfg.cookAfterXs;
      if (afterMaxEl) afterMaxEl.value = cfg.cookBeforeYs;
      if (beforeMinEl) beforeMinEl.value = cfg.cookBeforeYsBeforeCook;
      if (beforeMaxEl) beforeMaxEl.value = cfg.cookAfterXsBeforeCook;
      if (virtualEl) virtualEl.value = cfg.virtualOrderOffsetSeconds;
      var panelStrategy = this._mapStrategyToPanel(cfg.strategy);
      var radios = document.querySelectorAll('input[name="waimai-strategy"]');
      radios.forEach(function(r) { r.checked = (r.value === panelStrategy); });
    }

    // 每秒刷新定时器倒计时显示
    this._updateTimerDisplay();
  }

  /** 刷新倒计时显示 */
  _updateTimerDisplay() {
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
  }

  /** 销毁面板 */
  destroyPanel() {
    if (this._panelTimer) {
      clearInterval(this._panelTimer);
      this._panelTimer = null;
    }
    var container = document.getElementById('waimai-panel-container');
    if (container) container.remove();
    var style = document.getElementById('waimai-panel-styles');
    if (style) style.remove();
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
