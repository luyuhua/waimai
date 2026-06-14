/**
 * @file 页面结构化数据提取工具（页面分析器）
 * @description 独立模块，与 V1 主业务脚本解耦。
 *              用于把任意页面的 DOM 转成结构化数据 + 可交互元素索引，
 *              方便开发者观察页面有哪些可点击/可操作的元素。
 *              提取逻辑移植自 alibaba/page-agent。
 *
 * 加载方式：被 domExtractor.bookmarklet.js 依赖调用，
 *           也可单独作为浏览器脚本加载。
 *
 * 暴露的全局 API：
 *   - window.domExtractor(args)        → { rootId, map }
 *   - window.getInteractiveElements(map) → Array<{id, tagName, text, className, id_attr, ref}>
 *   - window.findElementByText(map, text) → {id, node} | null
 *   - window.printDomResults(result)   → 在 console 打印结果 + 存 window.__domResult
 *
 * 行为约定：
 *   - 第一次加载时自动执行一次提取 + 打印
 *   - 已加载时再次执行只重跑提取（不重置全局状态）
 */

(function () {
    'use strict';

    // 防止重复执行：已加载时仅重新执行提取（不重新拉取脚本）
    if (window.__domExtractorLoaded) {
        console.log('🔄 domExtractor 已加载，重新执行提取...');
        if (window.domExtractor && window.printDomResults) {
            const result = window.domExtractor({ viewportExpansion: -1 });
            window.printDomResults(result);
        }
        return;
    }
    window.__domExtractorLoaded = true;

    // ==================== 核心 DOM 提取代码 ====================

    window.domExtractor = function (args = {}) {
        const config = {
            viewportExpansion: args.viewportExpansion ?? -1,
            debugMode: args.debugMode ?? false,
            interactiveBlacklist: args.interactiveBlacklist ?? [],
            interactiveWhitelist: args.interactiveWhitelist ?? [],
        };

        const {
            interactiveBlacklist,
            interactiveWhitelist,
            viewportExpansion,
            debugMode
        } = config;

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
            if (DOM_CACHE.boundingRects.has(element)) {
                return DOM_CACHE.boundingRects.get(element);
            }
            const rect = element.getBoundingClientRect();
            if (rect) DOM_CACHE.boundingRects.set(element, rect);
            return rect;
        }

        function getCachedComputedStyle(element) {
            if (!element) return null;
            if (DOM_CACHE.computedStyles.has(element)) {
                return DOM_CACHE.computedStyles.get(element);
            }
            const style = window.getComputedStyle(element);
            if (style) DOM_CACHE.computedStyles.set(element, style);
            return style;
        }

        function getCachedClientRects(element) {
            if (!element) return null;
            if (DOM_CACHE.clientRects.has(element)) {
                return DOM_CACHE.clientRects.get(element);
            }
            const rects = element.getClientRects();
            if (rects) DOM_CACHE.clientRects.set(element, rects);
            return rects;
        }

        const DOM_HASH_MAP = {};
        const ID = { current: 0 };

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
            return {
                top: element.scrollTop,
                left: element.scrollLeft,
                right: scrollWidth - element.scrollLeft,
                bottom: scrollHeight - element.scrollTop,
            };
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

        function buildDomTree(node, parentIframe = null) {
            if (!node || (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE)) return null;
            if (node.dataset?.browserUseIgnore === 'true' || node.dataset?.pageAgentIgnore === 'true') return null;
            if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return null;

            if (node === document.body) {
                const nodeData = { tagName: 'body', attributes: {}, children: [] };
                for (const child of node.childNodes) {
                    const domElement = buildDomTree(child, parentIframe);
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

            if (node.nodeType === Node.ELEMENT_NODE) {
                nodeData.isVisible = isElementVisible(node);
                if (nodeData.isVisible) {
                    nodeData.isTopElement = isTopElement(node);
                    if (nodeData.isTopElement) {
                        nodeData.isInteractive = isInteractiveElement(node);
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
                                const domElement = buildDomTree(child, node);
                                if (domElement) nodeData.children.push(domElement);
                            }
                        }
                    } catch (e) {}
                } else {
                    if (node.shadowRoot) {
                        nodeData.shadowRoot = true;
                        for (const child of node.shadowRoot.childNodes) {
                            const domElement = buildDomTree(child, parentIframe);
                            if (domElement) nodeData.children.push(domElement);
                        }
                    }
                    for (const child of node.childNodes) {
                        const domElement = buildDomTree(child, parentIframe);
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

    window.getInteractiveElements = function (map) {
        const interactive = [];
        for (const [id, node] of Object.entries(map)) {
            if (node.isInteractive) {
                interactive.push({
                    id,
                    tagName: node.tagName,
                    text: (node.ref?.innerText?.trim() || '').slice(0, 50),
                    className: node.attributes?.class || '',
                    id_attr: node.attributes?.id || '',
                    ref: node.ref,
                });
            }
        }
        return interactive;
    };

    window.findElementByText = function (map, text) {
        for (const [id, node] of Object.entries(map)) {
            if (node.ref?.innerText?.includes(text)) {
                return { id, node };
            }
        }
        return null;
    };

    // ==================== 结果打印（只打 DOM 部分，不依赖业务脚本）====================

    window.printDomResults = function (result) {
        const interactive = window.getInteractiveElements(result.map);

        console.log('');
        console.log('%c📊 提取结果', 'color: #667eea; font-size: 16px; font-weight: bold;');
        console.log('%c────────────────────────────────────', 'color: #ddd;');
        console.log(`  📄 总节点数: ${Object.keys(result.map).length}`);
        console.log(`  🎯 可交互元素: ${interactive.length}`);
        console.log('');

        if (interactive.length > 0) {
            console.log('%c🎯 可交互元素列表:', 'color: #667eea; font-weight: bold;');
            console.table(interactive.map(item => ({
                '标签': item.tagName,
                '文本': item.text || '(无)',
                'class': item.className || '-',
                'id': item.id_attr || '-',
            })));

            console.log('');
            console.log('%c💡 使用示例:', 'color: #667eea; font-weight: bold;');
            console.log('%c// 点击第 N 个元素', 'color: #888;');
            console.log(`getInteractiveElements(result.map)[0].ref.click();`);
            console.log('');
            console.log('%c// 查找包含文本的元素', 'color: #888;');
            console.log(`findElementByText(result.map, '按钮文本').node.ref.click();`);
        }

        // 保存到全局变量
        window.__domResult = result;
        window.__interactiveElements = interactive;

        console.log('');
        console.log('%c💾 DOM 数据已保存到全局变量:', 'color: #667eea;');
        console.log('  - window.__domResult (完整结果)');
        console.log('  - window.__interactiveElements (可交互元素)');
    };

    // ==================== 首次执行由加载方触发 ====================
    // 单独加载本文件时不会自动跑提取，调用方应在加载完成后执行：
    //   const result = window.domExtractor({ viewportExpansion: -1 });
    //   window.printDomResults(result);
    // 这样可以避免与主脚本重复执行。
})();
