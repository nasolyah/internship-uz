-- Доступы админа: чтобы разбирать очередь, ему нужно видеть чужие профили (контекст к
-- документу), заявки компаний и сами файлы в приватном бакете. Всё гейтится is_admin().

/* ---------- профили студентов: админ видит все ---------- */

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

/* ---------- заявки компаний: админ видит все ---------- */

drop policy if exists "company_applications_select_admin" on public.company_applications;
create policy "company_applications_select_admin" on public.company_applications
  for select to authenticated
  using (public.is_admin());

-- Решение по заявке компании — через функцию, а НЕ через политику update.
-- Если выдать authenticated право писать в колонку status, владелец заявки сможет
-- проставить approved сам себе: у него уже есть update-политика на свою строку.
create or replace function public.admin_decide_company(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Доступ только для админа';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Недопустимый статус';
  end if;
  update public.company_applications set status = p_status where id = p_id;
end;
$$;

revoke all on function public.admin_decide_company(uuid, text) from public;
grant execute on function public.admin_decide_company(uuid, text) to authenticated;

/* ---------- файлы в бакете student-docs: админ читает любые ---------- */

drop policy if exists "student_docs_select_admin" on storage.objects;
create policy "student_docs_select_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-docs' and public.is_admin());

/* ---------- очередь модерации одним запросом ---------- */

-- Отдаёт файлы вместе с именем студента, чтобы в панели не делать N дополнительных
-- запросов. Только для админа: внутри стоит проверка, обойти нельзя.
create or replace function public.admin_moderation_queue(p_status text default null)
returns table (
  id uuid, student_id uuid, student_name text, student_status text, student_institution text,
  kind text, path text, name text, mime text, size bigint,
  status text, decided_by text, ai_verdict jsonb, reason text,
  created_at timestamptz, decided_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.student_id,
    btrim(coalesce(p.data ->> 'first', '') || ' ' || coalesce(p.data ->> 'last', '')),
    p.data ->> 'status',
    p.data ->> 'institution',
    f.kind, f.path, f.name, f.mime, f.size,
    f.status, f.decided_by, f.ai_verdict, f.reason,
    f.created_at, f.decided_at
  from public.student_files f
  left join public.profiles p on p.id = f.student_id
  where public.is_admin()
    and (p_status is null or f.status = p_status)
  order by (f.status = 'pending') desc, f.created_at desc;
$$;

revoke all on function public.admin_moderation_queue(text) from public;
grant execute on function public.admin_moderation_queue(text) to authenticated;
