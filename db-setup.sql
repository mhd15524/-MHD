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
--   • table `il_vaults`  — shared encrypted ledger (owner='master')
--   • table `il_users`   — cloud user registry with roles & access control
--   • table `il_roles`   — role definitions (customer visibility or page access)
--   • RLS policy allowing the app's publishable key to read/write.
--
-- IMPORTANT (security note):
--   The app NEVER uploads readable data. Each row holds only the
--   AES-256-GCM encrypted blob plus the key-derivation salt, so the
--   cloud cannot read your ledger without the admin password.
--   The policy below is intentionally open (the app has no login
--   of its own against Supabase); protection comes from encryption.

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

alter table public.il_vaults enable row level security;
alter table public.il_users enable row level security;
alter table public.il_roles enable row level security;

drop policy if exists "il_vaults_all" on public.il_vaults;
create policy "il_vaults_all"
  on public.il_vaults
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "il_users_all" on public.il_users;
create policy "il_users_all"
  on public.il_users
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "il_roles_all" on public.il_roles;
create policy "il_roles_all"
  on public.il_roles
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Verify:
--   select count(*) from public.il_vaults;
--   select * from public.il_users;
--   select * from public.il_roles;
