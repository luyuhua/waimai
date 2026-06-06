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

        console.log('');
        console.log('%c💾 数据已保存到全局变量:', 'color: #667eea;');
        console.log('  - window.__domResult (完整结果)');
        console.log('  - window.__interactiveElements (可交互元素)');
    }

    // ==================== 自动执行 ====================

    const result = domExtractor({ viewportExpansion: -1, doHighlightElements: true });
    printResults(result);

})();
