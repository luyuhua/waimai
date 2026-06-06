/**
 * @file 美团外卖商家版 - 订单数据提取器
 * @description 在美团商家版订单页面提取结构化数据
 * @usage 在 Chrome DevTools MCP 或浏览器控制台中执行
 *
 * 关键发现：
 * - 主内容在 iframe#hashframe 中，需要进入 iframe 操作
 * - 订单卡片 class: order-card_7742d (hash可能变化，用 [class*="order-card"] 选择)
 * - 按钮 class: roo-btn (ant-design 风格组件)
 * - 当前所有订单为"已送达"状态，"出餐"按钮需在"待出餐"状态下观察
 */

// ==================== 订单数据结构 ====================

/**
 * 单个订单的数据结构
 * @typedef {Object} OrderData
 * @property {string} orderNo - 订单编号 (如 "2002156823164924733")
 * @property {number} orderIndex - 订单序号 (如 8 表示 #8)
 * @property {string} orderTime - 下单时间 (如 "06-06 19:08")
 * @property {string} deliverTime - 送达时间 (如 "06-06 19:37")
 * @property {string} customerName - 顾客姓名 (如 "谢先生")
 * @property {boolean} isNewCustomer - 是否新客
 * @property {number} customerOrderCount - 下单次数 (0表示新客)
 * @property {boolean} isFavCustomer - 是否收藏店铺
 * @property {string} status - 订单状态: pending_accept | pending_cook | cooked | delivering | delivered | cancelled
 * @property {string} cookTime - 出餐用时 (如 "02:27")
 * @property {string} suggestedCookTime - 建议出餐时长 (如 "10分00秒")
 * @property {string} phoneTail - 手机尾号 (如 "9091")
 * @property {string} remark - 备注
 * @property {number} estimatedIncome - 预计收入
 * @property {Array} products - 商品列表
 * @property {string} deliveryType - 配送类型: "meituan" | ""
 * @property {boolean} isFlashDelivery - 是否闪电送
 * @property {string} riderName - 骑手姓名
 * @property {number} commissionRate - 佣金比例 (如 7.2 表示 7.2%)
 * @property {number} commissionAmount - 佣金金额
 * @property {number} deliverySubsidy - 配送补贴
 * @property {number} orderDiscount - 订单优惠
 * @property {number} packFee - 打包费
 * @property {Array} buttons - 可操作按钮列表
 */

/**
 * 商品数据结构
 * @typedef {Object} ProductData
 * @property {string} name - 商品名称 (如 "椰子三兄弟(大杯500ml 正常冰)")
 * @property {number} unitPrice - 单价
 * @property {number} quantity - 数量
 * @property {number} totalPrice - 实付金额
 */

/**
 * 按钮数据结构
 * @typedef {Object} ButtonData
 * @property {string} text - 按钮文本
 * @property {string} className - 按钮 class (用于定位和点击)
 */

// ==================== 实际提取数据样例 ====================

const sampleOrders = [
  {
    "orderNo": "2002156823164924733",
    "orderIndex": 8,
    "orderTime": "06-06 19:08",
    "deliverTime": "06-06 19:37",
    "customerName": "谢先生",
    "isNewCustomer": true,
    "customerOrderCount": 0,
    "isFavCustomer": false,
    "status": "cooked",
    "cookTime": "02:27",
    "suggestedCookTime": "10分00秒",
    "phoneTail": "9091",
    "remark": "顾客需要餐具；",
    "estimatedIncome": 15.08,
    "products": [
      { "name": "椰子三兄弟(大杯500ml 正常冰)", "unitPrice": 32, "quantity": 1, "totalPrice": 22.4 }
    ],
    "deliveryType": "meituan",
    "isFlashDelivery": false,
    "riderName": "徐嘉威",
    "commissionRate": 7.2,
    "commissionAmount": 1.42,
    "deliverySubsidy": 3.7,
    "orderDiscount": 0,
    "packFee": 1,
    "buttons": [
      { "text": "标记顾客", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "发起聊天", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "点击查看", "className": "roo-btn roo-btn-default roo-btn-xs roo-btn-normal" },
      { "text": "点击查看", "className": "roo-btn roo-btn-default roo-btn-xs roo-btn-normal" },
      { "text": "点击查看", "className": "roo-btn roo-btn-default roo-btn-xs roo-btn-normal" },
      { "text": "查看地图", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "评价骑手\n待评价", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "退款", "className": "roo-btn roo-btn-primary roo-btn-sm roo-btn-normal" },
      { "text": "补发", "className": "roo-btn roo-btn-primary roo-btn-sm roo-btn-normal" },
      { "text": "复制订单", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" }
    ]
  },
  {
    "orderNo": "2002156730764519755",
    "orderIndex": 7,
    "orderTime": "06-06 17:35",
    "deliverTime": "06-06 18:05",
    "customerName": "蒋先生",
    "isNewCustomer": false,
    "customerOrderCount": 3,
    "isFavCustomer": false,
    "status": "cooked",
    "cookTime": "03:19",
    "suggestedCookTime": "10分03秒",
    "phoneTail": "1452",
    "remark": "顾客需要餐具；",
    "estimatedIncome": 45.75,
    "products": [
      { "name": "芒果椰子冻～没有芒果椰子冻解决不了的不开心(去掉脆波波)", "unitPrice": 32, "quantity": 2, "totalPrice": 64 }
    ],
    "deliveryType": "meituan",
    "isFlashDelivery": false,
    "riderName": "石志平",
    "commissionRate": 7.2,
    "commissionAmount": 4.17,
    "deliverySubsidy": 6,
    "orderDiscount": 2,
    "packFee": 1.96,
    "buttons": [
      { "text": "标记顾客", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "发起聊天", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" },
      { "text": "退款", "className": "roo-btn roo-btn-primary roo-btn-sm roo-btn-normal" },
      { "text": "补发", "className": "roo-btn roo-btn-primary roo-btn-sm roo-btn-normal" },
      { "text": "复制订单", "className": "roo-btn roo-btn-default roo-btn-sm roo-btn-normal" }
    ]
  }
];

// ==================== 提取函数（可在控制台/MCP中执行） ====================

/**
 * 提取当前页面所有订单数据
 * 需要在美团商家版订单页面（iframe 内）执行
 * 如果在外层页面执行，会自动进入 iframe
 */
function extractOrders() {
  // 判断是否在 iframe 内
  let doc = document;
  let win = window;

  if (window.self === window.top) {
    // 在外层，需要进入 iframe
    const iframe = document.getElementById('hashframe');
    if (!iframe) {
      console.error('未找到 hashframe iframe');
      return null;
    }
    try {
      doc = iframe.contentDocument || iframe.contentWindow.document;
      win = iframe.contentWindow;
    } catch (e) {
      console.error('无法访问 iframe 内容（可能跨域）', e);
      return null;
    }
  }

  // 订单卡片选择器（class 可能含 hash，用 *= 匹配）
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
    const productLines = [];
    const productRegex = /([一-龥\w·～""（）()（）]+(?:\([^)]*\))*)\s*[￥¥](\d+\.?\d*)\s*x\s*(\d+)\s*[￥¥](\d+\.?\d*)/g;
    let pm;
    while ((pm = productRegex.exec(allText)) !== null) {
      productLines.push({
        name: pm[1],
        unitPrice: parseFloat(pm[2]),
        quantity: parseInt(pm[3]),
        totalPrice: parseFloat(pm[4])
      });
    }
    data.products = productLines;

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

    // 操作按钮
    const buttons = card.querySelectorAll('button');
    data.buttons = [];
    for (const btn of buttons) {
      data.buttons.push({
        text: btn.innerText.trim(),
        className: btn.className || ''
      });
    }

    // 保存 DOM 引用（方便后续操作）
    data._element = card;

    orders.push(data);
  }

  return orders;
}

// ==================== 自动出餐操作函数 ====================

/**
 * 按订单号点击指定按钮
 * @param {string} orderNo - 订单编号
 * @param {string} buttonText - 按钮文本（如 "出餐完成"、"出餐"）
 * @returns {boolean} 是否点击成功
 */
function clickOrderButton(orderNo, buttonText) {
  let doc = document;
  if (window.self === window.top) {
    const iframe = document.getElementById('hashframe');
    if (!iframe) { console.error('未找到 iframe'); return false; }
    try { doc = iframe.contentDocument || iframe.contentWindow.document; }
    catch (e) { console.error('无法访问 iframe'); return false; }
  }

  const cards = doc.querySelectorAll('[class*="order-card"]');
  for (const card of cards) {
    const text = card.innerText || '';
    // 先匹配订单号
    const match = text.match(/订单编号[：:]\s*(\d+)/);
    if (match && match[1] === orderNo) {
      const buttons = card.querySelectorAll('button');
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
}

/**
 * 一键出餐：找到所有"待出餐"订单，逐个点击出餐按钮
 * @param {number} intervalMs - 每次点击间隔（毫秒），默认 2000
 * @returns {number} 成功点击出餐的订单数
 */
function autoCookAll(intervalMs = 2000) {
  let doc = document;
  if (window.self === window.top) {
    const iframe = document.getElementById('hashframe');
    if (!iframe) { console.error('未找到 iframe'); return 0; }
    try { doc = iframe.contentDocument || iframe.contentWindow.document; }
    catch (e) { console.error('无法访问 iframe'); return 0; }
  }

  const cards = doc.querySelectorAll('[class*="order-card"]');
  let count = 0;

  for (const card of cards) {
    const text = card.innerText || '';
    // 只处理"待出餐"状态的订单
    if (text.includes('待出餐')) {
      const match = text.match(/订单编号[：:]\s*(\d+)/);
      const orderNo = match ? match[1] : '';
      const buttons = card.querySelectorAll('button');
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

  if (count === 0) console.log('没有待出餐订单');
  else console.log(`🚀 将自动出餐 ${count} 单，间隔 ${intervalMs}ms`);
  return count;
}

  // 也可能在订单卡片外有出餐操作
  console.warn(`⚠️ 未找到出餐按钮: 订单 ${orderCard.orderNo}，可能不是"待出餐"状态`);
  return false;
}

/**
 * 筛选特定状态的订单
 */
function filterOrders(orders, status) {
  return orders.filter(o => o.status === status);
}

/**
 * 等待新订单出现（轮询方式）
 * @param {number} intervalMs - 轮询间隔（毫秒），默认 3000
 * @param {number} maxWaitMs - 最大等待时间（毫秒），默认 60000
 * @param {function} onNewOrder - 新订单回调
 */
function watchForNewOrders(intervalMs = 3000, maxWaitMs = 60000, onNewOrder) {
  let knownOrders = new Set();
  const startTime = Date.now();

  // 初始化已知订单
  const initial = extractOrders();
  if (initial) {
    initial.forEach(o => knownOrders.add(o.orderNo));
    console.log(`📋 已知 ${knownOrders.size} 个订单，开始监听...`);
  }

  const timer = setInterval(() => {
    if (Date.now() - startTime > maxWaitMs) {
      clearInterval(timer);
      console.log('⏰ 监听超时');
      return;
    }

    const current = extractOrders();
    if (!current) return;

    current.forEach(o => {
      if (!knownOrders.has(o.orderNo)) {
        knownOrders.add(o.orderNo);
        console.log(`🆕 新订单: #${o.orderIndex} ${o.customerName} - ${o.status}`);
        if (onNewOrder) onNewOrder(o);
      }
    });
  }, intervalMs);

  return timer;
}

// ==================== 导出 ====================
// 如果在 Node.js 环境中
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractOrders, clickCookButton, filterOrders, watchForNewOrders };
}