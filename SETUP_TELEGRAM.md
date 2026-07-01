# Вход через Telegram — настройка

Реальный вход работает **только на публичном домене** (Netlify), не на `file://` и не на `localhost`.
Порядок такой: создать бота → задеплоить Edge Function → захостить сайт → привязать домен к боту.

## 1. Создать бота (@BotFather)

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram → `/newbot`.
2. Задайте имя и username (username заканчивается на `bot`, напр. `internship_uz_bot`).
3. BotFather пришлёт **токен** вида `123456:ABC-DEF...` — сохраните, он понадобится для Edge Function.

## 2. Задеплоить Edge Function

Нужен [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# из папки проекта (там, где лежит папка supabase/)
supabase login
supabase link --project-ref ysxvlopfcarhdszqzmnp

# положить токен бота в секреты функции
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC-DEF...

# деплой
supabase functions deploy telegram-auth
```

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в рантайме функции присутствуют автоматически — задавать их не нужно.

Проверить, что функция поднялась:
```bash
curl -i -X POST https://ysxvlopfcarhdszqzmnp.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer <ВАШ_ANON_KEY>" \
  -H "Content-Type: application/json" -d '{}'
# ожидаемо: 401 "Неверная подпись Telegram" — значит функция работает и проверяет подпись
```

## 3. Прописать имя бота в коде

В [int_app.js](int_app.js) вверху замените:
```js
var TELEGRAM_BOT = 'YOUR_BOT_USERNAME';   // → 'internship_uz_bot' (без @)
```

## 4. Захостить сайт на Netlify

Залейте `int.html`, `int_app.js`, `int_css.css` (перетаскиванием на app.netlify.com или через Git).
Получите домен, напр. `internship-uz.netlify.app`.

## 5. Привязать домен к боту

В [@BotFather](https://t.me/BotFather): `/setdomain` → выберите бота → отправьте домен **без https://**:
```
internship-uz.netlify.app
```
Без этого шага кнопка Telegram будет отдавать ошибку «Bot domain invalid».

## Готово

Откройте сайт на Netlify → «Войти как студент» → кнопка Telegram. После подтверждения в Telegram
имя и username подтянутся в профиль, а в Supabase появится пользователь с сессией.

---

## Как это работает (кратко)

1. Виджет Telegram отдаёт подписанные данные пользователя в браузер (`onTelegramAuth`).
2. Клиент шлёт их в Edge Function `telegram-auth`.
3. Функция проверяет подпись токеном бота (HMAC-SHA256), создаёт/находит пользователя
   (`tg_<id>@telegram.local`) и возвращает одноразовый OTP.
4. Клиент вызывает `supabase.auth.verifyOtp(...)` и получает настоящую Supabase-сессию.

Токен бота и service-role ключ живут только внутри Edge Function — в браузер не попадают.

## Локальная отладка функции (необязательно)

```bash
echo "TELEGRAM_BOT_TOKEN=123456:ABC-DEF..." > supabase/.env
supabase functions serve telegram-auth --env-file supabase/.env
```
Кнопку Telegram всё равно не проверить локально (нужен домен), но саму функцию — можно через `curl`.
