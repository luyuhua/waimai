/**
 * @file DOM 结构化数据提取器 - 浏览器 Console 版本
 * @description 直接复制粘贴到浏览器控制台使用
 */

(function() {
    'use strict';

    // 主函数：提取 DOM 结构化数据
    window.domExtractor = function(args = {}) {
        const config = {
            doHighlightElements: args.doHighlightElements ?? false,
            focusHighlightIndex: args.focusHighlightIndex ?? -1,
            viewportExpansion: args.viewportExpansion ?? 0,
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
        const HIGHLIGHT_CONTAINER_ID = 'playwright-highlight-container';

        function highlightElement(element, index, parentIframe = null) {
            if (!element) return index;

            const overlays = [];
            let label = null;
            let labelWidth = 20;
            let labelHeight = 16;

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
                    overlays.push({ element: overlay, initialRect: rect });
                }

                const firstRect = rects[0];
                label = document.createElement('div');
                label.className = 'playwright-highlight-label';
                label.style.position = 'fixed';
                label.style.background = baseColor;
                label.style.color = 'white';
                label.style.padding = '1px 4px';
                label.style.borderRadius = '4px';
                label.style.fontSize = `${Math.min(12, Math.max(8, firstRect.height / 2))}px`;
                label.textContent = index.toString();

                labelWidth = label.offsetWidth > 0 ? label.offsetWidth : labelWidth;
                labelHeight = label.offsetHeight > 0 ? label.offsetHeight : labelHeight;

                let labelTop = firstRect.top + iframeOffset.y + 2;
                let labelLeft = firstRect.left + iframeOffset.x + firstRect.width - labelWidth - 2;

                if (firstRect.width < labelWidth + 4 || firstRect.height < labelHeight + 4) {
                    labelTop = firstRect.top + iframeOffset.y - labelHeight - 2;
                    labelLeft = firstRect.left + iframeOffset.x + firstRect.width - labelWidth;
                }

                label.style.top = `${Math.max(0, labelTop)}px`;
                label.style.left = `${Math.max(0, labelLeft)}px`;

                fragment.appendChild(label);
                container.appendChild(fragment);

                return index + 1;
            } catch (e) {
                if (debugMode) console.error('highlightElement error:', e);
                return index;
            }
        }

        function isScrollableElement(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
            const style = getCachedComputedStyle(element);
            if (!style) return null;

            const display = style.display;
            if (display === 'inline' || display === 'inline-block') return null;

            const overflowX = style.overflowX;
            const overflowY = style.overflowY;
            const hasScrollbarSignal = (style.scrollbarWidth && style.scrollbarWidth !== 'auto') || (style.scrollbarGutter && style.scrollbarGutter !== 'auto');
            const scrollableX = overflowX === 'auto' || overflowX === 'scroll';
            const scrollableY = overflowY === 'auto' || overflowY === 'scroll';

            if (!scrollableX && !scrollableY && !hasScrollbarSignal) return null;

            const scrollWidth = element.scrollWidth - element.clientWidth;
            const scrollHeight = element.scrollHeight - element.clientHeight;
            const threshold = 4;

            if (scrollWidth < threshold && scrollHeight < threshold) return null;

            const scrollData = {
                top: element.scrollTop,
                left: element.scrollLeft,
                right: scrollWidth - element.scrollLeft,
                bottom: scrollHeight - element.scrollTop,
            };

            addExtraData(element, { scrollable: true, scrollData });
            return scrollData;
        }

        function isTextNodeVisible(textNode) {
            try {
                if (viewportExpansion === -1) {
                    const parentElement = textNode.parentElement;
                    if (!parentElement) return false;
                    const style = window.getComputedStyle(parentElement);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }

                const range = document.createRange();
                range.selectNodeContents(textNode);
                const rects = range.getClientRects();
                if (!rects || rects.length === 0) return false;

                for (const rect of rects) {
                    if (rect.width > 0 && rect.height > 0) {
                        if (!(rect.bottom < -viewportExpansion || rect.top > window.innerHeight + viewportExpansion || rect.right < -viewportExpansion || rect.left > window.innerWidth + viewportExpansion)) {
                            return true;
                        }
                    }
                }
                return false;
            } catch (e) {
                return false;
            }
        }

        function isElementAccepted(element) {
            if (!element || !element.tagName) return false;
            const alwaysAccept = new Set(['body', 'div', 'main', 'article', 'section', 'nav', 'header', 'footer']);
            const tagName = element.tagName.toLowerCase();
            if (alwaysAccept.has(tagName)) return true;
            const leafElementDenyList = new Set(['svg', 'script', 'style', 'link', 'meta', 'noscript', 'template']);
            return !leafElementDenyList.has(tagName);
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

            const interactiveCursors = new Set(['pointer', 'move', 'text', 'grab', 'grabbing', 'cell', 'copy', 'alias', 'all-scroll', 'col-resize', 'context-menu', 'crosshair', 'e-resize', 'ew-resize', 'help', 'n-resize', 'ne-resize', 'nesw-resize', 'ns-resize', 'nw-resize', 'nwse-resize', 'row-resize', 's-resize', 'se-resize', 'sw-resize', 'vertical-text', 'w-resize', 'zoom-in', 'zoom-out']);

            if (style?.cursor && interactiveCursors.has(style.cursor)) return true;

            const interactiveElements = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label', 'option', 'optgroup', 'fieldset', 'legend']);

            if (interactiveElements.has(tagName)) {
                if (element.disabled || element.readOnly || element.inert) return false;
                return true;
            }

            if (element.getAttribute('contenteditable') === 'true' || element.isContentEditable) return true;

            if (element.classList && (element.classList.contains('button') || element.classList.contains('dropdown-toggle') || element.getAttribute('data-index') || element.getAttribute('data-toggle') === 'dropdown' || element.getAttribute('aria-haspopup') === 'true')) {
                return true;
            }

            const interactiveRoles = new Set(['button', 'menu', 'menubar', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'checkbox', 'tab', 'switch', 'slider', 'spinbutton', 'combobox', 'searchbox', 'textbox', 'listbox', 'option', 'scrollbar']);
            const role = element.getAttribute('role');
            if (role && interactiveRoles.has(role)) return true;

            const commonMouseAttrs = ['onclick', 'onmousedown', 'onmouseup', 'ondblclick'];
            for (const attr of commonMouseAttrs) {
                if (element.hasAttribute(attr) || typeof element[attr] === 'function') return true;
            }

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
                { x: rect.right - 5, y: rect.bottom - 5 },
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
            if (!rects || rects.length === 0) {
                const boundingRect = getCachedBoundingRect(element);
                if (!boundingRect || boundingRect.width === 0 || boundingRect.height === 0) return false;
                return !(boundingRect.bottom < -viewportExpansion || boundingRect.top > window.innerHeight + viewportExpansion || boundingRect.right < -viewportExpansion || boundingRect.left > window.innerWidth + viewportExpansion);
            }

            for (const rect of rects) {
                if (rect.width === 0 || rect.height === 0) continue;
                if (!(rect.bottom < -viewportExpansion || rect.top > window.innerHeight + viewportExpansion || rect.right < -viewportExpansion || rect.left > window.innerWidth + viewportExpansion)) {
                    return true;
                }
            }
            return false;
        }

        const INTERACTIVE_ARIA_ATTRS = ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-haspopup', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-valuenow', 'aria-valuetext', 'aria-valuemax', 'aria-valuemin', 'aria-autocomplete'];

        function hasInteractiveAria(el) {
            for (let i = 0; i < INTERACTIVE_ARIA_ATTRS.length; i++) {
                if (el.hasAttribute(INTERACTIVE_ARIA_ATTRS[i])) return true;
            }
            return false;
        }

        function isInteractiveCandidate(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            const tagName = element.tagName.toLowerCase();
            const interactiveElements = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label']);
            if (interactiveElements.has(tagName)) return true;
            return element.hasAttribute('onclick') || element.hasAttribute('role') || element.hasAttribute('tabindex') || hasInteractiveAria(element) || element.hasAttribute('data-action') || element.getAttribute('contenteditable') === 'true';
        }

        const DISTINCT_INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label', 'option', 'li']);
        const DISTINCT_INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'checkbox', 'tab', 'switch', 'slider', 'spinbutton', 'combobox', 'searchbox', 'textbox', 'listbox', 'listitem', 'treeitem', 'row', 'option', 'scrollbar']);

        function isElementDistinctInteraction(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute('role');

            if (tagName === 'iframe') return true;
            if (DISTINCT_INTERACTIVE_TAGS.has(tagName)) return true;
            if (role && DISTINCT_INTERACTIVE_ROLES.has(role)) return true;
            if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return true;
            if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test')) return true;
            if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;
            if (hasInteractiveAria(element)) return true;
            if (extraData.get(element)?.scrollable) return true;

            return false;
        }

        function handleHighlighting(nodeData, node, parentIframe, isParentHighlighted) {
            if (!nodeData.isInteractive) return false;

            let shouldHighlight = false;
            if (!isParentHighlighted) {
                shouldHighlight = true;
            } else {
                if (isElementDistinctInteraction(node)) shouldHighlight = true;
            }

            if (shouldHighlight) {
                nodeData.isInViewport = isInExpandedViewport(node, viewportExpansion);
                if (nodeData.isInViewport || viewportExpansion === -1) {
                    nodeData.highlightIndex = highlightIndex++;
                    if (doHighlightElements) {
                        if (focusHighlightIndex < 0 || focusHighlightIndex === nodeData.highlightIndex) {
                            highlightElement(node, nodeData.highlightIndex, parentIframe);
                        }
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
                DOM_HASH_MAP[id] = { type: 'TEXT_NODE', text: textContent, isVisible: isTextNodeVisible(node) };
                return id;
            }

            if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) return null;

            if (viewportExpansion !== -1 && !node.shadowRoot) {
                const rect = getCachedBoundingRect(node);
                const style = getCachedComputedStyle(node);
                const isFixedOrSticky = style && (style.position === 'fixed' || style.position === 'sticky');
                const hasSize = node.offsetWidth > 0 || node.offsetHeight > 0;

                if (!rect || (!isFixedOrSticky && !hasSize && (rect.bottom < -viewportExpansion || rect.top > window.innerHeight + viewportExpansion || rect.right < -viewportExpansion || rect.left > window.innerWidth + viewportExpansion))) {
                    return null;
                }
            }

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
                    const role = node.getAttribute('role');
                    const isMenuContainer = role === 'menu' || role === 'menubar' || role === 'listbox';

                    if (nodeData.isTopElement || isMenuContainer) {
                        nodeData.isInteractive = isInteractiveElement(node);
                        nodeWasHighlighted = handleHighlighting(nodeData, node, parentIframe, isParentHighlighted);
                        nodeData.ref = node;

                        if (nodeData.isInteractive && Object.keys(nodeData.attributes).length === 0) {
                            const attributeNames = node.getAttributeNames?.() || [];
                            for (const name of attributeNames) {
                                nodeData.attributes[name] = node.getAttribute(name);
                            }
                        }
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
                        const passHighlightStatusToChild = nodeWasHighlighted || isParentHighlighted;
                        const domElement = buildDomTree(child, parentIframe, passHighlightStatusToChild);
                        if (domElement) nodeData.children.push(domElement);
                    }
                }
            }

            if (nodeData.tagName === 'a' && nodeData.children.length === 0 && !nodeData.attributes.href) {
                const rect = getCachedBoundingRect(node);
                const hasSize = (rect && rect.width > 0 && rect.height > 0) || node.offsetWidth > 0 || node.offsetHeight > 0;
                if (!hasSize) return null;
            }

            nodeData.extra = extraData.get(node) || null;

            const id = `${ID.current++}`;
            DOM_HASH_MAP[id] = nodeData;
            return id;
        }

        const rootId = buildDomTree(document.body);
        DOM_CACHE.clearCache();

        return { rootId, map: DOM_HASH_MAP };
    };

    // 辅助函数：获取所有可交互元素
    window.getInteractiveElements = function(map) {
        const interactive = [];
        for (const [id, node] of Object.entries(map)) {
            if (node.isInteractive && node.highlightIndex !== undefined) {
                interactive.push({
                    id,
                    tagName: node.tagName,
                    text: node.ref?.innerText?.trim() || '',
                    attributes: node.attributes,
                    highlightIndex: node.highlightIndex,
                    ref: node.ref,
                });
            }
        }
        return interactive;
    };

    // 辅助函数：根据文本查找元素
    window.findElementByText = function(map, text) {
        for (const [id, node] of Object.entries(map)) {
            if (node.ref?.innerText?.includes(text)) {
                return { id, node };
            }
        }
        return null;
    };

    // 辅助函数：清理高亮
    window.clearHighlights = function() {
        const container = document.getElementById('playwright-highlight-container');
        if (container) container.remove();
    };

    console.log('✅ domExtractor 已加载！');
    console.log('使用方法:');
    console.log('  const result = domExtractor({ viewportExpansion: -1 });');
    console.log('  const interactive = getInteractiveElements(result.map);');
    console.log('  console.log(interactive);');
})();
