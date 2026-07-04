// Supabase Edge Function: generate-test
// Генерирует ИИ-тест (8 вопросов с вариантами + 1 открытый) через Claude для выбранных
// специальностей студента. Исключает вопросы, которые студент уже видел (по тексту),
// чтобы повторные попытки не повторяли один и тот же набор вопросов.
//
// НЕ ЗАДЕПЛОЕНО — требуется:
//   1) supabase functions deploy generate-test
//   2) секрет ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...)
// До деплоя фронтенд (int_app.js) продолжает использовать статический банк вопросов
// из ai_test_bank.js — см. testBankFor() / actions.startTest.
//
// Секреты:
//   ANTHROPIC_API_KEY  — ключ Anthropic API
// Авто: SUPABASE_URL, SUPABASE_ANON_KEY

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

// Формат совпадает с записями window.AI_TEST_BANK в ai_test_bank.js.
const SCHEMA = {
  type: 'object',
  properties: {
    mcq: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          a: { type: 'array', items: { type: 'string' } },
          c: { type: 'integer' },
        },
        required: ['q', 'a', 'c'],
        additionalProperties: false,
      },
    },
    open: { type: 'string' },
  },
  required: ['mcq', 'open'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);

    // Идентифицируем пользователя по JWT — специальности/историю вопросов из тела не доверяем слепо,
    // но авторизация нужна хотя бы для того, чтобы тест мог запросить только вошедший студент.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: 'Не авторизован' }, 401);

    const { specialties, seenQuestions } = await req.json();
    if (!Array.isArray(specialties) || specialties.length === 0) return json({ error: 'Не указаны специальности' }, 400);
    const specList = specialties.slice(0, 3).map(String);
    const seenList = (Array.isArray(seenQuestions) ? seenQuestions : []).slice(0, 60).map(String);

    const anthropic = new Anthropic({ apiKey });
    const prompt = 'Составь ИИ-тест навыков для специальности' + (specList.length > 1 ? 'ей' : '') + ': ' + specList.join(', ') + '.\n' +
      'Нужно ровно 8 вопросов с вариантами ответа (mcq) — у каждого ровно 4 варианта (a) и индекс правильного (c, от 0 до 3) — плюс 1 открытый практический вопрос (open).\n' +
      'Вопросы — на русском языке, разного уровня сложности (от базового до продвинутого), проверяют реальное понимание, а не зазубренные факты.\n' +
      'Если специальностей несколько — распредели вопросы между ними примерно поровну.\n' +
      (seenList.length ? 'Не повторяй и не перефразируй близко следующие уже заданные вопросы:\n' + seenList.map((q) => '- ' + q).join('\n') : '');

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = msg.content.find((b: { type: string }) => b.type === 'text') as { text?: string } | undefined;
    if (!textBlock?.text) return json({ error: 'ИИ не вернул текстовый ответ' }, 502);
    const bank = JSON.parse(textBlock.text);

    if (!Array.isArray(bank.mcq) || bank.mcq.length !== 8 || typeof bank.open !== 'string') {
      return json({ error: 'ИИ вернул некорректный формат теста' }, 502);
    }
    for (const item of bank.mcq) {
      if (!Array.isArray(item.a) || item.a.length !== 4 || typeof item.c !== 'number' || item.c < 0 || item.c > 3) {
        return json({ error: 'ИИ вернул некорректный вопрос' }, 502);
      }
    }

    return json({ ok: true, bank });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
