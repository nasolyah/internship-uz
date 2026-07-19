// Supabase Edge Function: telegram-auth
// Проверяет подпись Telegram Login Widget и выдаёт одноразовый OTP,
// которым клиент устанавливает настоящую Supabase-сессию (verifyOtp).
//
// Кого пускать — определяет таблица telegram_links (миграция 0013), а не почта аккаунта.
// Требует применённой 0013: без неё запрос к telegram_links упадёт.
//
// Секреты (Project Settings → Edge Functions → Secrets, или `supabase secrets set`):
//   TELEGRAM_BOT_TOKEN   — токен бота из @BotFather
// Автоматически доступны в рантайме:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Деплой:  supabase functions deploy telegram-auth
// Локально: supabase functions serve telegram-auth --env-file supabase/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Проверка подписи по алгоритму Telegram:
//   secret_key   = SHA256(bot_token)
//   check_string = отсортированные "key=value" (без hash), склеенные через "\n"
//   ожидаемый hash = HMAC_SHA256(check_string, secret_key) в hex
async function verifyTelegram(
  data: Record<string, string>,
  botToken: string,
): Promise<boolean> {
  const hash = data.hash;
  if (!hash) return false;

  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');

  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(checkString));
  return toHex(sig) === hash;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return json({ error: 'TELEGRAM_BOT_TOKEN не задан' }, 500);

    const payload = await req.json();
    if (!payload || typeof payload !== 'object') {
      return json({ error: 'Пустой запрос' }, 400);
    }

    // Telegram присылает поля разных типов (id/auth_date — числа).
    // Для строки проверки приводим всё к строкам.
    const data: Record<string, string> = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== undefined && payload[k] !== null) data[k] = String(payload[k]);
    }

    if (!(await verifyTelegram(data, botToken))) {
      return json({ error: 'Неверная подпись Telegram' }, 401);
    }

    // Защита от повторного использования старых данных (не старше 24ч).
    const authDate = Number(data.auth_date || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) {
      return json({ error: 'Данные авторизации устарели' }, 401);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Кого пускаем — решает таблица связей, а не почта. Пользователь мог привязать
    // настоящую почту к тг-аккаунту (тогда его email в auth.users уже не синтетический)
    // или привязать Telegram к аккаунту, заведённому по почте. Поиск по tg_<id>@telegram.local
    // в обоих случаях промахнулся бы и завёл человеку второй, пустой аккаунт.
    const { data: link } = await admin
      .from('telegram_links')
      .select('user_id')
      .eq('telegram_id', String(data.id))
      .maybeSingle();

    let email: string;

    if (link) {
      // Аккаунт уже известен — берём его актуальную почту (она могла смениться при привязке).
      const { data: existing, error: getErr } = await admin.auth.admin.getUserById(link.user_id);
      if (getErr || !existing?.user?.email) {
        return json({ error: getErr?.message || 'Аккаунт не найден' }, 500);
      }
      email = existing.user.email;
      // Username в Telegram меняется — держим его свежим для отображения в кабинете.
      await admin.from('telegram_links')
        .update({ username: data.username ?? null })
        .eq('telegram_id', String(data.id));
    } else {
      // Первый вход через Telegram: заводим аккаунт с синтетической почтой. Настоящую
      // человек сможет привязать позже в кабинете, и тогда логин станет нормальным.
      email = `tg_${data.id}@telegram.local`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          provider: 'telegram',
          telegram_id: data.id,
          first_name: data.first_name ?? '',
          last_name: data.last_name ?? '',
          username: data.username ?? '',
          photo_url: data.photo_url ?? '',
        },
      });
      if (createErr || !created?.user) {
        return json({ error: createErr?.message || 'Не удалось создать аккаунт' }, 500);
      }
      const { error: linkInsErr } = await admin.from('telegram_links').insert({
        telegram_id: String(data.id),
        user_id: created.user.id,
        username: data.username ?? null,
      });
      // Без связи следующий вход снова создал бы новый аккаунт — это тихая порча данных,
      // поэтому падаем явно, а не пускаем внутрь.
      if (linkInsErr) return json({ error: 'Не удалось связать Telegram с аккаунтом' }, 500);
    }

    // Генерируем OTP без отправки письма — клиент обменяет его на сессию через verifyOtp.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const emailOtp = linkData?.properties?.email_otp;
    if (linkErr || !emailOtp) {
      return json({ error: linkErr?.message || 'Не удалось создать сессию' }, 500);
    }

    return json({ email, email_otp: emailOtp });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
