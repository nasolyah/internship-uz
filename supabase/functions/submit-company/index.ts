// Supabase Edge Function: submit-company
// Принимает заявку компании, сохраняет её и шлёт уведомление в Telegram-группу проверки.
// Заявка подтверждается только в панели модерации (admin_decide_company); Telegram — пинг.
//
// Заявку подаёт залогиненный пользователь (вход по коду на корпоративную почту), и она
// привязывается к нему через owner_user_id. Дальше компания читает свою заявку напрямую
// по RLS, а не по UUID из localStorage.
//
// Секреты:
//   TELEGRAM_BOT_TOKEN   — токен бота
//   TG_COMPANY_CHAT_ID   — id группы проверки компаний
//   PANEL_URL            — адрес сайта для ссылки в уведомлении (необязательный)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TG_COMPANY_CHAT_ID');
    if (!botToken || !chatId) return json({ error: 'TELEGRAM_BOT_TOKEN / TG_COMPANY_CHAT_ID не заданы' }, 500);

    // Владельца заявки берём из JWT — из тела ему верить нельзя.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Не авторизован' }, 401);

    const p = await req.json();
    const name = String(p?.name || '').trim();
    const inn = String(p?.inn || '').trim();
    const director = String(p?.director || '').trim();
    const contact = String(p?.contact || '').trim();
    const phone = String(p?.phone || '').trim();
    // Обязательные поля (кроме корпоративной почты и LinkedIn).
    if (!name || !inn || !director || !contact || !phone) {
      return json({ error: 'Заполнены не все обязательные поля' }, 400);
    }

    const data = {
      name, inn, director, contact, phone,
      corpEmail: String(p?.corpEmail || '').trim(),
      domain: String(p?.domain || '').trim(),
      linkedin: String(p?.linkedin || '').trim(),
    };

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Одна заявка на аккаунт: повторная отправка формы не плодит дублей в группе проверки.
    const existing = await admin
      .from('company_applications').select('id, status').eq('owner_user_id', user.id).maybeSingle();
    if (existing.error) return json({ error: existing.error.message }, 500);
    if (existing.data) return json({ id: existing.data.id, status: existing.data.status });

    const ins = await admin
      .from('company_applications').insert({ data, status: 'pending', owner_user_id: user.id }).select('id').single();
    if (ins.error || !ins.data) return json({ error: ins.error?.message || 'Не удалось сохранить заявку' }, 500);
    const id = ins.data.id as string;

    const panel = Deno.env.get('PANEL_URL');
    const lines = [
      `🏢 Заявка компании`,
      `Название: ${data.name}`,
      `ИНН: ${data.inn}`,
      `Руководитель: ${data.director}`,
      data.corpEmail ? `Почта: ${data.corpEmail}` : '',
      data.linkedin ? `LinkedIn/соцсети: ${data.linkedin}` : '',
      `Контакт: ${data.contact}`,
      `Телефон: ${data.phone}`,
      `Статус: на проверке`,
      panel ? `Решение — в разделе «Модерация»: ${panel}` : `Решение — в разделе «Модерация» на сайте`,
    ].filter(Boolean);

    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') }),
    });
    const tgRes = await tg.json();
    if (!tgRes.ok) return json({ error: 'Telegram: ' + (tgRes.description || 'ошибка отправки') }, 502);

    return json({ id, status: 'pending' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
