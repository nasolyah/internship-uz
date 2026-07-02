# Документы школьников (справка + согласие) — настройка

Школьник/лицеист загружает в кабинете **справку о месте учёбы** и **согласие родителя**.
Файлы уходят в Supabase Storage, Edge Function шлёт их в Telegram-группу проверки с
кнопками ✅/❌, а вебхук обновляет статус в БД.

## 1. Таблица и хранилище (SQL Editor)

Выполните миграцию [supabase/migrations/0002_student_docs.sql](supabase/migrations/0002_student_docs.sql)
(создаёт приватный бакет `student-docs` и RLS). Профили уже хранят статусы в `profiles.data.docStatus`.

## 2. Группа проверки в Telegram

1. Создайте группу (напр. «internship.uz — проверка документов»).
2. Добавьте туда бота **@int_auth_bot** и сделайте его администратором.
3. Узнайте `chat_id` группы: временно напишите в группе что-нибудь и откройте
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates` — там будет `chat.id` вида `-1001234567890`.

## 3. Секреты Edge Functions

Dashboard → Edge Functions → Secrets (или `supabase secrets set`):

- `TG_REVIEW_CHAT_ID` = id группы проверки (напр. `-1001234567890`)
- `TG_WEBHOOK_SECRET` = любая случайная строка (напр. сгенерируйте 32 символа)
- `TELEGRAM_BOT_TOKEN` — уже задан (используется повторно)

## 4. Задеплоить функции

- `submit-doc` — приём документа и отправка в группу (обычный деплой).
- `tg-webhook` — обработчик кнопок; деплой **без проверки JWT**:

```bash
supabase functions deploy submit-doc
supabase functions deploy tg-webhook --no-verify-jwt
```

(Через Dashboard: создать функции «Via Editor», вставить код из
`supabase/functions/submit-doc/` и `supabase/functions/tg-webhook/`. Для `tg-webhook`
отключить «Verify JWT» в настройках функции.)

## 5. Привязать вебхук к боту

Один раз вызовите (подставьте токен и секрет):

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://ysxvlopfcarhdszqzmnp.supabase.co/functions/v1/tg-webhook&secret_token=<TG_WEBHOOK_SECRET>&allowed_updates=[\"callback_query\"]"
```

Проверить: `https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo`.

> ⚠️ Тот же бот используется и для входа (Login Widget), и для вебхука — это нормально.
> Login Widget работает независимо от вебхука.

## 6. Шаблон согласия

Положите PDF в `templates/parental-consent-template.pdf` (см. [templates/README.md](templates/README.md))
и запушьте. Кнопка «Скачать шаблон» в модалке ведёт на этот файл.

## Как проходит проверка

1. Школьник в кабинете жмёт «Загрузить» / «Подтвердить» → выбирает файл → «Отправить на проверку».
2. Документ приходит в группу с подписью (ФИО, email, tg) и кнопками ✅/❌.
3. Админ жмёт кнопку → вебхук ставит статус `approved`/`rejected`, сообщение помечается решением.
4. У школьника в кабинете статус меняется (после перезагрузки страницы). Одобренное согласие
   разблокирует каталог задач.
