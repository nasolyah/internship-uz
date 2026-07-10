// Supabase Edge Function: claim-company
// Привязывает к текущему аккаунту заявку компании, поданную до появления аккаунтов
// (когда «сессией» был company_app_id в localStorage). Одноразовая операция:
// как только у заявки есть владелец, забрать её больше нельзя.
//
// После привязки компания читает свою заявку напрямую — company_applications
// с политикой select using (auth.uid() = owner_user_id). Отдельная функция статуса не нужна.
//
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
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Не авторизован' }, 401);

    const { id } = await req.json();
    if (!id || typeof id !== 'string') return json({ error: 'id обязателен' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: app, error } = await admin
      .from('company_applications').select('id, status, owner_user_id').eq('id', id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!app) return json({ error: 'Заявка не найдена' }, 404);

    if (app.owner_user_id && app.owner_user_id !== user.id) {
      return json({ error: 'Заявка уже привязана к другому аккаунту' }, 403);
    }

    if (!app.owner_user_id) {
      // Гонка двух вкладок: привязываем только пока владельца нет.
      const upd = await admin
        .from('company_applications').update({ owner_user_id: user.id })
        .eq('id', id).is('owner_user_id', null).select('id').maybeSingle();
      if (upd.error) return json({ error: upd.error.message }, 500);
      if (!upd.data) return json({ error: 'Заявка уже привязана к другому аккаунту' }, 403);
    }

    return json({ id: app.id, status: app.status });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
