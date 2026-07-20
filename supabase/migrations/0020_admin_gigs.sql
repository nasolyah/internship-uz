-- Список всех задач для панели: админ и так видит их по политике из 0018, но откликов
-- он не видит вовсе — на gig_applications админской политики нет и заводить её незачем
-- (там переписка студента с компанией, читать её админу не нужно).
--
-- Поэтому счётчики считаем здесь, отдавая только числа: сколько всего откликов, сколько
-- мест занято и сколько стажировок завершено. Самих откликов и переписки функция не отдаёт.

create or replace function public.admin_gigs()
returns table (
  id uuid, title text, company_name text, slots text,
  closed_at timestamptz, created_at timestamptz, is_open boolean,
  applications int, taken int, completed int
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.title, g.company_name, g.slots,
         g.closed_at, g.created_at,
         public.gig_is_open(g.id, g.slots, g.closed_at),
         (select count(*)::int from public.gig_applications a where a.gig_id = g.id),
         (select count(*)::int from public.gig_applications a
           where a.gig_id = g.id and a.status in ('invited', 'completed')),
         (select count(*)::int from public.gig_applications a
           where a.gig_id = g.id and a.status = 'completed')
  from public.gigs g
  where public.is_admin()
  order by g.created_at desc;
$$;

revoke all on function public.admin_gigs() from public;
grant execute on function public.admin_gigs() to authenticated;
