/**
 * @file 统一书签入口 - Bookmarklet Loader
 * @description 根据当前页面域名自动检测平台，加载对应的业务脚本:
 *
 *              - waimaie.meituan.com → domExtractor.bookmarklet.js（美团外卖）
 *              - melody.shop.ele.me  → taobaoFlash.bookmarklet.js（淘宝闪购/饿了么）
 *              - 其他                 → 提示不是支持的目标网页
 *
 *              加载链路:
 *                ① pageAnalyzer.js（DOM 分析工具，所有平台共用）
 *                ② 平台对应的业务脚本
 *
 * @usage 书签 javascript:
 *   javascript:(function(){var s=document.createElement('script');s.src='https://luyuhua.github.io/waimai/src/bookmarklet.loader.js?t='+Date.now();document.body.appendChild(s);})()
 */

(function () {
    'use strict';

    var CDN_BASE = 'https://luyuhua.github.io/waimai/src/';
    var cacheBust = '?t=' + Date.now();
    var hostname = window.location.hostname || '';

    console.log('%c🔍 自动检测平台: ' + hostname, 'color: #667eea; font-weight: bold;');

    function loadScript(src, onload, onerror) {
        var s = document.createElement('script');
        s.src = src;
        s.type = 'text/javascript';
        s.setAttribute('crossorigin', 'anonymous');
        if (onload) s.onload = onload;
        if (onerror) s.onerror = onerror;
        document.body.appendChild(s);
    }

    // 加载目标页面分析工具（pageAnalyzer，所有平台通用）
    loadScript(
        CDN_BASE + 'pageAnalyzer.js' + cacheBust,
        function () {
            console.log('✅ pageAnalyzer 加载完成');
            loadPlatformScript();
        },
        function () {
            console.error('❌ pageAnalyzer.js 加载失败！');
            console.log('💡 备用方案：直接在控制台粘贴 pageAnalyzer.js 的代码');
        }
    );

    function loadPlatformScript() {
        var isMeituan = hostname.indexOf('meituan') !== -1;
        var isTaobaoFlash = hostname.indexOf('ele.me') !== -1;

        if (isMeituan) {
            console.log('📍 检测到美团外卖商家版，加载美团出餐助手');
            loadScript(
                CDN_BASE + 'domExtractor.bookmarklet.js' + cacheBust,
                function () { console.log('✅ 美团出餐助手 加载完成'); },
                function () {
                    console.error('❌ domExtractor.bookmarklet.js 加载失败！');
                    console.log('💡 备用方案：直接在控制台粘贴代码');
                }
            );
        } else if (isTaobaoFlash) {
            // 淘宝页面：订单在跨域 iframe 里（napos-order-pc.faas.ele.me），
            // 同源策略禁止主页面访问 contentDocument/eval。
            // 解决：新开一个窗口指向 iframe 那个 URL，登录态由浏览器 cookie 保持，
            //       淘宝脚本在新窗口里运行，DOM 可访问。
            var orderIframe = null;
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                if ((iframes[i].src || '').indexOf('napos-order-pc') !== -1) {
                    orderIframe = iframes[i];
                    break;
                }
            }
            if (orderIframe) {
                console.log('📍 检测到淘宝闪购订单区，新开窗口运行助手');
                var popup = window.open(orderIframe.src, '_blank');
                if (!popup) {
                    console.error('❌ 新窗口被拦截，请允许此网站弹出窗口');
                } else {
                    // 等待新窗口加载完成，注入淘宝脚本
                    var inject = function() {
                        try {
                            if (!popup.document || !popup.document.body) {
                                setTimeout(inject, 300);
                                return;
                            }
                            var s = popup.document.createElement('script');
                            s.src = CDN_BASE + 'taobaoFlash.bookmarklet.js' + cacheBust;
                            s.onload = function() { console.log('✅ 淘宝闪购出餐助手 加载完成（新窗口）'); };
                            s.onerror = function() { console.error('❌ taobaoFlash.bookmarklet.js 加载失败'); };
                            popup.document.body.appendChild(s);
                        } catch (e) {
                            console.error('❌ 注入失败:', e.message);
                        }
                    };
                    setTimeout(inject, 1000);
                }
            } else {
                // 没有 iframe 时直接在主页面运行（兜底）
                console.log('📍 检测到淘宝闪购页面，主页面加载助手');
                loadScript(
                    CDN_BASE + 'taobaoFlash.bookmarklet.js' + cacheBust,
                    function () { console.log('✅ 淘宝闪购出餐助手 加载完成'); },
                    function () {
                        console.error('❌ taobaoFlash.bookmarklet.js 加载失败！');
                        console.log('💡 备用方案：直接在控制台粘贴代码');
                    }
                );
            }
        } else {
            console.warn('⚠️ 不是支持的目标网页（美团外卖商家版: waimaie.meituan.com / 淘宝闪购: melody.shop.ele.me）');
            console.log('💡 如果需要强制加载某个脚本，请在控制台执行对应的 loadScript 调用');
        }
    }
})();
