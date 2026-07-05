// Supabase Edge Function: company-status
// Возвращает статус и данные заявки компании по её id (у компаний нет аккаунта,
// поэтому браузер хранит id в localStorage и спрашивает статус здесь).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { id } = await req.json();
    if (!id || typeof id !== 'string') return json({ error: 'id обязателен' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.from('company_applications').select('status, data').eq('id', id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ status: null, data: null });

    return json({ status: data.status, data: data.data });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
