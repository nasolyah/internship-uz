-- Админ видит все задачи (это нужно для истории и разбора), но каталог — это «куда можно
-- откликнуться», и закрытым задачам там не место ни у кого. Раньше админ видел их в общем
-- списке, и выглядело это как сломанный фильтр.
--
-- Права не урезаем: политика чтения остаётся как в 0018. Вместо этого даём клиенту способ
-- отличить открытую задачу от закрытой — вычисляемое поле. Первый аргумент типа public.gigs
-- делает функцию «вычисляемым столбцом» в PostgREST: её можно запросить как select=*,is_open.

create or replace function public.is_open(g public.gigs)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.gig_is_open(g.id, g.slots, g.closed_at);
$$;

revoke all on function public.is_open(public.gigs) from public;
grant execute on function public.is_open(public.gigs) to anon, authenticated;
