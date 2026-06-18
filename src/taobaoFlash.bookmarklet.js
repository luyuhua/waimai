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

    // ==================== 订单提取 ====================
    // 订单卡片: div.order-card__xxx，id 是订单号
    // 出餐按钮: button > span[text=上报出餐]
    // 状态: .order-status__xxx 的 innerText

    window.extractOrders = function() {
        var cards = document.querySelectorAll('[class*="order-card"]');
        if (!cards.length) return [];

        var orders = [];

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var allText = card.innerText || '';
            var data = {};

            data.orderNo = card.id || '';
            var indexMatch = allText.match(/#(\d+)/);
            data.orderIndex = indexMatch ? parseInt(indexMatch[1]) : '';
            var timeMatch = allText.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})\s*下单/);
            data.orderTime = timeMatch ? timeMatch[1] : '';
            var deliverMatch = allText.match(/(\d{2}:\d{2})\s*前送达/);
            data.deliverTime = deliverMatch ? deliverMatch[1] : '';
            var nameMatch = allText.match(/^([一-龥]{1,2}\*\*|[一-龥]{2,4}(?:先生|女士))/m);
            data.customerName = nameMatch ? nameMatch[1] : '';
            var countMatch = allText.match(/近\d+天下单(\d+)次/);
            data.customerOrderCount = countMatch ? parseInt(countMatch[1]) : 0;
            data.isNewCustomer = allText.includes('门店新客');
            data.isSuperMember = allText.includes('超级会员');
            data.cannotContact = allText.includes('联系不上');

            // 订单状态（独立维度）
            var statusEl = card.querySelector('[class*="order-status"]');
            data.riderStatus = statusEl ? statusEl.innerText.replace(/[>＞\s]+$/, '').trim() : '';

            // 订单出餐状态
            var hasReportBtn = !!card.querySelector('button span') &&
                Array.from(card.querySelectorAll('span')).some(function(s) { return s.innerText.trim() === '上报出餐'; });
            if (hasReportBtn) {
                data.status = 'pending_cook';
            } else if (allText.includes('已出餐') || allText.includes('已送达') || allText.includes('已收餐') || allText.includes('已完成')) {
                data.status = 'cooked';
            } else if (allText.includes('待接单') || allText.includes('待支付')) {
                data.status = 'pending_accept';
            } else if (allText.includes('已取消') || allText.includes('部分取消') || allText.includes('整单取消')) {
                data.status = 'cancelled';
            } else {
                data.status = 'unknown';
            }

            data.cookTime = '';
            var cookTimeMatch = allText.match(/出餐用时\s*(\d+)分(\d+)秒/);
            if (cookTimeMatch) {
                data.cookTime = cookTimeMatch[1] + ':' + cookTimeMatch[2];
            }

            // 备注
            data.remark = '';
            var remarkMatch = allText.match(/备注[：:]\s*([^\n]+)/);
            if (remarkMatch) data.remark = remarkMatch[1].trim();

            // 商品
            data.products = [];
            var productMatch = allText.match(/(\d+)种商品[，,]共(\d+)件/);
            if (productMatch) {
                data.products.push({ summary: productMatch[1] + '种商品，共' + productMatch[2] + '件' });
            }

            // 预计收入
            data.estimatedIncome = 0;
            var incomeMatch = allText.match(/预计收入\s*[￥¥]([\d.]+)/);
            if (incomeMatch) data.estimatedIncome = parseFloat(incomeMatch[1]);

            // 单号（OCR 中显示 "单号：xxxxx"，但实际 HTML 中可能在不同位置）
            data.orderSerial = '';
            var serialMatch = allText.match(/单号[：:]\s*(\d+)/);
            if (serialMatch) data.orderSerial = serialMatch[1];

            data.isPreOrder = false;

            // 操作按钮
            data.buttons = [];
            var buttons = getCardButtons(card);
            for (var b = 0; b < buttons.length; b++) {
                data.buttons.push({ text: buttons[b].innerText.trim(), className: buttons[b].className || '', tag: buttons[b].tagName.toLowerCase() });
            }

            data.cookRemainingTime = '';
            data.suggestedCookTime = '';
            data.suggestedCookTimeSec = 0;
            data.suggestedCookDeadline = '';

            orders.push(data);
        }

        // 排序：待出餐优先
        orders.sort(function(a, b) {
            var aUrgent = (a.status === 'pending_cook' || a.status === 'pending_accept') ? 0 : 1;
            var bUrgent = (b.status === 'pending_cook' || b.status === 'pending_accept') ? 0 : 1;
            if (aUrgent !== bUrgent) return aUrgent - bUrgent;
            return (a.orderIndex || 0) < (b.orderIndex || 0) ? -1 : 1;
        });

        return orders;
    };

    window.printOrders = function(orders) {
        if (!orders || orders.length === 0) {
            console.log('%c📭 暂无订单数据', 'color: #888;');
            return;
        }
        var statusMap = {
            'pending_cook': '🔴 待出餐', 'pending_accept': '🟡 待接单',
            'cooked': '🟢 已出餐', 'cancelled': '❌ 已取消', 'unknown': '❓ 未知'
        };
        console.log('%c📦 淘宝闪购订单数据（共 ' + orders.length + ' 单）', 'color: #ff6a00; font-weight: bold;');
        console.table(orders.map(function(o) {
            return {
                '#': o.orderIndex,
                '状态': statusMap[o.status] || o.status,
                '骑手': o.riderStatus || '-',
                '顾客': o.customerName + (o.isNewCustomer ? '🆕' : '') + (o.isSuperMember ? '⭐' : ''),
                '订单号': o.orderNo,
                '下单时间': o.orderTime,
                '商品': (o.products[0] && o.products[0].summary) || '-',
                '预计收入': '¥' + o.estimatedIncome,
                '出餐用时': o.cookTime || '-',
                '备注': o.remark || '-'
            };
        }));
    };

    // ==================== 按钮查找 ====================

    function getCardButtons(card) {
        var btns = Array.from(card.querySelectorAll('button'));
        return btns;
    }

    /**
     * 查找订单卡片中包含指定文本的按钮
     */
    function findButtonByText(card, text) {
        var buttons = getCardButtons(card);
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].innerText.trim().includes(text)) return buttons[i];
        }
        return null;
    }

    window.clickOrderButton = function(orderNo, buttonText) {
        var cards = document.querySelectorAll('[class*="order-card"]');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].id === orderNo) {
                var btn = findButtonByText(cards[i], buttonText);
                if (btn) {
                    btn.click();
                    console.log('✅ 已点击「' + buttonText + '」: 订单 ' + orderNo);
                    return true;
                }
                console.warn('⚠️ 订单 ' + orderNo + ' 中未找到「' + buttonText + '」按钮');
                return false;
            }
        }
        console.error('❌ 未找到订单 ' + orderNo);
        return false;
    };

    window.autoCookAll = function(intervalMs) {
        intervalMs = intervalMs || 2000;
        var cards = document.querySelectorAll('[class*="order-card"]');
        var count = 0;

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var text = card.innerText || '';
            if (text.includes('上报出餐')) {
                var btn = findButtonByText(card, '上报出餐');
                if (btn) {
                    (function(b, no) {
                        setTimeout(function() { b.click(); }, count * intervalMs);
                    })(btn, card.id);
                    count++;
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

        function parseTimeToSeconds(timeStr) {
            if (!timeStr) return 0;
            var parts = timeStr.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        }

        function clickReportButton(orderNo) {
            var cards = document.querySelectorAll('[class*="order-card"]');
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].id === orderNo) {
                    var btn = findButtonByText(cards[i], '上报出餐');
                    if (btn) { btn.click(); return true; }
                }
            }
            return false;
        }

        function checkOrders() {
            window.__monitorCheckCount++;

            var allOrders = window.extractOrders ? window.extractOrders() : null;
            if (!allOrders || allOrders.length === 0) {
                if (window.__monitorCheckCount % 6 === 1) {
                    panelLog('⏸️ 监控中 | 当前页面无订单数据', 'gray', 'heartbeat');
                }
                return;
            }

            var cookLabel = { pending_cook: '待出餐', cooked: '已出餐', pending_accept: '待接单', cancelled: '已取消' };

            allOrders.forEach(function(order) {
                var orderNo = order.orderNo;
                if (!orderNo) return;
                var orderLabel = '#' + (order.orderIndex || '?') + ' ' + (order.customerName || '顾客');

                var currentStatus = order.status;
                var riderStatus = order.riderStatus;
                var prevStatus = window.__orderStatusMap[orderNo];
                var isNew = !(orderNo in window.__orderStatusMap);
                var statusChanged = prevStatus && prevStatus !== currentStatus;

                window.__knownOrders.add(orderNo);
                window.__orderStatusMap[orderNo] = currentStatus;

                var isPendingCook = currentStatus === 'pending_cook';

                if (statusChanged && !isPendingCook && window.__cookTimers[orderNo]) {
                    clearTimeout(window.__cookTimers[orderNo].timerId);
                    delete window.__cookTimers[orderNo];
                    panelLog('⏹️ ' + orderLabel + ' 状态变化为' + (cookLabel[currentStatus] || currentStatus) + '，取消定时出餐', 'gray');
                }

                if (isNew || (statusChanged && isPendingCook)) {
                    var statusLabel = cookLabel[currentStatus] || currentStatus;
                    var label = riderStatus ? statusLabel + ' | ' + riderStatus : statusLabel;
                    panelLog((isNew ? '🆕 新订单' : '🔄 状态变化 → ' + label) + ' ' + orderLabel, 'blue');

                    console.log('%c📦 订单详情：', 'color: #ff6a00; font-weight: bold;');
                    console.log(JSON.stringify(order, null, 2));

                    if (isPendingCook) {
                        panelLog('🔴🔴🔴 发现待出餐订单！', 'red');

                        if (!window.__cookTimers[orderNo]) {
                            var config = window.__cookConfig;
                            var orderTime = order.orderTime;
                            var elapsedSec = 0;
                            if (orderTime) {
                                var tm = orderTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                                if (tm) {
                                    var nowD = new Date();
                                    var orderDate = new Date(nowD.getFullYear(), parseInt(tm[1]) - 1, parseInt(tm[2]), parseInt(tm[3]), parseInt(tm[4]));
                                    elapsedSec = Math.round((Date.now() - orderDate.getTime()) / 1000);
                                }
                            }

                            var delay;
                            var delayDesc;
                            if (config.strategy === 'manual') {
                                panelLog('🖐️ ' + orderLabel + ' 手动出餐模式，等待人工操作', 'gray');
                            } else {
                                var aoMinSec = Math.min(config.afterOrderMinSec, config.afterOrderMaxSec);
                                var aoMaxSec = Math.max(config.afterOrderMinSec, config.afterOrderMaxSec);
                                var targetSec = aoMinSec + Math.round(Math.random() * (aoMaxSec - aoMinSec));
                                delay = Math.max(1000, (targetSec - elapsedSec) * 1000);
                                delayDesc = '下单后' + config.afterOrderMinSec + '~' + config.afterOrderMaxSec + '秒';
                            }

                            if (config.strategy !== 'manual') {
                                var targetTime = new Date(Date.now() + delay);
                                var delaySec = Math.round(delay / 1000);
                                if (delay <= 1000) {
                                    panelLog('⚠️ ' + orderLabel + ' 出餐时间已过或即将到达，立即出餐', 'orange');
                                }

                                (function(no, lbl) {
                                    var timerId = setTimeout(function() {
                                        clickReportButton(no);
                                        panelLog('✅ 已自动出餐: ' + lbl, 'green');
                                        delete window.__cookTimers[no];
                                    }, delay);
                                    window.__cookTimers[no] = { timerId: timerId, targetTime: targetTime, delay: delay, delayDesc: delayDesc };
                                    var minStr = Math.floor(delaySec / 60);
                                    var secStr = delaySec % 60;
                                    panelLog('⏰ ' + lbl + ' 将在 ' + (minStr > 0 ? minStr + '分' : '') + secStr + '秒后自动出餐（' + targetTime.toLocaleTimeString() + '）', 'orange');
                                })(orderNo, orderLabel);
                            }
                        }
                    }
                }
            });

            if (window.__monitorCheckCount % 6 === 1) {
                var pendingCount = allOrders.filter(function(o) { return o.status === 'pending_cook'; }).length;
                var emoji = pendingCount > 0 ? '🔴' : '✅';
                var timerCount = window.__cookTimers ? Object.keys(window.__cookTimers).length : 0;
                var timerInfo = timerCount > 0 ? ' | ⏰ 待出餐 ' + timerCount + ' 单' : '';
                panelLog(emoji + ' 监控中 | 已知 ' + window.__knownOrders.size + ' 单 | 待出餐 ' + pendingCount + ' 单' + timerInfo, 'gray', 'heartbeat');
            }
        }

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

    window.createPanel = function() {
        // 防止重复创建
        if (document.getElementById('waimai-panel-container')) {
            return;
        }

        // 注入样式
        var style = document.createElement('style');
        style.id = 'waimai-panel-styles';
        style.textContent = [
            '#waimai-panel-container { position: fixed; bottom: 20px; right: 20px; z-index: 2147483640; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; }',
            '#waimai-panel-toggle { background: rgba(26,26,46,0.95); color: #fff; border: none; border-radius: 20px; padding: 10px 18px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 20px rgba(255,106,0,0.4); transition: transform 0.2s; }',
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
            '.waimai-section-title button { background: none; border: none; color: #ff6a00; cursor: pointer; font-size: 12px; padding: 0; }',
            '.waimai-order-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }',
            '.waimai-order-item:last-child { border-bottom: none; }',
            '.waimai-order-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }',
            '.waimai-order-id { font-weight: bold; color: #fff; }',
            '.waimai-order-name { color: #e0e0e0; }',
            '.waimai-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }',
            '.waimai-tag-pending { background: rgba(239,68,68,0.2); color: #f87171; }',
            '.waimai-tag-cooked { background: rgba(34,197,94,0.2); color: #4ade80; }',
            '.waimai-tag-rider { background: rgba(59,130,246,0.2); color: #60a5fa; }',
            '.waimai-tag-other { background: rgba(156,163,175,0.2); color: #9ca3af; }',
            '.waimai-order-detail { font-size: 12px; color: #888; padding-left: 4px; }',
            '.waimai-order-detail .timer { color: #f59e0b; font-weight: bold; }',
            '.waimai-order-detail .done { color: #4ade80; }',
            '.waimai-detail-toggle { font-size: 10px; color: #ff6a00; cursor: pointer; margin-left: auto; white-space: nowrap; user-select: none; }',
            '.waimai-detail-toggle:hover { color: #ff8c42; }',
            '.waimai-order-debug { font-size: 11px; color: #888; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; display: none; }',
            '#waimai-order-list { max-height: 150px; overflow-y: auto; }',
            '#waimai-order-list.expanded { max-height: 400px; }',
            '.waimai-strategy { margin-top: 6px; }',
            '.waimai-strategy label { display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer; color: #ccc; font-size: 13px; }',
            '.waimai-strategy input[type="radio"] { accent-color: #ff6a00; }',
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
            '.waimai-log-tabs { display: flex; gap: 2px; margin-bottom: 6px; }',
            '.waimai-log-tab { font-size: 11px; padding: 2px 10px; border-radius: 3px; cursor: pointer; color: #888; background: rgba(255,255,255,0.05); }',
            '.waimai-log-tab:hover { color: #ccc; }',
            '.waimai-log-tab.active { color: #fff; background: rgba(255,106,0,0.3); }',
            '.waimai-log-entry.hidden { display: none; }',
            '#waimai-log-area::-webkit-scrollbar { width: 6px; }',
            '#waimai-log-area::-webkit-scrollbar-track { background: transparent; }',
            '#waimai-log-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }',
            '#waimai-order-list::-webkit-scrollbar { width: 6px; }',
            '#waimai-order-list::-webkit-scrollbar-track { background: transparent; }',
            '#waimai-order-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }',
        ].join('\n');
        document.head.appendChild(style);

        // 创建容器
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
            '  <h3>🛵 淘宝闪购出餐助手</h3>',
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

        // 绑定策略切换
        var radios = container.querySelectorAll('input[name="waimai-strategy"]');
        radios.forEach(function(r) {
            r.addEventListener('change', function() {
                window.__cookConfig = window.__cookConfig || { strategy: 'after_order', afterOrderMinSec: 240, afterOrderMaxSec: 300, beforeDeadlineMinSec: 120, beforeDeadlineMaxSec: 180 };
                window.__cookConfig.strategy = this.value;
                panelLog('🔄 策略已切换为: ' + (this.value === 'manual' ? '手动出餐' : this.value === 'before_deadline' ? '建议出餐前' : '下单后'), 'blue');
            });
        });
        var afterMinInput = document.getElementById('waimai-after-min-sec');
        var afterMaxInput = document.getElementById('waimai-after-max-sec');
        var beforeMinInput = document.getElementById('waimai-before-min-sec');
        var beforeMaxInput = document.getElementById('waimai-before-max-sec');
        function logConfigChange() {
            var c = window.__cookConfig;
            if (!c) return;
            var desc = c.strategy === 'manual' ? '手动出餐' :
                       c.strategy === 'before_deadline' ? '建议出餐前' + c.beforeDeadlineMinSec + '~' + c.beforeDeadlineMaxSec + '秒' :
                       '下单后' + c.afterOrderMinSec + '~' + c.afterOrderMaxSec + '秒';
            panelLog('⚙️ 出餐配置已更新: ' + desc, 'blue');
        }
        if (afterMinInput) afterMinInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.afterOrderMinSec = parseInt(this.value) || 240; logConfigChange(); });
        if (afterMaxInput) afterMaxInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.afterOrderMaxSec = parseInt(this.value) || 300; logConfigChange(); });
        if (beforeMinInput) beforeMinInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.beforeDeadlineMinSec = parseInt(this.value) || 120; logConfigChange(); });
        if (beforeMaxInput) beforeMaxInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.beforeDeadlineMaxSec = parseInt(this.value) || 180; logConfigChange(); });
        // 从已有配置回填面板输入值
        if (window.__cookConfig) {
            if (afterMinInput) afterMinInput.value = window.__cookConfig.afterOrderMinSec || 240;
            if (afterMaxInput) afterMaxInput.value = window.__cookConfig.afterOrderMaxSec || 300;
            if (beforeMinInput) beforeMinInput.value = window.__cookConfig.beforeDeadlineMinSec || 120;
            if (beforeMaxInput) beforeMaxInput.value = window.__cookConfig.beforeDeadlineMaxSec || 180;
            var currentStrategy = window.__cookConfig.strategy || 'after_order';
            radios.forEach(function(r) { r.checked = (r.value === currentStrategy); });
        }
    };

    /**
     * 面板日志输出
     * @param {string} message
     * @param {string} color - red/green/blue/orange/gray
     * @param {string} [category] - 'heartbeat' 表示心跳日志,其他视为操作日志
     */
    window.panelLog = function(message, color, category) {
        // 保留 console 输出
        var styleMap = { red: 'red', green: 'green', blue: '#ff6a00', orange: '#f59e0b', gray: '#888' };
        var consoleStyle = '';
        if (color === 'red') consoleStyle = 'color: red; font-weight: bold;';
        else if (color === 'green') consoleStyle = 'color: green; font-weight: bold;';
        else if (color === 'blue') consoleStyle = 'color: #ff6a00; font-weight: bold;';
        else if (color === 'orange') consoleStyle = 'color: #f59e0b; font-weight: bold;';
        console.log('%c' + message, consoleStyle || 'color: #888;');

        // 面板日志
        var logArea = document.getElementById('waimai-log-area');
        if (logArea) {
            var entry = document.createElement('div');
            entry.className = 'waimai-log-entry';
            if (category === 'heartbeat') entry.classList.add('waimai-log-hb');
            else entry.classList.add('waimai-log-op');

            // 写入时即按当前 tab 过滤,避免点击 tab 时全量遍历
            var activeTab = document.querySelector('.waimai-log-tab.active');
            var currentFilter = activeTab ? activeTab.getAttribute('data-filter') : 'all';
            if (currentFilter === 'op' && category === 'heartbeat') entry.classList.add('hidden');
            if (currentFilter === 'hb' && category !== 'heartbeat') entry.classList.add('hidden');

            var now = new Date().toLocaleTimeString();
            var colorClass = color ? 'waimai-log-' + color : '';
            entry.innerHTML = '<span style="color:#666">' + now + '</span> <span class="' + colorClass + '">' + message + '</span>';
            logArea.appendChild(entry);
            // 操作/心跳 各 100 条独立上限,各清各的,避免互相冲
            var sameType = logArea.querySelectorAll(category === 'heartbeat' ? '.waimai-log-hb' : '.waimai-log-op');
            while (sameType.length > 100) {
                sameType[0].remove();
                sameType = logArea.querySelectorAll(category === 'heartbeat' ? '.waimai-log-hb' : '.waimai-log-op');
            }
            logArea.scrollTop = logArea.scrollHeight;
        }
    };

    /**
     * 过滤日志(切换 tab)
     */
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

    /**
     * 更新面板订单列表
     */
    window.updatePanelOrders = function() {
        var orders = window.extractOrders ? window.extractOrders() : null;
        var listEl = document.getElementById('waimai-order-list');
        if (!listEl) return;
        var badge = document.getElementById('waimai-badge');

        if (!orders || orders.length === 0) {
            listEl.innerHTML = '<div style="color:#666;font-size:12px;">暂无订单数据（extractOrders返回: ' + (orders === null ? 'null' : orders.length + '条') + '）</div>';
            if (badge) badge.textContent = '0';
            return;
        }

        var pendingCount = 0;
        var html = '';
        orders.forEach(function(o) {
            var statusTag = '';
            var detailHtml = '';
            if (o.status === 'pending_cook') {
                statusTag = '<span class="waimai-tag waimai-tag-pending">待出餐</span>';
                pendingCount++;
                // 预订单显示预约出餐时间
                if (o.isPreOrder && o.suggestedCookDeadline) {
                    statusTag = '<span class="waimai-tag waimai-tag-pending">预订单</span>';
                    detailHtml = '<div class="waimai-order-detail">🕒 预约出餐 ' + o.suggestedCookDeadline + '</div>';
                }
                // 检查是否有定时器（每秒倒计时更新）
                var timer = window.__cookTimers && window.__cookTimers[o.orderNo];
                if (timer) {
                    var targetTimeStr = timer.targetTime.toLocaleTimeString(); var timerExtra = timer.deadline ? " | 出餐参考 " + timer.deadline : ""; detailHtml = '<div class="waimai-order-detail" data-timer-end="' + timer.targetTime.getTime() + '">⏰ ...</div>' + '<div class="waimai-order-detail" style="font-size:11px;color:#888;">目标 ' + targetTimeStr + timerExtra + '</div>';
                } else if (!detailHtml && o.cookRemainingTime) {
                    detailHtml = '<div class="waimai-order-detail">⏳ 剩余 <span class="timer">' + o.cookRemainingTime + '</span></div>';
                }
            } else if (o.status === 'cooked') {
                statusTag = '<span class="waimai-tag waimai-tag-cooked">已出餐</span>';
                detailHtml = '<div class="waimai-order-detail"><span class="done">✅ 已出餐</span></div>';
            } else if (o.status === 'pending_accept') {
                statusTag = '<span class="waimai-tag waimai-tag-other">待接单</span>';
            } else if (o.riderStatus) {
                // 有骑手状态但不是待出餐/已出餐（如配送中、用户已收餐等）
                statusTag = '<span class="waimai-tag waimai-tag-cooked">' + o.statusText + '</span>';
            } else {
                var label = o.statusText || o.status;
                statusTag = '<span class="waimai-tag waimai-tag-other">' + label + '</span>';
            }

            var riderTag = o.riderStatus ? ' <span class="waimai-tag waimai-tag-rider">' + o.riderStatus + '</span>' : '';
            var name = o.customerName || '';

            // 取值辅助:空值用占位,保证所有字段都展示
            var v = function(val, fallback) {
                if (val === 0) return '0';
                if (val === false) return '否';
                if (val === true) return '是';
                if (val === undefined || val === null || val === '') return fallback || '-';
                return val;
            };

            // 1) 📋 基础信息
            var baseInfo = '订单号: ' + v(o.orderNo) + ' | 序号: #' + v(o.orderIndex) +
                ' | 状态枚举: ' + v(o.status) + ' | 状态展示: ' + v(o.statusText);

            // 2) ⏰ 时间信息
            var timeInfo = '下单时间: ' + v(o.orderTime) +
                ' | 送达时间: ' + v(o.deliverTime) +
                ' | 建议出餐时长: ' + v(o.suggestedCookTime) + ' (' + v(o.suggestedCookTimeSec, 0) + '秒)' +
                ' | 建议出餐时间点: ' + v(o.suggestedCookDeadline) +
                ' | 剩余时间: ' + v(o.cookRemainingTime) +
                ' | 出餐用时: ' + v(o.cookTime);

            // 3) 👤 用户信息
            var userInfo = '顾客: ' + v(o.customerName) +
                ' | 手机尾号: ' + v(o.phoneTail) +
                ' | 门店新客: ' + v(o.isNewCustomer, '否') +
                ' | 历史下单: ' + v(o.customerOrderCount, 0) + '次' +
                ' | 收藏店铺: ' + v(o.isFavCustomer, '否') +
                ' | 骑手姓名: ' + v(o.riderName) +
                ' | 骑手状态: ' + v(o.riderStatus);

            // 4) 📦 配送 & 商品
            var deliveryInfo = '配送方式: ' + v(o.deliveryType, '-') +
                (o.deliveryType === 'meituan' ? ' (美团配送)' : '') +
                ' | 闪电送: ' + v(o.isFlashDelivery, '否') +
                ' | 预订单: ' + v(o.isPreOrder, '否');
            var productsInfo = '商品列表: ' + (
                (o.products && o.products.length)
                    ? o.products.map(function(p) {
                        return p.name + ' ¥' + p.unitPrice.toFixed(2) + ' x ' + p.quantity + ' = ¥' + p.totalPrice.toFixed(2);
                    }).join('; ')
                    : '-'
            );
            var remarkInfo = '备注: ' + v(o.remark);

            // 5) 💰 费用信息
            var feeInfo = '预计收入: ¥' + v(o.estimatedIncome, 0) +
                ' | 佣金比例: ' + v(o.commissionRate, 0) + '%' +
                ' | 佣金: ¥' + v(o.commissionAmount, 0) +
                ' | 配送补贴: ¥' + v(o.deliverySubsidy, 0) +
                ' | 订单优惠: ¥' + v(o.orderDiscount, 0) +
                ' | 打包费: ¥' + v(o.packFee, 0);

            // 6) 🔘 操作按钮
            var buttonsInfo = '操作按钮: ' + (
                (o.buttons && o.buttons.length)
                    ? o.buttons.map(function(b) { return b.text + '(' + b.tag + (b.className ? '.' + b.className.split(' ')[0] : '') + ')'; }).join(', ')
                    : '-'
            );

            var debugInfo = [
                '📋 ' + baseInfo,
                '⏰ ' + timeInfo,
                '👤 ' + userInfo,
                '📦 ' + deliveryInfo,
                '   ' + productsInfo,
                '   ' + remarkInfo,
                '💰 ' + feeInfo,
                '🔘 ' + buttonsInfo
            ].join('\n');

            html += '<div class="waimai-order-item">' +
                '<div class="waimai-order-top">' +
                '<span class="waimai-order-id">#' + (o.orderIndex || '?') + '</span> ' +
                '<span class="waimai-order-name">' + name + '</span> ' +
                statusTag + riderTag +
                '<span class="waimai-detail-toggle" onclick="var d=this.parentElement.parentElement.querySelector(\'.waimai-order-debug\');var v=d.style.display===\'none\'||!d.style.display;d.style.display=v?\'block\':\'none\';this.textContent=v?\'收起 ▾\':\'详情 ▸\'">详情 ▸</span>' +
                '</div>' +
                detailHtml +
                '<div class="waimai-order-debug" data-orderno="' + (o.orderNo || '') + '" style="white-space: pre-wrap;">' + debugInfo + '</div>' +
                '</div>';
        });

        // 保留展开状态:刷新前收集当前展开的 orderNo
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
                var tog = debugEl.parentElement.querySelector('.waimai-detail-toggle');
                if (tog) tog.textContent = '收起 ▾';
            }
        }
        if (badge) badge.textContent = pendingCount;
        window.__pendingCount = pendingCount;

        // 更新折叠按钮文字
        var toggle = document.getElementById('waimai-panel-toggle');
        if (toggle) {
            var arrow = document.getElementById('waimai-panel').style.display === 'none' ? '▼' : '▲';
            toggle.innerHTML = '🛵 <span class="badge" id="waimai-badge">' + pendingCount + '</span> 待出餐 ' + arrow;
        }
    };

    /**
     * 从面板启动监控
     */
    window.startMonitorFromPanel = function() {
        // 确保配置已初始化
        window.__cookConfig = window.__cookConfig || {
            strategy: 'after_order',
            afterOrderMinSec: 240,
            afterOrderMaxSec: 300,
            beforeDeadlineMinSec: 120,
            beforeDeadlineMaxSec: 180
        };
        var config = window.__cookConfig;
        // Backward compatibility: migrate old field names
        if (config.minDelayMin !== undefined && config.afterOrderMinSec === undefined) {
            config.afterOrderMinSec = Math.round(config.minDelayMin * 60);
            delete config.minDelayMin;
        }
        if (config.maxDelayMin !== undefined && config.afterOrderMaxSec === undefined) {
            config.afterOrderMaxSec = Math.round(config.maxDelayMin * 60);
            delete config.maxDelayMin;
        }
        if (config.beforeDeadlineSec !== undefined && config.beforeDeadlineMinSec === undefined) {
            config.beforeDeadlineMaxSec = config.beforeDeadlineSec;
            config.beforeDeadlineMinSec = Math.round(config.beforeDeadlineSec * 0.67);
            delete config.beforeDeadlineSec;
        }
        if (config.strategy === 'immediate') {
            config.strategy = 'manual';
        }
        var afterMinEl = document.getElementById('waimai-after-min-sec');
        var afterMaxEl = document.getElementById('waimai-after-max-sec');
        var beforeMinEl = document.getElementById('waimai-before-min-sec');
        var beforeMaxEl = document.getElementById('waimai-before-max-sec');
        if (afterMinEl) config.afterOrderMinSec = parseInt(afterMinEl.value) || 240;
        if (afterMaxEl) config.afterOrderMaxSec = parseInt(afterMaxEl.value) || 300;
        if (beforeMinEl) config.beforeDeadlineMinSec = parseInt(beforeMinEl.value) || 120;
        if (beforeMaxEl) config.beforeDeadlineMaxSec = parseInt(beforeMaxEl.value) || 180;

        window.monitorOrders(5000);

        // 更新按钮状态和订单列表
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        setTimeout(updatePanelOrders, 1500);  // 等待首次监控完成后更新
    };

    // 监控启停时同步按钮状态
    var _origMonitor = window.monitorOrders;
    window.monitorOrders = function(intervalMs) {
        var result = _origMonitor(intervalMs);
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        setTimeout(updatePanelOrders, 1500);
        return result;
    };

    var _origStop = window.stopOrderMonitor;
    window.stopOrderMonitor = function() {
        _origStop();
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        updatePanelOrders();
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
