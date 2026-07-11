-- Приглашение несёт студенту не только ссылку на созвон, но и контакт куратора.
-- Оба всё так же приватны: их нет в company_public (открытом профиле), они приходят
-- в чат только в момент, когда компания нажимает «Пригласить» (status -> invited).
--
-- Ссылка ставится в КОНЕЦ строки: клиент делает из URL в конце сообщения кнопку
-- «Присоединиться к созвону» (см. systemBubble/MEET_URL в int_app.js). Контакт куратора
-- идёт текстом перед ссылкой.

create or replace function public.announce_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  link      text;
  m_name    text;
  m_role    text;
  m_contact text;
  mentor    text := '';
  msg       text;
begin
  if new.status <> 'invited' or old.status is not distinct from 'invited' then
    return new;
  end if;

  select nullif(btrim(ca.profile ->> 'meetingLink'),   ''),
         nullif(btrim(ca.profile ->> 'mentorName'),    ''),
         nullif(btrim(ca.profile ->> 'mentorRole'),    ''),
         nullif(btrim(ca.profile ->> 'mentorContact'), '')
    into link, m_name, m_role, m_contact
  from public.company_applications ca
  where ca.id = new.company_app_id;

  if m_name is not null or m_contact is not null then
    mentor := ' Куратор — ' || coalesce(m_name, 'куратор')
      || case when m_role    is not null then ' (' || m_role || ')' else '' end
      || case when m_contact is not null then ', ' || m_contact       else '' end
      || '.';
  end if;

  if link is null then
    msg := 'Отклик принят.' || mentor || ' Компания добавит ссылку на созвон в этот чат.';
  else
    -- ссылка последней — из неё клиент собирает кнопку присоединения
    msg := 'Отклик принят.' || mentor || ' ' || link;
  end if;

  insert into public.messages (application_id, sender_role, sender_id, body)
  values (new.id, 'system', null, msg);

  return new;
end;
$$;
