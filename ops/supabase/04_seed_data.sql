-- ============================================================
-- 外卖运营助手 — 初始数据
-- 在 Supabase SQL Editor 粘贴执行（最后一步）
-- ============================================================

-- 从现有 orders 表提取已有店铺
insert into stores (name, platform) values
  ('暖燕·姨妈热饮·鲜炖燕窝(青浦宝龙店)', 'meituan')
on conflict do nothing;

-- 初始固定成本模板（后续可在 UI 中修改）
insert into fixed_costs (store_id, name, category, monthly_amount, is_active)
select id, '门店月租金', 'rent', 0, true from stores
union all
select id, '水电费', 'utility', 0, true from stores
union all
select id, '员工人工成本', 'labor', 0, true from stores
union all
select id, '设备折旧摊销', 'other', 0, false from stores;

-- 默认报告模板
insert into report_templates (name, included_modules, is_default) values
  ('标准日报模板', '["kpi_cards","revenue_waterfall","cost_breakdown","top_dishes","anomaly_alerts","ai_analysis"]', true),
  ('标准周报模板', '["weekly_summary","daily_trend_chart","user_structure","cost_structure","top_dishes_weekly","ai_analysis"]', true);

-- 默认推送配置（全部关闭，需用户在 UI 手动开启）
insert into push_configs (store_id, channel, enabled)
select id, 'email', false from stores
union all
select id, 'dingtalk', false from stores;

-- ============================================================
-- 注意：user_roles 表需要在用户注册后由 admin 手动分配角色
-- 注册的第一个用户自动成为 admin，在应用代码中处理
-- ============================================================
