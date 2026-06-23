-- ============================================================
-- 外卖运营助手 — RLS 策略
-- 在 Supabase SQL Editor 粘贴执行（在 02_new_tables.sql 之后）
-- ============================================================

-- 所有新表启用 RLS
alter table stores enable row level security;
alter table dishes enable row level security;
alter table dish_aliases enable row level security;
alter table dish_cost_history enable row level security;
alter table dish_mappings enable row level security;
alter table platform_dish_imports enable row level security;
alter table imported_platform_dishes enable row level security;
alter table daily_op_costs enable row level security;
alter table daily_op_cost_items enable row level security;
alter table fixed_costs enable row level security;
alter table reports enable row level security;
alter table report_templates enable row level security;
alter table push_configs enable row level security;
alter table user_roles enable row level security;

-- ============================================================
-- 通用策略：已认证用户可读
-- ============================================================
create policy "auth_select_stores" on stores for select to authenticated using (true);
create policy "auth_select_dishes" on dishes for select to authenticated using (true);
create policy "auth_select_aliases" on dish_aliases for select to authenticated using (true);
create policy "auth_select_cost_hist" on dish_cost_history for select to authenticated using (true);
create policy "auth_select_mappings" on dish_mappings for select to authenticated using (true);
create policy "auth_select_imports" on platform_dish_imports for select to authenticated using (true);
create policy "auth_select_imp_dishes" on imported_platform_dishes for select to authenticated using (true);
create policy "auth_select_daily_cost" on daily_op_costs for select to authenticated using (true);
create policy "auth_select_cost_items" on daily_op_cost_items for select to authenticated using (true);
create policy "auth_select_fixed_cost" on fixed_costs for select to authenticated using (true);
create policy "auth_select_reports" on reports for select to authenticated using (true);
create policy "auth_select_templates" on report_templates for select to authenticated using (true);
create policy "auth_select_push" on push_configs for select to authenticated using (true);
create policy "auth_select_roles" on user_roles for select to authenticated using (true);

-- ============================================================
-- 写策略：admin 和 operator 可写，boss 只读
-- 通过检查 user_roles 表判断角色
-- ============================================================
create or replace function is_admin_or_operator()
returns boolean as $$
  select exists(
    select 1 from user_roles
    where user_id = auth.uid()
    and role in ('admin', 'operator')
  );
$$ language sql stable security definer;

create or replace function is_boss()
returns boolean as $$
  select exists(
    select 1 from user_roles
    where user_id = auth.uid()
    and role = 'boss'
  );
$$ language sql stable security definer;

-- stores 写策略
create policy "auth_insert_stores" on stores for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_stores" on stores for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_stores" on stores for delete to authenticated using (is_admin_or_operator());

-- dishes 写策略
create policy "auth_insert_dishes" on dishes for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_dishes" on dishes for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_dishes" on dishes for delete to authenticated using (is_admin_or_operator());

-- dish_aliases 写策略
create policy "auth_insert_aliases" on dish_aliases for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_aliases" on dish_aliases for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_aliases" on dish_aliases for delete to authenticated using (is_admin_or_operator());

-- dish_cost_history 写策略（自动记录，通常不允许手动修改）
create policy "auth_insert_cost_hist" on dish_cost_history for insert to authenticated with check (is_admin_or_operator());
create policy "auth_delete_cost_hist" on dish_cost_history for delete to authenticated using (is_admin_or_operator());

-- dish_mappings 写策略
create policy "auth_insert_mappings" on dish_mappings for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_mappings" on dish_mappings for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_mappings" on dish_mappings for delete to authenticated using (is_admin_or_operator());

-- platform_dish_imports 写策略
create policy "auth_insert_imports" on platform_dish_imports for insert to authenticated with check (is_admin_or_operator());
create policy "auth_delete_imports" on platform_dish_imports for delete to authenticated using (is_admin_or_operator());

-- imported_platform_dishes 写策略
create policy "auth_insert_imp_dishes" on imported_platform_dishes for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_imp_dishes" on imported_platform_dishes for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_imp_dishes" on imported_platform_dishes for delete to authenticated using (is_admin_or_operator());

-- daily_op_costs 写策略
create policy "auth_insert_daily_cost" on daily_op_costs for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_daily_cost" on daily_op_costs for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_daily_cost" on daily_op_costs for delete to authenticated using (is_admin_or_operator());

-- daily_op_cost_items 写策略
create policy "auth_insert_cost_items" on daily_op_cost_items for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_cost_items" on daily_op_cost_items for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_cost_items" on daily_op_cost_items for delete to authenticated using (is_admin_or_operator());

-- fixed_costs 写策略
create policy "auth_insert_fixed_cost" on fixed_costs for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_fixed_cost" on fixed_costs for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_fixed_cost" on fixed_costs for delete to authenticated using (is_admin_or_operator());

-- reports 写策略
create policy "auth_insert_reports" on reports for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_reports" on reports for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_reports" on reports for delete to authenticated using (is_admin_or_operator());

-- report_templates 写策略
create policy "auth_insert_templates" on report_templates for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_templates" on report_templates for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_templates" on report_templates for delete to authenticated using (is_admin_or_operator());

-- push_configs 写策略
create policy "auth_insert_push" on push_configs for insert to authenticated with check (is_admin_or_operator());
create policy "auth_update_push" on push_configs for update to authenticated using (is_admin_or_operator()) with check (is_admin_or_operator());
create policy "auth_delete_push" on push_configs for delete to authenticated using (is_admin_or_operator());

-- user_roles 只有 admin 可以管理
create or replace function is_admin()
returns boolean as $$
  select exists(
    select 1 from user_roles
    where user_id = auth.uid()
    and role = 'admin'
  );
$$ language sql stable security definer;

create policy "auth_insert_roles" on user_roles for insert to authenticated with check (is_admin());
create policy "auth_update_roles" on user_roles for update to authenticated using (is_admin()) with check (is_admin());
create policy "auth_delete_roles" on user_roles for delete to authenticated using (is_admin());

-- ============================================================
-- 注意：现有 orders/order_products/order_events 的 RLS 保持全开（anon 可读写）
-- 不要修改这 3 张表的策略，以免影响订单数据同步
-- ============================================================
