/**
 * @file DOM 结构化数据提取器 - Bookmarklet 版本
 * @description 作为浏览器书签使用，自动提取并打印页面结构化数据
 * @usage 将此文件部署到 CDN，然后创建书签：
 *        javascript:(function(){var s=document.createElement('script');s.src='URL';document.body.appendChild(s);})();
 */

(function() {
    'use strict';

    // 防止重复执行
    if (window.__domExtractorLoaded) {
        console.log('🔄 domExtractor 已加载，重新执行提取...');
        const result = window.domExtractor({ viewportExpansion: -1 });
        printResults(result);
        return;
    }
    window.__domExtractorLoaded = true;

    console.log('%c🛵 美团外卖自动出餐助手 - DOM 提取工具', 'color: #667eea; font-size: 20px; font-weight: bold;');
    console.log('%c基于 page-agent 开源项目', 'color: #888; font-size: 12px;');
    console.log('');

    // ==================== 核心 DOM 提取代码 ====================

    window.domExtractor = function(args = {}) {
        const config = {
            doHighlightElements: args.doHighlightElements ?? true,
            focusHighlightIndex: args.focusHighlightIndex ?? -1,
            viewportExpansion: args.viewportExpansion ?? -1,
            debugMode: args.debugMode ?? false,
            interactiveBlacklist: args.interactiveBlacklist ?? [],
            interactiveWhitelist: args.interactiveWhitelist ?? [],
            highlightOpacity: args.highlightOpacity ?? 0.1,
            highlightLabelOpacity: args.highlightLabelOpacity ?? 0.5,
        };

        const {
            interactiveBlacklist,
            interactiveWhitelist,
            highlightOpacity,
            highlightLabelOpacity,
            doHighlightElements,
            focusHighlightIndex,
            viewportExpansion,
            debugMode
        } = config;

        let highlightIndex = 0;

        const extraData = new WeakMap();
        function addExtraData(element, data) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
            extraData.set(element, { ...extraData.get(element), ...data });
        }

        const DOM_CACHE = {
            boundingRects: new WeakMap(),
            clientRects: new WeakMap(),
            computedStyles: new WeakMap(),
            clearCache: () => {
                DOM_CACHE.boundingRects = new WeakMap();
                DOM_CACHE.clientRects = new WeakMap();
                DOM_CACHE.computedStyles = new WeakMap();
            },
        };

        function getCachedBoundingRect(element) {
            if (!element) return null;
            if (DOM_CACHE.boundingRects.has(element)) return DOM_CACHE.boundingRects.get(element);
            const rect = element.getBoundingClientRect();
            if (rect) DOM_CACHE.boundingRects.set(element, rect);
            return rect;
        }

        function getCachedComputedStyle(element) {
            if (!element) return null;
            if (DOM_CACHE.computedStyles.has(element)) return DOM_CACHE.computedStyles.get(element);
            const style = window.getComputedStyle(element);
            if (style) DOM_CACHE.computedStyles.set(element, style);
            return style;
        }

        function getCachedClientRects(element) {
            if (!element) return null;
            if (DOM_CACHE.clientRects.has(element)) return DOM_CACHE.clientRects.get(element);
            const rects = element.getClientRects();
            if (rects) DOM_CACHE.clientRects.set(element, rects);
            return rects;
        }

        const DOM_HASH_MAP = {};
        const ID = { current: 0 };
        const HIGHLIGHT_CONTAINER_ID = 'dom-extractor-highlight';

        function highlightElement(element, index, parentIframe = null) {
            if (!element) return index;

            try {
                let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
                if (!container) {
                    container = document.createElement('div');
                    container.id = HIGHLIGHT_CONTAINER_ID;
                    container.style.position = 'fixed';
                    container.style.pointerEvents = 'none';
                    container.style.top = '0';
                    container.style.left = '0';
                    container.style.width = '100%';
                    container.style.height = '100%';
                    container.style.zIndex = '2147483640';
                    container.style.backgroundColor = 'transparent';
                    document.body.appendChild(container);
                }

                const rects = element.getClientRects();
                if (!rects || rects.length === 0) return index;

                const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080', '#008080', '#FF69B4', '#4B0082', '#FF4500', '#2E8B57', '#DC143C', '#4682B4'];
                const colorIndex = index % colors.length;
                let baseColor = colors[colorIndex];

                const backgroundColor = baseColor + Math.floor(highlightOpacity * 255).toString(16).padStart(2, '0');
                baseColor = baseColor + Math.floor(highlightLabelOpacity * 255).toString(16).padStart(2, '0');

                let iframeOffset = { x: 0, y: 0 };
                if (parentIframe) {
                    const iframeRect = parentIframe.getBoundingClientRect();
                    iframeOffset.x = iframeRect.left;
                    iframeOffset.y = iframeRect.top;
                }

                const fragment = document.createDocumentFragment();

                for (const rect of rects) {
                    if (rect.width === 0 || rect.height === 0) continue;
                    const overlay = document.createElement('div');
                    overlay.style.position = 'fixed';
                    overlay.style.border = `2px solid ${baseColor}`;
                    overlay.style.backgroundColor = backgroundColor;
                    overlay.style.pointerEvents = 'none';
                    overlay.style.boxSizing = 'border-box';
                    overlay.style.top = `${rect.top + iframeOffset.y}px`;
                    overlay.style.left = `${rect.left + iframeOffset.x}px`;
                    overlay.style.width = `${rect.width}px`;
                    overlay.style.height = `${rect.height}px`;
                    fragment.appendChild(overlay);
                }

                const firstRect = rects[0];
                const label = document.createElement('div');
                label.className = 'dom-extractor-label';
                label.style.position = 'fixed';
                label.style.background = baseColor;
                label.style.color = 'white';
                label.style.padding = '2px 6px';
                label.style.borderRadius = '4px';
                label.style.fontSize = '12px';
                label.style.fontWeight = 'bold';
                label.textContent = index.toString();

                let labelTop = firstRect.top + iframeOffset.y + 2;
                let labelLeft = firstRect.left + iframeOffset.x + firstRect.width - 30;

                if (firstRect.width < 30) {
                    labelTop = firstRect.top + iframeOffset.y - 20;
                    labelLeft = firstRect.left + iframeOffset.x;
                }

                label.style.top = `${Math.max(0, labelTop)}px`;
                label.style.left = `${Math.max(0, labelLeft)}px`;

                fragment.appendChild(label);
                container.appendChild(fragment);

                return index + 1;
            } catch (e) {
                return index;
            }
        }

        function isScrollableElement(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
            const style = getCachedComputedStyle(element);
            if (!style) return null;
            if (style.display === 'inline' || style.display === 'inline-block') return null;
            const scrollableX = style.overflowX === 'auto' || style.overflowX === 'scroll';
            const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll';
            if (!scrollableX && !scrollableY) return null;
            const scrollWidth = element.scrollWidth - element.clientWidth;
            const scrollHeight = element.scrollHeight - element.clientHeight;
            if (scrollWidth < 4 && scrollHeight < 4) return null;
            return { top: element.scrollTop, left: element.scrollLeft, right: scrollWidth - element.scrollLeft, bottom: scrollHeight - element.scrollTop };
        }

        function isElementAccepted(element) {
            if (!element || !element.tagName) return false;
            const alwaysAccept = new Set(['body', 'div', 'main', 'article', 'section', 'nav', 'header', 'footer']);
            if (alwaysAccept.has(element.tagName.toLowerCase())) return true;
            const leafElementDenyList = new Set(['svg', 'script', 'style', 'link', 'meta', 'noscript', 'template']);
            return !leafElementDenyList.has(element.tagName.toLowerCase());
        }

        function isElementVisible(element) {
            const style = getCachedComputedStyle(element);
            return element.offsetWidth > 0 && element.offsetHeight > 0 && style?.visibility !== 'hidden' && style?.display !== 'none';
        }

        function isInteractiveElement(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            if (interactiveBlacklist.includes(element)) return false;
            if (interactiveWhitelist.includes(element)) return true;
            const tagName = element.tagName.toLowerCase();
            const style = getCachedComputedStyle(element);
            const interactiveCursors = new Set(['pointer', 'move', 'text', 'grab', 'grabbing', 'cell', 'copy']);
            if (style?.cursor && interactiveCursors.has(style.cursor)) return true;
            const interactiveElements = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label', 'option']);
            if (interactiveElements.has(tagName)) {
                if (element.disabled || element.readOnly || element.inert) return false;
                return true;
            }
            if (element.getAttribute('contenteditable') === 'true' || element.isContentEditable) return true;
            if (element.classList?.contains('button') || element.getAttribute('data-toggle') === 'dropdown') return true;
            const interactiveRoles = new Set(['button', 'menu', 'menuitem', 'checkbox', 'tab', 'switch', 'slider', 'combobox', 'textbox', 'listbox']);
            const role = element.getAttribute('role');
            if (role && interactiveRoles.has(role)) return true;
            if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;
            if (isScrollableElement(element)) return true;
            return false;
        }

        function isTopElement(element) {
            if (viewportExpansion === -1) return true;
            const rects = getCachedClientRects(element);
            if (!rects || rects.length === 0) return false;
            let rect = Array.from(rects).find(r => r.width > 0 && r.height > 0);
            if (!rect) return false;
            const checkPoints = [
                { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                { x: rect.left + 5, y: rect.top + 5 },
            ];
            return checkPoints.some(({ x, y }) => {
                try {
                    const topEl = document.elementFromPoint(x, y);
                    if (!topEl) return false;
                    let current = topEl;
                    while (current && current !== document.documentElement) {
                        if (current === element) return true;
                        current = current.parentElement;
                    }
                    return false;
                } catch (e) {
                    return true;
                }
            });
        }

        function isInExpandedViewport(element, viewportExpansion) {
            if (viewportExpansion === -1) return true;
            const rects = element.getClientRects();
            if (!rects || rects.length === 0) return false;
            for (const rect of rects) {
                if (rect.width === 0 || rect.height === 0) continue;
                if (!(rect.bottom < -viewportExpansion || rect.top > window.innerHeight + viewportExpansion || rect.right < -viewportExpansion || rect.left > window.innerWidth + viewportExpansion)) return true;
            }
            return false;
        }

        const INTERACTIVE_ARIA_ATTRS = ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-haspopup'];
        function hasInteractiveAria(el) {
            for (const attr of INTERACTIVE_ARIA_ATTRS) {
                if (el.hasAttribute(attr)) return true;
            }
            return false;
        }

        function isInteractiveCandidate(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            const tagName = element.tagName.toLowerCase();
            const interactiveElements = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label']);
            if (interactiveElements.has(tagName)) return true;
            return element.hasAttribute('onclick') || element.hasAttribute('role') || element.hasAttribute('tabindex') || hasInteractiveAria(element);
        }

        const DISTINCT_INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label']);
        const DISTINCT_INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'checkbox', 'tab', 'switch']);

        function isElementDistinctInteraction(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute('role');
            if (DISTINCT_INTERACTIVE_TAGS.has(tagName)) return true;
            if (role && DISTINCT_INTERACTIVE_ROLES.has(role)) return true;
            if (element.isContentEditable) return true;
            if (element.hasAttribute('onclick')) return true;
            if (hasInteractiveAria(element)) return true;
            return false;
        }

        function handleHighlighting(nodeData, node, parentIframe, isParentHighlighted) {
            if (!nodeData.isInteractive) return false;
            let shouldHighlight = !isParentHighlighted || isElementDistinctInteraction(node);
            if (shouldHighlight) {
                nodeData.isInViewport = isInExpandedViewport(node, viewportExpansion);
                if (nodeData.isInViewport || viewportExpansion === -1) {
                    nodeData.highlightIndex = highlightIndex++;
                    if (doHighlightElements) {
                        highlightElement(node, nodeData.highlightIndex, parentIframe);
                    }
                    return true;
                }
            }
            return false;
        }

        function buildDomTree(node, parentIframe = null, isParentHighlighted = false) {
            if (!node || node.id === HIGHLIGHT_CONTAINER_ID || (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE)) return null;
            if (node.dataset?.browserUseIgnore === 'true' || node.dataset?.pageAgentIgnore === 'true') return null;
            if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return null;

            if (node === document.body) {
                const nodeData = { tagName: 'body', attributes: {}, children: [] };
                for (const child of node.childNodes) {
                    const domElement = buildDomTree(child, parentIframe, false);
                    if (domElement) nodeData.children.push(domElement);
                }
                const id = `${ID.current++}`;
                DOM_HASH_MAP[id] = nodeData;
                return id;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const textContent = node.textContent?.trim();
                if (!textContent) return null;
                const parentElement = node.parentElement;
                if (!parentElement || parentElement.tagName.toLowerCase() === 'script') return null;
                const id = `${ID.current++}`;
                DOM_HASH_MAP[id] = { type: 'TEXT_NODE', text: textContent };
                return id;
            }

            if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) return null;

            const nodeData = { tagName: node.tagName.toLowerCase(), attributes: {}, children: [] };

            if (isInteractiveCandidate(node) || node.tagName.toLowerCase() === 'iframe' || node.tagName.toLowerCase() === 'body') {
                const attributeNames = node.getAttributeNames?.() || [];
                for (const name of attributeNames) {
                    nodeData.attributes[name] = node.getAttribute(name);
                }
                if (node.tagName.toLowerCase() === 'input' && (node.type === 'checkbox' || node.type === 'radio')) {
                    nodeData.attributes.checked = node.checked ? 'true' : 'false';
                }
            }

            let nodeWasHighlighted = false;
            if (node.nodeType === Node.ELEMENT_NODE) {
                nodeData.isVisible = isElementVisible(node);
                if (nodeData.isVisible) {
                    nodeData.isTopElement = isTopElement(node);
                    if (nodeData.isTopElement) {
                        nodeData.isInteractive = isInteractiveElement(node);
                        nodeWasHighlighted = handleHighlighting(nodeData, node, parentIframe, isParentHighlighted);
                        nodeData.ref = node;
                    }
                }
            }

            if (node.tagName) {
                const tagName = node.tagName.toLowerCase();
                if (tagName === 'iframe') {
                    try {
                        const iframeDoc = node.contentDocument || node.contentWindow?.document;
                        if (iframeDoc) {
                            for (const child of iframeDoc.childNodes) {
                                const domElement = buildDomTree(child, node, false);
                                if (domElement) nodeData.children.push(domElement);
                            }
                        }
                    } catch (e) {}
                } else {
                    if (node.shadowRoot) {
                        nodeData.shadowRoot = true;
                        for (const child of node.shadowRoot.childNodes) {
                            const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted);
                            if (domElement) nodeData.children.push(domElement);
                        }
                    }
                    for (const child of node.childNodes) {
                        const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted);
                        if (domElement) nodeData.children.push(domElement);
                    }
                }
            }

            if (nodeData.tagName === 'a' && nodeData.children.length === 0 && !nodeData.attributes.href) {
                const rect = getCachedBoundingRect(node);
                const hasSize = (rect && rect.width > 0 && rect.height > 0) || node.offsetWidth > 0 || node.offsetHeight > 0;
                if (!hasSize) return null;
            }

            const id = `${ID.current++}`;
            DOM_HASH_MAP[id] = nodeData;
            return id;
        }

        const rootId = buildDomTree(document.body);
        DOM_CACHE.clearCache();
        return { rootId, map: DOM_HASH_MAP };
    };

    // ==================== 辅助函数 ====================

    window.getInteractiveElements = function(map) {
        const interactive = [];
        for (const [id, node] of Object.entries(map)) {
            if (node.isInteractive && node.highlightIndex !== undefined) {
                interactive.push({
                    id,
                    index: node.highlightIndex,
                    tagName: node.tagName,
                    text: (node.ref?.innerText?.trim() || '').slice(0, 50),
                    className: node.attributes?.class || '',
                    id_attr: node.attributes?.id || '',
                    ref: node.ref,
                });
            }
        }
        return interactive.sort((a, b) => a.index - b.index);
    };

    window.findElementByText = function(map, text) {
        for (const [id, node] of Object.entries(map)) {
            if (node.ref?.innerText?.includes(text)) {
                return { id, node };
            }
        }
        return null;
    };

    window.findElementByIndex = function(map, index) {
        for (const [id, node] of Object.entries(map)) {
            if (node.highlightIndex === index) {
                return { id, node };
            }
        }
        return null;
    };

    window.clearHighlights = function() {
        const container = document.getElementById('dom-extractor-highlight');
        if (container) container.remove();
    };

    // ==================== 结果打印 ====================

    function printResults(result) {
        const interactive = getInteractiveElements(result.map);

        console.log('');
        console.log('%c📊 提取结果', 'color: #667eea; font-size: 16px; font-weight: bold;');
        console.log('%c────────────────────────────────────', 'color: #ddd;');
        console.log(`  📄 总节点数: ${Object.keys(result.map).length}`);
        console.log(`  🎯 可交互元素: ${interactive.length}`);
        console.log('');

        if (interactive.length > 0) {
            console.log('%c🎯 可交互元素列表:', 'color: #667eea; font-weight: bold;');
            console.table(interactive.map(item => ({
                '索引': item.index,
                '标签': item.tagName,
                '文本': item.text || '(无)',
                'class': item.className || '-',
                'id': item.id_attr || '-',
            })));

            console.log('');
            console.log('%c💡 使用示例:', 'color: #667eea; font-weight: bold;');
            console.log('%c// 点击第 N 个元素', 'color: #888;');
            console.log(`findElementByIndex(result.map, 0).node.ref.click();`);
            console.log('');
            console.log('%c// 查找包含文本的元素', 'color: #888;');
            console.log(`findElementByText(result.map, '按钮文本').node.ref.click();`);
            console.log('');
            console.log('%c// 清除高亮', 'color: #888;');
            console.log(`clearHighlights();`);
        }

        // 保存到全局变量
        window.__domResult = result;
        window.__interactiveElements = interactive;

        // 美团订单提取
        const orders = window.extractOrders ? window.extractOrders() : null;
        if (orders && orders.length > 0) {
            const statusMap = {
                'pending_cook': '🔴 待出餐', 'pending_accept': '🟡 待接单',
                'cooked': '🟢 已出餐', 'delivering': '🚴 配送中',
                'delivered': '✅ 已送达', 'cancelled': '❌ 已取消', 'unknown': '❓ 未知'
            };

            console.log('');
            console.log('%c📦 美团订单数据（共 ' + orders.length + ' 单，从新到旧）', 'color: #667eea; font-size: 16px; font-weight: bold;');
            console.log('%c────────────────────────────────────', 'color: #ddd;');

            // 简洁表格输出
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
            console.log('%c💾 订单数据已保存:', 'color: #667eea;');
            console.log('  - window.__orders (完整订单JSON)');

            // 输出完整 JSON
            console.log('');
            console.log('%c📋 完整订单 JSON:', 'color: #667eea; font-weight: bold;');
            console.log(JSON.stringify(orders, null, 2));
        }

        console.log('');
        console.log('%c💾 DOM 数据已保存到全局变量:', 'color: #667eea;');
        console.log('  - window.__domResult (完整结果)');
        console.log('  - window.__interactiveElements (可交互元素)');
        if (orders) console.log('  - window.__orders (美团订单)');
    }

    // 挂载到全局，供 loader 重复执行时调用
    window.printResults = printResults;

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

            // 建议出餐时长
            const suggestMatch = allText.match(/建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒/);
            data.suggestedCookTime = suggestMatch ? `${suggestMatch[1]}分${suggestMatch[2]}秒` : '';

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
    window.monitorOrders = function(intervalMs, autoCook) {
        intervalMs = intervalMs || 5000;
        autoCook = autoCook || false;

        // 停止之前的监控
        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
        }
        window.__knownOrders = window.__knownOrders || new Set();
        window.__autoCookEnabled = autoCook;
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

                            // 计算延迟
                            var delay;
                            var delayDesc;
                            if (config.strategy === 'immediate') {
                                delay = 1000;
                                delayDesc = '立即出餐';
                            } else if (config.strategy === 'before_deadline') {
                                delay = Math.max(1000, (remainingSec - config.beforeDeadlineSec) * 1000);
                                delayDesc = '建议出餐前' + config.beforeDeadlineSec + '秒';
                            } else {
                                // after_order: 下单后N分钟，已用时需扣除
                                var targetMin = config.minDelayMin + Math.random() * (config.maxDelayMin - config.minDelayMin);
                                var targetSec = Math.round(targetMin * 60);
                                var remainDelay = Math.max(1000, (targetSec - elapsedSec) * 1000);
                                delay = remainDelay;
                                delayDesc = '下单后' + config.minDelayMin + '~' + config.maxDelayMin + '分钟';
                            }

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
                                if (suggestedSec > 0) {
                                    panelLog('   建议时长 ' + suggestedSec + '秒 | 已用 ' + elapsedSec + '秒 | 剩余 ' + remainingSec + '秒', 'gray');
                                }
                            })(orderNo);
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
                var timerCount = Object.keys(window.__cookTimers).length;
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
        var strategyDesc = config.strategy === 'immediate' ? '立即出餐' :
                          config.strategy === 'before_deadline' ? '建议出餐前' + config.beforeDeadlineSec + '秒' :
                          '下单后' + config.minDelayMin + '~' + config.maxDelayMin + '分钟';
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
            '.waimai-strategy input[type="number"] { width: 40px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; padding: 2px 4px; font-size: 13px; text-align: center; }',
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
            '    <label><input type="radio" name="waimai-strategy" value="after_order" checked> 下单后 <input type="number" id="waimai-min-delay" value="2" min="0" max="30" style="width:36px">~<input type="number" id="waimai-max-delay" value="3" min="0" max="30" style="width:36px"> 分钟</label>',
            '    <label><input type="radio" name="waimai-strategy" value="before_deadline"> 建议出餐前 <input type="number" id="waimai-before-sec" value="30" min="0" max="600" style="width:46px"> 秒</label>',
            '    <label><input type="radio" name="waimai-strategy" value="immediate"> 立即出餐</label>',
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
                window.__cookConfig = window.__cookConfig || {};
                window.__cookConfig.strategy = this.value;
            });
        });
        var minInput = document.getElementById('waimai-min-delay');
        var maxInput = document.getElementById('waimai-max-delay');
        var beforeInput = document.getElementById('waimai-before-sec');
        if (minInput) minInput.addEventListener('change', function() { window.__cookConfig.minDelayMin = parseFloat(this.value) || 2; });
        if (maxInput) maxInput.addEventListener('change', function() { window.__cookConfig.maxDelayMin = parseFloat(this.value) || 3; });
        if (beforeInput) beforeInput.addEventListener('change', function() { window.__cookConfig.beforeDeadlineSec = parseInt(this.value) || 30; });
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
            listEl.innerHTML = '<div style="color:#666;font-size:12px;">暂无订单数据</div>';
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
                // 检查是否有定时器
                var timer = window.__cookTimers && window.__cookTimers[o.orderNo];
                if (timer) {
                    var remain = Math.max(0, Math.round((timer.targetTime.getTime() - Date.now()) / 1000));
                    var min = Math.floor(remain / 60);
                    var sec = remain % 60;
                    detailHtml = '<div class="waimai-order-detail">⏰ ' + (min > 0 ? min + '分' : '') + sec + '秒后出餐</div>';
                } else if (o.cookRemainingTime) {
                    detailHtml = '<div class="waimai-order-detail">⏳ 剩余 <span class="timer">' + o.cookRemainingTime + '</span></div>';
                }
            } else if (o.status === 'cooked') {
                statusTag = '<span class="waimai-tag waimai-tag-cooked">已出餐</span>';
                detailHtml = '<div class="waimai-order-detail"><span class="done">✅ 已出餐</span></div>';
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
        // 从面板读取配置
        var config = window.__cookConfig;
        var minDelay = document.getElementById('waimai-min-delay');
        var maxDelay = document.getElementById('waimai-max-delay');
        var beforeSec = document.getElementById('waimai-before-sec');
        if (minDelay) config.minDelayMin = parseFloat(minDelay.value) || 2;
        if (maxDelay) config.maxDelayMin = parseFloat(maxDelay.value) || 3;
        if (beforeSec) config.beforeDeadlineSec = parseInt(beforeSec.value) || 30;

        window.monitorOrders(5000);

        // 更新按钮状态
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
    };

    // 监控启停时同步按钮状态
    var _origMonitor = window.monitorOrders;
    window.monitorOrders = function(intervalMs) {
        var result = _origMonitor(intervalMs);
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        return result;
    };

    var _origStop = window.stopOrderMonitor;
    window.stopOrderMonitor = function() {
        _origStop();
        var startBtn = document.getElementById('waimai-btn-start');
        var stopBtn = document.getElementById('waimai-btn-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
    };

    // ==================== 自动执行 ====================

    const result = domExtractor({ viewportExpansion: -1, doHighlightElements: true });
    printResults(result);

    // 自动检测：如果当前页面是美团商家版，创建面板并启动监控
    var currentHost = window.location.hostname || '';
    var isMeituan = currentHost.indexOf('meituan') !== -1 || currentHost.indexOf('waimai') !== -1;
    if (isMeituan) {
        createPanel();
        setTimeout(function() {
            monitorOrders(5000);
            updatePanelOrders();
            // 每5秒更新面板订单列表（与监控同步）
            setInterval(updatePanelOrders, 5000);
        }, 1000);
    } else {
        createPanel();
        panelLog('💡 非美团页面，面板已加载', 'blue');
        panelLog('💡 调用 monitorOrders() 或点击面板按钮启动监控', 'gray');
    }

})();
