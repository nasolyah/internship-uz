-- Компания должна видеть только ОДОБРЕННЫЕ файлы. До этого student_public отдавала
-- сертификаты, файлы проектов и фото прямо из profiles.data, то есть сразу после загрузки,
-- ещё до модерации. Здесь режем всё, что не одобрено.
--
-- Файлы в самом profiles.data не трогаем: студент в своём кабинете видит их всегда,
-- со статусом «на проверке». Фильтрация происходит только на выдаче наружу.

/* ---------- какие пути одобрены у студента ---------- */

create or replace function public.approved_paths(p_student uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(path), '{}')
  from public.student_files
  where student_id = p_student and status = 'approved';
$$;

revoke all on function public.approved_paths(uuid) from public;
grant execute on function public.approved_paths(uuid) to authenticated;

/* ---------- вырезание неодобренных файлов из jsonb ---------- */

-- Навыки, языки, достижения: у элемента один файл в ключе file.
-- Не одобрен — убираем сам ключ, элемент остаётся (название навыка скрывать незачем).
create or replace function public.keep_approved_file(items jsonb, ok text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    case
      when it -> 'file' is null then it
      when (it -> 'file' ->> 'path') = any(ok) then it
      else it - 'file'
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) as it;
$$;

-- Проекты: массив files, фильтруем поэлементно.
create or replace function public.keep_approved_files(items jsonb, ok text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    it || jsonb_build_object('files', coalesce((
      select jsonb_agg(f)
      from jsonb_array_elements(coalesce(it -> 'files', '[]'::jsonb)) as f
      where (f ->> 'path') = any(ok)
    ), '[]'::jsonb))
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) as it;
$$;

/* ---------- student_public теперь отдаёт только одобренное ---------- */

create or replace function public.student_public(p_id uuid)
returns table (
  id uuid, first_name text, last_name text, study_status text, institution text,
  description text, availability text, photo_url text,
  specialties jsonb, hard_skills jsonb, languages jsonb, projects jsonb,
  achievements jsonb, ai_test jsonb, email text, tg text
)
language sql
stable
security definer
set search_path = public
as $$
  with ok as (select public.approved_paths(p_id) as paths)
  select p.id,
    p.data ->> 'first',        p.data ->> 'last',
    p.data ->> 'status',       p.data ->> 'institution',
    p.data ->> 'description',  p.data ->> 'availability',
    -- фото показываем, только если аватар прошёл модерацию
    case when (p.data ->> 'photoPath') = any((select paths from ok)) then p.data ->> 'photoUrl' end,
    coalesce(p.data -> 'specialties', '[]'::jsonb),
    public.keep_approved_file(p.data -> 'hardSkills',   (select paths from ok)),
    public.keep_approved_file(p.data -> 'languages',    (select paths from ok)),
    public.keep_approved_files(p.data -> 'projects',    (select paths from ok)),
    public.keep_approved_file(p.data -> 'achievements', (select paths from ok)),
    p.data -> 'aiTest',
    case when public.company_invited_student(p.id) then p.data ->> 'email' end,
    case when public.company_invited_student(p.id) then p.data ->> 'tg'    end
  from public.profiles p
  where p.id = p_id
    and exists (
      select 1 from public.gig_applications a
      where a.student_id = p.id and public.owns_company_app(a.company_app_id)
    );
$$;

revoke all on function public.student_public(uuid) from public;
grant execute on function public.student_public(uuid) to authenticated;
