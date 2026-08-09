-- ============================================================
-- Installments Ledger — Cloud Sync setup (run ONCE in Supabase)
-- ============================================================
-- How to run:
--   1. Sign in at https://supabase.com/dashboard
--   2. Open your project (cgaopjqydylfhkgnqegf)
--   3. Go to SQL Editor -> New query
--   4. Paste ALL of this and press Run.
--
-- What it creates:
--   • il_vaults      — encrypted backup of the ledger
--   • il_users       — user accounts (auth + roles)
--   • il_roles       — role definitions (visibility / page access)
--   • il_settings    — business settings (name, phone, address, currency)
--   • il_customers   — customer records (readable from dashboard)
--   • il_installments— installment schedule per customer
--   • il_payments    — payment history per customer
--   • il_discounts   — discounts per customer
--   • il_logs        — audit log
--   • RLS policies so the app's publishable key can read/write.
-- ============================================================

-- ---------- DROP existing (clean re-run) ----------
DROP TABLE IF EXISTS public.il_discounts    CASCADE;
DROP TABLE IF EXISTS public.il_payments     CASCADE;
DROP TABLE IF EXISTS public.il_installments CASCADE;
DROP TABLE IF EXISTS public.il_customers    CASCADE;
DROP TABLE IF EXISTS public.il_logs         CASCADE;
DROP TABLE IF EXISTS public.il_settings     CASCADE;
DROP TABLE IF EXISTS public.il_vaults       CASCADE;
DROP TABLE IF EXISTS public.il_users        CASCADE;
DROP TABLE IF EXISTS public.il_roles        CASCADE;

-- ---------- CREATE ----------
create table if not exists public.il_vaults (
  owner text primary key,
  enc_salt text not null,
  payload text not null,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.il_users (
  username text primary key,
  pass_hash text not null,
  salt text not null,
  enc_salt text not null,
  pubkey text not null,
  privkey_enc text not null,
  wrapped_key text not null,
  role text not null default '',
  is_admin boolean not null default false,
  status text not null default 'pending',  -- pending | approved | blocked
  created_at timestamptz not null default now()
);

create table if not exists public.il_roles (
  name text primary key,
  kind text not null default 'customers',  -- customers | pages
  colors text not null default '[]',       -- json array of 'pink'/'gold'/'silver'
  pages text not null default '[]'         -- json array of page names
);

create table if not exists public.il_settings (
  key text primary key,
  value text not null
);

create table if not exists public.il_customers (
  id bigint primary key,
  name text not null,
  notes text not null default '',
  cat text not null default 'gold',
  plan_type text not null default 'installments',
  plan_total numeric not null default 0,
  plan_down numeric not null default 0,
  plan_start_date text not null default '',
  plan_frequency text not null default 'monthly',
  plan_count bigint not null default 0,
  plan_amount_per_inst numeric not null default 0,
  box_total numeric,
  box_paid numeric,
  box_remaining numeric,
  created_at text not null default ''
);

create table if not exists public.il_installments (
  customer_id bigint not null,
  inst_num bigint not null,
  due_date text not null,
  amount numeric not null,
  primary key (customer_id, inst_num)
);

create table if not exists public.il_payments (
  id bigint not null,
  customer_id bigint not null,
  date text not null,
  amount numeric not null,
  note text not null default '',
  primary key (id, customer_id)
);

create table if not exists public.il_discounts (
  id bigint not null,
  customer_id bigint not null,
  date text not null,
  inst_num bigint not null default 0,
  amount numeric not null,
  primary key (id, customer_id)
);

create table if not exists public.il_logs (
  id bigint primary key,
  date text not null,
  type text not null default '',
  detail text not null default ''
);

-- ---------- RLS ----------
alter table public.il_vaults enable row level security;
alter table public.il_users enable row level security;
alter table public.il_roles enable row level security;
alter table public.il_settings enable row level security;
alter table public.il_customers enable row level security;
alter table public.il_installments enable row level security;
alter table public.il_payments enable row level security;
alter table public.il_discounts enable row level security;
alter table public.il_logs enable row level security;

-- ---------- Policies ----------
drop policy if exists "il_vaults_all" on public.il_vaults;
create policy "il_vaults_all" on public.il_vaults
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_users_all" on public.il_users;
create policy "il_users_all" on public.il_users
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_roles_all" on public.il_roles;
create policy "il_roles_all" on public.il_roles
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_settings_all" on public.il_settings;
create policy "il_settings_all" on public.il_settings
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_customers_all" on public.il_customers;
create policy "il_customers_all" on public.il_customers
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_installments_all" on public.il_installments;
create policy "il_installments_all" on public.il_installments
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_payments_all" on public.il_payments;
create policy "il_payments_all" on public.il_payments
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_discounts_all" on public.il_discounts;
create policy "il_discounts_all" on public.il_discounts
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "il_logs_all" on public.il_logs;
create policy "il_logs_all" on public.il_logs
  for all to anon, authenticated using (true) with check (true);
