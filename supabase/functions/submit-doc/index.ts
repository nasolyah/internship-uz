// Supabase Edge Function: submit-doc
// Получает от клиента ссылку на загруженный документ и шлёт уведомление в Telegram-группу
// проверки. Telegram здесь — только пинг «пришёл документ»; решения принимаются в админке.
// Кнопок ✅/❌ нет намеренно: два источника решений (бот и панель) расходились бы между собой,
// а статус документа живёт в student_files и меняется только через панель.
//
// Секреты:
//   TELEGRAM_BOT_TOKEN  — токен бота
//   TG_STUDY_CHAT_ID    — id группы проверки справок о месте учёбы
//   TG_CONSENT_CHAT_ID  — id группы проверки согласий родителей
//   PANEL_URL           — адрес сайта, ссылку на него кладём в уведомление (необязательный)
// Авто: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const LABELS: Record<string, string> = { study: 'Справка о месте учёбы', consent: 'Согласие родителя' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return json({ error: 'TELEGRAM_BOT_TOKEN не задан' }, 500);

    // Идентифицируем пользователя по его JWT (нельзя доверять userId из тела).
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Не авторизован' }, 401);

    const { type, path } = await req.json();
    if (type !== 'study' && type !== 'consent') return json({ error: 'Неизвестный тип документа' }, 400);
    if (typeof path !== 'string' || !path.startsWith(user.id + '/')) return json({ error: 'Некорректный путь файла' }, 403);

    // Тип документа → своя группа проверки.
    const chatId = type === 'consent' ? Deno.env.get('TG_CONSENT_CHAT_ID') : Deno.env.get('TG_STUDY_CHAT_ID');
    if (!chatId) return json({ error: (type === 'consent' ? 'TG_CONSENT_CHAT_ID' : 'TG_STUDY_CHAT_ID') + ' не задан' }, 500);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Ссылка на файл на 7 дней — Telegram сам скачает документ по URL.
    const { data: signed, error: signErr } = await admin.storage.from('student-docs').createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signErr || !signed?.signedUrl) return json({ error: signErr?.message || 'Не удалось создать ссылку' }, 500);

    // Данные пользователя для подписи в группе.
    const { data: prof } = await admin.from('profiles').select('data').eq('id', user.id).maybeSingle();
    const d: Record<string, unknown> = (prof?.data as Record<string, unknown>) || {};
    const who = `${d.first ?? ''} ${d.last ?? ''}`.trim() + (d.email ? ` · ${d.email}` : '') + (d.tg ? ` · ${d.tg}` : '');
    const panel = Deno.env.get('PANEL_URL');
    const caption = [
      `📄 ${LABELS[type]}`,
      who,
      `Статус: на проверке`,
      panel ? `Решение — в разделе «Модерация»: ${panel}` : `Решение — в разделе «Модерация» на сайте`,
    ].filter(Boolean).join('\n');

    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, document: signed.signedUrl, caption }),
    });
    const tgRes = await tg.json();
    if (!tgRes.ok) return json({ error: 'Telegram: ' + (tgRes.description || 'ошибка отправки') }, 502);

    // Статус документа живёт в student_files — строку туда создаёт клиент при загрузке
    // (RLS пускает только 'pending'). Здесь ничего не пишем: функция лишь уведомляет
    // группу проверки, а решение принимается в панели модерации.
    return json({ ok: true, status: 'pending' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
