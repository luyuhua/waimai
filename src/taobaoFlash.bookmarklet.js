/**
 * @file 淘宝闪购自动出餐助手 - 主书签脚本（骨架版）
 * @description 淘宝闪购（饿了么商家版）商家的自动出餐业务。
 *              与 pageAnalyzer.js 解耦。
 *
 * 当前状态：骨架版，等待用户提供订单卡片的 HTML 后补完 extractOrders()。
 *
 * 加载链路:
 *   1. taobaoFlash.loader.js 加载 pageAnalyzer.js
 *   2. taobaoFlash.loader.js 加载本文件
 *   3. 本文件做淘宝闪购订单提取 + 出餐业务
 *
 * 暴露的全局 API:
 *   - window.extractOrders()       —— 提取当前页面所有订单（TODO: 等订单 HTML 补完）
 *   - window.clickOrderButton(...) —— 按订单号点击按钮
 *   - window.autoCookAll()         —— 一键出餐所有"待出餐"订单
 *   - window.monitorOrders(intervalMs) —— 启动订单监控
 *   - window.stopOrderMonitor()    —— 停止监控
 *   - window.showCookTimers()      —— 查看待执行的出餐任务
 *   - window.cancelCookTimer(no)   —— 取消某订单的出餐任务
 *   - window.printOrders(orders)   —— 打印订单表格到 console
 *   - window.switchToOrderTab()    —— 切换到「订单处理」tab
 */

(function() {
    'use strict';

    console.log('%c🍜 淘宝闪购自动出餐助手', 'color: #ff6a00; font-size: 20px; font-weight: bold;');
    console.log('%c⚠️ 骨架版 - extractOrders() 待补完', 'color: #f59e0b;');
    console.log('');

    // ==================== Tab 切换 ====================

    window.switchToOrderTab = function() {
        // 订单处理菜单项是 div（带 data-aspm-param 属性）
        // 通过 data-aspm-param 或文本内容匹配
        var candidates = document.querySelectorAll('div[data-aspm-param]');
        for (var i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            if (item.innerText && item.innerText.trim() === '订单处理') {
                item.click();
                return true;
            }
        }
        // fallback: 通过文本查找
        var allDivs = document.querySelectorAll('div');
        for (var j = 0; j < allDivs.length; j++) {
            var d = allDivs[j];
            if (d.innerText && d.innerText.trim() === '订单处理') {
                d.click();
                return true;
            }
        }
        console.warn('⚠️ 未找到「订单处理」tab');
        return false;
    };

    function isOnOrderTab() {
        // 选中状态：通过 data-aspm-param 或高亮 class 判断
        var selected = document.querySelector('div[data-aspm-param*="订单处理"]');
        if (selected) {
            // 检查是否有选中的样式 class
            var className = selected.className || '';
            if (className.includes('selected') || className.includes('active')) {
                return true;
            }
        }
        // fallback: 查找含"订单处理"且带 selected/active class 的元素
        var allDivs = document.querySelectorAll('div');
        for (var i = 0; i < allDivs.length; i++) {
            var d = allDivs[i];
            if (d.innerText && d.innerText.trim() === '订单处理') {
                var cn = d.className || '';
                if (cn.includes('selected') || cn.includes('active')) return true;
            }
        }
        return false;
    }

    // ==================== 订单提取 ====================
    // TODO: 等用户提供订单卡片 HTML 后补完

    window.extractOrders = function() {
        // 占位实现：等用户提供订单 HTML 后补完
        console.warn('⚠️ extractOrders() 尚未实现 - 请提供订单卡片的 HTML');
        return [];
    };

    window.printOrders = function(orders) {
        if (!orders || orders.length === 0) {
            console.log('%c📭 暂无订单数据', 'color: #888;');
            return;
        }
        console.log('%c📦 淘宝闪购订单数据（共 ' + orders.length + ' 单）', 'color: #ff6a00; font-weight: bold;');
        console.table(orders);
    };

    // ==================== 按钮查找 ====================
    // TODO: 等用户确认出餐按钮选择器后补完

    function getCardButtons(card) {
        var btns = Array.from(card.querySelectorAll('button'));
        return btns;
    }

    window.clickOrderButton = function(orderNo, buttonText) {
        var cards = document.querySelectorAll('[class*="order"]');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var text = card.innerText || '';
            if (text.includes(orderNo)) {
                var buttons = getCardButtons(card);
                for (var j = 0; j < buttons.length; j++) {
                    if (buttons[j].innerText.trim().includes(buttonText)) {
                        buttons[j].click();
                        console.log('✅ 已点击「' + buttonText + '」: 订单 ' + orderNo);
                        return true;
                    }
                }
            }
        }
        console.error('❌ 未找到订单 ' + orderNo);
        return false;
    };

    window.autoCookAll = function(intervalMs) {
        intervalMs = intervalMs || 2000;
        var cards = document.querySelectorAll('[class*="order"]');
        var count = 0;
        for (var i = 0; i < cards.length; i++) {
            var text = cards[i].innerText || '';
            if (text.includes('待出餐')) {
                var buttons = getCardButtons(cards[i]);
                for (var j = 0; j < buttons.length; j++) {
                    var btnText = buttons[j].innerText.trim();
                    if (btnText === '出餐' || btnText === '出餐完成' || btnText === '确认出餐') {
                        (function(btn, c) {
                            setTimeout(function() { btn.click(); }, count * intervalMs);
                        })(buttons[j], cards[i]);
                        count++;
                        break;
                    }
                }
            }
        }
        if (count === 0) console.log('📭 没有待出餐订单');
        else console.log('🚀 将自动出餐 ' + count + ' 单，间隔 ' + intervalMs + 'ms');
        return count;
    };

    // ==================== 监控 ====================
    // 复用美团的定时器策略逻辑，TODO: 补完状态判断

    window.monitorOrders = function(intervalMs) {
        intervalMs = intervalMs || 5000;

        // 出餐配置
        window.__cookConfig = window.__cookConfig || {
            strategy: 'after_order',
            afterOrderMinSec: 240,
            afterOrderMaxSec: 300
        };
        window.__cookTimers = window.__cookTimers || {};

        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
        }
        window.__knownOrders = window.__knownOrders || new Set();
        window.__monitorCheckCount = 0;
        window.__orderStatusMap = {};

        function checkOrders() {
            window.__monitorCheckCount++;

            if (!isOnOrderTab()) {
                panelLog('⚠️ 不在「订单处理」tab，跳过本次检查', 'orange');
                return;
            }

            var allOrders = window.extractOrders ? window.extractOrders() : null;
            if (!allOrders || allOrders.length === 0) return;

            // TODO: 复用美团的订单处理逻辑
            // - 状态变化检测
            // - 新订单触发定时出餐
            // - 状态变化取消定时器

            if (window.__monitorCheckCount % 6 === 1) {
                var pendingCount = allOrders.filter(function(o) { return o.status === 'pending_cook'; }).length;
                var emoji = pendingCount > 0 ? '🔴' : '✅';
                panelLog(emoji + ' 监控中 | 已知 ' + window.__knownOrders.size + ' 单 | 待出餐 ' + pendingCount + ' 单', 'gray', 'heartbeat');
            }
        }

        // 启动时先切到订单处理 tab
        switchToOrderTab();

        var config = window.__cookConfig;
        var strategyDesc = config.strategy === 'manual' ? '手动出餐' : '下单后' + config.afterOrderMinSec + '~' + config.afterOrderMaxSec + '秒';
        panelLog('📋 订单监控已启动 | 每 ' + (intervalMs/1000) + '秒检查', 'blue');
        panelLog('⏰ 出餐策略: ' + strategyDesc, 'orange');

        window.__orderMonitorTimer = setInterval(checkOrders, intervalMs);
        checkOrders();

        return window.__knownOrders.size;
    };

    window.stopOrderMonitor = function() {
        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
            window.__orderMonitorTimer = null;
        }
        if (window.__cookTimers) {
            Object.keys(window.__cookTimers).forEach(function(no) {
                clearTimeout(window.__cookTimers[no].timerId);
            });
            window.__cookTimers = {};
        }
        console.log('%c⏹️ 订单监控已停止', 'color: #888;');
    };

    // ==================== 悬浮面板 ====================
    // 复用美团面板样式，品牌色改为淘宝橙

    window.createPanel = function() {
        if (document.getElementById('waimai-panel-container')) return;

        var style = document.createElement('style');
        style.id = 'waimai-panel-styles';
        style.textContent = [
            '#waimai-panel-container { position: fixed; bottom: 20px; right: 20px; z-index: 2147483640; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; }',
            '#waimai-panel-toggle { background: rgba(26,26,46,0.95); color: #fff; border: none; border-radius: 20px; padding: 10px 18px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 20px rgba(255,106,0,0.4); }',
            '#waimai-panel { display: none; background: rgba(26,26,46,0.97); color: #e0e0e0; border-radius: 12px; width: 380px; max-height: 80vh; box-shadow: 0 8px 40px rgba(0,0,0,0.4); overflow: hidden; margin-bottom: 8px; }',
            '#waimai-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }',
            '#waimai-panel-header h3 { margin: 0; font-size: 15px; color: #ff6a00; }',
            '.waimai-section { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }',
            '.waimai-btn { border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }',
            '.waimai-btn-start { background: #ff6a00; color: #fff; }',
            '.waimai-btn-stop { background: #666; color: #fff; }',
            '#waimai-log-area { height: 120px; overflow-y: auto; font-size: 12px; font-family: monospace; }',
        ].join('\n');
        document.head.appendChild(style);

        var container = document.createElement('div');
        container.id = 'waimai-panel-container';
        container.innerHTML = [
            '<button id="waimai-panel-toggle" onclick="var p=document.getElementById(\'waimai-panel\');p.style.display=p.style.display===\'none\'?\'block\':\'none\';">🍜 淘宝闪购 ▼</button>',
            '<div id="waimai-panel">',
            '  <div id="waimai-panel-header"><h3>🍜 淘宝闪购出餐助手</h3></div>',
            '  <div class="waimai-section">',
            '    <button class="waimai-btn waimai-btn-start" onclick="window.monitorOrders(5000)">开始监控</button>',
            '    <button class="waimai-btn waimai-btn-stop" onclick="window.stopOrderMonitor()">停止监控</button>',
            '  </div>',
            '  <div class="waimai-section" id="waimai-log-area"></div>',
            '</div>',
        ].join('');
        document.body.appendChild(container);
    };

    window.panelLog = function(message, color, category) {
        var logArea = document.getElementById('waimai-log-area');
        if (logArea) {
            var entry = document.createElement('div');
            entry.style.color = color || '#888';
            entry.textContent = new Date().toLocaleTimeString() + ' ' + message;
            logArea.appendChild(entry);
            logArea.scrollTop = logArea.scrollHeight;
        }
    };

    // ==================== 平台检测 ====================

    var currentHost = window.location.hostname || '';
    var isTaobao = currentHost.indexOf('ele.me') !== -1 || currentHost.indexOf('taobao') !== -1;

    if (isTaobao) {
        createPanel();
        panelLog('🍜 淘宝闪购页面检测到', 'blue');
        panelLog('💡 点击「开始监控」启动自动出餐', 'gray');

        // 自动启动监控
        setTimeout(function() {
            window.monitorOrders(5000);
        }, 1500);
    } else {
        createPanel();
        console.log('%c⚠️ 非淘宝闪购页面，仅加载面板', 'color: #f59e0b;');
    }
})();
