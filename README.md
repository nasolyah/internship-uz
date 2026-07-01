# internship.uz

Платформа стажировок для стартапов и студентов Узбекистана (пилот). Одностраничное приложение
на ванильном JavaScript + Supabase для аутентификации.

## Структура

| Файл | Назначение |
|------|-----------|
| `int.html` | Точка входа, подключает Supabase JS и приложение |
| `int_app.js` | Всё приложение (SPA): вьюхи, состояние, аутентификация |
| `int_css.css` | Стили и анимации |
| `supabase/functions/telegram-auth/` | Edge Function: проверяет подпись Telegram и выдаёт Supabase-сессию |
| `SETUP_TELEGRAM.md` | Инструкция по настройке входа через Telegram |

## Аутентификация

Два способа входа для студентов:

- **Telegram** — своя кнопка вызывает `Telegram.Login.auth`, данные проверяются в Edge
  `telegram-auth` (HMAC-SHA256 токеном бота), затем клиент обменивает OTP на сессию через
  `verifyOtp`. Подробности — в [SETUP_TELEGRAM.md](SETUP_TELEGRAM.md).
- **Email** — одноразовый код через `signInWithOtp` / `verifyOtp`.

Секреты (токен бота, service-role ключ) живут только в секретах Supabase Edge Functions —
в клиентском коде их нет. Публичный `anon`-ключ в `int_app.js` открыт по дизайну.

## Локальный запуск

Статика — достаточно любого статик-сервера:

```bash
python -m http.server 8777
# затем открыть http://localhost:8777/int.html
```

> Вход через Telegram работает только на публичном домене, привязанном к боту через
> BotFather `/setdomain` — на `file://` и `localhost` кнопка авторизации не сработает.

## Деплой

- **Сайт** — статика (`int.html`, `int_app.js`, `int_css.css`) на Netlify.
- **Edge Function** — `supabase functions deploy telegram-auth` или через Supabase Dashboard.
