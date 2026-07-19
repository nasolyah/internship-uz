-- Связь аккаунта с Telegram. До этого «кто есть кто» определялось синтетической почтой
-- tg_<telegram_id>@telegram.local в auth.users: telegram-auth создавал по ней пользователя
-- и по ней же его находил. Из-за этого один человек, зашедший сегодня по почте, а завтра
-- через Telegram, получал два независимых аккаунта с разными профилями.
--
-- Теперь соответствие telegram_id → пользователь хранится явно. Это развязывает логин
-- аккаунта и его Telegram: почту в auth.users можно поменять на настоящую (привязка почты
-- к тг-аккаунту), и вход через Telegram всё равно найдёт того же пользователя.

create table if not exists public.telegram_links (
  -- id из Telegram — первичный ключ: один Telegram нельзя привязать к двум аккаунтам.
  telegram_id text primary key,
  -- unique: у одного аккаунта не больше одного Telegram.
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  username    text,
  linked_at   timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

-- Читать можно только свою связь — чтобы кабинет показал «Telegram привязан».
-- Политик insert/update/delete нет вовсе: пишут только Edge Functions под service role,
-- иначе привязку можно было бы подделать без подписи Telegram.
drop policy if exists "telegram_links_select_own" on public.telegram_links;
create policy "telegram_links_select_own" on public.telegram_links
  for select to authenticated
  using (user_id = auth.uid());

/* ---------- перенос уже существующих тг-аккаунтов ---------- */

-- Без этого после переключения telegram-auth на поиск по связи все, кто регистрировался
-- через Telegram раньше, при следующем входе получили бы новый пустой аккаунт.
insert into public.telegram_links (telegram_id, user_id, username)
select
  substring(u.email from '^tg_(.+)@telegram\.local$'),
  u.id,
  nullif(u.raw_user_meta_data ->> 'username', '')
from auth.users u
where u.email ~ '^tg_.+@telegram\.local$'
on conflict do nothing;

/* ---------- что показать в кабинете ---------- */

-- Кабинету нужно знать две вещи: привязан ли Telegram и является ли текущий логин
-- синтетическим (то есть предлагать ли привязать настоящую почту).
create or replace function public.my_account_links()
returns table (telegram_id text, telegram_username text, login_email text, login_is_synthetic boolean)
language sql
stable
security definer
set search_path = public
as $$
  select l.telegram_id, l.username, u.email::text,
         u.email ~ '^tg_.+@telegram\.local$'
  from auth.users u
       left join public.telegram_links l on l.user_id = u.id
  where u.id = auth.uid();
$$;

revoke all on function public.my_account_links() from public;
grant execute on function public.my_account_links() to authenticated;
