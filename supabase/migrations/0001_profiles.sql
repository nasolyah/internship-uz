-- Таблица профилей студентов. Одна строка на пользователя (id = auth.users.id).
-- Гибкое хранение: role + jsonb data (имя, статус, согласие и т.д.).

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: пользователь видит и меняет только свою строку.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
