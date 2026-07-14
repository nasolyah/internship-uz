-- Линтер Supabase (0010_security_definer_view) флагует security-definer вьюхи как ошибку.
-- Наш обход RLS намеренный (компания читает ограниченный профиль студента), но правильный
-- паттерн для этого — security-definer ФУНКЦИЯ, а не вьюха. Переносим один-в-один: тот же
-- набор колонок, те же правила доступа. Клиент читает их через supabase.rpc(...).

drop view if exists public.company_public;
drop view if exists public.student_public;

/* ---------- витрина компании для студентов ---------- */

-- Скрыты inn, director, phone, contact, corpEmail, mentorContact и meetingLink.
-- Только approved-компании. Читать может кто угодно (каталог публичен).
create or replace function public.company_public(p_id uuid)
returns table (
  id uuid, name text, linkedin text, description text, pitch text,
  focus_areas jsonb, tech_stack jsonb, comm_style text, sync_hours text,
  meeting_cadence text, default_duration text, mentor_name text, mentor_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select ca.id,
    ca.data    ->> 'name',            ca.data    ->> 'linkedin',
    ca.profile ->> 'description',     ca.profile ->> 'pitch',
    ca.profile ->  'focusAreas',      ca.profile ->  'techStack',
    ca.profile ->> 'commStyle',       ca.profile ->> 'syncHours',
    ca.profile ->> 'meetingCadence',  ca.profile ->> 'defaultDuration',
    ca.profile ->> 'mentorName',      ca.profile ->> 'mentorRole'
  from public.company_applications ca
  where ca.id = p_id and ca.status = 'approved';
$$;

revoke all on function public.company_public(uuid) from public;
grant execute on function public.company_public(uuid) to anon, authenticated;

/* ---------- профиль студента для компании ---------- */

-- Видит только компания, к задаче которой студент откликнулся. Контакты (email, tg) —
-- лишь после приглашения (company_invited_student).
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
  select p.id,
    p.data ->> 'first',        p.data ->> 'last',
    p.data ->> 'status',       p.data ->> 'institution',
    p.data ->> 'description',  p.data ->> 'availability',
    p.data ->> 'photoUrl',
    coalesce(p.data -> 'specialties',  '[]'::jsonb),
    coalesce(p.data -> 'hardSkills',   '[]'::jsonb),
    coalesce(p.data -> 'languages',    '[]'::jsonb),
    coalesce(p.data -> 'projects',     '[]'::jsonb),
    coalesce(p.data -> 'achievements', '[]'::jsonb),
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
