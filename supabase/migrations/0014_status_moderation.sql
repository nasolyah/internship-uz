-- Статус (школьник до 18 / студент вуза) до сих пор был словом на слово: он лежит в
-- profiles.data, а profiles_update_own разрешает писать в свою строку что угодно. Значит
-- гейт «несовершеннолетний без согласия родителя не может откликнуться» обходился в два
-- клика — достаточно было выбрать «Студент вуза (18+)», и проверка переставала применяться.
-- Сам гейт к тому же жил только в браузере, то есть снимался и через консоль.
--
-- Здесь закрывается и то и другое: статус меняется только заявкой с документом, которую
-- одобряет админ, а условие отклика переезжает в политику вставки — на сервер.
--
-- Уже выставленные статусы считаем доверенными: гейт применяется к изменениям с этого
-- момента, задним числом никого не перепроверяем.

/* ---------- заявка на смену статуса ---------- */

create table if not exists public.status_requests (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users (id) on delete cascade,
  from_status text,                            -- что было на момент подачи, для контекста в панели
  to_status   text not null,                   -- что просит поставить
  -- Документ, подтверждающий личность. После решения обнуляется: хранить сканы
  -- удостоверений (в том числе детских) дольше, чем нужно для проверки, — лишний риск.
  path        text,
  name        text not null default '',
  mime        text not null default '',
  size        bigint not null default 0,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason      text,                            -- причина отказа, её видит студент
  decided_by  text check (decided_by in ('ai','admin')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists status_requests_student_idx on public.status_requests (student_id);
create index if not exists status_requests_status_idx  on public.status_requests (status, created_at desc);

-- Одна заявка в ожидании на студента: иначе можно было бы подать десять и запутать очередь.
create unique index if not exists status_requests_one_pending
  on public.status_requests (student_id) where status = 'pending';

alter table public.status_requests enable row level security;

drop policy if exists "status_requests_select_own" on public.status_requests;
create policy "status_requests_select_own" on public.status_requests
  for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

-- Студент подаёт заявку только за себя и только в статусе 'pending'.
drop policy if exists "status_requests_insert_own" on public.status_requests;
create policy "status_requests_insert_own" on public.status_requests
  for insert to authenticated
  with check (student_id = auth.uid() and status = 'pending' and decided_by is null);

-- Политики update у студента нет вовсе — решение принимает только админ.
drop policy if exists "status_requests_update_admin" on public.status_requests;
create policy "status_requests_update_admin" on public.status_requests
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Пока заявка не рассмотрена, студент может её отозвать (например, приложил не тот файл).
drop policy if exists "status_requests_delete_own_pending" on public.status_requests;
create policy "status_requests_delete_own_pending" on public.status_requests
  for delete to authenticated
  using (student_id = auth.uid() and status = 'pending');

create or replace function public.stamp_status_decision()
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

drop trigger if exists status_requests_stamp_decision on public.status_requests;
create trigger status_requests_stamp_decision
  before update on public.status_requests
  for each row
  execute function public.stamp_status_decision();

/* ---------- статус в профиле больше не переписывается напрямую ---------- */

create or replace function public.lock_profile_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Первичная установка при регистрации проходит (это insert). Здесь — только смена.
  if public.is_admin() then
    return new;
  end if;

  -- Не ругаемся, а молча возвращаем то, что уже в базе. Ошибку кидать нельзя: клиент при
  -- любом сохранении профиля шлёт весь data целиком, включая статус. Если админ одобрит
  -- заявку, пока у студента открыта вкладка, у того останется старый статус — и следующая
  -- правка почты падала бы с ошибкой на ровном месте. При таком варианте чужое значение
  -- просто отбрасывается, а одобренный статус остаётся нетронутым.
  new.data := jsonb_set(new.data, '{status}', coalesce(old.data -> 'status', '""'::jsonb));
  -- minor выводится из статуса, поэтому подделать его отдельно тоже нельзя.
  new.data := jsonb_set(new.data, '{minor}', coalesce(old.data -> 'minor', 'false'::jsonb));
  return new;
end;
$$;

drop trigger if exists profiles_lock_status on public.profiles;
create trigger profiles_lock_status
  before update on public.profiles
  for each row
  execute function public.lock_profile_status();

/* ---------- кто считается несовершеннолетним ---------- */

create or replace function public.is_minor_student(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.data ->> 'status' from public.profiles p where p.id = p_id) ~ 'до 18', false);
$$;

revoke all on function public.is_minor_student(uuid) from public;
grant execute on function public.is_minor_student(uuid) to authenticated;

/* ---------- гейт отклика переезжает на сервер ---------- */

-- Раньше проверка «нет согласия родителя — нельзя откликнуться» была только в браузере
-- (int_app.js, actions.applyToGig), то есть снималась через консоль разработчика.
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
    -- Пока статус на подтверждении, новые проекты недоступны: иначе заявкой на смену
    -- статуса можно было бы выиграть время и откликаться «между» статусами.
    and not exists (
      select 1 from public.status_requests r
      where r.student_id = auth.uid() and r.status = 'pending'
    )
    -- Несовершеннолетнему нужно одобренное согласие родителя (ТК РУз).
    and (
      not public.is_minor_student(auth.uid())
      or exists (
        select 1 from public.student_files f
        where f.student_id = auth.uid() and f.kind = 'consent' and f.status = 'approved'
      )
    )
  );

/* ---------- решение админа по заявке ---------- */

-- Через функцию, а не политику update на profiles: дать админу право писать в чужие
-- профили целиком — слишком широко, ему нужно менять ровно два ключа.
create or replace function public.admin_decide_status(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.status_requests;
begin
  if not public.is_admin() then
    raise exception 'Доступ только для админа';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Недопустимый статус решения';
  end if;

  select * into req from public.status_requests where id = p_id;
  if not found then
    raise exception 'Заявка не найдена';
  end if;

  if p_status = 'approved' then
    -- minor пересчитываем здесь же: он всегда должен следовать за статусом.
    -- Место учёбы обнуляем: список заведений зависит от статуса, и старое значение
    -- после перехода (школа → вуз) ему уже не соответствует. Справку о месте учёбы
    -- при этом удалит триггер из 0010 — она подтверждала прежнее место, студенту
    -- нужно будет загрузить новую.
    update public.profiles
    set data = jsonb_set(
                 jsonb_set(
                   jsonb_set(data, '{status}', to_jsonb(req.to_status)),
                   '{minor}', to_jsonb(req.to_status ~ 'до 18')
                 ),
                 '{institution}', '""'::jsonb
               )
    where id = req.student_id;
  end if;

  -- path обнуляем в любом случае: документ больше не нужен, а сам файл удаляет панель.
  update public.status_requests
  set status = p_status, reason = p_reason, decided_by = 'admin', path = null
  where id = p_id;
end;
$$;

revoke all on function public.admin_decide_status(uuid, text, text) from public;
grant execute on function public.admin_decide_status(uuid, text, text) to authenticated;

/* ---------- очередь заявок для панели ---------- */

create or replace function public.admin_status_queue(p_status text default null)
returns table (
  id uuid, student_id uuid, student_name text,
  from_status text, to_status text,
  path text, name text, mime text, size bigint,
  status text, reason text, decided_by text,
  created_at timestamptz, decided_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.student_id,
    btrim(coalesce(p.data ->> 'first', '') || ' ' || coalesce(p.data ->> 'last', '')),
    r.from_status, r.to_status,
    r.path, r.name, r.mime, r.size,
    r.status, r.reason, r.decided_by,
    r.created_at, r.decided_at
  from public.status_requests r
  left join public.profiles p on p.id = r.student_id
  where public.is_admin()
    and (p_status is null or r.status = p_status)
  order by (r.status = 'pending') desc, r.created_at desc;
$$;

revoke all on function public.admin_status_queue(text) from public;
grant execute on function public.admin_status_queue(text) to authenticated;

/* ---------- админу нужно удалять документы после решения ---------- */

drop policy if exists "student_docs_delete_admin" on storage.objects;
create policy "student_docs_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-docs' and public.is_admin());
