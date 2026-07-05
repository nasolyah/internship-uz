-- Заявки компаний на подтверждение. Компании пока без аккаунта — доступ только через Edge Functions.
create table if not exists public.company_applications (
  id         uuid primary key default gen_random_uuid(),
  data       jsonb not null default '{}'::jsonb,
  status     text  not null default 'pending',  -- pending | approved | rejected
  created_at timestamptz not null default now()
);

-- RLS включён, публичных политик нет: читать/писать может только service role (Edge Functions).
alter table public.company_applications enable row level security;
