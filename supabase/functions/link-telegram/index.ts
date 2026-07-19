// Supabase Edge Function: link-telegram
// Привязывает Telegram к аккаунту, в который человек уже вошёл (обычно — по коду на почту).
// После привязки вход через Telegram ведёт в этот же аккаунт, а не создаёт второй.
//
// Почему отдельная функция, а не поле в профиле: строку '@username' в профиле человек
// печатает руками, её никто не проверяет. Здесь же проверяется подпись Telegram, то есть
// подтверждается владение аккаунтом — иначе можно было бы «привязать» чужой Telegram.
//
// Секреты:
//   TELEGRAM_BOT_TOKEN  — токен бота из @BotFather
// Авто: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Деплой: supabase functions deploy link-telegram

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Тот же алгоритм, что в telegram-auth. Продублирован намеренно: функции деплоятся
// по отдельности (в том числе через редактор в Dashboard), и общий модуль сделал бы
// деплой зависимым от структуры папок.
async function verifyTelegram(data: Record<string, string>, botToken: string): Promise<boolean> {
  const hash = data.hash;
  if (!hash) return false;
  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  const cryptoKey = await crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(checkString));
  return toHex(sig) === hash;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return json({ error: 'TELEGRAM_BOT_TOKEN не задан' }, 500);

    // К какому аккаунту привязываем — берём из JWT, а не из тела запроса.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Не авторизован' }, 401);

    const payload = await req.json();
    if (!payload || typeof payload !== 'object') return json({ error: 'Пустой запрос' }, 400);

    const data: Record<string, string> = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== undefined && payload[k] !== null) data[k] = String(payload[k]);
    }

    if (!(await verifyTelegram(data, botToken))) return json({ error: 'Неверная подпись Telegram' }, 401);

    const authDate = Number(data.auth_date || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) {
      return json({ error: 'Данные авторизации устарели' }, 401);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tgId = String(data.id);
    const username = data.username ? String(data.username) : null;

    // Этот Telegram уже за кем-то закреплён?
    const { data: byTg } = await admin
      .from('telegram_links').select('user_id').eq('telegram_id', tgId).maybeSingle();
    if (byTg && byTg.user_id !== user.id) {
      // Скорее всего это второй аккаунт того же человека, заведённый через Telegram раньше.
      // Молча переписывать связь нельзя: тот аккаунт останется без входа, а вместе с ним
      // его профиль, отклики и переписки. Разбираем такие случаи вручную.
      return json({ error: 'Этот Telegram уже привязан к другому аккаунту на платформе. Напишите нам — поможем объединить.' }, 409);
    }

    // У этого аккаунта уже есть другой Telegram?
    const { data: byUser } = await admin
      .from('telegram_links').select('telegram_id').eq('user_id', user.id).maybeSingle();
    if (byUser && byUser.telegram_id !== tgId) {
      return json({ error: 'К аккаунту уже привязан другой Telegram.' }, 409);
    }

    if (byTg) {
      // Повторная привязка того же Telegram — просто освежаем username.
      await admin.from('telegram_links').update({ username }).eq('telegram_id', tgId);
    } else {
      const { error: insErr } = await admin.from('telegram_links')
        .insert({ telegram_id: tgId, user_id: user.id, username });
      if (insErr) return json({ error: 'Не удалось привязать Telegram' }, 500);
    }

    // Заодно кладём @username в профиль как контакт — раньше его печатали руками.
    if (username) {
      const { data: prof } = await admin.from('profiles').select('data').eq('id', user.id).maybeSingle();
      if (prof?.data) {
        const d = prof.data as Record<string, unknown>;
        await admin.from('profiles').update({ data: { ...d, tg: '@' + username } }).eq('id', user.id);
      }
    }

    return json({ ok: true, telegram_id: tgId, username });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
