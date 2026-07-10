-- Отклики студентов на задачи и переписка по каждому отклику.
--
-- Модель: один отклик = одна ветка чата. Студент откликается на gig, в этот же момент
-- триггером создаётся системное сообщение — компания видит отклик как начатый диалог.

create table if not exists public.gig_applications (
  id             uuid primary key default gen_random_uuid(),
  gig_id         uuid not null references public.gigs (id) on delete cascade,
  student_id     uuid not null references auth.users (id) on delete cascade,
  company_app_id uuid not null references public.company_applications (id) on delete cascade,
  -- Имя студента копией: profiles читается только своим владельцем, напрямую компания
  -- имя не достанет. Заполняет триггер, значение из запроса игнорируется.
  student_name   text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'invited', 'rejected')),
  created_at     timestamptz not null default now(),
  -- На одну задачу студент откликается один раз.
  unique (gig_id, student_id)
);

create index if not exists gig_applications_student_idx on public.gig_applications (student_id);
create index if not exists gig_applications_company_idx on public.gig_applications (company_app_id);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.gig_applications (id) on delete cascade,
  -- 'system' — автосообщение об отклике, у него нет автора.
  sender_role    text not null check (sender_role in ('student', 'company', 'system')),
  sender_id      uuid references auth.users (id) on delete set null,
  body           text not null check (length(btrim(body)) between 1 and 4000),
  created_at     timestamptz not null default now()
);

create index if not exists messages_application_idx on public.messages (application_id, created_at);

alter table public.gig_applications enable row level security;
alter table public.messages         enable row level security;

-- Участие в переписке — security definer: политики messages ссылаются на gig_applications,
-- у которой своя RLS. Без этого политики зациклятся друг на друге.
create or replace function public.is_application_participant(app_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gig_applications a
    where a.id = app_id
      and (a.student_id = auth.uid() or public.owns_company_app(a.company_app_id))
  );
$$;

revoke all on function public.is_application_participant(uuid) from public;
grant execute on function public.is_application_participant(uuid) to authenticated;

/* ---------- отклики ---------- */

-- Видят обе стороны: студент — свои, компания — адресованные ей.
drop policy if exists "gig_applications_select_participant" on public.gig_applications;
create policy "gig_applications_select_participant" on public.gig_applications
  for select to authenticated
  using (student_id = auth.uid() or public.owns_company_app(company_app_id));

-- Откликается только студент и только от своего имени. company_app_id обязан совпадать
-- с владельцем задачи — иначе отклик утёк бы в чужой кабинет.
drop policy if exists "gig_applications_insert_student" on public.gig_applications;
create policy "gig_applications_insert_student" on public.gig_applications
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.gigs g
      where g.id = gig_id and g.company_app_id = company_app_id
    )
  );

-- Статус отклика (приглашение/отказ) меняет только компания.
drop policy if exists "gig_applications_update_company" on public.gig_applications;
create policy "gig_applications_update_company" on public.gig_applications
  for update to authenticated
  using (public.owns_company_app(company_app_id))
  with check (public.owns_company_app(company_app_id));

/* ---------- сообщения ---------- */

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (public.is_application_participant(application_id));

-- Пишет участник, только от своего имени и только своей ролью.
-- sender_role = 'system' закрыт: системные сообщения ставит триггер под security definer.
drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_application_participant(application_id)
    and case sender_role
      when 'student' then exists (
        select 1 from public.gig_applications a
        where a.id = application_id and a.student_id = auth.uid()
      )
      when 'company' then exists (
        select 1 from public.gig_applications a
        where a.id = application_id and public.owns_company_app(a.company_app_id)
      )
      else false
    end
  );

-- Переписку не переписывают: update/delete политик нет.

/* ---------- имя студента в отклике ---------- */

-- Клиент мог бы прислать любое student_name — политика insert его не ограничивает.
-- Поэтому имя всегда перезаписываем из профиля (читаем под security definer).
create or replace function public.set_application_student_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_profile text;
begin
  -- Сначала затираем присланное значение: если профиля нет, select ... into
  -- оставил бы в поле то, что прислал клиент.
  new.student_name := 'Студент';

  select nullif(btrim(coalesce(p.data ->> 'first', '') || ' ' || coalesce(p.data ->> 'last', '')), '')
    into from_profile
  from public.profiles p
  where p.id = new.student_id;

  if from_profile is not null then
    new.student_name := left(from_profile, 120);
  end if;

  return new;
end;
$$;

drop trigger if exists gig_applications_set_student_name on public.gig_applications;
create trigger gig_applications_set_student_name
  before insert on public.gig_applications
  for each row
  execute function public.set_application_student_name();

/* ---------- автосообщение об отклике ---------- */

-- Стартовое сообщение ставит база, а не клиент: тогда ветка чата существует всегда,
-- даже если браузер студента отвалился сразу после отклика.
create or replace function public.seed_application_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gig_title text;
begin
  select g.title into gig_title from public.gigs g where g.id = new.gig_id;

  insert into public.messages (application_id, sender_role, sender_id, body)
  values (
    new.id,
    'system',
    null,
    new.student_name || ' откликнулся на задачу «' ||
      coalesce(nullif(btrim(gig_title), ''), 'без названия') || '». Можно обсудить детали здесь.'
  );

  return new;
end;
$$;

drop trigger if exists gig_applications_seed_thread on public.gig_applications;
create trigger gig_applications_seed_thread
  after insert on public.gig_applications
  for each row
  execute function public.seed_application_thread();

/* ---------- realtime ---------- */

-- Подписка на новые сообщения (Supabase Realtime уважает RLS выше: чужую ветку не покажет).
-- add table не идемпотентен — повторный прогон миграции иначе падает.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
