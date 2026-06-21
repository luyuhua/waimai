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
            const deadlineMatch = allText.match(/(?:参考|建议)出餐时间(\d{2}-\d{2}\s+\d{2}:\d{2})前/);
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
        orders.sort(function(a, b) {
            // 第一组:待出餐/待接单 → 第二组:其他(已出餐/已送达/已取消)
            var aUrgent = (a.status === 'pending_cook' || a.status === 'pending_accept') ? 0 : 1;
            var bUrgent = (b.status === 'pending_cook' || b.status === 'pending_accept') ? 0 : 1;
            if (aUrgent !== bUrgent) return aUrgent - bUrgent;
            // 组内按 deliverTime 字符串字典序(空串自然排前,便于观察无送达时间的订单)
            var cmp = a.deliverTime < b.deliverTime ? -1 : a.deliverTime > b.deliverTime ? 1 : 0;
            return aUrgent === 0 ? cmp : -cmp;
        });

        return orders;
    };

    // ==================== 自动出餐操作 ====================

    // ==================== 云端数据同步 ====================

    var SUPABASE_URL = 'https://ubnjwhavibtyafyicrdv.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmp3aGF2aWJ0eWFmeWljcmR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMDcxNzUsImV4cCI6MjA5NzU4MzE3NX0.7_3fuNhchNVuLaM6cSzDoKWMAk4ZBZI1PuwMxxj1V8M';
    var _cloudSyncSeq = 0;
    var _orderHashes = {};

    /**
     * 将订单数据同步到 Supabase 云端数据库
     * @param {Array} orders - extractOrders() 的返回数组
     */
    window.syncOrdersToCloud = function(orders) {
        if (!orders || orders.length === 0) return;

        _cloudSyncSeq++;
        var seq = _cloudSyncSeq;
        var now = new Date().toISOString();

        // 去重：只同步内容有变化的订单
        var changedOrders = [];
        for (var i = 0; i < orders.length; i++) {
            var o = orders[i];
            var hash = o.orderNo + '|' + o.status + '|' + o.riderStatus + '|' + o.cookRemainingTime;
            if (_orderHashes[o.orderNo] !== hash) {
                _orderHashes[o.orderNo] = hash;
                changedOrders.push(o);
            }
        }
        if (changedOrders.length === 0) return;

        var orderRecords = changedOrders.map(function(o) {
            return {
                order_no: o.orderNo,
                platform: 'meituan',
                order_index: o.orderIndex,
                order_time: o.orderTime,
                deliver_time: o.deliverTime,
                customer_name: o.customerName,
                is_new_customer: o.isNewCustomer,
                customer_order_count: o.customerOrderCount,
                is_fav_customer: o.isFavCustomer,
                rider_status: o.riderStatus,
                status: o.status,
                status_text: o.statusText,
                cook_time: o.cookTime,
                suggested_cook_time: o.suggestedCookTime,
                suggested_cook_time_sec: o.suggestedCookTimeSec,
                is_pre_order: o.isPreOrder,
                suggested_cook_deadline: o.suggestedCookDeadline,
                phone_tail: o.phoneTail,
                remark: o.remark,
                estimated_income: o.estimatedIncome,
                delivery_type: o.deliveryType,
                is_flash_delivery: o.isFlashDelivery,
                rider_name: o.riderName,
                commission_rate: o.commissionRate,
                commission_amount: o.commissionAmount,
                delivery_subsidy: o.deliverySubsidy,
                order_discount: o.orderDiscount,
                pack_fee: o.packFee,
                cook_remaining_time: o.cookRemainingTime,
                buttons: o.buttons,
                raw_json: o,
                last_updated_at: now
            };
        });

        fetch(SUPABASE_URL + '/rest/v1/orders?on_conflict=order_no', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY,
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(orderRecords)
        }).then(function(res) {
            if (res.ok) {
                console.log('[cloud-sync #' + seq + '] orders upserted: ' + orderRecords.length);
            } else {
                console.warn('[cloud-sync #' + seq + '] orders upsert failed: HTTP ' + res.status);
            }
        }).catch(function(err) {
            console.warn('[cloud-sync #' + seq + '] orders request error: ' + err.message);
        });

        // 同步商品明细
        var productRecords = [];
        changedOrders.forEach(function(o) {
            (o.products || []).forEach(function(p) {
                productRecords.push({
                    order_no: o.orderNo,
                    name: p.name,
                    unit_price: p.unitPrice,
                    quantity: p.quantity,
                    total_price: p.totalPrice
                });
            });
        });

        if (productRecords.length > 0) {
            fetch(SUPABASE_URL + '/rest/v1/order_products?on_conflict=order_no,name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify(productRecords)
            }).then(function(res) {
                if (!res.ok) {
                    console.warn('[cloud-sync #' + seq + '] products upsert failed: HTTP ' + res.status);
                }
            }).catch(function(err) {
                console.warn('[cloud-sync #' + seq + '] products request error: ' + err.message);
            });
        }
    };

    /**
     * 记录订单状态变更事件到云端
     */
    window.syncOrderEvent = function(orderNo, fromStatus, toStatus) {
        if (!orderNo || !toStatus) return;

        fetch(SUPABASE_URL + '/rest/v1/order_events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                order_no: orderNo,
                from_status: fromStatus || null,
                to_status: toStatus
            })
        }).catch(function(err) {
            console.warn('[cloud-sync] event insert error: ' + err.message);
        });
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

        // 出餐后同步最新状态到云端
        if (count > 0) {
            setTimeout(function() {
                if (window.extractOrders && window.syncOrdersToCloud) {
                    window.syncOrdersToCloud(window.extractOrders());
                }
            }, count * intervalMs + 500);
        }

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

        // 出餐配置（默认：下单后240~300秒随机出餐）
        window.__cookConfig = window.__cookConfig || {
            strategy: 'after_order',
            afterOrderMinSec: 240,
            afterOrderMaxSec: 300,
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
        window.__orderStatusMap = {};

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

            // 唯一提取入口 —— 复用 window.extractOrders() 一次性抓全 27 字段
            var allOrders = window.extractOrders ? window.extractOrders() : null;
            if (!allOrders || allOrders.length === 0) return;

            // 云端同步（异步，不阻塞主循环）
            if (window.syncOrdersToCloud) window.syncOrdersToCloud(allOrders);

            var now = new Date().toLocaleTimeString();

            // 重置状态追踪（首次运行时）

            allOrders.forEach(function(order) {
                var orderNo = order.orderNo;
                if (!orderNo) return;
                var orderLabel = '#' + (order.orderIndex || '?') + ' ' + (order.customerName || '顾客');

                // 直接用 OrderData 字段,不再各自解析
                var currentStatus = order.status;
                var riderStatus = order.riderStatus;
                var prevStatus = window.__orderStatusMap[orderNo];
                var isNew = !(orderNo in window.__orderStatusMap);
                var statusChanged = prevStatus && prevStatus !== currentStatus;

                window.__knownOrders.add(orderNo);
                window.__orderStatusMap[orderNo] = currentStatus;

                // 同步状态变更事件到云端
                if (statusChanged && window.syncOrderEvent) {
                    window.syncOrderEvent(orderNo, prevStatus, currentStatus);
                }

                var isPendingCook = currentStatus === 'pending_cook';
                var cookLabel = { pending_cook: '待出餐', cooked: '已出餐', pending_accept: '待接单', delivered: '已送达', cancelled: '已取消' };

                // 状态变化：如果不再是待出餐，取消定时出餐
                if (statusChanged && !isPendingCook && window.__cookTimers[orderNo]) {
                    clearTimeout(window.__cookTimers[orderNo].timerId);
                    delete window.__cookTimers[orderNo];
                    panelLog('⏹️ ' + orderLabel + ' 状态变化为' + (cookLabel[currentStatus] || currentStatus) + '，取消定时出餐', 'gray');
                }

                // 新订单 或 状态变为"待出餐"
                if (isNew || (statusChanged && isPendingCook)) {
                    var statusLabel = cookLabel[currentStatus] || currentStatus;
                    var label = riderStatus ? statusLabel + ' | ' + riderStatus : statusLabel;
                    var reason = isNew ? '🆕 新订单' : '🔄 状态变化 → ' + label;
                    panelLog('🆕 新订单 #' + (order.orderIndex || '?') + ' ' + (order.customerName || ''), 'blue');

                    // 输出该订单的完整数据
                    console.log('%c📦 订单详情：', 'color: #667eea; font-weight: bold;');
                    console.log(JSON.stringify(order, null, 2));

                    if (isPendingCook) {
                        panelLog('🔴🔴🔴 发现待出餐订单！', 'red');

                        // 自动出餐定时器
                        if (!window.__cookTimers[orderNo]) {
                            var config = window.__cookConfig;
                            // 复用 OrderData 字段
                            var suggestedSec = order.suggestedCookTimeSec || 0;
                            var remainingSec = parseTimeToSeconds(order.cookRemainingTime);
                            var isPreOrder = !!order.isPreOrder;
                            var suggestedCookDeadline = order.suggestedCookDeadline || '';
                            var deadlineDate = null;

                            // 解析建议出餐时间为 Date（用于预订单的绝对时间计算）
                            if (suggestedCookDeadline) {
                                var parts = suggestedCookDeadline.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                                if (parts) {
                                    var nowD = new Date();
                                    deadlineDate = new Date(nowD.getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]));
                                }
                            }

                            // 计算已用时
                            var elapsedSec = suggestedSec > 0 ? suggestedSec - remainingSec : 0;

                            // 预订单处理：建议出餐时间前20分钟视为虚拟下单时间(给骑手早来留提前量)
                            if (isPreOrder && deadlineDate && remainingSec === 0) {
                                var preOrderVirtualStart = new Date(deadlineDate.getTime() - 20 * 60 * 1000);
                                if (Date.now() < preOrderVirtualStart.getTime()) {
                                    elapsedSec = 0;
                                } else {
                                    elapsedSec = Math.round((Date.now() - preOrderVirtualStart.getTime()) / 1000);
                                }
                            }

                            // 计算延迟
                            var delay;
                            var delayDesc;
                            if (config.strategy === 'manual') {
                                panelLog('🖐️ ' + orderLabel + ' 手动出餐模式，等待人工操作', 'gray');
                            } else if (config.strategy === 'before_deadline') {
                                var bdMinSec = Math.min(config.beforeDeadlineMinSec, config.beforeDeadlineMaxSec);
                                var bdMaxSec = Math.max(config.beforeDeadlineMinSec, config.beforeDeadlineMaxSec);
                                var bdSec = bdMinSec + Math.round(Math.random() * (bdMaxSec - bdMinSec));
                                if (remainingSec > 0) {
                                    delay = Math.max(1000, (remainingSec - bdSec) * 1000);
                                } else if (deadlineDate) {
                                    delay = Math.max(1000, deadlineDate.getTime() - Date.now() - bdSec * 1000);
                                } else {
                                    delay = 1000;
                                }
                                delayDesc = '建议出餐前' + config.beforeDeadlineMinSec + '~' + config.beforeDeadlineMaxSec + '秒';
                            } else {
                                var aoMinSec = Math.min(config.afterOrderMinSec, config.afterOrderMaxSec);
                                var aoMaxSec = Math.max(config.afterOrderMinSec, config.afterOrderMaxSec);
                                if (isPreOrder && deadlineDate && remainingSec === 0) {
                                    var preOrderVirtualStart = new Date(deadlineDate.getTime() - 20 * 60 * 1000);
                                    var targetSec = aoMinSec + Math.round(Math.random() * (aoMaxSec - aoMinSec));
                                    var virtualDelayMs = targetSec * 1000;
                                    delay = Math.max(1000, preOrderVirtualStart.getTime() + virtualDelayMs - Date.now());
                                } else {
                                    var targetSec = aoMinSec + Math.round(Math.random() * (aoMaxSec - aoMinSec));
                                    delay = Math.max(1000, (targetSec - elapsedSec) * 1000);
                                }
                                delayDesc = '下单后' + config.afterOrderMinSec + '~' + config.afterOrderMaxSec + '秒';
                            }

                            if (config.strategy !== 'manual') {
                                var targetTime = new Date(Date.now() + delay);
                                var delaySec = Math.round(delay / 1000); if (delay <= 1000) { panelLog('⚠️ ' + orderLabel + ' 出餐时间已过或即将到达，立即出餐', 'orange'); }

                                (function(no, label) {
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
                                                        panelLog('✅ 已自动出餐: ' + label, 'green');
                                                        break;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                        delete window.__cookTimers[no];
                                    }, delay);

                                    window.__cookTimers[no] = { timerId: timerId, targetTime: targetTime, delay: delay, delayDesc: delayDesc, deadline: suggestedCookDeadline };

                                    var minStr = Math.floor(delaySec / 60);
                                    var secStr = delaySec % 60;
                                    panelLog('⏰ ' + label + ' 将在 ' + (minStr > 0 ? minStr + '分' : '') + secStr + '秒后自动出餐（' + targetTime.toLocaleTimeString() + '）', 'orange');
                                    if (isPreOrder && deadlineDate) {
                                        panelLog('   📋 预订单 | 建议出餐 ' + suggestedCookDeadline + ' | 策略: ' + delayDesc, 'blue');
                                    } else if (suggestedSec > 0 && remainingSec > 0) {
                                        panelLog('   建议时长 ' + suggestedSec + '秒 | 已用 ' + elapsedSec + '秒 | 剩余 ' + remainingSec + '秒', 'gray');
                                    }
                                })(orderNo, orderLabel);
                            }
                        }
                    }
                }
            });

            // 心跳提示 —— 用 allOrders 统计,不再二次扫 cards
            if (window.__monitorCheckCount % 6 === 1) {
                var pendingCount = allOrders.filter(function(o) { return o.status === 'pending_cook'; }).length;
                var emoji = pendingCount > 0 ? '🔴' : '✅';
                var timerCount = window.__cookTimers ? Object.keys(window.__cookTimers).length : 0;
                var timerInfo = timerCount > 0 ? ' | ⏰ 待出餐 ' + timerCount + ' 单' : '';
                panelLog(emoji + ' 监控中 | 已知 ' + window.__knownOrders.size + ' 单 | 待出餐 ' + pendingCount + ' 单' + timerInfo, 'gray', 'heartbeat');
            }
        }

        // 初始化已知订单 —— 复用 extractOrders,不再二次扫 DOM + 正则
        var initOrders = window.extractOrders ? window.extractOrders() : null;
        if (initOrders && initOrders.length) {
            initOrders.forEach(function(o) { if (o.orderNo) window.__knownOrders.add(o.orderNo); });
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
            window.__orderStatusMap = {};
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
            '.waimai-detail-toggle { font-size: 10px; color: #667eea; cursor: pointer; margin-left: auto; white-space: nowrap; user-select: none; }',
            '.waimai-detail-toggle:hover { color: #8b9cf7; }',
            '.waimai-order-debug { font-size: 11px; color: #888; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; display: none; }',
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
            '.waimai-log-tabs { display: flex; gap: 2px; margin-bottom: 6px; }',
            '.waimai-log-tab { font-size: 11px; padding: 2px 10px; border-radius: 3px; cursor: pointer; color: #888; background: rgba(255,255,255,0.05); }',
            '.waimai-log-tab:hover { color: #ccc; }',
            '.waimai-log-tab.active { color: #fff; background: rgba(102,126,234,0.3); }',
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
