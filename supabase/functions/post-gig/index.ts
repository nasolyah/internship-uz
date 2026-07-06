// Supabase Edge Function: post-gig
// Публикация задачи компанией. Проверяет, что компания (по company_app_id) подтверждена,
// и вставляет задачу в таблицу gigs. Читают каталог все напрямую (публичная SELECT-политика).
//
// Авто: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function clip(v: unknown, n: number): string { return String(v ?? '').trim().slice(0, n); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const p = await req.json();
    const appId = clip(p?.company_app_id, 64);
    const title = clip(p?.title, 120);
    if (!appId) return json({ error: 'Нет id компании' }, 400);
    if (!title) return json({ error: 'Укажите название задачи' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Задачу может публиковать только подтверждённая компания.
    const { data: app, error: appErr } = await admin
      .from('company_applications').select('status, data').eq('id', appId).maybeSingle();
    if (appErr) return json({ error: appErr.message }, 500);
    if (!app) return json({ error: 'Компания не найдена' }, 404);
    if (app.status !== 'approved') return json({ error: 'Профиль компании ещё не подтверждён' }, 403);

    const companyName = clip((app.data as Record<string, unknown>)?.name, 120) || 'Компания';
    const row = {
      company_app_id: appId,
      company_name: companyName,
      title,
      description: clip(p?.description, 1000),
      format: clip(p?.format, 40),
      duration: clip(p?.duration, 40),
      slots: clip(p?.slots, 10) || '1',
    };

    const { data: ins, error: insErr } = await admin.from('gigs').insert(row).select('*').single();
    if (insErr || !ins) return json({ error: insErr?.message || 'Не удалось создать задачу' }, 500);

    return json({ gig: ins });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
