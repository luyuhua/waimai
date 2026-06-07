/**
 * @file 美团商家版 - 新订单监控脚本
 * @description 在控制台中运行，自动监控新订单并抓取"待出餐"状态的按钮结构
 * @usage 复制到美团商家版控制台执行：monitorNewOrders()
 */

// ==================== 使用说明 ====================
//
// 1. 打开美团商家版订单页面
// 2. F12 打开控制台
// 3. 粘贴此脚本并回车
// 4. 脚本会每5秒检查一次新订单
// 5. 发现"待出餐"订单时，自动抓取按钮结构并输出
// 6. 可选：设置 autoCook=true 自动点击出餐按钮
//
// 控制命令：
//   stopMonitor()     - 停止监控
//   forceCheck()      - 立即检查一次
//   autoCook = true   - 开启自动出餐（默认关闭）
//   autoCook = false  - 关闭自动出餐
//

let _monitorTimer = null;
let _knownOrders = new Set();
let autoCook = false; // 是否自动出餐，默认关闭

/**
 * 进入 iframe 获取 document
 */
function getIframeDoc() {
    if (window.self !== window.top) return document;
    const iframe = document.getElementById('hashframe');
    if (!iframe) return null;
    try {
        return iframe.contentDocument || iframe.contentWindow.document;
    } catch (e) {
        return null;
    }
}

// ======== 按钮查找辅助函数 ========
// 出餐按钮可能是 <button> 或 <div class="submit-button_xxx">，需要同时查找
function getCardButtons(card) {
    var btns = Array.from(card.querySelectorAll('button'));
    var divBtns = Array.from(card.querySelectorAll('div[class*="submit-button"]'));
    return btns.concat(divBtns);
}

/**
 * 提取订单数据（含按钮详细结构）
 */
function extractOrdersWithButtons() {
    const doc = getIframeDoc();
    if (!doc) return [];

    const cards = doc.querySelectorAll('[class*="order-card"]');
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

        // 订单状态
        if (allText.includes('待出餐')) data.status = 'pending_cook';
        else if (allText.includes('待接单')) data.status = 'pending_accept';
        else if (allText.includes('已出餐')) data.status = 'cooked';
        else if (allText.includes('配送中')) data.status = 'delivering';
        else if (allText.includes('已送达') || allText.includes('用户已收餐')) data.status = 'delivered';
        else if (allText.includes('已取消')) data.status = 'cancelled';
        else data.status = 'unknown';

        // 出餐用时
        const cookTimeMatch = allText.match(/用时(\d{2}):(\d{2})/);
        data.cookTime = cookTimeMatch ? `${cookTimeMatch[1]}:${cookTimeMatch[2]}` : '';

        // 建议出餐时长
        const suggestMatch = allText.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
        data.suggestedCookTime = suggestMatch ? `${suggestMatch[1]}分${suggestMatch[2]}秒` : '';

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

        // ====== 关键：按钮完整结构（包括 <button> 和出餐 <div>）======
        const buttons = getCardButtons(card);
        data.buttons = [];
        for (const btn of buttons) {
            data.buttons.push({
                text: btn.innerText.trim(),
                type: btn.type || '',
                className: btn.className || '',
                tag: btn.tagName.toLowerCase(),
                disabled: btn.disabled,
                id: btn.id || '',
                ariaLabel: btn.getAttribute('aria-label') || '',
                role: btn.getAttribute('role') || '',
                dataset: Object.assign({}, btn.dataset),
                // 在卡片中是第几个按钮（用于位置定位）
                indexInCard: Array.from(buttons).indexOf(btn)
            });
        }

        // 额外：查找非 button/div.submit-button 的可点击元素
        const allClickable = card.querySelectorAll('[onclick], [role="button"], [class*="btn"], [class*="button"]');
        data.allClickableElements = [];
        for (const el of allClickable) {
            // 跳过已被 getCardButtons 捕获的 button 和 submit-button div
            if (el.tagName === 'BUTTON' || (el.tagName === 'DIV' && /submit-button/.test(el.className))) {
                continue;
            }
            data.allClickableElements.push({
                    tag: el.tagName,
                    text: (el.innerText || '').trim().substring(0, 50),
                    className: el.className?.substring(0, 100) || '',
                    role: el.getAttribute('role') || ''
                });
            }
        }

        orders.push(data);
    }

    return orders;
}

/**
 * 检查新订单
 */
function checkForNewOrders() {
    const now = new Date().toLocaleTimeString();
    const orders = extractOrdersWithButtons();

    if (!orders || orders.length === 0) return;

    // 筛选待出餐订单
    const pendingOrders = orders.filter(o => o.status === 'pending_cook');

    for (const order of orders) {
        if (!_knownOrders.has(order.orderNo)) {
            _knownOrders.add(order.orderNo);

            const statusEmoji = {
                'pending_cook': '🔴', 'pending_accept': '🟡',
                'cooked': '🟢', 'delivering': '🚴',
                'delivered': '✅', 'cancelled': '❌'
            };

            console.log(
                `%c${statusEmoji[order.status] || '❓'} 新订单 #%s %s %s - %s`,
                'font-weight: bold; font-size: 14px;',
                order.orderIndex, order.orderTime, order.customerName, order.status
            );

            // 如果是待出餐订单，输出完整的按钮结构
            if (order.status === 'pending_cook') {
                console.log('%c🔴🔴🔴 发现待出餐订单！按钮结构如下：', 'color: red; font-size: 16px; font-weight: bold;');
                console.log(JSON.stringify(order.buttons, null, 2));
                if (order.cookRemainingTime) {
                    console.log('%c⏱️ 出餐剩余时间: ' + order.cookRemainingTime, 'color: #f59e0b; font-size: 14px; font-weight: bold;');
                }
                if (order.allClickableElements && order.allClickableElements.length > 0) {
                    console.log('%c⚠️ 还发现非 button 的可点击元素：', 'color: orange; font-weight: bold;');
                    console.log(JSON.stringify(order.allClickableElements, null, 2));
                }

                // 自动出餐
                if (autoCook) {
                    const doc = getIframeDoc();
                    const cards = doc.querySelectorAll('[class*="order-card"]');
                    for (const card of cards) {
                        const text = card.innerText || '';
                        if (text.includes(order.orderNo)) {
                            const btns = getCardButtons(card);
                            for (const btn of btns) {
                                var btnText = btn.innerText.trim();
                                if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
                                    setTimeout(() => {
                                        btn.click();
                                        console.log(`✅ 已自动出餐: 订单 ${order.orderNo}`);
                                    }, 1000);
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // 状态提示（每 30 秒输出一次）
    _checkCount = (_checkCount || 0) + 1;
    if (_checkCount % 6 === 1) { // 每 6 次检查（约 30 秒）输出一次
        const pending = orders.filter(o => o.status === 'pending_cook');
        const statusEmoji = pending.length > 0 ? '🔴' : '✅';
        console.log(`%c${statusEmoji} [${now}] 监控中... 已知 ${_knownOrders.size} 单 | 待出餐 ${pending.length} 单`, 'color: #888;');
    }
}

/**
 * 启动监控
 */
function monitorNewOrders(intervalMs = 5000) {
    if (_monitorTimer) {
        console.log('⚠️ 监控已在运行中');
        return;
    }

    // 初始化已知订单
    const initial = extractOrdersWithButtons();
    if (initial) {
        initial.forEach(o => _knownOrders.add(o.orderNo));
        console.log(`%c📋 已知 ${_knownOrders.size} 个订单，开始监控...`, 'color: #667eea; font-size: 14px; font-weight: bold;');
        console.log('%c🔍 每 5 秒检查一次新订单', 'color: #888;');
        console.log('%c💡 设置 autoCook = true 可自动出餐', 'color: #f59e0b;');
        console.log('%c💡 执行 stopMonitor() 停止监控', 'color: #888;');
    }

    _monitorTimer = setInterval(checkForNewOrders, intervalMs);
}

/**
 * 停止监控
 */
function stopMonitor() {
    if (_monitorTimer) {
        clearInterval(_monitorTimer);
        _monitorTimer = null;
        console.log('%c⏹️ 监控已停止', 'color: #888; font-size: 14px;');
    }
}

/**
 * 立即检查一次（不开启定时器）
 */
function forceCheck() {
    const orders = extractOrdersWithButtons();
    if (orders) {
        const pending = orders.filter(o => o.status === 'pending_cook');
        console.log(`%c当前 ${orders.length} 单，待出餐 ${pending.length} 单`, 'color: #667eea; font-size: 14px;');
        if (pending.length > 0) {
            console.log('%c🔴 待出餐订单按钮结构：', 'color: red; font-weight: bold;');
            pending.forEach(o => {
                console.log(`订单 ${o.orderNo} 按钮:`, o.buttons);
            });
        }
    }
}

// 自动启动
monitorNewOrders();