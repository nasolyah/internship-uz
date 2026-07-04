// Supabase Edge Function: review-cert
// ИИ-проверка сертификата/достижения перед публикацией в профиле: определяет, похож ли
// прикреплённый файл на настоящий документ (сертификат, диплом, грамота, скриншот
// результата) или на спам/мусор/нерелевантный файл. Используется разделами "Матрица
// навыков" и "Верифицированные документы и достижения" личного кабинета студента.
//
// НЕ ЗАДЕПЛОЕНО — требуется:
//   1) supabase functions deploy review-cert
//   2) секрет ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...)
// До деплоя файлы в int_app.js загружаются без авто-проверки — см. actions.saveItemModal.
// После деплоя: вызывать эту функцию сразу после успешной загрузки файла, передав путь;
// если verdict.approved === false — удалить элемент/файл и показать студенту предупреждение
// с verdict.reason.
//
// Секреты:
//   ANTHROPIC_API_KEY  — ключ Anthropic API
// Авто: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    category: { type: 'string', enum: ['certificate', 'diploma', 'award', 'other_legit', 'spam', 'irrelevant', 'unreadable'] },
    reason: { type: 'string' },
  },
  required: ['approved', 'category', 'reason'],
  additionalProperties: false,
};

const IMAGE_EXT: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Не авторизован' }, 401);

    const { path, title } = await req.json();
    if (typeof path !== 'string' || !path.startsWith(user.id + '/')) return json({ error: 'Некорректный путь файла' }, 403);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: fileBlob, error: dlErr } = await admin.storage.from('student-docs').download(path);
    if (dlErr || !fileBlob) return json({ error: dlErr?.message || 'Не удалось скачать файл' }, 500);
    if (fileBlob.size > 10 * 1024 * 1024) return json({ error: 'Файл больше 10 МБ' }, 400);

    const ext = (path.split('.').pop() || '').toLowerCase();
    const isImage = ext in IMAGE_EXT;
    const isPdf = ext === 'pdf';
    if (!isImage && !isPdf) return json({ error: 'ИИ-проверка поддерживает только изображения и PDF' }, 400);

    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);

    const contentBlock = isImage
      ? { type: 'image' as const, source: { type: 'base64' as const, media_type: ('image/' + IMAGE_EXT[ext]) as 'image/jpeg', data: b64 } }
      : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } };

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: 'Это файл, который студент прикрепил к разделу профиля "' + (title || 'достижение') + '" на платформе стажировок для студентов и школьников. ' +
              'Проверь: похож ли это на настоящий документ (сертификат, диплом, грамота, справка, скриншот реального результата теста или олимпиады и т.п.), ' +
              'или это спам, случайный/нерелевантный файл, мем, пустое изображение, нечитаемый скан и т.п. ' +
              'Будь снисходителен к качеству скана или фото — отклоняй только явный спам или полностью нерелевантный контент.',
          },
        ],
      }],
    });

    const textBlock = msg.content.find((b: { type: string }) => b.type === 'text') as { text?: string } | undefined;
    if (!textBlock?.text) return json({ error: 'ИИ не вернул ответ' }, 502);
    const verdict = JSON.parse(textBlock.text);

    if (!verdict.approved) {
      await admin.storage.from('student-docs').remove([path]);
    }

    return json({ ok: true, verdict });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
