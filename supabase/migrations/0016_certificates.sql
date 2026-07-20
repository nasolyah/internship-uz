-- Завершение стажировки и справка от компании.
--
-- В профиле уже был блок «История на платформе» с обещанием «появятся автоматически после
-- подтверждения проекта стартапом», но заполнять его было нечем: у отклика не существовало
-- состояния «завершено», а platformHistory в profiles.data никто никогда не записывал.
--
-- Писать историю в profiles.data нельзя: там student пишет что угодно (profiles_update_own),
-- то есть можно было бы вписать себе завершённые стажировки в известных компаниях вместе с
-- отзывами. Поэтому справка — отдельная таблица, куда пишет только компания-владелец отклика.
--
-- Справка — не PDF, а проверяемая страница: ценность именно в том, что её нельзя подделать.

/* ---------- у отклика появляется состояние «завершён» ---------- */

alter table public.gig_applications drop constraint if exists gig_applications_status_check;
alter table public.gig_applications add constraint gig_applications_status_check
  check (status in ('pending', 'invited', 'rejected', 'completed'));

/* ---------- справка ---------- */

create table if not exists public.certificates (
  id             uuid primary key default gen_random_uuid(),
  -- Адрес публичной страницы. Неугадываемый: справку показывают по ссылке, но подобрать
  -- чужую перебором нельзя.
  public_id      text not null unique default encode(gen_random_bytes(9), 'hex'),
  -- Одна стажировка — одна справка.
  application_id uuid not null unique references public.gig_applications (id) on delete cascade,
  student_id     uuid not null references auth.users (id) on delete cascade,
  company_app_id uuid not null references public.company_applications (id) on delete cascade,
  -- Копиями, а не ссылками: справка должна остаться читаемой, даже если задачу удалят
  -- или компания сменит название. Документ фиксирует то, что было на момент выдачи.
  student_name   text not null default '',
  company_name   text not null default '',
  gig_title      text not null default '',
  started_at     date,
  finished_at    date,
  -- Оценка видна только внутри платформы, на публичной странице её нет: тройка из пяти
  -- навредила бы студенту сильнее, чем помогла.
  score          int  not null check (score between 1 and 5),
  -- Текст характеристики — то, ради чего справка существует.
  body           text not null check (length(btrim(body)) >= 120),
  status         text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  reason         text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);

create index if not exists certificates_student_idx on public.certificates (student_id);
create index if not exists certificates_status_idx  on public.certificates (status, created_at desc);

alter table public.certificates enable row level security;

-- Читают: свой студент, выдавшая компания, админ. Публичная страница идёт не сюда,
-- а через функцию ниже — иначе анонимный клиент смог бы выгрузить список всех справок.
drop policy if exists "certificates_select_involved" on public.certificates;
create policy "certificates_select_involved" on public.certificates
  for select to authenticated
  using (student_id = auth.uid() or public.owns_company_app(company_app_id) or public.is_admin());

-- Выдаёт только компания-владелец отклика и только в статусе 'pending' — публикует админ.
drop policy if exists "certificates_insert_company" on public.certificates;
create policy "certificates_insert_company" on public.certificates
  for insert to authenticated
  with check (
    public.owns_company_app(company_app_id)
    and status = 'pending'
    and exists (
      select 1 from public.gig_applications a
      where a.id = application_id and a.company_app_id = certificates.company_app_id
    )
  );

-- Политики update у компании нет: выданная справка не переписывается задним числом,
-- иначе это не документ. Правки — через админа.
drop policy if exists "certificates_update_admin" on public.certificates;
create policy "certificates_update_admin" on public.certificates
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.stamp_certificate_decision()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists certificates_stamp_decision on public.certificates;
create trigger certificates_stamp_decision
  before update on public.certificates
  for each row
  execute function public.stamp_certificate_decision();

/* ---------- завершение стажировки ---------- */

-- Одной операцией: отклик переходит в 'completed' и создаётся справка. Через функцию,
-- потому что это два связанных изменения — иначе можно было бы получить завершённую
-- стажировку без справки или наоборот.
create or replace function public.complete_internship(
  p_application_id uuid, p_score int, p_body text,
  p_started_at date default null, p_finished_at date default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  app   public.gig_applications;
  gig   public.gigs;
  comp  public.company_applications;
  new_public_id text;
begin
  select * into app from public.gig_applications where id = p_application_id;
  if not found then
    raise exception 'Отклик не найден';
  end if;
  if not public.owns_company_app(app.company_app_id) then
    raise exception 'Завершить стажировку может только компания, разместившая задачу';
  end if;
  if app.status = 'completed' then
    raise exception 'Стажировка уже завершена';
  end if;
  -- Завершать имеет смысл только то, что начиналось: студента должны были пригласить.
  if app.status <> 'invited' then
    raise exception 'Завершить можно только стажировку, на которую студент был приглашён';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'Оценка должна быть от 1 до 5';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 120 then
    raise exception 'Характеристика слишком короткая — опишите, что студент делал и чего добился';
  end if;

  select * into gig  from public.gigs where id = app.gig_id;
  select * into comp from public.company_applications where id = app.company_app_id;

  update public.gig_applications set status = 'completed' where id = app.id;

  insert into public.certificates (
    application_id, student_id, company_app_id,
    student_name, company_name, gig_title,
    started_at, finished_at, score, body
  ) values (
    app.id, app.student_id, app.company_app_id,
    app.student_name,
    coalesce(comp.data ->> 'name', ''),
    coalesce(gig.title, ''),
    coalesce(p_started_at, app.created_at::date),
    coalesce(p_finished_at, current_date),
    p_score, btrim(p_body)
  )
  returning public_id into new_public_id;

  return new_public_id;
end;
$$;

revoke all on function public.complete_internship(uuid, int, text, date, date) from public;
grant execute on function public.complete_internship(uuid, int, text, date, date) to authenticated;

/* ---------- публичная страница справки ---------- */

-- Отдаёт только опубликованное и только по точному public_id. Оценки здесь нет.
-- Доступно анониму: справку показывают работодателю, который на платформе не зарегистрирован.
create or replace function public.certificate_public(p_public_id text)
returns table (
  public_id text, student_name text, company_name text, gig_title text,
  started_at date, finished_at date, body text, issued_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.public_id, c.student_name, c.company_name, c.gig_title,
         c.started_at, c.finished_at, c.body, c.decided_at
  from public.certificates c
  where c.public_id = p_public_id and c.status = 'published';
$$;

revoke all on function public.certificate_public(text) from public;
grant execute on function public.certificate_public(text) to anon, authenticated;

/* ---------- история стажировок в профиле ---------- */

-- Раньше история лежала в profiles.data, куда студент пишет сам. Теперь выводится из
-- опубликованных справок, то есть подделать её нельзя.
create or replace function public.student_history(p_student uuid)
returns table (
  public_id text, company_name text, gig_title text,
  started_at date, finished_at date, body text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.public_id, c.company_name, c.gig_title, c.started_at, c.finished_at, c.body
  from public.certificates c
  where c.student_id = p_student and c.status = 'published'
  order by c.finished_at desc nulls last;
$$;

revoke all on function public.student_history(uuid) from public;
grant execute on function public.student_history(uuid) to authenticated;

/* ---------- очередь справок в панели ---------- */

create or replace function public.admin_certificate_queue(p_status text default null)
returns table (
  id uuid, public_id text, student_name text, company_name text, gig_title text,
  started_at date, finished_at date, score int, body text,
  status text, reason text, created_at timestamptz, decided_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.public_id, c.student_name, c.company_name, c.gig_title,
         c.started_at, c.finished_at, c.score, c.body,
         c.status, c.reason, c.created_at, c.decided_at
  from public.certificates c
  where public.is_admin()
    and (p_status is null or c.status = p_status)
  order by (c.status = 'pending') desc, c.created_at desc;
$$;

revoke all on function public.admin_certificate_queue(text) from public;
grant execute on function public.admin_certificate_queue(text) to authenticated;

create or replace function public.admin_decide_certificate(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Доступ только для админа';
  end if;
  if p_status not in ('published', 'rejected') then
    raise exception 'Недопустимый статус решения';
  end if;
  update public.certificates set status = p_status, reason = p_reason where id = p_id;
end;
$$;

revoke all on function public.admin_decide_certificate(uuid, text, text) from public;
grant execute on function public.admin_decide_certificate(uuid, text, text) to authenticated;
