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
      console.log(`[WM-V2] 即时单: 下单后 ${this.config.cookAfterXs}s ~ ${this.config.cookBeforeYs}s`);
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
      const ordersToCheck = this.store.getPendingCook();
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
