// Supabase Edge Function: tg-webhook
// Вебхук Telegram. Обрабатывает нажатия inline-кнопок ✅/❌ под документами в группе проверки:
// обновляет profiles.data.docStatus и редактирует сообщение с решением.
//
// Обрабатывает и заявки компаний (callback_data company:<id>:approve|reject) — меняет
// company_applications.status.
//
// Секреты:
//   TELEGRAM_BOT_TOKEN  — токен бота
//   TG_STUDY_CHAT_ID    — id группы проверки справок
//   TG_CONSENT_CHAT_ID  — id группы проверки согласий
//   TG_COMPANY_CHAT_ID  — id группы проверки заявок компаний
//   TG_WEBHOOK_SECRET   — секрет, который Telegram шлёт в заголовке (задаётся при setWebhook)
// Авто: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Деплой без проверки JWT (Telegram не шлёт наш JWT — защищаемся секретом заголовка):
//   supabase functions deploy tg-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LABELS: Record<string, string> = { study: 'Справка о месте учёбы', consent: 'Согласие родителя' };

async function tg(method: string, body: unknown, botToken: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
    const allowedChats = [Deno.env.get('TG_STUDY_CHAT_ID'), Deno.env.get('TG_CONSENT_CHAT_ID'), Deno.env.get('TG_COMPANY_CHAT_ID')].filter(Boolean).map(String);
    const secret = Deno.env.get('TG_WEBHOOK_SECRET');

    // Защита эндпоинта: Telegram шлёт секрет в этом заголовке (см. setWebhook).
    if (secret && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return new Response('forbidden', { status: 401 });
    }

    const update = await req.json();
    const cb = update.callback_query;
    if (!cb) return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

    // Только из разрешённых групп проверки (справки/согласия).
    if (allowedChats.length && cb.message && !allowedChats.includes(String(cb.message.chat.id))) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Недоступно' }, botToken);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const parts = String(cb.data || '').split(':');
    const type = parts[0], userId = parts[1], action = parts[2];
    if (!type || !userId || (action !== 'approve' && action !== 'reject')) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id }, botToken);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const who = cb.from.username ? '@' + cb.from.username : (cb.from.first_name || 'админ');
    const mark = status === 'approved' ? '✅ Подтверждено' : '❌ Отклонено';

    if (type === 'company') {
      // userId здесь — это id заявки компании; сообщение текстовое (sendMessage).
      await admin.from('company_applications').update({ status }).eq('id', userId);
      const baseText = String(cb.message.text || 'Заявка компании').split('\nСтатус:')[0];
      await tg('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: `${baseText}\nСтатус: ${mark} · ${who}`,
      }, botToken);
    } else {
      // документы студента (study/consent): сообщение с документом (sendDocument, caption).
      const { data: prof } = await admin.from('profiles').select('data').eq('id', userId).maybeSingle();
      const d: Record<string, unknown> = (prof?.data as Record<string, unknown>) || {};
      const docStatus = (d.docStatus as Record<string, string>) || {};
      docStatus[type] = status;
      d.docStatus = docStatus;
      await admin.from('profiles').update({ data: d, updated_at: new Date().toISOString() }).eq('id', userId);
      const baseCaption = String(cb.message.caption || LABELS[type] || 'Документ').split('\nСтатус:')[0];
      await tg('editMessageCaption', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        caption: `${baseCaption}\nСтатус: ${mark} · ${who}`,
      }, botToken);
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: mark }, botToken);

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
