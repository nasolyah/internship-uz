-- Задача исчезает из каталога, когда мест больше нет.
--
-- До сих пор задача висела в каталоге вечно: компания набрала людей, стажировка прошла и
-- завершилась, а студенты продолжали откликаться — и получали отказ или тишину. Хуже всего
-- это бьёт по студентам, то есть по той стороне, которой у нас и так мало.
--
-- Момент закрытия — не завершение проекта, а набор нужного числа людей. Между приглашением
-- и завершением проходят недели, и всё это время задача уже занята. Завершение при этом
-- тоже закрывает задачу: завершённый отклик считается занятым местом.

/* ---------- сколько мест и сколько занято ---------- */

-- slots — текст ('1', '2', иногда '1-2' или с припиской). Берём первое число, при любой
-- невнятице считаем, что место одно: лучше закрыть задачу раньше, чем держать открытой
-- ту, куда уже некого брать.
create or replace function public.gig_slot_count(p_slots text)
returns int
language sql
immutable
as $$
  select greatest(coalesce(nullif(substring(coalesce(p_slots, '') from '\d+'), '')::int, 1), 1);
$$;

-- Занятыми считаем приглашённых и завершивших. Отклики «на рассмотрении» место не занимают:
-- компания ещё никого не выбрала.
create or replace function public.gig_taken_count(p_gig uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.gig_applications
  where gig_id = p_gig and status in ('invited', 'completed');
$$;

-- Открыта ли задача: есть свободные места и её не закрыли руками.
create or replace function public.gig_is_open(p_gig uuid, p_slots text, p_closed_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_closed_at is null and public.gig_taken_count(p_gig) < public.gig_slot_count(p_slots);
$$;

/* ---------- ручное закрытие ---------- */

-- Нужно как запасной выход: задачу отменили, или приглашённый студент пропал и компания
-- хочет снять её с публикации, не дожидаясь заполнения мест.
alter table public.gigs add column if not exists closed_at timestamptz;

create or replace function public.set_gig_closed(p_gig uuid, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.gigs;
begin
  select * into g from public.gigs where id = p_gig;
  if not found then
    raise exception 'Задача не найдена';
  end if;
  if not public.owns_company_app(g.company_app_id) then
    raise exception 'Закрыть задачу может только разместившая её компания';
  end if;
  update public.gigs set closed_at = case when p_closed then now() else null end where id = p_gig;
end;
$$;

revoke all on function public.set_gig_closed(uuid, boolean) from public;
grant execute on function public.set_gig_closed(uuid, boolean) to authenticated;

/* ---------- каталог показывает только открытые ---------- */

-- Компания и админ видят свои задачи всегда — иначе «Мои вакансии» опустели бы ровно
-- в тот момент, когда там появляется самое важное: завершение и выдача справок.
drop policy if exists "gigs_select_all" on public.gigs;
create policy "gigs_select_open" on public.gigs
  for select
  using (
    public.gig_is_open(id, slots, closed_at)
    or public.owns_company_app(company_app_id)
    or public.is_admin()
  );

/* ---------- откликнуться на закрытую задачу нельзя ---------- */

-- Клиент просто не покажет кнопку, но проверка нужна на сервере: страница могла быть
-- открыта до того, как место заняли.
drop policy if exists "gig_applications_insert_student" on public.gig_applications;
create policy "gig_applications_insert_student" on public.gig_applications
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.gigs g
      where g.id = gig_id
        and g.company_app_id = company_app_id
        and public.gig_is_open(g.id, g.slots, g.closed_at)
    )
    -- Пока статус на подтверждении, новые проекты недоступны (0014).
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
