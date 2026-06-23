-- ============================================================
-- 外卖运营助手 — 新建表 DDL（14张表）
-- 在 Supabase SQL Editor 粘贴执行
-- ============================================================

-- ============================================================
-- 1. 店铺注册
-- ============================================================
create table if not exists stores (
  id          bigint generated always as identity primary key,
  name        text not null,
  platform    text not null default 'meituan',
  address     text,
  phone       text,
  notes       text,
  created_at  timestamptz default now()
);
comment on table stores is '店铺注册表';
comment on column stores.name is '店铺名称';
comment on column stores.platform is '所属平台: meituan / eleme / taobao';

-- ============================================================
-- 2. 自有菜品
-- ============================================================
create table if not exists dishes (
  id            bigint generated always as identity primary key,
  store_id      bigint not null references stores(id) on delete cascade,
  name          text not null,
  category      text default '未分类',
  cost_price    real not null default 0,
  selling_price real not null default 0,
  status        text default '上架',
  process_desc  text,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_dishes_store on dishes(store_id);
create index if not exists idx_dishes_status on dishes(status);
create index if not exists idx_dishes_category on dishes(category);
comment on table dishes is '自有菜品管理';
comment on column dishes.store_id is '所属店铺';
comment on column dishes.name is '菜品标准名称';
comment on column dishes.category is '分类: 主食/小吃/饮品/自定义';
comment on column dishes.cost_price is '单份制作成本（元）';
comment on column dishes.selling_price is '平台展示售价（元）';
comment on column dishes.status is '上架/下架';
comment on column dishes.process_desc is '制作流程描述';
comment on column dishes.notes is '备注';

-- ============================================================
-- 3. 菜品别名
-- ============================================================
create table if not exists dish_aliases (
  id         bigint generated always as identity primary key,
  dish_id    bigint not null references dishes(id) on delete cascade,
  alias_name text not null,
  created_at timestamptz default now(),
  unique(dish_id, alias_name)
);
create index if not exists idx_aliases_dish on dish_aliases(dish_id);
comment on table dish_aliases is '菜品别名表，用于平台菜品模糊匹配';
comment on column dish_aliases.alias_name is '别名（如"秘制红烧肉"）';

-- ============================================================
-- 4. 菜品成本变更历史
-- ============================================================
create table if not exists dish_cost_history (
  id         bigint generated always as identity primary key,
  dish_id    bigint not null references dishes(id) on delete cascade,
  old_cost   real not null,
  new_cost   real not null,
  changed_at timestamptz default now()
);
create index if not exists idx_cost_hist_dish on dish_cost_history(dish_id);
comment on table dish_cost_history is '菜品成本变更历史，自动记录';

-- ============================================================
-- 5. 平台菜品 → 自有菜品映射
-- ============================================================
create table if not exists dish_mappings (
  id                bigint generated always as identity primary key,
  platform          text not null,
  platform_dish_name text not null,
  dish_id           bigint references dishes(id) on delete set null,
  status            text default 'pending',
  confirm_score     real,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique(platform, platform_dish_name)
);
create index if not exists idx_mappings_platform on dish_mappings(platform);
create index if not exists idx_mappings_dish on dish_mappings(dish_id);
create index if not exists idx_mappings_status on dish_mappings(status);
comment on table dish_mappings is '平台菜品到自有菜品的映射关系';
comment on column dish_mappings.platform is '平台: meituan/eleme/taobao';
comment on column dish_mappings.platform_dish_name is '平台商品名称';
comment on column dish_mappings.status is 'matched/manual/pending/ignored';
comment on column dish_mappings.confirm_score is '自动匹配置信度 0~1';

-- ============================================================
-- 6. 平台菜品导入批次
-- ============================================================
create table if not exists platform_dish_imports (
  id           bigint generated always as identity primary key,
  platform     text not null,
  store_id     bigint references stores(id) on delete cascade,
  filename     text,
  total_rows   integer default 0,
  matched_rows integer default 0,
  pending_rows integer default 0,
  imported_at  timestamptz default now()
);
comment on table platform_dish_imports is '平台菜品批量导入批次记录';

-- ============================================================
-- 7. 导入的平台原始菜品数据
-- ============================================================
create table if not exists imported_platform_dishes (
  id                  bigint generated always as identity primary key,
  import_id           bigint not null references platform_dish_imports(id) on delete cascade,
  platform_dish_name  text not null,
  platform_price      real default 0,
  platform_sales      integer default 0,
  status              text default 'pending',
  dish_id             bigint references dishes(id) on delete set null,
  notes               text
);
create index if not exists idx_imp_dishes_import on imported_platform_dishes(import_id);
create index if not exists idx_imp_dishes_status on imported_platform_dishes(status);
comment on table imported_platform_dishes is '批量导入的平台原始菜品数据';
comment on column imported_platform_dishes.status is 'matched/pending/unmatched';

-- ============================================================
-- 8. 每日运营成本（聚合头）
-- ============================================================
create table if not exists daily_op_costs (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references stores(id) on delete cascade,
  date       date not null,
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(store_id, date)
);
create index if not exists idx_daily_cost_store on daily_op_costs(store_id);
create index if not exists idx_daily_cost_date on daily_op_costs(date);
comment on table daily_op_costs is '每日运营成本记录（按店铺+日期唯一）';

-- ============================================================
-- 9. 运营成本明细项
-- ============================================================
create table if not exists daily_op_cost_items (
  id               bigint generated always as identity primary key,
  daily_op_cost_id bigint not null references daily_op_costs(id) on delete cascade,
  category         text not null,
  name             text,
  amount           real not null default 0,
  notes            text
);
create index if not exists idx_cost_items_parent on daily_op_cost_items(daily_op_cost_id);
comment on table daily_op_cost_items is '每日运营成本明细项';
comment on column daily_op_cost_items.category is 'promotion/bawangcan/subsidy/other';

-- ============================================================
-- 10. 固定成本
-- ============================================================
create table if not exists fixed_costs (
  id             bigint generated always as identity primary key,
  store_id       bigint not null references stores(id) on delete cascade,
  name           text not null,
  category       text not null default 'other',
  monthly_amount real not null default 0,
  is_active      boolean default true,
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_fixed_cost_store on fixed_costs(store_id);
comment on table fixed_costs is '固定成本设置，按店铺隔离';
comment on column fixed_costs.category is 'rent/utility/labor/other';
comment on column fixed_costs.monthly_amount is '月金额，系统按日自动摊算';
comment on column fixed_costs.is_active is '暂停期间不计入';

-- ============================================================
-- 11. 运营报告
-- ============================================================
create table if not exists reports (
  id          bigint generated always as identity primary key,
  store_id    bigint references stores(id) on delete cascade,
  type        text not null,
  report_date date not null,
  start_date  date,
  end_date    date,
  content     jsonb default '{}',
  ai_analysis text,
  created_at  timestamptz default now()
);
create index if not exists idx_reports_store on reports(store_id);
create index if not exists idx_reports_date on reports(report_date);
comment on table reports is '日报/周报';
comment on column reports.type is 'daily / weekly';
comment on column reports.content is '报告结构化内容 JSONB';
comment on column reports.ai_analysis is 'AI 分析文本';

-- ============================================================
-- 12. 报告模板
-- ============================================================
create table if not exists report_templates (
  id               bigint generated always as identity primary key,
  store_id         bigint references stores(id) on delete cascade,
  name             text not null,
  included_modules jsonb default '[]',
  is_default       boolean default false,
  created_at       timestamptz default now()
);
comment on table report_templates is '自定义报告模板';
comment on column report_templates.included_modules is '勾选的指标模块列表 JSON';

-- ============================================================
-- 13. 推送配置
-- ============================================================
create table if not exists push_configs (
  id         bigint generated always as identity primary key,
  store_id   bigint references stores(id) on delete cascade,
  channel    text not null,
  enabled    boolean default false,
  config     jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(store_id, channel)
);
comment on table push_configs is '报告推送配置';
comment on column push_configs.channel is 'email/wechat/dingtalk';

-- ============================================================
-- 14. 用户角色
-- ============================================================
create table if not exists user_roles (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'operator',
  store_id   bigint references stores(id) on delete set null,
  created_at timestamptz default now(),
  unique(user_id)
);
create index if not exists idx_user_roles_user on user_roles(user_id);
comment on table user_roles is '用户角色权限表';
comment on column user_roles.role is 'admin/operator/boss';
comment on column user_roles.store_id is 'null=全店铺访问';
