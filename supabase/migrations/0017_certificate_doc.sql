-- Официальное свидетельство о стажировке: бумага, которую компания составляет сама
-- (на своём бланке, со своей подписью и печатью) и прикладывает к уже выданной справке.
-- Шаблона нет — платформа только принимает файл, проверяет его и отдаёт студенту.
--
-- Зачем отдельно от текста справки: платформенная справка — это проверяемая страница,
-- а свидетельство студент скачивает и прикладывает в Common App или портфолио. Разные
-- документы с разной судьбой.
--
-- Поля добавлены к certificates, а не в отдельную таблицу: свидетельство привязано
-- к конкретной стажировке один к одному, и заводить ради этого таблицу незачем.

alter table public.certificates
  add column if not exists doc_path       text,
  add column if not exists doc_name       text not null default '',
  add column if not exists doc_mime       text not null default '',
  add column if not exists doc_size       bigint not null default 0,
  -- null — компания ещё ничего не приложила.
  add column if not exists doc_status     text check (doc_status in ('pending', 'approved', 'rejected')),
  add column if not exists doc_reason     text,
  add column if not exists doc_decided_at timestamptz;

/* ---------- компания прикладывает файл ---------- */

-- Через функцию, а не политику update: у компании нет права писать в certificates вовсе,
-- иначе она смогла бы задним числом переписать текст характеристики. Здесь меняются
-- только поля документа.
create or replace function public.attach_certificate_doc(
  p_certificate_id uuid, p_path text, p_name text, p_mime text, p_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cert public.certificates;
begin
  select * into cert from public.certificates where id = p_certificate_id;
  if not found then
    raise exception 'Справка не найдена';
  end if;
  if not public.owns_company_app(cert.company_app_id) then
    raise exception 'Приложить свидетельство может только компания, выдавшая справку';
  end if;
  if p_path is null or btrim(p_path) = '' then
    raise exception 'Файл не приложен';
  end if;

  -- Повторная загрузка (например, после отказа) просто заменяет файл и снова
  -- отправляет его на проверку.
  update public.certificates
  set doc_path = p_path, doc_name = coalesce(p_name, ''), doc_mime = coalesce(p_mime, ''),
      doc_size = coalesce(p_size, 0), doc_status = 'pending', doc_reason = null, doc_decided_at = null
  where id = p_certificate_id;
end;
$$;

revoke all on function public.attach_certificate_doc(uuid, text, text, text, bigint) from public;
grant execute on function public.attach_certificate_doc(uuid, text, text, text, bigint) to authenticated;

/* ---------- решение админа по свидетельству ---------- */

create or replace function public.admin_decide_certificate_doc(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Доступ только для админа';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Недопустимый статус решения';
  end if;
  update public.certificates
  set doc_status = p_status, doc_reason = p_reason, doc_decided_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.admin_decide_certificate_doc(uuid, text, text) from public;
grant execute on function public.admin_decide_certificate_doc(uuid, text, text) to authenticated;

/* ---------- очередь и история отдают документ ---------- */

-- Панели нужно видеть, от кого свидетельство и кому — эти поля в справке уже есть,
-- добавляем к ним сам файл и его статус.
create or replace function public.admin_certificate_queue(p_status text default null)
returns table (
  id uuid, public_id text, student_name text, company_name text, gig_title text,
  started_at date, finished_at date, score int, body text,
  status text, reason text, created_at timestamptz, decided_at timestamptz,
  doc_path text, doc_name text, doc_status text, doc_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.public_id, c.student_name, c.company_name, c.gig_title,
         c.started_at, c.finished_at, c.score, c.body,
         c.status, c.reason, c.created_at, c.decided_at,
         c.doc_path, c.doc_name, c.doc_status, c.doc_reason
  from public.certificates c
  where public.is_admin()
    -- Ждут решения либо сама справка, либо приложенное к ней свидетельство.
    and (p_status is null or c.status = p_status or c.doc_status = p_status)
  order by (c.status = 'pending' or c.doc_status = 'pending') desc, c.created_at desc;
$$;

revoke all on function public.admin_certificate_queue(text) from public;
grant execute on function public.admin_certificate_queue(text) to authenticated;

-- Студенту отдаём путь только у одобренного свидетельства: до проверки скачивать нечего.
create or replace function public.student_history(p_student uuid)
returns table (
  public_id text, company_name text, gig_title text,
  started_at date, finished_at date, body text,
  doc_path text, doc_name text, doc_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.public_id, c.company_name, c.gig_title, c.started_at, c.finished_at, c.body,
         case when c.doc_status = 'approved' then c.doc_path end,
         c.doc_name, c.doc_status
  from public.certificates c
  where c.student_id = p_student and c.status = 'published'
  order by c.finished_at desc nulls last;
$$;

revoke all on function public.student_history(uuid) from public;
grant execute on function public.student_history(uuid) to authenticated;

/* ---------- файлы свидетельств в хранилище ---------- */

-- Кладём в тот же приватный бакет по пути certs/<id справки>/<файл>. Папка студента
-- (<uid>/...) не подходит: туда компания писать не может и не должна.

drop policy if exists "cert_docs_insert_company" on storage.objects;
create policy "cert_docs_insert_company" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-docs'
    and (storage.foldername(name))[1] = 'certs'
    and exists (
      select 1 from public.certificates c
      where c.id::text = (storage.foldername(name))[2]
        and public.owns_company_app(c.company_app_id)
    )
  );

-- Читают: выдавшая компания (всегда) и студент — только после одобрения.
-- Админ уже читает весь бакет по политике из 0011.
drop policy if exists "cert_docs_select_involved" on storage.objects;
create policy "cert_docs_select_involved" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-docs'
    and (storage.foldername(name))[1] = 'certs'
    and exists (
      select 1 from public.certificates c
      where c.id::text = (storage.foldername(name))[2]
        and (
          public.owns_company_app(c.company_app_id)
          or (c.student_id = auth.uid() and c.doc_status = 'approved')
        )
    )
  );
