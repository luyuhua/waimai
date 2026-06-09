/**
 * @file 美团外卖商家版 — API 拦截与请求层 (V2)
 * @description 拦截美团商家版的 XHR/Fetch 请求，捕获订单相关 API 响应数据；
 *              同时提供主动请求能力，复用当前 session 发起订单列表查询。
 * @note 本模块是 V2 混合架构的一部分，可独立启用/禁用，不影响原有 DOM 提取逻辑。
 *
 * 已验证的 API 端点（2026-06-09）：
 *   - POST /gw/api/unified/r/order/list/page/unprocessed
 *     Body: tag=all&pageParam={"pageSize":10,"pageNum":1,"sort":0,"nextLabel":"","lastLabel":""}&extParam={"phfRollback":0,"searchMealTag":""}
 *     tag 可选值: all, 或各个状态 tab
 *     响应: { code: 0, data: { orderList: [...], pageInfo: { totalCount, pageCount }, orderIndex: [...] } }
 *   - POST /gw/api/unified/r/order/list/count
 *   - POST /gw/api/unified/r/order/list/interval
 *   - GET /gw/api/order/mix/unprocessed/count/common
 *   - GET /v2/order/pre/r/notify/v2
 */

;(function () {
  'use strict';

  if (!window.__WM_V2) window.__WM_V2 = {};
  const V2 = window.__WM_V2;

  const CONFIG = {
    interceptPaths: [
      '/gw/api/unified/r/order/list/page',
      '/gw/api/unified/r/order/list/interval',
      '/gw/api/unified/r/order/list/count',
      '/gw/api/order/mix/unprocessed/count',
      '/v2/order/pre/r/notify',
    ],
  };

  // ==================== API 拦截器 ====================
  class ApiInterceptor {
    constructor() {
      this._listeners = [];
      this._installed = false;
      this._capturedResponses = [];
      this._maxCaptured = 50;
    }

    install() {
      if (this._installed) return this;
      this._installed = true;
      this._interceptXHR();
      this._interceptFetch();
      console.log('[WM-V2] API 拦截器已安装');
      return this;
    }

    on(path, callback) {
      this._listeners.push({ path, callback });
      return this;
    }

    off(path) {
      if (path) {
        this._listeners = this._listeners.filter(l => l.path !== path);
      } else {
        this._listeners = [];
      }
      return this;
    }

    getCaptured() { return this._capturedResponses.slice(); }

    _isTargetUrl(url) {
      if (!url) return false;
      const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
      return CONFIG.interceptPaths.some(p => path.startsWith(p));
    }

    _notify(url, data) {
      for (const l of this._listeners) {
        if (url.includes(l.path)) {
          try { l.callback(data, url); } catch (e) {
            console.error('[WM-V2] listener error:', e);
          }
        }
      }
    }

    _interceptXHR() {
      const self = this;
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const origOpen = win.XMLHttpRequest.prototype.open;
      const origSend = win.XMLHttpRequest.prototype.send;

      win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__wmUrl = url;
        this.__wmMethod = method;
        return origOpen.apply(this, [method, url, ...rest]);
      };

      win.XMLHttpRequest.prototype.send = function (body) {
        const xhr = this;
        const url = xhr.__wmUrl || '';
        const method = xhr.__wmMethod || 'GET';

        if (self._isTargetUrl(url)) {
          xhr.addEventListener('load', function () {
            try {
              const resp = JSON.parse(xhr.responseText);
              const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
              const record = {
                source: 'xhr',
                method,
                path,
                url: url.substring(0, 300),
                requestBody: typeof body === 'string' ? body.substring(0, 2000) : null,
                response: resp,
                timestamp: Date.now(),
              };
              self._capturedResponses.push(record);
              if (self._capturedResponses.length > self._maxCaptured) {
                self._capturedResponses.shift();
              }
              self._notify(url, record);
            } catch (e) { /* 非 JSON 响应 */ }
          });
        }

        return origSend.apply(this, [body]);
      };
    }

    _interceptFetch() {
      const self = this;
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const origFetch = win.fetch;

      win.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const opts = args[1] || {};
        const method = opts.method || 'GET';

        const promise = origFetch.apply(this, args);

        if (self._isTargetUrl(url)) {
          promise.then(resp => {
            resp.clone().json().then(data => {
              const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
              const record = {
                source: 'fetch',
                method,
                path,
                url: url.substring(0, 300),
                requestBody: typeof opts.body === 'string' ? opts.body.substring(0, 2000) : null,
                response: data,
                timestamp: Date.now(),
              };
              self._capturedResponses.push(record);
              if (self._capturedResponses.length > self._maxCaptured) {
                self._capturedResponses.shift();
              }
              self._notify(url, record);
            }).catch(() => {});
          }).catch(() => {});
        }

        return promise;
      };
    }

    _getIframe() {
      try {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe && iframe.contentDocument && iframe.contentWindow) return iframe;
      } catch (e) {}
      return null;
    }
  }

  // ==================== 主动请求层 ====================
  class ApiRequester {
    /**
     * 主动请求订单列表
     * @param {Object} params
     * @param {string} [params.tag='all'] - 订单标签: 'all', 'pending_cook' 等
     * @param {number} [params.pageSize=10] - 每页数量
     * @param {number} [params.pageNum=1] - 页码
     * @returns {Promise<Object>} API 响应数据
     */
    async fetchOrderList({ tag = 'all', pageSize = 10, pageNum = 1 } = {}) {
      const iframe = this._getIframe();
      const win = iframe ? iframe.contentWindow : window;
      const doc = iframe ? iframe.contentDocument : document;

      // 从 cookie 提取认证参数
      const cookies = this._parseCookies(doc.cookie);
      const regionId = cookies.region_id || '';
      const regionVersion = cookies.region_version || '';

      const url = `${win.location.origin}/gw/api/unified/r/order/list/page/unprocessed?region_id=${regionId}&region_version=${regionVersion}`;

      const pageParam = JSON.stringify({ pageSize, pageNum, sort: 0, nextLabel: '', lastLabel: '' });
      const extParam = JSON.stringify({ phfRollback: 0, searchMealTag: '' });

      // 使用 XHR（因为美团使用了 mtgsig 签名，直接 fetch 可能缺少签名）
      // 更好的方式是触发页面自身发请求，而非手动构造
      // 但我们仍然尝试构造一个基本请求，如果失败则 fallback 到 DOM 提取
      try {
        const resp = await win.fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `tag=${tag}&pageParam=${encodeURIComponent(pageParam)}&extParam=${encodeURIComponent(extParam)}`,
        });
        const data = await resp.json();
        console.log(`[WM-V2] 主动请求订单列表: tag=${tag}, code=${data.code}`);
        return data;
      } catch (e) {
        console.warn('[WM-V2] 主动请求失败，需要 mtgsig 签名:', e.message);
        console.warn('[WM-V2] 将使用 DOM + 拦截方式获取数据');
        return null;
      }
    }

    /**
     * 通过模拟 tab 切换来触发页面自身的 API 请求
     * 这是 fallback 策略：不直接调 API，而是让页面自己重新拉取数据
     * @param {string} tabName - 'all' | 'pending_cook' | 'pending_accept' 等
     */
    triggerTabSwitch(tabName) {
      const iframe = this._getIframe();
      if (!iframe) return false;
      const doc = iframe.contentDocument;

      const tabMap = {
        'all': '全部',
        'pending_cook': '待出餐',
        'pending_accept': '待接单',
        'delivering': '配送中',
        'cancelled': '已取消',
      };

      const targetText = tabMap[tabName] || tabName;
      const buttons = doc.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.innerText.trim().includes(targetText)) {
          btn.click();
          console.log(`[WM-V2] 切换到 tab: ${targetText}`);
          return true;
        }
      }
      console.warn(`[WM-V2] 未找到 tab: ${targetText}`);
      return false;
    }

    _parseCookies(cookieStr) {
      const obj = {};
      if (!cookieStr) return obj;
      cookieStr.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        obj[k.trim()] = v.join('=');
      });
      return obj;
    }

    _getIframe() {
      try {
        const iframe = document.getElementById('hashframe') || document.getElementById('mainContainer');
        if (iframe && iframe.contentDocument && iframe.contentWindow) return iframe;
      } catch (e) {}
      return null;
    }
  }

  // ==================== 导出 ====================
  V2.ApiInterceptor = ApiInterceptor;
  V2.ApiRequester = ApiRequester;
  V2.apiConfig = CONFIG;

  console.log('[WM-V2] orderApi 模块已加载（v2.1 - 含订单列表主动请求）');
})();
