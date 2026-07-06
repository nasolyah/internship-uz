-- Задачи (вакансии), которые публикуют подтверждённые компании. Видны всем в каталоге.
create table if not exists public.gigs (
  id             uuid primary key default gen_random_uuid(),
  company_app_id uuid,
  company_name   text not null,
  title          text not null,
  description    text default '',
  format         text default '',
  duration       text default '',
  slots          text default '1',
  created_at     timestamptz not null default now()
);

alter table public.gigs enable row level security;

-- Публичное чтение: каталог задач виден всем (гостям и студентам).
drop policy if exists "gigs_select_all" on public.gigs;
create policy "gigs_select_all" on public.gigs for select using (true);

-- Вставка/изменение — только через Edge Function post-gig (service role). Anon-политик на запись нет.
