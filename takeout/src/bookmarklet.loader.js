/**
 * @file 统一书签入口 - Bookmarklet Loader
 * @description 根据当前页面域名自动检测平台，加载对应的业务脚本:
 *
 *              - waimaie.meituan.com → domExtractor.bookmarklet.js（美团外卖）
 *              - melody.shop.ele.me  → 提示使用 CDP 扩展（taobaoFlash API 路线已死）
 *              - 其他                 → 提示不是支持的目标网页
 *
 *              加载链路:
 *                ① pageAnalyzer.js（DOM 分析工具，所有平台共用）
 *                ② 平台对应的业务脚本
 *
 * @usage 书签 javascript:
 *   javascript:(function(){var s=document.createElement('script');s.src='https://luyuhua.github.io/waimai/takeout/src/bookmarklet.loader.js?t='+Date.now();document.body.appendChild(s);})()
 */

(function () {
    'use strict';

    var CDN_BASE = 'https://luyuhua.github.io/waimai/takeout/src/';
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
            console.log('📍 检测到淘宝闪购');
            console.log('💡 淘宝闪购出餐请使用 CDP Chrome 扩展 (cdp-extension/)，bookmarklet API 路线已被反爬封锁');
            console.log('   扩展安装: chrome://extensions → 加载已解压的扩展程序 → 选择 cdp-extension/ 目录');
        } else {
            console.warn('⚠️ 不是支持的目标网页（美团外卖商家版: waimaie.meituan.com / 淘宝闪购: melody.shop.ele.me）');
            console.log('💡 如果需要强制加载某个脚本，请在控制台执行对应的 loadScript 调用');
        }
    }
})();
