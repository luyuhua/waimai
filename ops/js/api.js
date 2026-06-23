// ========= SUPABASE CLIENT =========
const supabase = window._supabaseCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========= MOCK DATA =========
const DISHES = [
  {id:1,name:'叉烧饭',cat:'主食',cost:12,price:28,store:'旺角港式茶餐厅',status:'上架',sales:420},
  {id:2,name:'冰镇奶茶',cat:'饮品',cost:5,price:16,store:'旺角港式茶餐厅',status:'上架',sales:380},
  {id:3,name:'麻辣烫套餐',cat:'主食',cost:22,price:38,store:'尖沙咀麻辣烫',status:'上架',sales:320},
  {id:4,name:'鱼蛋河粉',cat:'主食',cost:10,price:25,store:'旺角港式茶餐厅',status:'上架',sales:280},
  {id:5,name:'港式煲仔饭',cat:'主食',cost:19,price:32,store:'旺角港式茶餐厅',status:'上架',sales:250},
  {id:6,name:'清炒时蔬',cat:'小吃',cost:6,price:18,store:'尖沙咀麻辣烫',status:'上架',sales:210},
  {id:7,name:'蜜汁叉烧',cat:'主食',cost:18,price:38,store:'旺角港式茶餐厅',status:'上架',sales:165},
  {id:8,name:'虾饺蒸笼',cat:'小吃',cost:20,price:42,store:'旺角港式茶餐厅',status:'下架',sales:130},
  {id:9,name:'招牌红烧肉',cat:'主食',cost:28,price:45,store:'旺角港式茶餐厅',status:'上架',sales:180},
  {id:10,name:'卤水猪蹄',cat:'小吃',cost:30,price:48,store:'尖沙咀麻辣烫',status:'上架',sales:95}
];

const FIXED_COSTS = [
  {id:1,name:'门店月租金',monthly:12000,store:'旺角港式茶餐厅',active:true},
  {id:2,name:'水电费',monthly:3200,store:'旺角港式茶餐厅',active:true},
  {id:3,name:'员工人工成本',monthly:45000,store:'旺角港式茶餐厅',active:true},
  {id:4,name:'设备折旧摊销',monthly:1800,store:'旺角港式茶餐厅',active:false},
];

const DISH_MAPPINGS = [
  {id:1,platform:'meituan',platformName:'招牌红烧肉（大份）',ownName:'招牌红烧肉',category:'主食',matchCount:156},
  {id:2,platform:'taobao',platformName:'港式叉烧饭套餐',ownName:'叉烧饭',category:'主食',matchCount:420},
  {id:3,platform:'taobao',platformName:'珍珠奶茶冰镇款',ownName:'冰镇奶茶',category:'饮品',matchCount:380},
  {id:4,platform:'meituan',platformName:'麻辣烫单人套餐',ownName:'麻辣烫套餐',category:'主食',matchCount:320},
  {id:5,platform:'taobao',platformName:'蜜汁叉烧大份',ownName:'叉烧饭',category:'主食',matchCount:0},
];

const MATCH_PENDING = [
  {id:1,src:'【特价】辣子鸡丁+米饭单人套餐',plat:'美团外卖',candidates:['麻辣烫套餐','叉烧饭','港式煲仔饭']},
  {id:2,src:'盲盒新品尝鲜惊喜套餐',plat:'淘宝闪购',candidates:[]},
  {id:3,src:'夜宵档加大份叉烧饭',plat:'淘宝闪购',candidates:['叉烧饭','蜜汁叉烧']},
];

const REPORTS = [
  {id:'r1',type:'daily',date:'2026-06-22',store:'全部店铺',income:24850,gross:14462,net:9542,orders:763,ai:true},
  {id:'r2',type:'daily',date:'2026-06-21',store:'全部店铺',income:22380,gross:13008,net:8921,orders:718,ai:true},
  {id:'r3',type:'daily',date:'2026-06-20',store:'全部店铺',income:26100,gross:15232,net:10120,orders:812,ai:true},
  {id:'r4',type:'weekly',date:'2026-06-16 ~ 2026-06-22',store:'全部店铺',income:168320,gross:97946,net:65388,orders:5124,ai:true},
  {id:'r5',type:'daily',date:'2026-06-19',store:'全部店铺',income:19540,gross:11358,net:7841,orders:621,ai:false},
];

const CUSTOMERS = [
  {rank:1,id:'C0023',orders:28,spend:986,lastOrder:'今日',tag:'高频老客'},
  {rank:2,id:'C0087',orders:22,spend:728,lastOrder:'昨日',tag:'高频老客'},
  {rank:3,id:'C0156',orders:19,spend:612,lastOrder:'今日',tag:''},
  {rank:4,id:'C0341',orders:15,spend:491,lastOrder:'3天前',tag:''},
  {rank:5,id:'C0502',orders:14,spend:453,lastOrder:'今日',tag:''},
];

// ========= AUTH =========
async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// ========= STORES =========
async function apiFetchStores() {
  if (!USE_REAL_DATA) return [{ id: 1, name: '旺角港式茶餐厅', platform: 'meituan' }];
  const { data, error } = await supabase.from('stores').select('*').order('id');
  if (error) throw error;
  return data;
}

async function apiCreateStore(store) {
  const { data, error } = await supabase.from('stores').insert(store).select().single();
  if (error) throw error;
  return data;
}

// ========= FIELD MAPPING HELPERS =========
function dbToJs(d) {
  return {
    id: d.id,
    name: d.name,
    cat: d.category || '未分类',
    cost: d.cost_price || 0,
    price: d.selling_price || 0,
    store_id: d.store_id,
    store: d.stores?.name || '',
    status: d.status || '上架',
    proc: d.process_desc || '',
    note: d.notes || '',
    created_at: d.created_at,
    updated_at: d.updated_at
  };
}

function jsToDb(dish) {
  const db = {};
  if (dish.name !== undefined) db.name = dish.name;
  if (dish.cat !== undefined) db.category = dish.cat;
  if (dish.cost !== undefined) db.cost_price = dish.cost;
  if (dish.price !== undefined) db.selling_price = dish.price;
  if (dish.store_id !== undefined) db.store_id = dish.store_id;
  if (dish.status !== undefined) db.status = dish.status;
  if (dish.proc !== undefined) db.process_desc = dish.proc;
  if (dish.note !== undefined) db.notes = dish.note;
  if (dish.cost_price !== undefined) db.cost_price = dish.cost_price;
  if (dish.category !== undefined) db.category = dish.category;
  if (dish.selling_price !== undefined) db.selling_price = dish.selling_price;
  if (dish.process_desc !== undefined) db.process_desc = dish.process_desc;
  db.updated_at = new Date().toISOString();
  return db;
}

function dbToJsFixedCost(c) {
  return {
    id: c.id,
    name: c.name,
    monthly: c.monthly_amount,
    store: c.stores?.name || '',
    store_id: c.store_id,
    active: c.is_active,
    category: c.category
  };
}

// ========= DISHES (真实数据) =========
async function apiFetchDishes(storeId) {
  if (!USE_REAL_DATA) return DISHES;
  let q = supabase.from('dishes').select('*, stores(name)').order('id');
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(dbToJs);
}

async function apiCreateDish(dish) {
  if (!USE_REAL_DATA) {
    const d = { ...dish, id: DISHES.length + 1, sales: 0, store: '旺角港式茶餐厅' };
    DISHES.push(d);
    return d;
  }
  const insert = jsToDb(dish);
  if (!insert.name) insert.name = dish.name || '';
  if (!insert.category) insert.category = dish.cat || dish.category || '未分类';
  if (!insert.cost_price) insert.cost_price = dish.cost || dish.cost_price || 0;
  if (!insert.selling_price) insert.selling_price = dish.price || dish.selling_price || 0;
  if (!insert.status) insert.status = dish.status || '上架';
  delete insert.updated_at;
  const { data, error } = await supabase.from('dishes').insert(insert).select().single();
  if (error) throw error;
  return dbToJs(data);
}

async function apiUpdateDish(id, updates) {
  if (!USE_REAL_DATA) {
    const idx = DISHES.findIndex(d => d.id === id);
    if (idx >= 0) Object.assign(DISHES[idx], updates);
    return DISHES[idx];
  }
  const db = jsToDb(updates);
  const { data, error } = await supabase.from('dishes').update(db).eq('id', id).select().single();
  if (error) throw error;
  return dbToJs(data);
}

async function apiDeleteDish(id) {
  if (!USE_REAL_DATA) {
    const idx = DISHES.findIndex(d => d.id === id);
    if (idx >= 0) DISHES.splice(idx, 1);
    return true;
  }
  const { error } = await supabase.from('dishes').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ========= DISH ALIASES =========
async function apiFetchAliases(dishId) {
  if (!USE_REAL_DATA) return [];
  const { data, error } = await supabase.from('dish_aliases').select('*').eq('dish_id', dishId);
  if (error) throw error;
  return data;
}

async function apiCreateAlias(alias) {
  const { data, error } = await supabase.from('dish_aliases').insert(alias).select().single();
  if (error) throw error;
  return data;
}

async function apiDeleteAlias(id) {
  const { error } = await supabase.from('dish_aliases').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ========= DISH MAPPINGS =========
function mappingDbToJs(m) {
  return {
    id: m.id,
    platform: m.platform,
    platformName: m.platform_dish_name,
    platform_dish_name: m.platform_dish_name,
    ownName: m.dishes?.name || '',
    ownNames: m.dishes?.name ? [m.dishes.name] : [],
    dishName: m.dishes?.name || '',
    category: m.dishes?.category || m.category || '',
    matchCount: m.order_count || 0,
    status: m.status,
    dish_id: m.dish_id,
    confirm_score: m.confirm_score
  };
}

async function apiFetchMappings(filterStatus) {
  if (!USE_REAL_DATA) return DISH_MAPPINGS;
  let q = supabase.from('dish_mappings').select('*, dishes(name, category)');
  if (filterStatus) q = q.eq('status', filterStatus);
  const { data, error } = await q.order('id');
  if (error) throw error;
  return data.map(mappingDbToJs);
}

async function apiCreateMapping(mapping) {
  if (!USE_REAL_DATA) {
    const m = { ...mapping, id: DISH_MAPPINGS.length + 1, matchCount: 0 };
    DISH_MAPPINGS.push(m);
    return m;
  }
  const { data, error } = await supabase.from('dish_mappings').insert(mapping).select().single();
  if (error) throw error;
  return data;
}

async function apiUpdateMapping(id, updates) {
  if (!USE_REAL_DATA) {
    const idx = DISH_MAPPINGS.findIndex(m => m.id === id);
    if (idx >= 0) Object.assign(DISH_MAPPINGS[idx], updates);
    return DISH_MAPPINGS[idx];
  }
  const { data, error } = await supabase.from('dish_mappings').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function apiDeleteMapping(id) {
  if (!USE_REAL_DATA) {
    const idx = DISH_MAPPINGS.findIndex(m => m.id === id);
    if (idx >= 0) DISH_MAPPINGS.splice(idx, 1);
    return true;
  }
  const { error } = await supabase.from('dish_mappings').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ========= PRODUCT AUTO-EXTRACTION (核心新功能) =========
async function apiAutoExtractProducts() {
  if (!USE_REAL_DATA) return MATCH_PENDING;

  // 从 order_products 提取所有唯一平台商品名（带平台信息）
  const { data: products, error } = await supabase
    .from('order_products')
    .select('name, orders!inner(platform, shop_name)');

  if (error) throw error;

  // 按 (platform, name) 去重并统计出现次数
  const map = new Map();
  for (const p of products) {
    const key = `${p.orders.platform}|||${p.name}`;
    if (!map.has(key)) {
      map.set(key, { platform: p.orders.platform, platform_dish_name: p.name, count: 0 });
    }
    map.get(key).count++;
  }

  // 获取已有的 mappings
  const { data: existing } = await supabase.from('dish_mappings').select('*');

  // 构建已有映射的查找索引
  const existingIdx = new Set(existing.map(m => `${m.platform}|||${m.platform_dish_name}`));

  // 对不存在的插入 pending 记录
  const results = [];
  for (const [key, item] of map) {
    if (!existingIdx.has(key)) {
      const { data: created } = await supabase
        .from('dish_mappings')
        .insert({
          platform: item.platform,
          platform_dish_name: item.platform_dish_name,
          status: 'pending'
        })
        .select()
        .single();
      if (created) results.push({ ...created, order_count: item.count });
    } else {
      const found = existing.find(m => m.platform === item.platform && m.platform_dish_name === item.platform_dish_name);
      results.push({ ...found, order_count: item.count });
    }
  }

  return results;
}

// 获取待关联列表（status=pending）
async function apiFetchPendingMappings() {
  if (!USE_REAL_DATA) return MATCH_PENDING;

  const { data, error } = await supabase
    .from('dish_mappings')
    .select('*, dishes(name, category)')
    .eq('status', 'pending')
    .order('id');
  if (error) throw error;

  // 加上出现次数统计
  const { data: products } = await supabase
    .from('order_products')
    .select('name, orders!inner(platform)');

  const countMap = new Map();
  for (const p of products) {
    const key = `${p.orders.platform}|||${p.name}`;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }

  return data.map(m => {
    const base = mappingDbToJs(m);
    const key = `${m.platform}|||${m.platform_dish_name}`;
    return { ...base, order_count: countMap.get(key) || 0 };
  });
}

// 忽略平台商品
async function apiIgnoreMapping(id) {
  return apiUpdateMapping(id, { status: 'ignored' });
}

// ========= 店铺自动发现 =========
async function apiAutoDiscoverStores() {
  if (!USE_REAL_DATA) return [{ id: 1, name: '旺角港式茶餐厅', platform: 'meituan' }];

  // 从 orders 表提取唯一店铺
  const { data: shops, error } = await supabase
    .from('orders')
    .select('platform, shop_name');

  if (error) throw error;

  // 去重
  const seen = new Set();
  const unique = [];
  for (const s of shops) {
    const key = `${s.platform}|||${s.shop_name}`;
    if (!seen.has(key) && s.shop_name) {
      seen.add(key);
      unique.push({ platform: s.platform, shop_name: s.shop_name });
    }
  }

  // 检查哪些已存在
  const { data: existing } = await supabase.from('stores').select('name, platform');
  const existingKeys = new Set(existing.map(s => `${s.platform}|||${s.name}`));

  // 插入不存在的
  const created = [];
  for (const u of unique) {
    const key = `${u.platform}|||${u.shop_name}`;
    if (!existingKeys.has(key)) {
      const { data: store } = await supabase
        .from('stores')
        .insert({ name: u.shop_name, platform: u.platform })
        .select()
        .single();
      if (store) created.push(store);
    } else {
      const found = existing.find(s => s.platform === u.platform && s.name === u.shop_name);
      if (found) created.push(found);
    }
  }

  return created;
}

// ========= FIXED COSTS (真实数据) =========
async function apiFetchFixedCosts(storeId) {
  if (!USE_REAL_DATA) return FIXED_COSTS;
  let q = supabase.from('fixed_costs').select('*, stores(name)').order('id');
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(c => ({
    id: c.id,
    name: c.name,
    monthly: c.monthly_amount,
    store: c.stores?.name || '',
    store_id: c.store_id,
    active: c.is_active,
    category: c.category
  }));
}

async function apiCreateFixedCost(cost) {
  if (!USE_REAL_DATA) {
    const c = { ...cost, id: FIXED_COSTS.length + 1, store: '旺角港式茶餐厅' };
    FIXED_COSTS.push(c);
    return c;
  }
  const { data, error } = await supabase.from('fixed_costs').insert({
    store_id: cost.store_id,
    name: cost.name,
    category: cost.category || 'other',
    monthly_amount: cost.monthly,
    is_active: cost.active !== false,
    notes: cost.notes || ''
  }).select('*, stores(name)').single();
  if (error) throw error;
  return dbToJsFixedCost(data);
}

async function apiUpdateFixedCost(id, updates) {
  if (!USE_REAL_DATA) {
    const idx = FIXED_COSTS.findIndex(c => c.id === id);
    if (idx >= 0) Object.assign(FIXED_COSTS[idx], updates);
    return FIXED_COSTS[idx];
  }
  const db = {};
  if (updates.name !== undefined) db.name = updates.name;
  if (updates.monthly !== undefined) db.monthly_amount = updates.monthly;
  if (updates.active !== undefined) db.is_active = updates.active;
  if (updates.category !== undefined) db.category = updates.category;
  if (updates.notes !== undefined) db.notes = updates.notes;
  const { data, error } = await supabase.from('fixed_costs').update(db).eq('id', id).select('*, stores(name)').single();
  if (error) throw error;
  return dbToJsFixedCost(data);
}

async function apiDeleteFixedCost(id) {
  if (!USE_REAL_DATA) {
    const idx = FIXED_COSTS.findIndex(c => c.id === id);
    if (idx >= 0) FIXED_COSTS.splice(idx, 1);
    return true;
  }
  const { error } = await supabase.from('fixed_costs').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ========= DAILY COSTS (真实数据) =========
async function apiFetchDailyCosts(storeId, date) {
  if (!USE_REAL_DATA) return []; // mock: return empty
  let q = supabase.from('daily_op_costs').select('*, daily_op_cost_items(*)').order('date', { ascending: false });
  if (storeId) q = q.eq('store_id', storeId);
  if (date) q = q.eq('date', date);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function apiSaveDailyCost(costData) {
  if (!USE_REAL_DATA) return { id: Date.now() };
  const { store_id, date, items, notes } = costData;

  // upsert head
  const { data: head, error: headErr } = await supabase
    .from('daily_op_costs')
    .upsert({ store_id, date, notes, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (headErr) throw headErr;

  // delete old items and re-insert
  await supabase.from('daily_op_cost_items').delete().eq('daily_op_cost_id', head.id);

  if (items && items.length > 0) {
    const rows = items.map(item => ({
      daily_op_cost_id: head.id,
      category: item.category || 'other',
      name: item.name || '',
      amount: item.amount || 0,
      notes: item.notes || ''
    }));
    const { error: itemsErr } = await supabase.from('daily_op_cost_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }

  return head;
}

// ========= REPORTS =========
async function apiFetchReports(storeId, type) {
  if (!USE_REAL_DATA) return type ? REPORTS.filter(r => r.type === type) : REPORTS;
  let q = supabase.from('reports').select('*').order('report_date', { ascending: false });
  if (storeId) q = q.eq('store_id', storeId);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ========= USER ROLES =========
async function apiFetchUserRole() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase.from('user_roles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) return null;
  return data;
}

// ========= ANALYTICS QUERIES =========
async function apiFetchAllOrdersWithProducts() {
  if (!USE_REAL_DATA) return [];
  const { data, error } = await supabase.from('orders').select('*, order_products(*)').order('order_time');
  if (error) throw error;
  return data;
}
