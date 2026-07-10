-- Взаимная видимость профилей: студент открывает витрину компании, компания — профиль
-- откликнувшегося студента. Плюс автосообщение со ссылкой на созвон при приглашении.
--
-- Обе стороны читают друг друга через представления (security definer): они обходят RLS
-- базовых таблиц, но отдают строго заданный набор колонок. Прямой select по profiles
-- и company_applications по-прежнему возвращает только свою строку.

/* ---------- витрина компании отдельно от реквизитов ---------- */

-- data (ИНН, директор, телефон, корпоративная почта) заполняется при подаче заявки и
-- дальше неприкосновенна: по ней компанию проверяли вручную. Всё, что компания правит
-- сама, живёт в profile — иначе, получив право писать в свою строку, она смогла бы
-- после одобрения подменить себе ИНН и остаться «подтверждённой».
alter table public.company_applications
  add column if not exists profile jsonb not null default '{}'::jsonb;

-- Supabase по умолчанию выдаёт authenticated update на все колонки — забираем и возвращаем
-- точечно. status тоже колонка, и без этого компания проставила бы себе approved.
revoke update on public.company_applications from authenticated;
grant  update (profile) on public.company_applications to authenticated;

drop policy if exists "company_applications_update_own_profile" on public.company_applications;
create policy "company_applications_update_own_profile" on public.company_applications
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

/* ---------- витрина компании для студентов ---------- */

-- Скрыты: inn, director, phone, contact, corpEmail, mentorContact и meetingLink
-- (ссылка на созвон приходит студенту в чат при приглашении, а не лежит в открытую).
create or replace view public.company_public as
select
  ca.id,
  ca.data    ->> 'name'            as name,
  ca.data    ->> 'linkedin'        as linkedin,
  ca.profile ->> 'description'     as description,
  ca.profile ->> 'pitch'           as pitch,
  ca.profile ->  'focusAreas'      as focus_areas,
  ca.profile ->  'techStack'       as tech_stack,
  ca.profile ->> 'commStyle'       as comm_style,
  ca.profile ->> 'syncHours'       as sync_hours,
  ca.profile ->> 'meetingCadence'  as meeting_cadence,
  ca.profile ->> 'defaultDuration' as default_duration,
  ca.profile ->> 'mentorName'      as mentor_name,
  ca.profile ->> 'mentorRole'      as mentor_role
from public.company_applications ca
where ca.status = 'approved';

-- security_invoker off (по умолчанию): представление читает базовую таблицу правами
-- владельца, минуя её RLS. Именно поэтому список колонок выше — исчерпывающий.
grant select on public.company_public to anon, authenticated;

/* ---------- профиль студента для компании ---------- */

-- Видит только компания, к задаче которой студент откликнулся. Контакты (email, Telegram)
-- открываются лишь после приглашения: до этого общаться можно в чате, а часть студентов —
-- несовершеннолетние, и раздавать их контакты каждой опубликовавшей задачу компании нельзя.
create or replace function public.company_invited_student(student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gig_applications a
    where a.student_id = student
      and a.status = 'invited'
      and public.owns_company_app(a.company_app_id)
  );
$$;

revoke all on function public.company_invited_student(uuid) from public;
grant execute on function public.company_invited_student(uuid) to authenticated;

create or replace view public.student_public as
select
  p.id,
  p.data ->> 'first'        as first_name,
  p.data ->> 'last'         as last_name,
  p.data ->> 'status'       as study_status,
  p.data ->> 'institution'  as institution,
  p.data ->> 'description'  as description,
  p.data ->> 'availability' as availability,
  p.data ->> 'photoUrl'     as photo_url,
  coalesce(p.data -> 'specialties',  '[]'::jsonb) as specialties,
  coalesce(p.data -> 'hardSkills',   '[]'::jsonb) as hard_skills,
  coalesce(p.data -> 'languages',    '[]'::jsonb) as languages,
  coalesce(p.data -> 'projects',     '[]'::jsonb) as projects,
  coalesce(p.data -> 'achievements', '[]'::jsonb) as achievements,
  p.data -> 'aiTest'        as ai_test,
  case when public.company_invited_student(p.id) then p.data ->> 'email' end as email,
  case when public.company_invited_student(p.id) then p.data ->> 'tg'    end as tg
from public.profiles p
where exists (
  select 1 from public.gig_applications a
  where a.student_id = p.id and public.owns_company_app(a.company_app_id)
);

grant select on public.student_public to authenticated;

/* ---------- приглашение: ссылка на созвон в чат ---------- */

-- Сообщение ставит база: иначе компания подделала бы системную реплику, а студент —
-- приглашение самому себе. Ссылку берём из витрины, а не из тела запроса.
create or replace function public.announce_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  link text;
begin
  if new.status <> 'invited' or old.status is not distinct from 'invited' then
    return new;
  end if;

  select nullif(btrim(ca.profile ->> 'meetingLink'), '')
    into link
  from public.company_applications ca
  where ca.id = new.company_app_id;

  insert into public.messages (application_id, sender_role, sender_id, body)
  values (
    new.id, 'system', null,
    case when link is null
      then 'Отклик принят. Компания добавит ссылку на созвон здесь.'
      else 'Отклик принят. Созвон: ' || link
    end
  );

  return new;
end;
$$;

drop trigger if exists gig_applications_announce_invite on public.gig_applications;
create trigger gig_applications_announce_invite
  after update of status on public.gig_applications
  for each row
  execute function public.announce_invite();
