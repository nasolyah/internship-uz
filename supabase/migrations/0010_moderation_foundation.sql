-- Фундамент модерации: один админ (пока), и КАЖДЫЙ загруженный студентом файл — строка
-- со статусом, вердиктом ИИ и следом решения. До этого проверялись только справка и
-- согласие (через телеграм), а сертификаты, файлы проектов и аватар попадали к компаниям
-- вообще без проверки.
--
-- Здесь же закрывается старая дыра: статусы документов больше не лежат в profiles.data,
-- куда студент может писать сам, — они в этой таблице, и менять их может только админ
-- (или сервер). Переезд самих статусов из profiles.data — в конце файла.

/* ---------- админы ---------- */

create table if not exists public.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Политик нет намеренно: таблица читается только через is_admin() (security definer)
-- и правится из SQL-редактора под service role. Сам себя админом никто не назначит.
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

/* ---------- файлы студентов ---------- */

create table if not exists public.student_files (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users (id) on delete cascade,
  -- avatar / study / consent — по одному на студента; остальные привязаны к элементу профиля
  kind        text not null check (kind in ('avatar','study','consent','skill','language','project','achievement')),
  path        text not null unique,            -- путь в бакете student-docs
  name        text not null default '',
  mime        text not null default '',
  size        bigint not null default 0,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  -- кто решил: ИИ автоматически или админ руками. null — ещё никто.
  decided_by  text check (decided_by in ('ai','admin')),
  -- что сказал ИИ: вердикт, объяснение, извлечённые поля. Хранится даже при ручном решении,
  -- чтобы в админке было видно, на чём ИИ основывался и где он ошибся.
  ai_verdict  jsonb,
  reason      text,                            -- причина отказа, её видит студент
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists student_files_student_idx on public.student_files (student_id);
create index if not exists student_files_status_idx  on public.student_files (status, created_at desc);

alter table public.student_files enable row level security;

-- Студент видит свои файлы (в кабинете — со статусом и причиной отказа).
drop policy if exists "student_files_select_own" on public.student_files;
create policy "student_files_select_own" on public.student_files
  for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

-- Загружать может только сам студент и только как «на проверке»:
-- ни статус, ни решение, ни вердикт ИИ подставить нельзя.
drop policy if exists "student_files_insert_own" on public.student_files;
create policy "student_files_insert_own" on public.student_files
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'pending'
    and decided_by is null
    and ai_verdict is null
    and reason is null
  );

-- Решение принимает только админ. У студента политики update нет вовсе — то есть
-- проставить себе approved он не может (в отличие от старого docStatus в jsonb).
drop policy if exists "student_files_update_admin" on public.student_files;
create policy "student_files_update_admin" on public.student_files
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Студент может удалить только свой ещё не рассмотренный файл (передумал/перезалил).
drop policy if exists "student_files_delete_own_pending" on public.student_files;
create policy "student_files_delete_own_pending" on public.student_files
  for delete to authenticated
  using ((student_id = auth.uid() and status = 'pending') or public.is_admin());

-- Проставляем время решения автоматически, чтобы история была честной.
create or replace function public.stamp_file_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists student_files_stamp_decision on public.student_files;
create trigger student_files_stamp_decision
  before update on public.student_files
  for each row
  execute function public.stamp_file_decision();

/* ---------- переезд статусов документов из profiles.data ---------- */

-- Старые docStatus (study/consent) переносим как строки без файла: путь известен по схеме
-- <uid>/study.* — точное расширение неизвестно, поэтому кладём заглушку и помечаем, что
-- файл нужно перезалить. Для пилота это нормально: документов пока единицы.
insert into public.student_files (student_id, kind, path, name, status, decided_by, decided_at)
select p.id,
       kv.key,
       p.id::text || '/legacy-' || kv.key,
       'загружен до модерации',
       case kv.value #>> '{}' when 'approved' then 'approved' when 'rejected' then 'rejected' else 'pending' end,
       case when kv.value #>> '{}' in ('approved','rejected') then 'admin' end,
       case when kv.value #>> '{}' in ('approved','rejected') then now() end
from public.profiles p
     cross join lateral jsonb_each(p.data -> 'docStatus') as kv(key, value)
where p.data ? 'docStatus'
  and kv.key in ('study','consent')
  and kv.value #>> '{}' in ('pending','approved','rejected')
on conflict (path) do nothing;

-- Убираем статусы из profiles.data, чтобы не осталось второго источника правды,
-- в который студент может писать.
update public.profiles
set data = data - 'docStatus' - 'consentUploaded'
where data ? 'docStatus' or data ? 'consentUploaded';

-- Смена статуса/места учёбы обесценивает уже проверенную справку — теперь это делает база,
-- а не клиент, поэтому обойти нельзя.
create or replace function public.reset_study_file_on_institution_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.data ->> 'status'      is distinct from old.data ->> 'status'
  or new.data ->> 'institution' is distinct from old.data ->> 'institution' then
    delete from public.student_files where student_id = new.id and kind = 'study';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_study_file on public.profiles;
create trigger profiles_reset_study_file
  after update of data on public.profiles
  for each row
  execute function public.reset_study_file_on_institution_change();
