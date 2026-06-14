/**
 * @file 美团外卖自动出餐助手 V1 - 主书签脚本
 * @description 美团外卖商家的自动出餐业务。不依赖 pageAnalyzer.js
 *              (loader 会在前面加载它用于页面分析,业务本身不引用其 API)。
 *
 * 加载链路:
 *   1. domExtractor.loader.js 加载 pageAnalyzer.js (页面分析工具,独立)
 *   2. domExtractor.loader.js 加载本文件
 *   3. 本文件只做美团订单提取 + 出餐业务
 *
 * 暴露的全局 API:
 *   - window.extractOrders()       —— 提取当前页面所有订单
 *   - window.clickOrderButton(...)  —— 按订单号点击按钮
 *   - window.autoCookAll()          —— 一键出餐所有"待出餐"订单
 *   - window.monitorOrders(intervalMs) —— 启动订单监控
 *   - window.stopOrderMonitor()     —— 停止监控
 *   - window.showCookTimers()       —— 查看待执行的出餐任务
 *   - window.cancelCookTimer(no)    —— 取消某订单的出餐任务
 *   - window.printOrders(orders)    —— 打印订单表格到 console
 */

(function() {
    'use strict';

    // 启动 banner
    console.log('%c🛵 美团外卖自动出餐助手', 'color: #667eea; font-size: 20px; font-weight: bold;');
    console.log('');

    // ==================== 打印美团订单表格 ====================
    /**
     * 把美团订单数据格式化成 console 表格输出
     * @param {Array} orders - extractOrders() 的返回
     */
    function printOrders(orders) {
        if (!orders || orders.length === 0) return;
        const statusMap = {
            'pending_cook': '🔴 待出餐', 'pending_accept': '🟡 待接单',
            'cooked': '🟢 已出餐', 'delivering': '🚴 配送中',
            'delivered': '✅ 已送达', 'cancelled': '❌ 已取消', 'unknown': '❓ 未知'
        };

        console.log('');
        console.log('%c📦 美团订单数据（共 ' + orders.length + ' 单，从新到旧）', 'color: #667eea; font-size: 16px; font-weight: bold;');
        console.log('%c────────────────────────────────────', 'color: #ddd;');

        console.table(orders.map(o => ({
            '#': o.orderIndex,
            '出餐': statusMap[o.status] || o.status,
            '骑手': o.riderStatus || '-',
            '顾客': o.customerName + (o.isNewCustomer ? '🆕' : ''),
            '下单时间': o.orderTime,
            '商品': o.products.map(p => p.name + '×' + p.quantity).join(', '),
            '预计收入': '¥' + o.estimatedIncome,
            '出餐用时': o.cookTime || '-',
            '出餐倒计时': o.cookRemainingTime || '-'
        })));

        window.__orders = orders;
        console.log('');
        console.log('%c💾 订单数据已保存到全局变量 window.__orders', 'color: #667eea;');
        console.log('');
        console.log('%c📋 完整订单 JSON:', 'color: #667eea; font-weight: bold;');
        console.log(JSON.stringify(orders, null, 2));
    }
    window.printOrders = printOrders;

    // ==================== 美团订单提取 ====================

    window.extractOrders = function() {
        // 判断是否在 iframe 内，如果在外层则进入 iframe
        let doc = document;
        let win = window;

        if (win.self === win.top) {
            const iframe = document.getElementById('hashframe');
            if (!iframe) {
                console.log('%c⚠️ 未找到订单 iframe（hashframe）', 'color: #f59e0b; font-size: 14px;');
                return null;
            }
            try {
                doc = iframe.contentDocument || iframe.contentWindow.document;
                win = iframe.contentWindow;
            } catch (e) {
                console.log('%c⚠️ 无法访问 iframe（可能跨域）', 'color: #f59e0b; font-size: 14px;');
                return null;
            }
        }

        // 订单卡片选择器（class 含 hash，用 *= 匹配）
        const cards = doc.querySelectorAll('[class*="order-card"]');
        if (!cards.length) {
            console.log('%c⚠️ 未找到订单卡片，请确认在订单页面', 'color: #f59e0b; font-size: 14px;');
            return [];
        }

        const orders = [];

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const allText = card.innerText || '';
            const data = {};

            // 订单编号
            const orderNoMatch = allText.match(/订单编号[：:]\s*(\d+)/);
            data.orderNo = orderNoMatch ? orderNoMatch[1] : '';

            // 序号
            const indexMatch = allText.match(/#(\d+)/);
            data.orderIndex = indexMatch ? parseInt(indexMatch[1]) : '';

            // 下单时间
            const timeMatch = allText.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})\s*下单/);
            data.orderTime = timeMatch ? timeMatch[1] : '';

            // 送达时间
            const deliverMatch = allText.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})\s*前送达/);
            data.deliverTime = deliverMatch ? deliverMatch[1] : '';

            // 顾客姓名
            const customerMatch = allText.match(/([^\s]{1,4}(?:先生|女士))/);
            data.customerName = customerMatch ? customerMatch[1] : '';

            // 顾客类型
            data.isNewCustomer = allText.includes('门店新客');
            const countMatch = allText.match(/下单(\d+)次/);
            data.customerOrderCount = countMatch ? parseInt(countMatch[1]) : 0;
            data.isFavCustomer = allText.includes('收藏店铺');

            // 骑手状态（独立维度，来自 baseInfoRight 元素）
            data.riderStatus = '';
            const baseInfoRightEl = card.querySelector('div[class*="baseInfoRight"]');
            if (baseInfoRightEl) {
                data.riderStatus = baseInfoRightEl.innerText.trim();
            }

            // 订单出餐状态枚举（靠全文匹配，最可靠）
            if (allText.includes('待接单')) data.status = 'pending_accept';
            else if (allText.includes('待出餐')) data.status = 'pending_cook';
            else if (allText.includes('已出餐') || allText.includes('出餐完成')) data.status = 'cooked';
            else if (allText.includes('已送达') || allText.includes('用户已收餐')) data.status = 'delivered';
            else if (allText.includes('已取消')) data.status = 'cancelled';
            else data.status = 'unknown';

            // 合并展示状态
            const cookLabel = { pending_cook: '待出餐', cooked: '已出餐', pending_accept: '待接单', delivered: '已送达', cancelled: '已取消', unknown: '' };
            data.statusText = (cookLabel[data.status] || '') + (data.riderStatus ? ' | ' + data.riderStatus : '');

            // 出餐用时
            const cookTimeMatch = allText.match(/用时(\d{2}):(\d{2})/);
            data.cookTime = cookTimeMatch ? `${cookTimeMatch[1]}:${cookTimeMatch[2]}` : '';

            // 建议出餐时长（正常单：如"10分00秒"；预订单为空）
            const suggestMatch = allText.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
            data.suggestedCookTime = suggestMatch ? `${suggestMatch[1]}分${suggestMatch[2]}秒` : '';
            data.suggestedCookTimeSec = suggestMatch ? parseInt(suggestMatch[1]) * 60 + parseInt(suggestMatch[2]) : 0;

            // 是否为预订单
            data.isPreOrder = allText.includes('预订单');

            // 建议出餐时间点（正常单为空；预订单如"06-09 11:43前"）
            data.suggestedCookDeadline = '';
            const deadlineMatch = allText.match(/建议出餐时间(\d{2}-\d{2}\s+\d{2}:\d{2})前/);
            if (deadlineMatch) {
                data.suggestedCookDeadline = deadlineMatch[1].trim();
            }

            // 手机尾号
            const phoneMatch = allText.match(/手机尾号(\d{4})/);
            data.phoneTail = phoneMatch ? phoneMatch[1] : '';

            // 备注
            const remarkMatch = allText.match(/备注\s*([\s\S]*?)(?=\d种商品|$)/);
            data.remark = remarkMatch ? remarkMatch[1].trim() : '';

            // 预计收入
            const incomeMatch = allText.match(/预计收入\s*￥([\d.]+)/);
            data.estimatedIncome = incomeMatch ? parseFloat(incomeMatch[1]) : 0;

            // 商品信息
            const products = [];
            const productRegex = /([一-龥\w·～""（）()（）]+(?:\([^)]*\))*)\s*[￥¥](\d+\.?\d*)\s*x\s*(\d+)\s*[￥¥](\d+\.?\d*)/g;
            let pm;
            while ((pm = productRegex.exec(allText)) !== null) {
                products.push({
                    name: pm[1], unitPrice: parseFloat(pm[2]),
                    quantity: parseInt(pm[3]), totalPrice: parseFloat(pm[4])
                });
            }
            data.products = products;

            // 配送信息
            data.deliveryType = allText.includes('美团配送') ? 'meituan' : '';
            data.isFlashDelivery = allText.includes('闪电送') || allText.includes('15分钟');

            // 骑手
            const riderMatch = allText.match(/([一-龥]{2,4})\s*\n\s*美团配送/);
            data.riderName = riderMatch ? riderMatch[1] : '';

            // 费用明细
            const commissionMatch = allText.match(/佣金[（(]比例([\d.]+)%[^）)]*\)?\s*[−\-]￥([\d.]+)/);
            data.commissionRate = commissionMatch ? parseFloat(commissionMatch[1]) : 0;
            data.commissionAmount = commissionMatch ? parseFloat(commissionMatch[2]) : 0;

            const subsidyMatch = allText.match(/商家给顾客的配送补贴\s*[−\-]￥([\d.]+)/);
            data.deliverySubsidy = subsidyMatch ? parseFloat(subsidyMatch[1]) : 0;

            const discountMatch = allText.match(/商家给顾客的订单优惠\s*[−\-]￥([\d.]+)/);
            data.orderDiscount = discountMatch ? parseFloat(discountMatch[1]) : 0;

            const packMatch = allText.match(/打包费\s*[￥¥]([\d.]+)/);
            data.packFee = packMatch ? parseFloat(packMatch[1]) : 0;

            // 操作按钮（包括 <button> 和出餐 <div class="submit-button_xxx">）
            const buttons = getCardButtons(card);
            data.buttons = [];
            for (const btn of buttons) {
                data.buttons.push({ text: btn.innerText.trim(), className: btn.className || '', tag: btn.tagName.toLowerCase() });
            }

            // 出餐剩余时间（只取"剩余"，避免误取"用时"）
            data.cookRemainingTime = '';
            const timeTitleEls = card.querySelectorAll('div[class*="time-title"]');
            for (const tEl of timeTitleEls) {
                if (tEl.innerText.trim() === '剩余') {
                    const parentEl = tEl.parentElement;
                    if (parentEl) {
                        const timeText = parentEl.innerText.trim();
                        const timeMatch = timeText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
                        data.cookRemainingTime = timeMatch ? timeMatch[1] : timeText;
                    }
                    break;
                }
            }

            orders.push(data);
        }

        // 按序号从新到旧排序（序号大的在前）
        orders.sort((a, b) => (b.orderIndex || 0) - (a.orderIndex || 0));

        return orders;
    };

    // ==================== 自动出餐操作 ====================

    /**
     * 获取订单卡片中所有可操作按钮元素。
     * 出餐按钮可能是 <button> 或 <div class="submit-button_xxx">，
     * 所以需要同时查找两类元素。
     */
    function getCardButtons(card) {
        var btns = Array.from(card.querySelectorAll('button'));
        var divBtns = Array.from(card.querySelectorAll('div[class*="submit-button"]'));
        return btns.concat(divBtns);
    }

    /**
     * 按订单号点击指定按钮
     * 用法: clickOrderButton('2002156823164924733', '出餐')
     */
    window.clickOrderButton = function(orderNo, buttonText) {
        let doc = document;
        if (window.self === window.top) {
            const iframe = document.getElementById('hashframe');
            if (!iframe) { console.error('❌ 未找到 iframe'); return false; }
            try { doc = iframe.contentDocument || iframe.contentWindow.document; }
            catch (e) { console.error('❌ 无法访问 iframe'); return false; }
        }

        const cards = doc.querySelectorAll('[class*="order-card"]');
        for (const card of cards) {
            const text = card.innerText || '';
            const match = text.match(/订单编号[：:]\s*(\d+)/);
            if (match && match[1] === orderNo) {
                const buttons = getCardButtons(card);
                for (const btn of buttons) {
                    if (btn.innerText.trim().includes(buttonText)) {
                        btn.click();
                        console.log(`✅ 已点击「${buttonText}」: 订单 ${orderNo}`);
                        return true;
                    }
                }
                console.warn(`⚠️ 订单 ${orderNo} 中未找到「${buttonText}」按钮`);
                return false;
            }
        }
        console.error(`❌ 未找到订单 ${orderNo}`);
        return false;
    };

    /**
     * 一键出餐：找到所有待出餐订单，逐个点击出餐按钮
     * 用法: autoCookAll()
     * 用法: autoCookAll(3000)  // 每次点击间隔3秒
     */
    window.autoCookAll = function(intervalMs = 2000) {
        let doc = document;
        if (window.self === window.top) {
            const iframe = document.getElementById('hashframe');
            if (!iframe) { console.error('❌ 未找到 iframe'); return 0; }
            try { doc = iframe.contentDocument || iframe.contentWindow.document; }
            catch (e) { console.error('❌ 无法访问 iframe'); return 0; }
        }

        const cards = doc.querySelectorAll('[class*="order-card"]');
        let count = 0;

        for (const card of cards) {
            const text = card.innerText || '';
            if (text.includes('待出餐')) {
                const match = text.match(/订单编号[：:]\s*(\d+)/);
                const orderNo = match ? match[1] : '';
                const buttons = getCardButtons(card);
                for (const btn of buttons) {
                    const btnText = btn.innerText.trim();
                    if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
                        setTimeout(() => {
                            btn.click();
                            console.log(`✅ 自动出餐: 订单 ${orderNo}`);
                        }, count * intervalMs);
                        count++;
                        break;
                    }
                }
            }
        }

        if (count === 0) console.log('📭 没有待出餐订单');
        else console.log(`🚀 将自动出餐 ${count} 单，间隔 ${intervalMs}ms`);
        return count;
    };

    // ==================== 订单监控 ====================

    /**
     * 启动订单监控：每 5 秒检查新订单，发现"待出餐"时自动抓取
     * @param {number} intervalMs - 轮询间隔毫秒，默认 5000
     * @param {boolean} autoCook - 是否自动点击出餐按钮，默认 false
     */
    window.monitorOrders = function(intervalMs) {
        intervalMs = intervalMs || 5000;

        // 出餐配置（默认：下单后180~240秒随机出餐）
        window.__cookConfig = window.__cookConfig || {
            strategy: 'after_order',
            afterOrderMinSec: 180,
            afterOrderMaxSec: 240,
            beforeDeadlineMinSec: 120,
            beforeDeadlineMaxSec: 180
        };
        // Backward compatibility: migrate old field names
        if (window.__cookConfig.minDelayMin !== undefined && window.__cookConfig.afterOrderMinSec === undefined) {
            window.__cookConfig.afterOrderMinSec = Math.round(window.__cookConfig.minDelayMin * 60);
            delete window.__cookConfig.minDelayMin;
        }
        if (window.__cookConfig.maxDelayMin !== undefined && window.__cookConfig.afterOrderMaxSec === undefined) {
            window.__cookConfig.afterOrderMaxSec = Math.round(window.__cookConfig.maxDelayMin * 60);
            delete window.__cookConfig.maxDelayMin;
        }
        if (window.__cookConfig.beforeDeadlineSec !== undefined && window.__cookConfig.beforeDeadlineMinSec === undefined) {
            window.__cookConfig.beforeDeadlineMaxSec = window.__cookConfig.beforeDeadlineSec;
            window.__cookConfig.beforeDeadlineMinSec = Math.round(window.__cookConfig.beforeDeadlineSec * 0.67);
            delete window.__cookConfig.beforeDeadlineSec;
        }
        if (window.__cookConfig.strategy === 'immediate') {
            window.__cookConfig.strategy = 'manual';
        }
        window.__cookTimers = window.__cookTimers || {};

        // 停止之前的监控
        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
        }
        window.__knownOrders = window.__knownOrders || new Set();
        window.__monitorCheckCount = 0;

        function getIframeDoc() {
            if (window.self !== window.top) return document;
            var iframe = document.getElementById('hashframe');
            if (!iframe) return null;
            try { return iframe.contentDocument || iframe.contentWindow.document; }
            catch (e) { return null; }
        }

        // 解析时间字符串为秒数（支持 "MM:SS" 和 "HH:MM:SS"）
        function parseTimeToSeconds(timeStr) {
            if (!timeStr) return 0;
            var parts = timeStr.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        }

        // 解析建议出餐时长为秒数（如 "10分00秒" → 600）
        function parseSuggestedTimeToSeconds(timeStr) {
            if (!timeStr) return 0;
            var minMatch = timeStr.match(/(\d+)分/);
            var secMatch = timeStr.match(/(\d+)秒/);
            return (minMatch ? parseInt(minMatch[1]) * 60 : 0) + (secMatch ? parseInt(secMatch[1]) : 0);
        }

        function checkOrders() {
            window.__monitorCheckCount++;
            var doc = getIframeDoc();
            if (!doc) {
                console.log('%c⏳ 等待订单页面加载...', 'color: #f59e0b;');
                return;
            }

            var cards = doc.querySelectorAll('[class*="order-card"]');
            if (!cards.length) return;

            var now = new Date().toLocaleTimeString();

            function getOrderStatus(allText) {
                // 出餐状态靠全文匹配（最可靠）
                if (allText.includes('待接单')) return 'pending_accept';
                if (allText.includes('待出餐')) return 'pending_cook';
                if (allText.includes('已出餐') || allText.includes('出餐完成')) return 'cooked';
                if (allText.includes('已送达') || allText.includes('用户已收餐')) return 'delivered';
                if (allText.includes('已取消')) return 'cancelled';
                return 'unknown';
            }

            function getRiderStatus(card) {
                // 骑手状态独立维度，从 baseInfoRight 元素提取
                var baseInfoRight = card.querySelector('div[class*="baseInfoRight"]');
                if (baseInfoRight) {
                    var text = baseInfoRight.innerText.trim();
                    if (text) return text;
                }
                return '';
            }

            // 重置状态追踪（首次运行时）
            if (!window.__orderStatusMap) window.__orderStatusMap = {};

            cards.forEach(function(card) {
                var allText = card.innerText || '';
                var orderNoMatch = allText.match(/订单编号[：:]\s*(\d+)/);
                var orderNo = orderNoMatch ? orderNoMatch[1] : '';
                if (!orderNo) return;

                var currentStatus = getOrderStatus(allText);
                var riderStatus = getRiderStatus(card);
                var prevStatus = window.__orderStatusMap[orderNo];
                var isNew = !window.__knownOrders.has(orderNo);
                var statusChanged = prevStatus && prevStatus !== currentStatus;

                window.__knownOrders.add(orderNo);
                window.__orderStatusMap[orderNo] = currentStatus;

                var customerMatch = allText.match(/([^\s]{1,4}(?:先生|女士))/);
                var indexMatch = allText.match(/#(\d+)/);
                var isPendingCook = currentStatus === 'pending_cook';
                var cookLabel = { pending_cook: '待出餐', cooked: '已出餐', pending_accept: '待接单', delivered: '已送达', cancelled: '已取消' };

                // 状态变化：如果不再是待出餐，取消定时出餐
                if (statusChanged && !isPendingCook && window.__cookTimers[orderNo]) {
                    clearTimeout(window.__cookTimers[orderNo].timerId);
                    delete window.__cookTimers[orderNo];
                    panelLog('⏹️ 订单 ' + orderNo + ' 状态变化为' + (cookLabel[currentStatus] || currentStatus) + '，取消定时出餐', 'gray');
                }

                // 新订单 或 状态变为"待出餐"
                if (isNew || (statusChanged && isPendingCook)) {
                    var statusLabel = cookLabel[currentStatus] || currentStatus;
                    var label = riderStatus ? statusLabel + ' | ' + riderStatus : statusLabel;
                    var reason = isNew ? '🆕 新订单' : '🔄 状态变化 → ' + label;
                    var statusEmoji = isPendingCook ? '🔴' : '🔵';
                    panelLog('🆕 新订单 #' + (indexMatch ? indexMatch[1] : '?') + ' ' + (customerMatch ? customerMatch[1] : ''), 'blue');

                    // 输出该订单的完整数据
                    var allOrders = window.extractOrders ? window.extractOrders() : null;
                    if (allOrders) {
                        var thisOrder = allOrders.find(function(o) { return o.orderNo === orderNo; });
                        if (thisOrder) {
                            console.log('%c📦 订单详情：', 'color: #667eea; font-weight: bold;');
                            console.log(JSON.stringify(thisOrder, null, 2));
                        }
                    }

                    if (isPendingCook) {
                        panelLog('🔴🔴🔴 发现待出餐订单！', 'red');

                        // 出餐剩余时间（只取"剩余"，避免误取"用时"）
                        var timeTitleEls = card.querySelectorAll('div[class*="time-title"]');
                        for (var ti = 0; ti < timeTitleEls.length; ti++) {
                            if (timeTitleEls[ti].innerText.trim() === '剩余') {
                                var parentEl = timeTitleEls[ti].parentElement;
                                if (parentEl) {
                                    var timeParentText = parentEl.innerText.trim();
                                    var timeRem = timeParentText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
                                    if (timeRem) {
                                        console.log('%c⏱️ 出餐剩余时间: ' + timeRem[1], 'color: #f59e0b; font-size: 14px; font-weight: bold;');
                                    }
                                }
                                break;
                            }
                        }

                        // 抓取出餐按钮结构（包括 <button> 和 <div class="submit-button_xxx">）
                        var buttons = getCardButtons(card);
                        var btnInfo = [];
                        for (var i = 0; i < buttons.length; i++) {
                            btnInfo.push({
                                text: buttons[i].innerText.trim(),
                                type: buttons[i].type || '',
                                className: buttons[i].className || '',
                                tag: buttons[i].tagName.toLowerCase(),
                                disabled: buttons[i].disabled,
                                id: buttons[i].id || ''
                            });
                        }
                        console.log('%c📋 出餐按钮结构：', 'color: #f59e0b; font-weight: bold;');
                        console.log(JSON.stringify(btnInfo, null, 2));

                        // 自动出餐定时器
                        if (!window.__cookTimers[orderNo]) {
                            var config = window.__cookConfig;
                            // 提取建议出餐时长和剩余时间
                            var suggestMatch = allText.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
                            var suggestedSec = suggestMatch ? parseInt(suggestMatch[1]) * 60 + parseInt(suggestMatch[2]) : 0;
                            var remainingSec = 0;
                            var timeTitleEls2 = card.querySelectorAll('div[class*="time-title"]');
                            for (var tIdx = 0; tIdx < timeTitleEls2.length; tIdx++) {
                                if (timeTitleEls2[tIdx].innerText.trim() === '剩余') {
                                    var pParent = timeTitleEls2[tIdx].parentElement;
                                    if (pParent) {
                                        var pText = pParent.innerText.trim();
                                        var pMatch = pText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
                                        if (pMatch) remainingSec = parseTimeToSeconds(pMatch[1]);
                                    }
                                    break;
                                }
                            }
                            var elapsedSec = suggestedSec > 0 ? suggestedSec - remainingSec : 0;

                            // 预订单处理：建议出餐时间前10分钟视为虚拟下单时间
                            var isPreOrder = allText.includes('预订单');
                            var deadlineMatch = allText.match(/建议出餐时间(\d{2}-\d{2}\s+\d{2}:\d{2})前/);
                            var deadlineDate = null;
                            if (deadlineMatch) {
                                // 解析 "06-09 11:43" 为 Date（当年）
                                var parts = deadlineMatch[1].trim().match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                                if (parts) {
                                    var now = new Date();
                                    deadlineDate = new Date(now.getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]));
                                }
                            }

                            // 计算已用时（预订单的倒计时可能还没开始）
                            if (isPreOrder && deadlineDate && remainingSec === 0) {
                                // 预订单：还没有开始倒计时，虚拟下单时间 = 建议出餐时间 - 10分钟
                                // elapsedSec 此时为0（没有倒计时），需要按预订单逻辑计算
                                var preOrderVirtualStart = new Date(deadlineDate.getTime() - 10 * 60 * 1000); // 建议-10分钟
                                if (Date.now() < preOrderVirtualStart.getTime()) {
                                    // 还没到虚拟下单时间，延迟到虚拟下单时间 + 策略延迟
                                    elapsedSec = 0;
                                    // 对于 after_order 策略，delay = 策略时间（因为没有已用时）
                                    // 但实际应该等到接近建议出餐时间，所以强制用 before_deadline 逻辑
                                } else {
                                    // 已过虚拟下单时间，计算已用时
                                    elapsedSec = Math.round((Date.now() - preOrderVirtualStart.getTime()) / 1000);
                                }
                            }

                            // 计算延迟
                            var delay;
                            var delayDesc;
                            // 手动出餐模式：不自动出餐，跳过定时器
                            if (config.strategy === 'manual') {
                                panelLog('🖐️ 订单 ' + orderNo + ' 手动出餐模式，等待人工操作', 'gray');
                            } else if (config.strategy === 'before_deadline') {
                                var bdMinSec = Math.min(config.beforeDeadlineMinSec, config.beforeDeadlineMaxSec);
                                var bdMaxSec = Math.max(config.beforeDeadlineMinSec, config.beforeDeadlineMaxSec);
                                var bdSec = bdMinSec + Math.round(Math.random() * (bdMaxSec - bdMinSec));
                                if (remainingSec > 0) {
                                    delay = Math.max(1000, (remainingSec - bdSec) * 1000);
                                } else if (deadlineDate) {
                                    // 预订单没有倒计时，用绝对时间算
                                    delay = Math.max(1000, deadlineDate.getTime() - Date.now() - bdSec * 1000);
                                } else {
                                    delay = 1000; // 兜底：无倒计时也无法推算，立即出餐
                                }
                                delayDesc = '建议出餐前' + config.beforeDeadlineMinSec + '~' + config.beforeDeadlineMaxSec + '秒';
                            } else {
                                // after_order: 下单后N秒
                                var aoMinSec = Math.min(config.afterOrderMinSec, config.afterOrderMaxSec);
                                var aoMaxSec = Math.max(config.afterOrderMinSec, config.afterOrderMaxSec);
                                if (isPreOrder && deadlineDate && remainingSec === 0) {
                                    // 预订单无倒计时：直接算到建议出餐时间前N秒
                                    var preOrderVirtualStart = new Date(deadlineDate.getTime() - 10 * 60 * 1000);
                                    var targetSec = aoMinSec + Math.round(Math.random() * (aoMaxSec - aoMinSec));
                                    var virtualDelayMs = targetSec * 1000;
                                    delay = Math.max(1000, preOrderVirtualStart.getTime() + virtualDelayMs - Date.now());
                                } else {
                                    var targetSec = aoMinSec + Math.round(Math.random() * (aoMaxSec - aoMinSec));
                                    delay = Math.max(1000, (targetSec - elapsedSec) * 1000);
                                }
                                delayDesc = '下单后' + config.afterOrderMinSec + '~' + config.afterOrderMaxSec + '秒';
                            }

                            // 手动出餐模式不需要设置定时器
                            if (config.strategy !== 'manual') {
                            var targetTime = new Date(Date.now() + delay);
                            var delaySec = Math.round(delay / 1000);

                            // 设置定时器（闭包捕获 orderNo）
                            (function(no) {
                                var timerId = setTimeout(function() {
                                    // 重新查找订单卡片（DOM 可能已变）
                                    var doc2 = getIframeDoc();
                                    if (!doc2) return;
                                    var cards2 = doc2.querySelectorAll('[class*="order-card"]');
                                    for (var k = 0; k < cards2.length; k++) {
                                        var t2 = cards2[k].innerText || '';
                                        if (t2.includes(no)) {
                                            var btns2 = getCardButtons(cards2[k]);
                                            for (var b = 0; b < btns2.length; b++) {
                                                var txt2 = btns2[b].innerText.trim();
                                                if (txt2 === '出餐完成' || txt2 === '出餐' || txt2 === '确认出餐') {
                                                    btns2[b].click();
                                                    panelLog('✅ 已自动出餐: 订单 ' + no, 'green');
                                                    break;
                                                }
                                            }
                                            break;
                                        }
                                    }
                                    delete window.__cookTimers[no];
                                }, delay);

                                window.__cookTimers[no] = { timerId: timerId, targetTime: targetTime, delay: delay };

                                var minStr = Math.floor(delaySec / 60);
                                var secStr = delaySec % 60;
                                panelLog('⏰ 订单 ' + no + ' 将在 ' + (minStr > 0 ? minStr + '分' : '') + secStr + '秒后自动出餐（' + targetTime.toLocaleTimeString() + '）', 'orange');
                                if (isPreOrder && deadlineDate) {
                                    panelLog('   📋 预订单 | 建议出餐 ' + (deadlineMatch ? deadlineMatch[1].trim() : '') + ' | 策略: ' + delayDesc, 'blue');
                                } else if (suggestedSec > 0 && remainingSec > 0) {
                                    panelLog('   建议时长 ' + suggestedSec + '秒 | 已用 ' + elapsedSec + '秒 | 剩余 ' + remainingSec + '秒', 'gray');
                                }
                            })(orderNo);
                            } // end if (strategy !== 'manual')
                        }
                    }
                }
            });

            // 心跳提示
            if (window.__monitorCheckCount % 6 === 1) {
                var pendingCount = 0;
                cards.forEach(function(card) {
                    if (card.innerText.includes('待出餐')) pendingCount++;
                });
                var emoji = pendingCount > 0 ? '🔴' : '✅';
                var timerCount = window.__cookTimers ? Object.keys(window.__cookTimers).length : 0;
                var timerInfo = timerCount > 0 ? ' | ⏰ 待出餐 ' + timerCount + ' 单' : '';
                panelLog(emoji + ' [' + now + '] 监控中 | 已知 ' + window.__knownOrders.size + ' 单 | 待出餐 ' + pendingCount + ' 单' + timerInfo, 'gray');
            }
        }

        // 初始化已知订单
        var doc = getIframeDoc();
        if (doc) {
            var cards = doc.querySelectorAll('[class*="order-card"]');
            cards.forEach(function(card) {
                var m = card.innerText.match(/订单编号[：:]\s*(\d+)/);
                if (m) window.__knownOrders.add(m[1]);
            });
        }

        var config = window.__cookConfig;
        var strategyDesc = config.strategy === 'manual' ? '手动出餐' :
                          config.strategy === 'before_deadline' ? '建议出餐前' + config.beforeDeadlineMinSec + '~' + config.beforeDeadlineMaxSec + '秒' :
                          '下单后' + config.afterOrderMinSec + '~' + config.afterOrderMaxSec + '秒';
        panelLog('📋 订单监控已启动 | 已知 ' + window.__knownOrders.size + ' 单 | 每 ' + (intervalMs/1000) + '秒检查', 'blue');
        panelLog('⏰ 出餐策略: ' + strategyDesc, 'orange');

        window.__orderMonitorTimer = setInterval(checkOrders, intervalMs);
        checkOrders(); // 立即检查一次

        return window.__knownOrders.size;
    };

    /**
     * 查看所有定时出餐任务
     */
    window.showCookTimers = function() {
        var timers = window.__cookTimers || {};
        var keys = Object.keys(timers);
        if (keys.length === 0) {
            console.log('%c📭 没有待执行的出餐任务', 'color: #888;');
            return;
        }
        console.log('%c⏰ 待执行出餐任务（' + keys.length + ' 单）：', 'color: #2196F3; font-weight: bold;');
        keys.forEach(function(no) {
            var t = timers[no];
            var remainSec = Math.max(0, Math.round((t.targetTime.getTime() - Date.now()) / 1000));
            var min = Math.floor(remainSec / 60);
            var sec = remainSec % 60;
            console.log('  订单 ' + no + ' → ' + (min > 0 ? min + '分' : '') + sec + '秒后出餐（目标时间 ' + t.targetTime.toLocaleTimeString() + '）');
        });
    };

    /**
     * 取消某个订单的定时出餐
     */
    window.cancelCookTimer = function(orderNo) {
        var timer = window.__cookTimers && window.__cookTimers[orderNo];
        if (timer) {
            clearTimeout(timer.timerId);
            delete window.__cookTimers[orderNo];
            console.log('%c⏹️ 已取消订单 ' + orderNo + ' 的定时出餐', 'color: #888;');
        } else {
            console.log('%c⚠️ 订单 ' + orderNo + ' 没有待执行的出餐任务', 'color: #f59e0b;');
        }
    };

    /**
     * 停止订单监控
     */
    window.stopOrderMonitor = function() {
        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
            window.__orderMonitorTimer = null;
        }
        // 清除所有定时出餐任务
        if (window.__cookTimers) {
            Object.keys(window.__cookTimers).forEach(function(no) {
                clearTimeout(window.__cookTimers[no].timerId);
            });
            window.__cookTimers = {};
        }
        console.log('%c⏹️ 订单监控已停止，所有定时出餐任务已取消', 'color: #888; font-size: 14px;');
    };

    // ==================== 悬浮控制面板 ====================

    /**
     * 创建悬浮控制面板
     */
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
            '  <h3>🛵 美团出餐助手</h3>',
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
            '    <label><input type="radio" name="waimai-strategy" value="after_order" checked> 下单后 <input type="number" id="waimai-after-min-sec" value="180" min="0" max="1800" style="width:50px">~<input type="number" id="waimai-after-max-sec" value="240" min="0" max="1800" style="width:50px"> 秒</label>',
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

        // 绑定策略切换
        var radios = container.querySelectorAll('input[name="waimai-strategy"]');
        radios.forEach(function(r) {
            r.addEventListener('change', function() {
                window.__cookConfig = window.__cookConfig || { strategy: 'after_order', afterOrderMinSec: 180, afterOrderMaxSec: 240, beforeDeadlineMinSec: 120, beforeDeadlineMaxSec: 180 };
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
        if (afterMinInput) afterMinInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.afterOrderMinSec = parseInt(this.value) || 180; logConfigChange(); });
        if (afterMaxInput) afterMaxInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.afterOrderMaxSec = parseInt(this.value) || 240; logConfigChange(); });
        if (beforeMinInput) beforeMinInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.beforeDeadlineMinSec = parseInt(this.value) || 120; logConfigChange(); });
        if (beforeMaxInput) beforeMaxInput.addEventListener('change', function() { window.__cookConfig = window.__cookConfig || {}; window.__cookConfig.beforeDeadlineMaxSec = parseInt(this.value) || 180; logConfigChange(); });
        // 从已有配置回填面板输入值
        if (window.__cookConfig) {
            if (afterMinInput) afterMinInput.value = window.__cookConfig.afterOrderMinSec || 180;
            if (afterMaxInput) afterMaxInput.value = window.__cookConfig.afterOrderMaxSec || 240;
            if (beforeMinInput) beforeMinInput.value = window.__cookConfig.beforeDeadlineMinSec || 120;
            if (beforeMaxInput) beforeMaxInput.value = window.__cookConfig.beforeDeadlineMaxSec || 180;
            var currentStrategy = window.__cookConfig.strategy || 'after_order';
            radios.forEach(function(r) { r.checked = (r.value === currentStrategy); });
        }
    };

    /**
     * 面板日志输出
     */
    window.panelLog = function(message, color) {
        // 保留 console 输出
        var styleMap = { red: 'red', green: 'green', blue: '#667eea', orange: '#f59e0b', gray: '#888' };
        var consoleStyle = '';
        if (color === 'red') consoleStyle = 'color: red; font-weight: bold;';
        else if (color === 'green') consoleStyle = 'color: green; font-weight: bold;';
        else if (color === 'blue') consoleStyle = 'color: #667eea; font-weight: bold;';
        else if (color === 'orange') consoleStyle = 'color: #f59e0b; font-weight: bold;';
        console.log('%c' + message, consoleStyle || 'color: #888;');

        // 面板日志
        var logArea = document.getElementById('waimai-log-area');
        if (logArea) {
            var entry = document.createElement('div');
            entry.className = 'waimai-log-entry';
            var now = new Date().toLocaleTimeString();
            var colorClass = color ? 'waimai-log-' + color : '';
            entry.innerHTML = '<span style="color:#666">' + now + '</span> <span class="' + colorClass + '">' + message + '</span>';
            logArea.appendChild(entry);
            // 最多保留 100 条
            while (logArea.childElementCount > 100) {
                logArea.removeChild(logArea.firstChild);
            }
            logArea.scrollTop = logArea.scrollHeight;
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
                    detailHtml = '<div class="waimai-order-detail" data-timer-end="' + timer.targetTime.getTime() + '">⏰ ...</div>';
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

            html += '<div class="waimai-order-item">' +
                '<div class="waimai-order-top">' +
                '<span class="waimai-order-id">#' + (o.orderIndex || '?') + '</span> ' +
                '<span class="waimai-order-name">' + name + '</span> ' +
                statusTag + riderTag +
                '</div>' +
                detailHtml +
                '</div>';
        });

        listEl.innerHTML = html;
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
            afterOrderMinSec: 180,
            afterOrderMaxSec: 240,
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
        if (afterMinEl) config.afterOrderMinSec = parseInt(afterMinEl.value) || 180;
        if (afterMaxEl) config.afterOrderMaxSec = parseInt(afterMaxEl.value) || 240;
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

    // 自动检测：如果当前页面是美团商家版，创建面板并启动监控
    var currentHost = window.location.hostname || '';
    var isMeituan = currentHost.indexOf('meituan') !== -1 || currentHost.indexOf('waimai') !== -1;
    if (isMeituan) {
        // 首次启动:把当前订单打印到 console (不阻塞后续监控)
        try {
            if (window.extractOrders && window.printOrders) {
                const initialOrders = window.extractOrders();
                window.printOrders(initialOrders);
            }
        } catch (e) {
            console.warn('⚠️ 首次订单打印失败:', e.message);
        }

        createPanel();
        setTimeout(function() {
            monitorOrders(5000);
            updatePanelOrders();
            // 每5秒更新面板订单列表（与监控同步）
            setInterval(updatePanelOrders, 5000);
            // 每秒刷新定时器倒计时显示
            setInterval(function() {
                var listEl = document.getElementById('waimai-order-list');
                if (!listEl) return;
                var timerItems = listEl.querySelectorAll('[data-timer-end]');
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
                        el.innerHTML = '⏰ ' + (min > 0 ? min + '分' : '') + sec + '秒后出餐';
                    }
                }
            }, 1000);
        }, 1000);
    } else {
        createPanel();
        panelLog('💡 非美团页面，面板已加载', 'blue');
        panelLog('💡 调用 monitorOrders() 或点击面板按钮启动监控', 'gray');
    }

})();
