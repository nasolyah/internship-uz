// Supabase Edge Function: telegram-auth
// Проверяет подпись Telegram Login Widget и выдаёт одноразовый OTP,
// которым клиент устанавливает настоящую Supabase-сессию (verifyOtp).
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

    // Telegram не даёт email — используем синтетический, стабильный по telegram id.
    const email = `tg_${data.id}@telegram.local`;

    // Идемпотентно создаём пользователя (если уже есть — Supabase вернёт ошибку, игнорируем её).
    const { error: createErr } = await admin.auth.admin.createUser({
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
    if (createErr && !/already|registered|exists/i.test(createErr.message)) {
      return json({ error: createErr.message }, 500);
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
