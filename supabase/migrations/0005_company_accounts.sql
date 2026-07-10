-- У компании появляется настоящий аккаунт auth.users (вход по коду на корпоративную почту).
-- До этого «сессией» компании был UUID заявки в localStorage: его знание давало и доступ
-- к данным заявки, и право публиковать задачи. Для чата этого мало — база должна уметь
-- проверить на уровне RLS, что читающий переписку и есть эта компания.

alter table public.company_applications
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

create index if not exists company_applications_owner_idx
  on public.company_applications (owner_user_id);

-- Компания читает свою заявку сама, напрямую (раньше это делала Edge Function company-status
-- под service role, отдавая ИНН и телефон директора любому, кто прислал угаданный id).
drop policy if exists "company_applications_select_own" on public.company_applications;
create policy "company_applications_select_own" on public.company_applications
  for select using (auth.uid() = owner_user_id);

-- Запись по-прежнему только через Edge Functions под service role: статус заявки
-- (pending/approved) компания менять себе не должна.

-- Владение заявкой — через security definer, чтобы политики других таблиц могли ссылаться
-- на company_applications, не упираясь в её собственную RLS и не устраивая рекурсию.
create or replace function public.owns_company_app(app_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_applications
    where id = app_id and owner_user_id = auth.uid()
  );
$$;

revoke all on function public.owns_company_app(uuid) from public;
grant execute on function public.owns_company_app(uuid) to authenticated;
