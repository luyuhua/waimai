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
                '状态': statusMap[o.status] || o.status,
                '顾客': o.customerName + (o.isNewCustomer ? '🆕' : ''),
                '下单时间': o.orderTime,
                '商品': o.products.map(p => p.name + '×' + p.quantity).join(', '),
                '预计收入': '¥' + o.estimatedIncome,
                '出餐用时': o.cookTime || '-',
                '建议出餐': o.suggestedCookTime || '-'
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
                if (allText.includes('待接单')) return 'pending_accept';
                if (allText.includes('待出餐')) return 'pending_cook';
                if (allText.includes('已出餐')) return 'cooked';
                if (allText.includes('配送中')) return 'delivering';
                if (allText.includes('已送达') || allText.includes('用户已收餐')) return 'delivered';
                if (allText.includes('已取消')) return 'cancelled';
                return 'unknown';
            }

            // 重置状态追踪（首次运行时）
            if (!window.__orderStatusMap) window.__orderStatusMap = {};

            cards.forEach(function(card) {
                var allText = card.innerText || '';
                var orderNoMatch = allText.match(/订单编号[：:]\s*(\d+)/);
                var orderNo = orderNoMatch ? orderNoMatch[1] : '';
                if (!orderNo) return;

                var currentStatus = getOrderStatus(allText);
                var prevStatus = window.__orderStatusMap[orderNo];
                var isNew = !window.__knownOrders.has(orderNo);
                var statusChanged = prevStatus && prevStatus !== currentStatus;

                window.__knownOrders.add(orderNo);
                window.__orderStatusMap[orderNo] = currentStatus;

                var customerMatch = allText.match(/([^\s]{1,4}(?:先生|女士))/);
                var indexMatch = allText.match(/#(\d+)/);
                var isPendingCook = currentStatus === 'pending_cook';

                // 新订单 或 状态变为"待出餐"
                if (isNew || (statusChanged && isPendingCook)) {
                    var reason = isNew ? '🆕 新订单' : '🔄 状态变化 → 待出餐';
                    var statusEmoji = isPendingCook ? '🔴' : '🔵';
                    console.log(
                        '%c' + statusEmoji + ' ' + reason + ' #%s %s %s',
                        'font-weight: bold; font-size: 14px; color: ' + (isPendingCook ? 'red' : '#667eea') + ';',
                        indexMatch ? indexMatch[1] : '?',
                        customerMatch ? customerMatch[1] : '',
                        isPendingCook ? '⚠️ 待出餐！' : ''
                    );

                    if (isPendingCook) {
                        console.log('%c🔴🔴🔴 发现待出餐订单！', 'color: red; font-size: 16px; font-weight: bold;');

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

                        // 自动出餐
                        if (window.__autoCookEnabled) {
                            for (var j = 0; j < buttons.length; j++) {
                                var btnText = buttons[j].innerText.trim();
                                if (btnText === '出餐完成' || btnText === '出餐' || btnText === '确认出餐') {
                                    setTimeout((function(btn, no) {
                                        return function() {
                                            btn.click();
                                            console.log('%c✅ 已自动出餐: 订单 ' + no, 'color: green; font-size: 14px; font-weight: bold;');
                                        };
                                    })(buttons[j], orderNo), 1000);
                                    break;
                                }
                            }
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
                console.log('%c' + emoji + ' [' + now + '] 监控中 | 已知 ' + window.__knownOrders.size + ' 单 | 待出餐 ' + pendingCount + ' 单', 'color: #888;');
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

        console.log('%c📋 订单监控已启动 | 已知 ' + window.__knownOrders.size + ' 单 | 每 ' + (intervalMs/1000) + '秒检查 | 自动出餐: ' + (autoCook ? '✅ 开启' : '❌ 关闭'), 'color: #667eea; font-size: 14px; font-weight: bold;');
        console.log('%c💡 设置 window.__autoCookEnabled = true 开启自动出餐', 'color: #f59e0b;');
        console.log('%c💡 调用 window.stopOrderMonitor() 停止监控', 'color: #888;');

        window.__orderMonitorTimer = setInterval(checkOrders, intervalMs);
        checkOrders(); // 立即检查一次

        return window.__knownOrders.size;
    };

    /**
     * 停止订单监控
     */
    window.stopOrderMonitor = function() {
        if (window.__orderMonitorTimer) {
            clearInterval(window.__orderMonitorTimer);
            window.__orderMonitorTimer = null;
            console.log('%c⏹️ 订单监控已停止', 'color: #888; font-size: 14px;');
        }
    };

    // ==================== 自动执行 ====================

    const result = domExtractor({ viewportExpansion: -1, doHighlightElements: true });
    printResults(result);

    // 自动检测：如果当前页面是美团商家版，启动订单监控
    var currentHost = window.location.hostname || '';
    var isMeituan = currentHost.indexOf('meituan') !== -1 || currentHost.indexOf('waimai') !== -1;
    if (isMeituan) {
        console.log('');
        console.log('%c🛵 检测到美团商家版，自动启动订单监控', 'color: #667eea; font-size: 14px; font-weight: bold;');
        setTimeout(function() { monitorOrders(5000, false); }, 1000);
    } else {
        console.log('');
        console.log('%c💡 非美团页面，如需订单监控请手动调用 monitorOrders()', 'color: #888;');
    }

})();
