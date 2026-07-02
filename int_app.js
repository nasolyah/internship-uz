/* internship.uz — vanilla SPA (int_app.js) */
(function () {
  'use strict';

  /* ---------- supabase ---------- */
  var SUPABASE_URL = 'https://ysxvlopfcarhdszqzmnp.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_kcFUE1wOjQ9pCa0f07bqSg_oZonsiRC';
  var supabase = (window.supabase && SUPABASE_URL.indexOf('YOUR_PROJECT_REF') === -1)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  /* ---------- telegram login ---------- */
  // Имя бота из @BotFather, БЕЗ символа @. Напр. 'internship_uz_bot'.
  var TELEGRAM_BOT = 'int_auth_bot';
  // Числовой bot_id (первая часть токена до ':') — нужен для Telegram.Login.auth.
  var TELEGRAM_BOT_ID = '8827034426';
  // Эндпоинт Edge Function, которая проверяет подпись Telegram и выдаёт сессию.
  var TG_AUTH_FN = SUPABASE_URL + '/functions/v1/telegram-auth';

  /* ---------- документы студента ---------- */
  var SUBMIT_DOC_FN = SUPABASE_URL + '/functions/v1/submit-doc';
  var DOC_BUCKET = 'student-docs';
  // Путь к шаблону согласия (статика Netlify). Положите файл в /templates/.
  var CONSENT_TEMPLATE_URL = 'templates/parental-consent-template.pdf';

  /* ---------- state ---------- */
  var state = {
    view: 'home',
    catalogTab: 'students',
    authRole: null,            // null | 'student' | 'company'
    studentStep: 'login',      // login | profile | consent | done
    studentProfile: null,
    companyProfile: null,
    session: null,
    form: {},
    docStatus: { study: 'none', consent: 'none' },  // none | pending | approved | rejected
    tgDraft: false,
    menuOpen: false,
    modal: null,               // null | 'study' | 'consent'
    otp: { email: '', error: '', loading: false },
    tgAuth: { loading: false, error: '' },
    profileSave: { loading: false, error: '' },
    docUpload: { loading: false, error: '', fileName: '' },
    _statsRan: false
  };

  var STATS_TARGET = { students: 148, companies: 23, projects: 41, score: 84 };
  var statsCur = { students: 0, companies: 0, projects: 0, score: 0 };

  /* ---------- data ---------- */
  var startupValue = [
    { title: 'Мотивированные исполнители бесплатно', desc: 'Студенты работают за опыт и рекомендацию — на старте платформа бесплатна.' },
    { title: 'Проекты закрываются быстрее', desc: 'Небольшие задачи находят руки за дни, а не недели найма.' },
    { title: 'Только верифицированные профили', desc: 'SMS и университетская почта отсекают случайных людей.' },
    { title: 'ИИ-тест навыков перед откликом', desc: 'Видно реальный уровень исполнителя ещё до общения.' }
  ];
  var studentValue = [
    { title: 'Реальный опыт на живых проектах', desc: 'Не учебные кейсы, а задачи настоящих стартапов.' },
    { title: 'Официальный документ о практике', desc: 'Оформляется как учебная практика — сильный пункт для поступления.' },
    { title: 'Рекомендация для резюме', desc: 'Подтверждённый вклад, а не просто строчка в CV.' },
    { title: 'Верифицированный профиль', desc: 'Статус доверия, который видят компании.' }
  ];
  var stepsStartup = [
    { n: '1', title: 'Разместите задачу', desc: 'Опишите проект, формат и длительность — за пару минут.' },
    { n: '2', title: 'Получите отклики', desc: 'Верифицированные студенты с результатами ИИ-теста откликаются на задачу.' },
    { n: '3', title: 'Работайте и подтвердите практику', desc: 'По завершении подтверждаете практику — студент получает документ.' }
  ];
  var stepsStudent = [
    { n: '1', title: 'Войдите и заполните профиль', desc: 'Вход через Telegram или email — без барьера. Имя и фамилия как в паспорте.' },
    { n: '2', title: 'Пройдите ИИ-тест и откликнитесь', desc: 'Короткий тест навыков, затем отклик на подходящие задачи.' },
    { n: '3', title: 'Завершите проект', desc: 'Получите официальный документ о практике и рекомендацию.' }
  ];
  var verifyItems = [
    { icon: '✉', title: 'Почта вуза + SMS', desc: 'Базовая верификация студента — бесплатно.', tag: 'Бесплатно' },
    { icon: '★', title: 'Сертификаты навыков', desc: 'Подтверждение через API площадок, а не сканы.', tag: 'Опционально' },
    { icon: '◇', title: 'ИИ-тест навыков', desc: 'Объективная оценка уровня перед откликом.', tag: 'Автоматически' },
    { icon: '§', title: 'Документ о практике', desc: 'Учебная практика, а не трудоустройство.', tag: 'Официально' }
  ];
  var catalogStudents = [
    { initials: 'АК', name: 'Азиз Каримов', school: 'Университет ИНХА · 2 курс', skills: ['UI/UX', 'Figma', 'Прототипы'], score: '82' },
    { initials: 'МН', name: 'Мадина Нурова', school: 'УзГУМЯ · 3 курс', skills: ['Копирайтинг', 'SMM', 'Контент'], score: '76' },
    { initials: 'ТИ', name: 'Тимур Исмаилов', school: 'ТУИТ · 1 курс', skills: ['Python', 'Аналитика', 'SQL'], score: '88' },
    { initials: 'ДС', name: 'Дилноза Саидова', school: 'Школа №64 · 11 класс', skills: ['Дизайн', 'Иллюстрация'], score: '71' },
    { initials: 'РА', name: 'Рустам Ахмедов', school: 'Westminster · 2 курс', skills: ['Frontend', 'React'], score: '84' },
    { initials: 'ЗК', name: 'Зарина Камолова', school: 'ИНХА · 3 курс', skills: ['Маркетинг', 'Таргет'], score: '79' }
  ];
  var catalogGigs = [
    { initials: 'GT', title: 'Дизайн лендинга для запуска', company: 'GreenTech Tashkent · EdTech', desc: 'Нужен лендинг под запуск бета-версии: макет + вёрстка простой страницы.', format: 'Удалённо', duration: '2 недели', slots: '1' },
    { initials: 'FP', title: 'Тестирование мобильного приложения', company: 'FinPay · Fintech', desc: 'Ручное тестирование, поиск багов, оформление отчётов по чек-листу.', format: 'Гибрид', duration: '1 месяц', slots: '2' },
    { initials: 'AG', title: 'SMM и контент для соцсетей', company: 'AgroLink · AgriTech', desc: 'Контент-план и посты на 2 недели, оформление и базовая аналитика.', format: 'Удалённо', duration: '2–3 месяца', slots: '1' },
    { initials: 'MD', title: 'Аналитика пользовательских данных', company: 'MedData · HealthTech', desc: 'Собрать и визуализировать данные по онбордингу, короткий дашборд.', format: 'Офис (Ташкент)', duration: '1 месяц', slots: '1' }
  ];

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fv(k) { return esc(state.form[k] || ''); }
  function isMinor() { return !!(state.studentProfile && state.studentProfile.minor); }
  function studentName() { var p = state.studentProfile; return p ? ((p.first + ' ' + p.last).trim() || 'Студент') : 'Студент'; }
  function studentInitials() { var p = state.studentProfile; if (!p) return 'С'; return (((p.first || '')[0] || '') + ((p.last || '')[0] || '')).toUpperCase() || 'С'; }
  function companyName() { return state.companyProfile ? state.companyProfile.name : 'Ваша компания'; }
  function companyDomain() { return state.companyProfile ? (state.companyProfile.domain || '') : ''; }
  // Статус конкретного документа: none | pending | approved | rejected.
  function docStat(type) { return (state.docStatus && state.docStatus[type]) || 'none'; }
  function docLabel(status) {
    return { pending: 'на проверке', approved: 'подтверждено', rejected: 'отклонено — загрузите заново', none: '' }[status] || '';
  }
  function docColor(status) {
    return { pending: '#b26b12', approved: '#16a34a', rejected: '#b3261e', none: 'var(--muted)' }[status] || 'var(--muted)';
  }
  // Короткий статус верификации для шапки/меню.
  function verifyStatus() {
    if (state.authRole === 'company') return 'На подтверждении';
    if (state.authRole === 'student') {
      if (isMinor()) {
        var c = docStat('consent');
        if (c === 'approved') return 'Согласие подтверждено';
        if (c === 'pending') return 'Согласие на проверке';
        if (c === 'rejected') return 'Согласие отклонено';
        return 'Требуется согласие родителя';
      }
      return 'Профиль активен';
    }
    return '';
  }
  function companyDirector() { return state.companyProfile ? (state.companyProfile.director || '') : ''; }

  /* ---------- shared style snippets ---------- */
  var S = {
    input: 'padding:13px 14px; border:1px solid var(--line); border-radius:11px; font-size:15px; background:#fff; width:100%;',
    label: 'display:flex; flex-direction:column; gap:7px;',
    labelSpan: 'font-size:14px; font-weight:600;',
    primary: 'font-size:15px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:15px; border-radius:11px; cursor:pointer;',
    dark: 'font-size:15px; font-weight:600; color:#fff; background:var(--ink); border:none; padding:13px 24px; border-radius:11px; cursor:pointer;',
    ghost: 'font-size:15px; font-weight:600; color:var(--ink); background:#fff; border:1px solid var(--line); padding:14px; border-radius:11px; cursor:pointer;',
    back: 'font-size:14px; color:var(--muted); cursor:pointer; font-weight:500;'
  };

  function inputField(label, field, ph, hint) {
    return '<label style="' + S.label + '"><span style="' + S.labelSpan + '">' + label + '</span>' +
      '<input data-field="' + field + '" value="' + fv(field) + '" placeholder="' + esc(ph) + '" style="' + S.input + '">' +
      (hint ? '<span style="font-size:12px; color:var(--muted);">' + hint + '</span>' : '') + '</label>';
  }

  /* ---------- header ---------- */
  function navLink(action, label) {
    var active = state.view === action.replace(/^go/, '').toLowerCase();
    return '<a data-action="' + action + '" class="nav-link" style="font-size:14.5px; font-weight:500; color:' + (active ? 'var(--ink)' : 'var(--muted)') + ';">' + label + '</a>';
  }
  function header() {
    var role = state.authRole;

    // центральная навигация — свой набор для каждой роли
    var nav;
    if (role === 'student') {
      nav = navLink('goCatalog', 'Каталог') + navLink('goResponses', 'Мои отклики');
    } else if (role === 'company') {
      nav = navLink('goCatalog', 'Каталог') + navLink('goVacancies', 'Мои вакансии');
    } else {
      nav = navLink('scrollHow', 'Как это работает') + navLink('scrollVerify', 'Верификация') + navLink('goCatalog', 'Каталог');
    }

    // правая часть — кнопки для гостя или аватар с выпадающим меню
    var auth, overlay = '';
    if (role === 'student' || role === 'company') {
      var avatar = role === 'student'
        ? '<span style="width:30px; height:30px; border-radius:50%; background:color-mix(in srgb, var(--accent) 14%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:13px; flex-shrink:0;">' + esc(studentInitials()) + '</span>'
        : '<span style="width:30px; height:30px; border-radius:8px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0;">◆</span>';
      var name = role === 'student' ? studentName() : companyName();
      var caret = '<span style="color:var(--muted); font-size:10px;' + (state.menuOpen ? ' transform:rotate(180deg);' : '') + '">▾</span>';
      var btn = '<button data-action="toggleMenu" style="display:flex; align-items:center; gap:9px; font-size:14.5px; font-weight:600; color:var(--ink); background:#fff; border:1px solid ' + (state.menuOpen ? 'var(--accent)' : 'var(--line)') + '; padding:6px 13px 6px 6px; border-radius:999px; cursor:pointer;">' + avatar + '<span style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(name) + '</span>' + caret + '</button>';

      var dropdown = '';
      if (state.menuOpen) {
        var dot = role === 'company' ? '#e2a53a' : '#4ade80';
        var mItem = function (action, label, color) {
          return '<a data-action="' + action + '" class="menu-item" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:9px; font-size:14px; font-weight:600; color:' + color + '; cursor:pointer;">' + label + '</a>';
        };
        dropdown = '<div style="position:absolute; right:0; top:calc(100% + 10px); width:252px; background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 22px 48px -22px rgba(18,20,26,0.34); padding:8px; z-index:60;">' +
          '<div style="display:flex; align-items:center; gap:11px; padding:8px 10px 12px; border-bottom:1px solid var(--line); margin-bottom:6px;">' + avatar +
            '<div style="min-width:0;"><div style="font-weight:700; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</div>' +
            '<div style="font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px; margin-top:3px;"><span style="width:6px; height:6px; border-radius:50%; background:' + dot + '; flex-shrink:0;"></span>' + esc(verifyStatus()) + '</div></div></div>' +
          mItem('goCabinet', 'Личный кабинет', 'var(--ink)') +
          mItem('logout', 'Выйти', '#b3261e') +
        '</div>';
      }
      auth = '<div style="position:relative;">' + btn + dropdown + '</div>';
      // невидимый оверлей на весь экран — клик вне меню закрывает его (рендерится вне header из-за backdrop-filter)
      if (state.menuOpen) overlay = '<div data-menu-overlay data-action="toggleMenu" style="position:fixed; inset:0; z-index:40;"></div>';
    } else {
      auth = '<span style="display:flex; align-items:center; gap:12px;">' +
        '<button data-action="goStudent" style="font-size:14.5px; font-weight:600; color:var(--ink); background:none; border:1px solid var(--line); padding:9px 16px; border-radius:9px; cursor:pointer; white-space:nowrap;">Войти как студент</button>' +
        '<button data-action="goStartupForm" style="font-size:14.5px; font-weight:600; color:#fff; background:var(--ink); border:1px solid var(--ink); padding:9px 16px; border-radius:9px; cursor:pointer; white-space:nowrap;">Регистрация компании</button></span>';
    }
    return overlay + '<header style="position:sticky; top:0; z-index:50; background:color-mix(in srgb, #fbfbf9 88%, transparent); backdrop-filter:blur(10px); border-bottom:1px solid var(--line);">' +
      '<div style="max-width:1180px; margin:0 auto; padding:16px 28px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:24px;">' +
        '<a data-action="goHome" style="display:flex; align-items:center; gap:10px; cursor:pointer;">' +
          '<span style="width:30px; height:30px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:#fff; font-family:\'Space Grotesk\',sans-serif; font-weight:700; font-size:16px;">i</span>' +
          '<span style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.01em;">internship<span style="color:var(--muted); font-weight:500;">.uz</span></span>' +
        '</a>' +
        '<nav style="display:flex; align-items:center; justify-content:center; gap:30px; white-space:nowrap;">' + nav + '</nav>' +
        '<div style="display:flex; align-items:center; justify-content:flex-end; gap:12px;">' + auth + '</div>' +
      '</div></header>';
  }

  /* ---------- footer ---------- */
  function footer() {
    return '<footer style="border-top:1px solid var(--line); background:#fff;">' +
      '<div style="max-width:1180px; margin:0 auto; padding:36px 28px; display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center; gap:10px;"><span style="width:26px; height:26px; border-radius:7px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:#fff; font-family:\'Space Grotesk\',sans-serif; font-weight:700; font-size:14px;">i</span><span style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:15px;">internship.uz</span></div>' +
        '<div style="font-size:13px; color:var(--muted); text-align:right;">Платформа стажировок для стартапов и студентов Узбекистана<br>Пилот · 2026</div>' +
      '</div></footer>';
  }

  /* ---------- HOME ---------- */
  function homeView() {
    var trust = ['Бесплатно на старте', 'Верификация через вуз', 'Официальная практика, не трудоустройство'].map(function (t) {
      return '<span style="display:flex; align-items:center; gap:7px;"><span style="color:var(--accent); font-weight:700;">✓</span>' + t + '</span>';
    }).join('');

    var statTile = function (id, val, label, dark, suffix) {
      var numStyle = 'font-family:\'Space Grotesk\',sans-serif; font-weight:700; font-size:34px; line-height:1; letter-spacing:-0.02em;' + (dark ? '' : (id === 'stat-companies' ? ' color:var(--accent);' : ''));
      var bg = dark ? 'background:var(--ink); color:#fff;' : 'background:var(--bg); border:1px solid var(--line);';
      var lblColor = dark ? 'rgba(255,255,255,0.62)' : 'var(--muted)';
      var num = suffix
        ? '<div style="display:flex; align-items:baseline; gap:2px;"><span id="' + id + '" style="' + numStyle + '">' + val + '</span><span style="font-size:15px; font-weight:600; color:var(--muted);">' + suffix + '</span></div>'
        : '<div id="' + id + '" style="' + numStyle + '">' + val + '</div>';
      return '<div style="border-radius:15px; padding:18px; ' + bg + '">' + num + '<div style="font-size:12.5px; color:' + lblColor + '; margin-top:7px;">' + label + '</div></div>';
    };

    var statsPanel = '<div class="hero-up" style="animation-delay:.18s; position:relative;">' +
      '<div style="position:absolute; inset:-12% -8% -16% 4%; background:radial-gradient(58% 58% at 60% 40%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 70%); filter:blur(10px); z-index:0;"></div>' +
      '<div style="position:relative; z-index:1; background:#fff; border:1px solid var(--line); border-radius:20px; box-shadow:0 30px 72px -34px rgba(18,20,26,0.32); padding:26px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;"><span style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:15px;">Платформа в цифрах</span><span style="display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600; color:var(--muted);"><span class="pulse-dot" style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span>в реальном времени</span></div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">' +
          statTile('stat-students', statsCur.students, 'студентов в базе', true) +
          statTile('stat-companies', statsCur.companies, 'компаний зарегистрировано', false) +
          statTile('stat-projects', statsCur.projects, 'проектов закрыто', false) +
          statTile('stat-score', statsCur.score, 'средний ИИ-балл', false, '/100') +
        '</div>' +
        '<div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); text-align:center;">Данные пилота · обновляется</div>' +
      '</div>' +
      '<div class="floaty" style="position:absolute; z-index:2; left:-22px; bottom:-20px; background:var(--ink); color:#fff; border-radius:14px; padding:13px 17px; box-shadow:0 22px 46px -22px rgba(18,20,26,0.55); display:flex; align-items:center; gap:12px;"><span style="width:38px; height:38px; border-radius:10px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-size:18px;">✦</span><div><div style="font-family:\'Space Grotesk\',sans-serif; font-weight:700; font-size:18px; line-height:1.05;">+34</div><div style="font-size:11.5px; color:rgba(255,255,255,0.6);">отклика за неделю</div></div></div>' +
      '<div class="floaty2" style="position:absolute; z-index:2; right:-16px; top:22px; background:#fff; border:1px solid var(--line); border-radius:12px; padding:10px 14px; box-shadow:0 16px 36px -20px rgba(18,20,26,0.35); display:flex; align-items:center; gap:9px;"><span class="pulse-dot" style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span><span style="font-size:12.5px; font-weight:600;">12 стартапов в пилоте</span></div>' +
    '</div>';

    var hero = '<section style="max-width:1180px; margin:0 auto; padding:76px 28px 40px;">' +
      '<div style="display:grid; grid-template-columns:1.05fr 0.95fr; gap:56px; align-items:center;">' +
        '<div>' +
          '<div class="hero-up" style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border:1px solid var(--line); border-radius:999px; background:#fff; font-size:12.5px; font-weight:600; color:var(--muted); letter-spacing:0.01em; animation-delay:.02s;"><span style="width:6px; height:6px; border-radius:50%; background:var(--accent);"></span>Платформа стажировок · Узбекистан</div>' +
          '<h1 class="hero-up" style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:clamp(38px,4.6vw,60px); line-height:1.04; letter-spacing:-0.025em; margin:22px 0 0; animation-delay:.08s;">Стартапам — руки.<br>Студентам и школьникам —<br>первый реальный опыт.</h1>' +
          '<p class="hero-up" style="font-size:18px; line-height:1.55; color:var(--muted); max-width:500px; margin:22px 0 0; animation-delay:.14s;">internship.uz связывает узбекские стартапы со студентами и школьниками: живые проекты, верифицированные профили и официальный документ о пройденной практике.</p>' +
          '<div class="hero-up" style="display:flex; gap:12px; margin-top:30px; flex-wrap:wrap; animation-delay:.2s;">' +
            '<button data-action="goStartupForm" style="font-size:15px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:14px 24px; border-radius:11px; cursor:pointer;">Я стартап — нужна помощь</button>' +
            '<button data-action="goStudent" style="font-size:15px; font-weight:600; color:var(--ink); background:#fff; border:1px solid var(--line); padding:14px 24px; border-radius:11px; cursor:pointer;">Я студент — ищу опыт</button>' +
          '</div>' +
          '<div class="hero-up" style="display:flex; gap:22px; margin-top:26px; flex-wrap:wrap; font-size:13.5px; color:var(--muted); animation-delay:.26s;">' + trust + '</div>' +
        '</div>' + statsPanel +
      '</div></section>';

    var valItem = function (v, dark) {
      var line = dark ? 'rgba(255,255,255,0.12)' : 'var(--line)';
      var descColor = dark ? 'rgba(255,255,255,0.6)' : 'var(--muted)';
      return '<div style="display:flex; gap:12px; padding:13px 0; border-top:1px solid ' + line + ';"><span style="color:var(--accent); font-weight:700; margin-top:1px;">✓</span><div><div style="font-weight:600; font-size:15px;">' + v.title + '</div><div style="font-size:13.5px; color:' + descColor + '; margin-top:2px;">' + v.desc + '</div></div></div>';
    };
    var value = '<section data-reveal style="max-width:1180px; margin:0 auto; padding:56px 28px;">' +
      '<div style="text-align:center; max-width:640px; margin:0 auto 44px;"><div style="font-size:13px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.08em;">Две стороны, одна выгода</div><h2 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:12px 0 0;">Каждый получает то, чего ему не хватает</h2></div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">' +
        '<div data-stagger style="background:#fff; border:1px solid var(--line); border-radius:18px; padding:32px;"><div style="display:flex; align-items:center; gap:11px; margin-bottom:8px;"><span style="width:34px; height:34px; border-radius:9px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:16px;">◆</span><span style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:21px;">Для стартапов</span></div><p style="color:var(--muted); font-size:15px; margin:0 0 20px;">Ранние команды с ограниченным бюджетом — быстрые руки без затрат на найм.</p>' + startupValue.map(function (v) { return valItem(v, false); }).join('') + '<button data-action="goStartupForm" style="margin-top:22px; width:100%; font-size:15px; font-weight:600; color:#fff; background:var(--ink); border:none; padding:13px; border-radius:11px; cursor:pointer;">Подтвердить компанию</button></div>' +
        '<div data-stagger style="background:var(--ink); border:1px solid var(--ink); border-radius:18px; padding:32px; color:#fff;"><div style="display:flex; align-items:center; gap:11px; margin-bottom:8px;"><span style="width:34px; height:34px; border-radius:9px; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:16px;">●</span><span style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:21px;">Для студентов и школьников</span></div><p style="color:rgba(255,255,255,0.62); font-size:15px; margin:0 0 20px;">Реальные проекты в резюме и официальный документ — сильный аргумент при поступлении.</p>' + studentValue.map(function (v) { return valItem(v, true); }).join('') + '<button data-action="goStudent" style="margin-top:22px; width:100%; font-size:15px; font-weight:600; color:var(--ink); background:#fff; border:none; padding:13px; border-radius:11px; cursor:pointer;">Создать профиль студента</button></div>' +
      '</div></section>';

    var stepItem = function (s, accent) {
      var circle = accent
        ? 'border:1.5px solid color-mix(in srgb, var(--accent) 40%, #fff); color:var(--accent); background:color-mix(in srgb, var(--accent) 6%, #fff);'
        : 'border:1.5px solid var(--line); background:#fff;';
      return '<div data-stagger style="display:flex; gap:16px; padding-bottom:26px; position:relative;"><div style="flex-shrink:0; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:15px; ' + circle + '">' + s.n + '</div><div><div style="font-weight:600; font-size:16px;">' + s.title + '</div><div style="font-size:14px; color:var(--muted); margin-top:3px;">' + s.desc + '</div></div></div>';
    };
    var how = '<section id="sec-how" data-reveal style="background:#fff; border-top:1px solid var(--line); border-bottom:1px solid var(--line);">' +
      '<div style="max-width:1180px; margin:0 auto; padding:64px 28px;"><div style="text-align:center; max-width:640px; margin:0 auto 44px;"><div style="font-size:13px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.08em;">Как это работает</div><h2 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:12px 0 0;">Два простых пути навстречу</h2></div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:48px;">' +
        '<div><div style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px; margin-bottom:20px; display:flex; align-items:center; gap:9px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--ink);"></span>Стартап</div>' + stepsStartup.map(function (s) { return stepItem(s, false); }).join('') + '</div>' +
        '<div><div style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px; margin-bottom:20px; display:flex; align-items:center; gap:9px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--accent);"></span>Студент</div>' + stepsStudent.map(function (s) { return stepItem(s, true); }).join('') + '</div>' +
      '</div></div></section>';

    var verifyCard = function (q) {
      return '<div data-lift data-stagger style="background:#fff; border:1px solid var(--line); border-radius:14px; padding:22px;"><div style="width:36px; height:36px; border-radius:9px; background:color-mix(in srgb, var(--accent) 10%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:17px; margin-bottom:14px;">' + q.icon + '</div><div style="font-weight:600; font-size:15.5px;">' + q.title + '</div><div style="font-size:13.5px; color:var(--muted); margin-top:5px; line-height:1.5;">' + q.desc + '</div><div style="margin-top:12px; font-size:11.5px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.04em;">' + q.tag + '</div></div>';
    };
    var verify = '<section id="sec-verify" data-reveal style="max-width:1180px; margin:0 auto; padding:72px 28px;">' +
      '<div style="display:grid; grid-template-columns:0.9fr 1.1fr; gap:56px; align-items:center;">' +
        '<div><div style="font-size:13px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.08em;">Доверие и качество</div><h2 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:12px 0 16px;">Профили проверены. Результат — оформлен официально.</h2><p style="font-size:16px; color:var(--muted); line-height:1.6;">Мы снижаем два главных риска: сомнительное качество исполнителей для компаний и юридическую неопределённость для обеих сторон. Верификация — бесплатная, а практика оформляется как учебная, а не как трудоустройство.</p>' +
          '<div style="margin-top:24px; padding:18px 20px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 20%, #fff); border-radius:14px; font-size:14.5px; line-height:1.55;"><strong style="font-weight:700;">Официальный документ о практике</strong> — студент получает подтверждение пройденной учебной практики, которое можно приложить к резюме или заявке на поступление.</div>' +
          '<div style="margin-top:14px; padding:18px 20px; background:color-mix(in srgb, #e2a53a 8%, #fff); border:1px solid color-mix(in srgb, #e2a53a 26%, #fff); border-radius:14px; font-size:14.5px; line-height:1.55;"><strong style="font-weight:700;">Защита несовершеннолетних</strong> — участникам до 18 лет доступ открывается только после письменного согласия родителя (по законодательству РУз). Готовый шаблон согласия — в один клик.</div>' +
        '</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">' + verifyItems.map(verifyCard).join('') + '</div>' +
      '</div></section>';

    var waitlist = '<section data-reveal style="max-width:1180px; margin:0 auto; padding:32px 28px 88px;"><div style="background:var(--ink); border-radius:22px; padding:56px 40px; text-align:center; color:#fff; position:relative; overflow:hidden;"><div style="position:absolute; inset:0; background:radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 45%, transparent), transparent 60%); opacity:0.5;"></div><div style="position:relative;"><h2 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:clamp(28px,3.2vw,42px); letter-spacing:-0.02em; margin:0;">Присоединяйтесь к пилоту</h2><p style="font-size:17px; color:rgba(255,255,255,0.66); max-width:480px; margin:14px auto 0;">Набираем первые 5–10 стартапов и 10–20 студентов. Ранние участники получают бесплатный доступ и приоритет в матчинге.</p><div style="display:flex; gap:12px; justify-content:center; margin-top:30px; flex-wrap:wrap;"><button data-action="goStartupForm" style="font-size:15px; font-weight:600; color:var(--ink); background:#fff; border:none; padding:14px 26px; border-radius:11px; cursor:pointer;">Записать стартап</button><button data-action="goStudent" style="font-size:15px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:14px 26px; border-radius:11px; cursor:pointer;">Записаться студентом</button></div></div></div></section>';

    return '<main class="view-in">' + hero + value + how + verify + waitlist + '</main>';
  }

  /* ---------- STUDENT FORM ---------- */
  function studentView() {
    var inner = '';
    if (state.studentStep === 'login') {
      inner = '<div style="max-width:440px;">' +
        '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:34px; letter-spacing:-0.02em; margin:20px 0 8px;">Войти как студент</h1>' +
        '<p style="color:var(--muted); font-size:16px; margin:0 0 28px;">Быстрый вход без барьеров. При входе через Telegram имя и фамилия подтянутся автоматически — останется только подтвердить их.</p>' +
        '<button data-action="loginTelegram" class="tg-btn"' + (state.tgAuth.loading ? ' disabled' : '') + '>' +
          '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>' +
          '<span>' + (state.tgAuth.loading ? 'Открываем Telegram…' : 'Войти через Telegram') + '</span>' +
        '</button>' +
        (state.tgAuth.loading ? '<div style="margin-top:12px; text-align:center; font-size:13px; color:var(--muted);">Проверяем вход через Telegram…</div>' : '') +
        (state.tgAuth.error ? '<div style="margin-top:12px; padding:11px 14px; background:color-mix(in srgb, #b3261e 8%, #fff); border:1px solid color-mix(in srgb, #b3261e 22%, #fff); border-radius:10px; font-size:13px; color:#b3261e; line-height:1.5;">' + esc(state.tgAuth.error) + '</div>' : '') +
        '<div style="display:flex; align-items:center; gap:14px; margin:20px 0;"><div style="flex:1; height:1px; background:var(--line);"></div><span style="font-size:13px; color:var(--muted);">или</span><div style="flex:1; height:1px; background:var(--line);"></div></div>' +
        '<button data-action="continueEmail" style="width:100%; ' + S.ghost + '">Продолжить по email</button>' +
        '<div style="margin-top:28px; padding-top:22px; border-top:1px solid var(--line);"><div style="font-size:12.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:16px;">Три шага регистрации</div>' +
          '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:6px;">' +
            stepDot('1', 'Стандартная регистрация', true) + arrow() + stepDot('2', 'Заполнение личных данных', false) + arrow() + stepDot('3', 'Тестирование', false) +
          '</div></div></div>';
    } else if (state.studentStep === 'email') {
      var noClient = !supabase;
      inner = '<div style="max-width:440px;">' +
        '<a data-action="backToLogin" style="' + S.back + ' display:inline-block; margin:20px 0 4px;">← Назад</a>' +
        '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:34px; letter-spacing:-0.02em; margin:10px 0 8px;">Вход по email</h1>' +
        '<p style="color:var(--muted); font-size:16px; margin:0 0 24px;">Подходит и студентам, и школьникам. Укажите email — пришлём одноразовый код подтверждения.</p>' +
        (noClient ? '<div style="padding:13px 15px; background:color-mix(in srgb, #b3261e 8%, #fff); border:1px solid color-mix(in srgb, #b3261e 22%, #fff); border-radius:12px; margin-bottom:16px; font-size:13px; color:#b3261e; line-height:1.5;">Supabase не настроен: укажите SUPABASE_URL и SUPABASE_ANON_KEY в int_app.js.</div>' : '') +
        '<div style="display:flex; flex-direction:column; gap:16px;">' +
          inputField('Email', 'semail', 'you@email.com') +
          (state.otp.error ? '<span style="font-size:13px; color:#b3261e; font-weight:600;">' + esc(state.otp.error) + '</span>' : '') +
          '<button data-action="sendOtp"' + (state.otp.loading || noClient ? ' disabled' : '') + ' style="' + S.primary + (state.otp.loading || noClient ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.otp.loading ? 'Отправка…' : 'Получить код') + '</button>' +
        '</div></div>';
    } else if (state.studentStep === 'otp') {
      inner = '<div style="max-width:440px;">' +
        '<a data-action="backToEmail" style="' + S.back + ' display:inline-block; margin:20px 0 4px;">← Изменить email</a>' +
        '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:34px; letter-spacing:-0.02em; margin:10px 0 8px;">Введите код</h1>' +
        '<p style="color:var(--muted); font-size:16px; margin:0 0 24px;">Шестизначный код отправлен на <strong style="color:var(--ink);">' + esc(state.otp.email) + '</strong>. Проверьте почту (и папку «Спам»).</p>' +
        '<div style="display:flex; flex-direction:column; gap:16px;">' +
          inputField('Код из письма', 'otpInput', '000000') +
          (state.otp.error ? '<span style="font-size:13px; color:#b3261e; font-weight:600;">' + esc(state.otp.error) + '</span>' : '') +
          '<button data-action="verifyOtp"' + (state.otp.loading ? ' disabled' : '') + ' style="' + S.primary + (state.otp.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.otp.loading ? 'Проверка…' : 'Подтвердить и войти') + '</button>' +
          '<button data-action="resendOtp"' + (state.otp.loading ? ' disabled' : '') + ' style="' + S.ghost + (state.otp.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">Отправить код повторно</button>' +
        '</div></div>';
    } else if (state.studentStep === 'profile') {
      inner = '<div>' +
        '<div style="display:inline-flex; align-items:center; gap:8px; font-size:11.5px; font-weight:700; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:5px 11px; border-radius:7px; text-transform:uppercase; letter-spacing:0.05em; margin-top:20px;">Обязательный шаг</div>' +
        '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:34px; letter-spacing:-0.02em; margin:14px 0 8px;">Заполните профиль</h1>' +
        '<p style="color:var(--muted); font-size:16px; margin:0 0 24px;">Укажите имя и фамилию <strong style="color:var(--ink);">как в паспорте или студенческом</strong> — именно это имя попадёт в официальный документ о практике.</p>' +
        (state.tgDraft ? '<div style="display:flex; gap:11px; align-items:flex-start; padding:13px 15px; background:color-mix(in srgb, #229ED9 8%, #fff); border:1px solid color-mix(in srgb, #229ED9 22%, #fff); border-radius:12px; margin-bottom:20px;"><span style="color:#229ED9; font-weight:700;">✈</span><span style="font-size:13px; color:var(--muted); line-height:1.5;">Черновик подтянут из Telegram. Проверьте имя и фамилию и при необходимости исправьте.</span></div>' : '') +
        '<div style="display:flex; flex-direction:column; gap:18px;">' +
          '<label style="' + S.label + '"><span style="' + S.labelSpan + '">Ваш статус</span><select data-field="status" style="' + S.input + '">' + statusOptions() + '</select><span style="font-size:12px; color:var(--muted);">Если вам ещё нет 18 — для доступа к каталогу потребуется согласие родителя.</span></label>' +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">' + inputField('Имя <span style="color:var(--muted); font-weight:500;">(как в документах)</span>', 'sfirst', 'Азиз') + inputField('Фамилия <span style="color:var(--muted); font-weight:500;">(как в документах)</span>', 'slast', 'Каримов') + '</div>' +
          inputField('Email', 'semail', 'you@email.com') +
          inputField('Telegram для связи <span style="color:var(--muted); font-weight:500;">(необязательно)</span>', 'tg', '@username', 'Используется только как способ связи, не как отображаемое имя в профиле.') +
          (state.profileSave.error ? '<span style="font-size:13px; color:#b3261e; font-weight:600;">' + esc(state.profileSave.error) + '</span>' : '') +
          '<button data-action="saveStudentProfile"' + (state.profileSave.loading ? ' disabled' : '') + ' style="margin-top:4px; ' + S.primary + (state.profileSave.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.profileSave.loading ? 'Сохранение…' : 'Сохранить и продолжить') + '</button>' +
        '</div></div>';
    } else { // done
      var body = isMinor()
        ? '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:30px; letter-spacing:-0.02em; margin:0 0 10px;">Профиль сохранён</h1><p style="color:var(--muted); font-size:16px; max-width:460px; margin:0 auto 8px;">Имя для официальных документов: <strong style="color:var(--ink);">' + esc(studentName()) + '</strong></p><p style="color:var(--muted); font-size:15px; max-width:460px; margin:0 auto 28px;">Дальше в личном кабинете загрузите <strong style="color:var(--ink);">справку о месте учёбы</strong> и <strong style="color:var(--ink);">согласие родителя</strong>. После ручной проверки откроется каталог задач.</p>'
        : '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:30px; letter-spacing:-0.02em; margin:0 0 10px;">Профиль сохранён</h1><p style="color:var(--muted); font-size:16px; max-width:460px; margin:0 auto 8px;">Имя для официальных документов: <strong style="color:var(--ink);">' + esc(studentName()) + '</strong></p><p style="color:var(--muted); font-size:15px; max-width:440px; margin:0 auto 28px;">Дальше можно подтвердить место учёбы и пройти ИИ-тест — статусы доверия добавятся к профилю.</p>';
      inner = '<div style="text-align:center; padding-top:56px;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 22px;">✓</div>' + body + '<button data-action="goCabinet" style="' + S.dark + '">Перейти в личный кабинет</button></div>';
    }
    return '<main class="view-in" style="max-width:640px; margin:0 auto; padding:56px 28px 88px;"><a data-action="goHome" style="' + S.back + '">← На главную</a>' + inner + '</main>';
  }
  function statusOptions() {
    var opts = ['', 'Студент вуза (18+)', 'Студент колледжа (18+)', 'Школьник, 10–11 класс (до 18)', 'Лицей, 1–2 курс (до 18)'];
    return opts.map(function (o) { var sel = state.form.status === o ? ' selected' : ''; return '<option' + sel + '>' + (o || 'Выберите…') + '</option>'; }).join('');
  }
  function stepDot(n, label, active) {
    var c = active ? 'background:var(--accent); color:#fff;' : 'background:#fff; border:1.5px solid var(--line); color:var(--muted);';
    return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:9px; text-align:center;"><span style="width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:14px; flex-shrink:0; ' + c + '">' + n + '</span><span style="font-size:12px; font-weight:600; line-height:1.3;">' + label + '</span></div>';
  }
  function arrow() { return '<span style="margin-top:9px; color:var(--muted); font-size:14px;">→</span>'; }

  /* ---------- COMPANY FORM ---------- */
  function companyView() {
    var inner;
    if (!state.companyProfile) {
      inner = '<div>' +
        '<div style="display:inline-flex; align-items:center; gap:8px; font-size:11.5px; font-weight:700; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:5px 11px; border-radius:7px; text-transform:uppercase; letter-spacing:0.05em; margin-top:20px;">Шаг 1 · Подтверждение профиля</div>' +
        '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:34px; letter-spacing:-0.02em; margin:14px 0 8px;">Заявка на подтверждение компании</h1>' +
        '<p style="color:var(--muted); font-size:16px; margin:0 0 28px;">На старте профили компаний подтверждаются вручную — так мы защищаем студентов. Проверяем госреестр, корпоративный домен и созваниваемся с командой.</p>' +
        '<div style="display:flex; flex-direction:column; gap:18px;">' +
          inputField('Название компании', 'company', 'Напр. GreenTech Tashkent LLC') +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">' + inputField('ИНН <span style="color:var(--muted); font-weight:500;">(госреестр)</span>', 'inn', '9 цифр') + inputField('Руководитель', 'director', 'ФИО по реестру') + '</div>' +
          inputField('Корпоративная почта <span style="color:var(--muted); font-weight:500;">(@домен компании)</span>', 'corpEmail', 'you@company.uz') +
          inputField('LinkedIn или соцсети компании', 'linkedin', 'Ссылка на профиль представителя или страницу') +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">' + inputField('Контактное лицо', 'contact', 'Имя') + inputField('Телефон для созвона', 'phone', '+998 ...') + '</div>' +
          '<div style="display:flex; gap:11px; align-items:flex-start; padding:14px 16px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 18%, #fff); border-radius:12px;"><span style="color:var(--accent); font-weight:700;">ⓘ</span><span style="font-size:13px; color:var(--muted); line-height:1.5;">Для первых компаний обязателен короткий созвон с командой платформы — это даёт максимальное доверие для студентов. Занимает 10–15 минут.</span></div>' +
          '<button data-action="submitCompany" style="margin-top:4px; ' + S.primary + '">Отправить заявку</button>' +
          '<p style="font-size:12.5px; color:var(--muted); text-align:center; margin:0;">Участие бесплатно на старте. Задачи можно размещать после подтверждения профиля.</p>' +
        '</div></div>';
    } else {
      inner = '<div style="text-align:center; padding-top:60px;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 22px;">✓</div><h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:30px; letter-spacing:-0.02em; margin:0 0 10px;">Заявка отправлена</h1><p style="color:var(--muted); font-size:16px; max-width:440px; margin:0 auto 28px;">Сверим данные в госреестре и по корпоративному домену, затем свяжемся для короткого созвона. Обычно 1–2 дня. Профиль компании уже доступен в личном кабинете.</p><div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;"><button data-action="goCabinet" style="' + S.primary + '">Перейти в профиль компании</button><button data-action="goCatalog" style="' + S.ghost + '">Каталог студентов</button></div></div>';
    }
    return '<main class="view-in" style="max-width:640px; margin:0 auto; padding:56px 28px 88px;"><a data-action="goHome" style="' + S.back + '">← На главную</a>' + inner + '</main>';
  }

  /* ---------- catalog cards ---------- */
  function studentCard(s) {
    return '<div data-lift style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px;"><div style="display:flex; align-items:center; justify-content:space-between;"><div style="width:44px; height:44px; border-radius:11px; background:color-mix(in srgb, var(--accent) 11%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px;">' + s.initials + '</div><span style="font-size:11px; font-weight:700; color:var(--accent);">✓ verified</span></div><div style="font-weight:600; font-size:16px; margin-top:14px;">' + s.name + '</div><div style="font-size:13px; color:var(--muted);">' + s.school + '</div><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;">' + s.skills.map(function (sk) { return '<span style="font-size:11.5px; font-weight:600; color:var(--ink); background:var(--bg); border:1px solid var(--line); padding:4px 9px; border-radius:6px;">' + sk + '</span>'; }).join('') + '</div><div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:14px; border-top:1px solid var(--line);"><span style="font-size:12.5px; color:var(--muted);">ИИ-тест: <strong style="color:var(--ink);">' + s.score + '</strong></span><button style="font-size:12.5px; font-weight:600; color:#fff; background:var(--ink); border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Пригласить</button></div></div>';
  }
  function gigCard(g) {
    return '<div data-lift style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:22px; display:flex; gap:18px; align-items:flex-start;"><div style="width:46px; height:46px; border-radius:12px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px; flex-shrink:0;">' + g.initials + '</div><div style="flex:1;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-weight:600; font-size:16px;">' + g.title + '</span><span style="font-size:11px; font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 8px; border-radius:6px;">' + g.format + '</span></div><div style="font-size:13.5px; color:var(--muted); margin-top:2px;">' + g.company + '</div><div style="font-size:14px; color:var(--muted); margin-top:10px; line-height:1.5;">' + g.desc + '</div><div style="display:flex; gap:18px; margin-top:12px; font-size:12.5px; color:var(--muted);"><span>⏱ ' + g.duration + '</span><span>👥 нужно ' + g.slots + '</span></div></div><button style="font-size:13px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:10px 16px; border-radius:9px; cursor:pointer; flex-shrink:0;">Откликнуться</button></div>';
  }
  function minorLock(title) {
    var c = docStat('consent');
    var action;
    if (c === 'pending') action = '<div style="display:inline-flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; color:#b26b12; background:color-mix(in srgb, #e2a53a 14%, #fff); padding:10px 16px; border-radius:10px;"><span style="width:7px; height:7px; border-radius:50%; background:#e2a53a;"></span>Согласие на проверке · обычно 1–2 дня</div>';
    else action = '<button data-action="openConsentDoc" style="' + S.primary.replace('padding:15px', 'padding:13px 24px') + '">' + (c === 'rejected' ? 'Загрузить согласие заново' : 'Загрузить согласие родителя') + '</button>';
    return '<div style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:52px 32px; text-align:center;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, #e2a53a 16%, #fff); display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 20px;">🔒</div><h3 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:23px; letter-spacing:-0.01em; margin:0 0 10px;">' + title + '</h3><p style="color:var(--muted); font-size:15px; max-width:440px; margin:0 auto 22px; line-height:1.55;">Вам ещё нет 18 лет. Доступ откроется после загрузки и ручной проверки согласия родителя.</p>' + action + '</div>';
  }

  /* ---------- CATALOG ---------- */
  function catalogView() {
    var role = state.authRole;
    var effectiveTab = role === 'company' ? 'students' : role === 'student' ? 'gigs' : state.catalogTab;
    var studentsActive = effectiveTab === 'students';
    var minorLocked = role === 'student' && isMinor();

    var catTitle = role === 'company' ? 'Каталог студентов' : role === 'student' ? 'Каталог задач' : 'Каталог';
    var catSub = role === 'company' ? 'Кандидаты для ваших задач' : role === 'student' ? 'Задачи от стартапов и компаний' : 'Студенты и задачи стартапов';
    var head = '<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:26px;">' +
      '<div><h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:32px; letter-spacing:-0.02em; margin:0;">' + catTitle + '</h1><div style="font-size:14.5px; color:var(--muted); margin-top:6px;">' + catSub + '</div></div>';
    if (role === null) {
      var tb = 'font-size:13.5px; font-weight:600; padding:8px 16px; border-radius:8px; border:none; cursor:pointer;';
      head += '<div style="display:flex; background:#fff; border:1px solid var(--line); border-radius:11px; padding:4px;"><button data-action="tabStudents" style="' + tb + (studentsActive ? ' background:var(--ink); color:#fff;' : ' background:transparent; color:var(--muted);') + '">Студенты</button><button data-action="tabGigs" style="' + tb + (studentsActive ? ' background:transparent; color:var(--muted);' : ' background:var(--ink); color:#fff;') + '">Задачи стартапов</button></div>';
    } else if (role === 'company') {
      head += '<button data-action="goStartupForm" style="font-size:13.5px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:11px 18px; border-radius:10px; cursor:pointer;">Разместить задачу</button>';
    }
    head += '</div>';

    // sidebar
    var sidebar;
    if (role === 'student') {
      sidebar = '<aside style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:22px; position:sticky; top:88px;"><div style="display:flex; align-items:center; gap:12px;"><div style="width:46px; height:46px; border-radius:12px; background:color-mix(in srgb, var(--accent) 14%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:17px;">' + esc(studentInitials()) + '</div><div><div style="font-weight:600; font-size:15px;">' + esc(studentName()) + '</div><div style="font-size:12px; color:var(--accent); font-weight:600;">✓ Профиль подтверждён</div></div></div></aside>';
    } else if (role === 'company') {
      sidebar = '<aside style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:22px; position:sticky; top:88px;"><div style="display:flex; align-items:center; gap:12px;"><div style="width:46px; height:46px; border-radius:12px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:18px;">◆</div><div><div style="font-weight:600; font-size:15px;">' + esc(companyName()) + '</div><div style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:#b26b12; font-weight:600;"><span style="width:6px; height:6px; border-radius:50%; background:#e2a53a;"></span>На подтверждении</div></div></div><div style="margin-top:18px; padding-top:18px; border-top:1px solid var(--line);"><div style="font-size:12px; color:var(--muted);">Что дальше</div><div style="font-size:13px; color:var(--muted); line-height:1.55; margin-top:2px;">Отбирайте подходящих студентов и приглашайте их в свои задачи.</div></div><button data-action="goStartupForm" style="margin-top:18px; width:100%; font-size:13.5px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:12px; border-radius:10px; cursor:pointer;">Разместить задачу</button><button data-action="goCabinet" style="margin-top:10px; width:100%; font-size:13.5px; font-weight:600; color:var(--ink); background:#fff; border:1px solid var(--line); padding:11px; border-radius:10px; cursor:pointer;">Профиль компании</button></aside>';
    } else {
      sidebar = '<div aria-hidden="true"></div>';
    }

    // listings
    var listings;
    if (studentsActive) {
      listings = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">' + catalogStudents.map(studentCard).join('') + '</div>';
    } else if (minorLocked) {
      listings = minorLock('Каталог заблокирован');
    } else {
      listings = '<div style="display:flex; flex-direction:column; gap:14px;">' + catalogGigs.map(gigCard).join('') + '</div>';
    }

    return '<main class="view-in" style="max-width:1180px; margin:0 auto; padding:40px 28px 88px;">' + head +
      '<div style="display:grid; grid-template-columns:270px 1fr; gap:24px; align-items:start;">' + sidebar + '<div>' + listings + '</div></div></main>';
  }

  /* ---------- STUDENT CABINET ---------- */
  function studentCabinetView() {
    var sp = state.studentProfile || {};
    var minor = isMinor();
    var cs = docStat('consent');
    var statusColor = !minor ? '#16a34a' : (cs === 'approved' ? '#16a34a' : cs === 'pending' ? '#b26b12' : '#b3261e');
    var card = 'background:#fff; border:1px solid var(--line); border-radius:16px; padding:24px;';
    var cardTitle = 'font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px; margin-bottom:4px;';
    var row = function (label, right) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1px solid var(--line);"><span style="font-size:13.5px; color:var(--muted);">' + label + '</span>' + right + '</div>';
    };
    var val = function (v) { return '<span style="font-size:13.5px; font-weight:600; text-align:right; word-break:break-word;">' + esc(v || '—') + '</span>'; };
    var todoBtn = function (label) { return '<button style="font-size:12px; font-weight:600; color:var(--ink); background:#fff; border:1px solid var(--line); padding:6px 12px; border-radius:8px; cursor:pointer;">' + label + '</button>'; };

    var profile = '<div style="' + card + ' display:flex; align-items:center; gap:18px;">' +
      '<span style="width:64px; height:64px; border-radius:18px; background:color-mix(in srgb, var(--accent) 14%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:24px; flex-shrink:0;">' + esc(studentInitials()) + '</span>' +
      '<div style="min-width:0;"><div style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:22px; letter-spacing:-0.01em;">' + esc(studentName()) + '</div>' +
      '<div style="display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; color:' + statusColor + '; margin-top:5px;"><span style="width:7px; height:7px; border-radius:50%; background:' + statusColor + ';"></span>' + esc(verifyStatus()) + '</div></div></div>';

    var contacts = '<div style="' + card + '"><div style="' + cardTitle + '">Контакты и статус</div>' +
      row('Email', val(sp.email)) + row('Telegram', val(sp.tg)) + row('Статус', val(sp.status)) + '</div>';

    // строка документа со статусом и кнопкой загрузки (открывает модалку)
    var docRow = function (label, type) {
      var s = docStat(type);
      var right;
      if (s === 'pending') right = '<span style="font-size:12px; font-weight:700; color:' + docColor(s) + ';">на проверке</span>';
      else if (s === 'approved') right = '<span style="font-size:12px; font-weight:700; color:' + docColor(s) + ';">✓ подтверждено</span>';
      else {
        var lbl = s === 'rejected' ? 'Загрузить заново' : (type === 'consent' ? 'Загрузить' : 'Подтвердить');
        var bg = type === 'consent' ? '#b26b12' : 'var(--accent)';
        var btn = '<button data-action="' + (type === 'consent' ? 'openConsentDoc' : 'openStudyDoc') + '" style="font-size:12px; font-weight:600; color:#fff; background:' + bg + '; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;">' + lbl + '</button>';
        right = s === 'rejected'
          ? '<span style="display:inline-flex; align-items:center; gap:8px;"><span style="font-size:11.5px; font-weight:700; color:#b3261e;">отклонено</span>' + btn + '</span>'
          : btn;
      }
      return row(label, right);
    };
    var verification = '<div style="' + card + '"><div style="' + cardTitle + '">Верификация</div>' +
      docRow('Место учёбы (справка)', 'study') +
      row('ИИ-тест навыков', todoBtn('Пройти тест')) +
      (minor ? docRow('Согласие родителя', 'consent') : '') + '</div>';

    var documents = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:8px;">Документы</div>' +
      '<p style="font-size:13.5px; color:var(--muted); line-height:1.55; margin:0 0 16px;">Официальный документ о практике станет доступен после завершения первого проекта.</p>' +
      '<button disabled style="width:100%; font-size:13.5px; font-weight:600; color:var(--muted); background:var(--bg); border:1px solid var(--line); padding:12px; border-radius:10px; cursor:not-allowed;">Скачать документ о практике</button></div>';

    return '<main class="view-in" style="max-width:960px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:32px; letter-spacing:-0.02em; margin:0 0 24px;">Личный кабинет</h1>' +
      profile +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-top:20px;">' + contacts + verification + '</div>' +
      '<div style="margin-top:20px;">' + documents + '</div>' +
      '<div style="margin-top:24px; text-align:center;"><button data-action="logout" style="font-size:13.5px; font-weight:600; color:#b3261e; background:#fff; border:1px solid var(--line); padding:11px 24px; border-radius:10px; cursor:pointer;">Выйти из аккаунта</button></div>' +
      '</main>';
  }

  /* ---------- COMPANY CABINET ---------- */
  function companyCabinetView() {
    var cp = state.companyProfile || {};
    var card = 'background:#fff; border:1px solid var(--line); border-radius:16px; padding:24px;';
    var cardTitle = 'font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:16px; margin-bottom:4px;';
    var row = function (label, v) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1px solid var(--line);"><span style="font-size:13.5px; color:var(--muted);">' + label + '</span><span style="font-size:13.5px; font-weight:600; text-align:right; word-break:break-word;">' + esc(v || '—') + '</span></div>';
    };

    var profile = '<div style="' + card + ' display:flex; align-items:center; gap:18px;">' +
      '<span style="width:64px; height:64px; border-radius:16px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:26px; flex-shrink:0;">◆</span>' +
      '<div style="min-width:0;"><div style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:22px; letter-spacing:-0.01em;">' + esc(companyName()) + '</div>' +
      '<div style="display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; color:#b26b12; margin-top:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#e2a53a;"></span>На подтверждении</div></div></div>';

    var details = '<div style="' + card + '"><div style="' + cardTitle + '">Реквизиты компании</div>' +
      row('ИНН', cp.inn) + row('Руководитель', cp.director) + row('Корпоративная почта', cp.corpEmail) +
      row('Домен', companyDomain()) + row('Контактное лицо', cp.contact) + row('Телефон', cp.phone) +
      row('LinkedIn / соцсети', cp.linkedin) + '</div>';

    var checks = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:12px;">Статус проверки</div>' +
      '<div style="font-size:13.5px; color:var(--muted); line-height:1.6;">Госреестр · корпоративный домен · созвон с командой</div>' +
      '<div style="margin-top:16px; padding:13px 15px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 18%, #fff); border-radius:12px; font-size:13px; color:var(--muted); line-height:1.5;">Размещение задач откроется после подтверждения профиля — обычно 1–2 дня.</div>' +
      '<button data-action="goStartupForm" style="margin-top:16px; width:100%; font-size:13.5px; font-weight:600; color:#fff; background:var(--accent); border:none; padding:12px; border-radius:10px; cursor:pointer;">Разместить задачу</button></div>';

    return '<main class="view-in" style="max-width:960px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:32px; letter-spacing:-0.02em; margin:0 0 24px;">Личный кабинет компании</h1>' +
      profile +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-top:20px;">' + details + checks + '</div>' +
      '<div style="margin-top:24px; text-align:center;"><button data-action="logout" style="font-size:13.5px; font-weight:600; color:#b3261e; background:#fff; border:1px solid var(--line); padding:11px 24px; border-radius:10px; cursor:pointer;">Выйти из аккаунта</button></div>' +
      '</main>';
  }

  /* ---------- MY RESPONSES / MY VACANCIES ---------- */
  function emptyState(icon, title, text, btnAction, btnLabel) {
    return '<div style="background:#fff; border:1px solid var(--line); border-radius:16px; padding:56px 32px; text-align:center;">' +
      '<div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:26px; margin:0 auto 20px;">' + icon + '</div>' +
      '<h3 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:22px; letter-spacing:-0.01em; margin:0 0 10px;">' + title + '</h3>' +
      '<p style="color:var(--muted); font-size:15px; max-width:420px; margin:0 auto 22px; line-height:1.55;">' + text + '</p>' +
      '<button data-action="' + btnAction + '" style="' + S.primary.replace('padding:15px', 'padding:13px 24px') + '">' + btnLabel + '</button></div>';
  }
  function pageWrap(title, inner) {
    return '<main class="view-in" style="max-width:820px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:32px; letter-spacing:-0.02em; margin:8px 0 24px;">' + title + '</h1>' + inner + '</main>';
  }
  function responsesView() {
    if (state.authRole !== 'student') return homeView();
    return pageWrap('Мои отклики', emptyState('◎', 'Пока нет откликов', 'Откликнитесь на задачи в каталоге — здесь появится статус каждого отклика: на рассмотрении, приглашение или отказ.', 'goCatalog', 'Открыть каталог задач'));
  }
  function vacanciesView() {
    if (state.authRole !== 'company') return homeView();
    return pageWrap('Мои вакансии', emptyState('▤', 'Пока нет вакансий', 'Разместите первую задачу — здесь появится статус ваших вакансий и отклики студентов.', 'goStartupForm', 'Разместить задачу'));
  }

  /* ---------- view dispatch ---------- */
  function viewHtml() {
    switch (state.view) {
      case 'student': return studentView();
      case 'company': return companyView();
      case 'catalog': return catalogView();
      case 'cabinet': return cabinetView();
      case 'responses': return responsesView();
      case 'vacancies': return vacanciesView();
      default: return homeView();
    }
  }
  // Единая страница личного кабинета — отображается по роли.
  function cabinetView() {
    if (state.authRole === 'company') return companyCabinetView();
    if (state.authRole === 'student') return studentCabinetView();
    return homeView();
  }

  /* ---------- actions ---------- */
  var root;
  var pendingDocFile = null;  // выбранный в модалке файл (хранится вне DOM, чтобы переживать перерисовку)
  function setState(patch) { for (var k in patch) state[k] = patch[k]; render(); }
  function top() { try { window.scrollTo(0, 0); } catch (e) {} }

  var actions = {
    // Залогиненного логотип ведёт в рабочий раздел (каталог), а не на маркетинговый лендинг.
    goHome: function () { setState({ view: state.authRole ? 'catalog' : 'home' }); top(); },
    goStudent: function () { setState({ view: 'student', studentStep: 'login' }); top(); },
    goStartupForm: function () { setState({ view: 'company' }); top(); },
    goCatalog: function () { setState({ view: 'catalog' }); top(); },
    goCabinet: function () { setState({ view: 'cabinet' }); top(); },
    goResponses: function () { setState({ view: 'responses' }); top(); },
    goVacancies: function () { setState({ view: 'vacancies' }); top(); },
    // Меню открывается/закрывается без полной перерисовки — иначе тело страницы «дёргается» (повтор анимаций).
    toggleMenu: function () { state.menuOpen = !state.menuOpen; paintHeader(); },
    tabStudents: function () { setState({ catalogTab: 'students' }); },
    tabGigs: function () { setState({ catalogTab: 'gigs' }); },
    // Открывает окно авторизации Telegram через JS-API (своя кнопка вместо iframe-виджета).
    loginTelegram: function () {
      if (TELEGRAM_BOT.indexOf('YOUR_BOT') !== -1) { setState({ tgAuth: { loading: false, error: 'Telegram-бот не настроен (TELEGRAM_BOT / TELEGRAM_BOT_ID в int_app.js).' } }); return; }
      if (!window.Telegram || !window.Telegram.Login || typeof window.Telegram.Login.auth !== 'function') {
        setState({ tgAuth: { loading: false, error: 'Виджет Telegram ещё не загрузился, попробуйте через секунду.' } });
        return;
      }
      setState({ tgAuth: { loading: true, error: '' } });
      window.Telegram.Login.auth({ bot_id: TELEGRAM_BOT_ID, request_access: 'write' }, function (user) {
        if (!user) { setState({ tgAuth: { loading: false, error: 'Вход через Telegram отменён' } }); return; }
        actions.telegramAuth(user);
      });
    },
    // Отправляет подписанные данные Telegram в Edge Function и устанавливает Supabase-сессию.
    telegramAuth: function (user) {
      if (!supabase) { setState({ tgAuth: { loading: false, error: 'Supabase не настроен' } }); return; }
      if (!user || !user.id) { setState({ tgAuth: { loading: false, error: 'Telegram не вернул данные пользователя' } }); return; }
      setState({ tgAuth: { loading: true, error: '' } });
      fetch(TG_AUTH_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify(user)
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok || !res.body || !res.body.email || !res.body.email_otp) {
          setState({ tgAuth: { loading: false, error: (res.body && res.body.error) || 'Не удалось войти через Telegram' } });
          return;
        }
        return supabase.auth.verifyOtp({ email: res.body.email, token: res.body.email_otp, type: 'email' }).then(function (v) {
          if (v.error) { setState({ tgAuth: { loading: false, error: v.error.message } }); return; }
          return applyStudentProfile(v.data.session).then(function (hasProfile) {
            if (hasProfile) {
              // профиль уже есть — сразу в кабинет (или на шаг согласия, если требуется)
              setState({ view: state.studentStep === 'consent' ? 'student' : 'cabinet', tgDraft: false, tgAuth: { loading: false, error: '' } });
            } else {
              // новый пользователь — черновик из Telegram и форма профиля
              state.form.sfirst = user.first_name || state.form.sfirst || '';
              state.form.slast = user.last_name || state.form.slast || '';
              state.form.tg = user.username ? '@' + user.username : (state.form.tg || '');
              setState({ view: 'student', tgDraft: true, studentStep: 'profile', tgAuth: { loading: false, error: '' } });
            }
            top();
          });
        });
      }).catch(function (err) {
        setState({ tgAuth: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    continueEmail: function () { setState({ tgDraft: false, studentStep: 'email', otp: { email: '', error: '', loading: false } }); top(); },
    backToLogin: function () { setState({ studentStep: 'login', otp: { email: '', error: '', loading: false } }); top(); },
    backToEmail: function () { setState({ studentStep: 'email', otp: { email: state.otp.email, error: '', loading: false } }); top(); },
    sendOtp: function () {
      var email = (state.form.semail || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setState({ otp: { email: '', error: 'Введите корректный email', loading: false } });
        return;
      }
      if (!supabase) {
        setState({ otp: { email: email, error: 'Supabase не настроен', loading: false } });
        return;
      }
      setState({ otp: { email: email, error: '', loading: true } });
      supabase.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(function (res) {
        if (res.error) { setState({ otp: { email: '', error: res.error.message, loading: false } }); return; }
        state.form.otpInput = '';
        setState({ studentStep: 'otp', otp: { email: email, error: '', loading: false } });
        top();
      });
    },
    resendOtp: function () {
      if (!supabase || state.otp.loading) return;
      var email = state.otp.email;
      setState({ otp: { email: email, error: '', loading: true } });
      supabase.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(function (res) {
        if (res.error) { setState({ otp: { email: email, error: res.error.message, loading: false } }); return; }
        setState({ otp: { email: email, error: '', loading: false } });
      });
    },
    verifyOtp: function () {
      var entered = (state.form.otpInput || '').trim();
      if (!entered) {
        setState({ otp: { email: state.otp.email, error: 'Введите код из письма', loading: false } });
        return;
      }
      if (!supabase) {
        setState({ otp: { email: state.otp.email, error: 'Supabase не настроен', loading: false } });
        return;
      }
      var email = state.otp.email;
      setState({ otp: { email: email, error: '', loading: true } });
      supabase.auth.verifyOtp({ email: email, token: entered, type: 'email' }).then(function (res) {
        if (res.error) { setState({ otp: { email: email, error: 'Неверный или устаревший код', loading: false } }); return; }
        state.form.semail = email;
        applyStudentProfile(res.data.session).then(function (hasProfile) {
          if (hasProfile) {
            setState({ view: state.studentStep === 'consent' ? 'student' : 'cabinet', otp: { email: email, error: '', loading: false } });
          } else {
            setState({ view: 'student', studentStep: 'profile', otp: { email: email, error: '', loading: false } });
          }
          top();
        });
      });
    },
    saveStudentProfile: function () {
      var status = state.form.status || '';
      var first = (state.form.sfirst || '').trim();
      var last = (state.form.slast || '').trim();
      var email = (state.form.semail || '').trim();
      // Обязательные поля (Telegram — необязателен)
      if (!status) { setState({ profileSave: { loading: false, error: 'Выберите ваш статус' } }); return; }
      if (!first || !last) { setState({ profileSave: { loading: false, error: 'Укажите имя и фамилию' } }); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setState({ profileSave: { loading: false, error: 'Укажите корректный email' } }); return; }
      var minor = /до 18/.test(status);
      state.studentProfile = { first: first, last: last, tg: (state.form.tg || '').trim(), email: email, status: status, minor: minor };
      // Документы (справка/согласие) загружаются уже в кабинете — сюда всегда 'done'.
      if (!supabase || !currentUserId()) {
        setState({ authRole: 'student', studentStep: 'done' }); top(); return;
      }
      setState({ profileSave: { loading: true, error: '' } });
      saveProfileToDb().then(function (res) {
        if (res.error) { setState({ profileSave: { loading: false, error: 'Не удалось сохранить профиль: ' + res.error.message } }); return; }
        setState({ authRole: 'student', studentStep: 'done', profileSave: { loading: false, error: '' } }); top();
      });
    },
    // Модальные окна загрузки документов
    openStudyDoc: function () { pendingDocFile = null; setState({ modal: 'study', docUpload: { loading: false, error: '', fileName: '' } }); },
    openConsentDoc: function () { pendingDocFile = null; setState({ modal: 'consent', docUpload: { loading: false, error: '', fileName: '' } }); },
    closeModal: function () { pendingDocFile = null; setState({ modal: null, docUpload: { loading: false, error: '', fileName: '' } }); },
    submitDoc: function () {
      var type = state.modal;
      if (!type) return;
      var file = pendingDocFile;
      if (!file) { setState({ docUpload: { loading: false, error: 'Сначала выберите файл', fileName: '' } }); return; }
      if (file.size > 10 * 1024 * 1024) { setState({ docUpload: { loading: false, error: 'Файл больше 10 МБ', fileName: file.name } }); return; }
      var userId = currentUserId();
      if (!supabase || !userId || !state.session) { setState({ docUpload: { loading: false, error: 'Сессия истекла — войдите заново', fileName: file.name } }); return; }
      var ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
      var path = userId + '/' + type + '.' + ext;
      setState({ docUpload: { loading: true, error: '', fileName: file.name } });
      supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' }).then(function (up) {
        if (up.error) { setState({ docUpload: { loading: false, error: 'Ошибка загрузки: ' + up.error.message, fileName: file.name } }); return; }
        return fetch(SUBMIT_DOC_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
          body: JSON.stringify({ type: type, path: path })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
          if (!res.ok || !res.body || res.body.error) { setState({ docUpload: { loading: false, error: (res.body && res.body.error) || 'Не удалось отправить на проверку', fileName: file.name } }); return; }
          state.docStatus[type] = 'pending';
          pendingDocFile = null;
          setState({ modal: null, docUpload: { loading: false, error: '', fileName: '' } });
        });
      }).catch(function (err) {
        setState({ docUpload: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err), fileName: file.name } });
      });
    },
    submitCompany: function () {
      state.companyProfile = {
        name: state.form.company || 'Ваша компания',
        inn: state.form.inn || '',
        director: state.form.director || '',
        corpEmail: state.form.corpEmail || '',
        domain: (state.form.corpEmail || '').split('@')[1] || '',
        linkedin: state.form.linkedin || '',
        contact: state.form.contact || '',
        phone: state.form.phone || ''
      };
      setState({ authRole: 'company' }); top();
    },
    scrollHow: function () { scrollToId('sec-how'); },
    scrollVerify: function () { scrollToId('sec-verify'); },
    logout: function () {
      if (supabase && state.session) supabase.auth.signOut();
      pendingDocFile = null;
      setState({
        authRole: null, studentProfile: null, companyProfile: null, session: null,
        studentStep: 'login', docStatus: { study: 'none', consent: 'none' }, tgDraft: false,
        otp: { email: '', error: '', loading: false },
        tgAuth: { loading: false, error: '' },
        profileSave: { loading: false, error: '' },
        docUpload: { loading: false, error: '', fileName: '' },
        menuOpen: false, modal: null,
        form: {}, view: 'home', catalogTab: 'students'
      });
      top();
    }
  };
  function scrollToId(id) {
    if (state.view !== 'home') { setState({ view: 'home' }); setTimeout(function () { doScroll(id); }, 60); }
    else doScroll(id);
  }
  function doScroll(id) { var el = document.getElementById(id); if (el) window.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' }); }

  /* ---------- count-up ---------- */
  function writeStats() {
    var map = { 'stat-students': statsCur.students, 'stat-companies': statsCur.companies, 'stat-projects': statsCur.projects, 'stat-score': statsCur.score };
    for (var id in map) { var e = document.getElementById(id); if (e) e.textContent = map[id]; }
  }
  function startStats() {
    if (state._statsRan) return; state._statsRan = true;
    var dur = 1500, start = now(), ease = function (t) { return 1 - Math.pow(1 - t, 3); };
    function tick() {
      var t = Math.min(1, (now() - start) / dur), e = ease(t);
      statsCur = { students: Math.round(STATS_TARGET.students * e), companies: Math.round(STATS_TARGET.companies * e), projects: Math.round(STATS_TARGET.projects * e), score: Math.round(STATS_TARGET.score * e) };
      writeStats();
      if (t < 1) requestAnimationFrame(tick);
    }
    if ('requestAnimationFrame' in window) requestAnimationFrame(tick);
    setTimeout(function () { statsCur = { students: STATS_TARGET.students, companies: STATS_TARGET.companies, projects: STATS_TARGET.projects, score: STATS_TARGET.score }; writeStats(); }, 1900);
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---------- scroll reveal ---------- */
  function setupReveal() {
    var els = [].slice.call(root.querySelectorAll('[data-reveal]'));
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.remove('reveal-armed'); }); return; }
    var vh = window.innerHeight || 800;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.remove('reveal-armed'); io.unobserve(en.target); } });
    }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { if (el.getBoundingClientRect().top > vh * 0.85) { el.classList.add('reveal-armed'); io.observe(el); } });
    setTimeout(function () { root.querySelectorAll('[data-reveal].reveal-armed').forEach(function (e) { e.classList.remove('reveal-armed'); }); }, 1600);
  }

  /* ---------- telegram widget script ---------- */
  // Грузим telegram-widget.js один раз — он нужен ради JS-API Telegram.Login.auth,
  // который открывает окно авторизации по клику на нашу собственную кнопку.
  function loadTelegramScript() {
    if (document.getElementById('tg-widget-js')) return;
    var s = document.createElement('script');
    s.id = 'tg-widget-js';
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    document.head.appendChild(s);
  }

  /* ---------- render ---------- */
  /* ---------- profile persistence ---------- */
  function currentUserId() {
    return state.session && state.session.user && state.session.user.id;
  }
  // Сохраняет текущий профиль студента в таблицу profiles (RLS: только своя строка).
  function saveProfileToDb() {
    var userId = currentUserId();
    if (!supabase || !userId || !state.studentProfile) return Promise.resolve({ error: null });
    var p = state.studentProfile;
    var data = { first: p.first, last: p.last, tg: p.tg, email: p.email, status: p.status, minor: !!p.minor, docStatus: state.docStatus };
    return supabase.from('profiles')
      .upsert({ id: userId, role: 'student', data: data, updated_at: new Date().toISOString() })
      .then(function (r) { return { error: r.error }; });
  }
  // Загружает существующий профиль студента из БД в state.
  // Возвращает Promise<boolean> — есть ли уже сохранённый профиль.
  function applyStudentProfile(session) {
    state.session = session;
    var userId = session && session.user && session.user.id;
    if (!supabase || !userId) return Promise.resolve(false);
    return supabase.from('profiles').select('role,data').eq('id', userId).maybeSingle().then(function (r) {
      var row = r && r.data;
      if (row && row.role === 'student' && row.data) {
        var d = row.data;
        state.studentProfile = { first: d.first || '', last: d.last || '', tg: d.tg || '', email: d.email || '', status: d.status || '', minor: !!d.minor };
        // статусы документов (совместимость со старым флагом consentUploaded)
        state.docStatus = d.docStatus || { study: 'none', consent: d.consentUploaded ? 'pending' : 'none' };
        state.authRole = 'student';
        state.studentStep = 'done';
        return true;
      }
      return false;
    });
  }
  // При загрузке страницы восстанавливает сессию и профиль из Supabase.
  function restoreSession() {
    if (!supabase) return;
    supabase.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;
      applyStudentProfile(session).then(function (hasProfile) {
        // залогиненного не держим на маркетинговом лендинге — в рабочий раздел (каталог)
        if (hasProfile && state.view === 'home') state.view = 'catalog';
        render();
      });
    });
  }

  /* ---------- document upload modal ---------- */
  function modalHtml() {
    if (!state.modal) return '';
    var type = state.modal;
    var isConsent = type === 'consent';
    var title = isConsent ? 'Согласие родителя' : 'Подтверждение места учёбы';
    var desc = isConsent
      ? 'Скачайте шаблон, подпишите его вместе с родителем или опекуном, затем загрузите скан или фото подписанного документа.'
      : 'Загрузите справку о месте учёбы (из вуза, колледжа, школы или лицея). PDF или фото, до 10 МБ.';
    var status = docStat(type);
    var loading = state.docUpload.loading;
    var tmpl = isConsent
      ? '<a href="' + CONSENT_TEMPLATE_URL + '" download style="display:flex; align-items:center; justify-content:center; gap:9px; font-size:14px; font-weight:600; color:var(--ink); background:#fff; border:1px solid var(--line); padding:12px; border-radius:11px; text-decoration:none; margin-bottom:16px;"><span>⬇</span>Скачать шаблон согласия</a>'
      : '';
    var statusNote = (status === 'pending' || status === 'approved')
      ? '<div style="padding:11px 14px; background:color-mix(in srgb, ' + docColor(status) + ' 10%, #fff); border:1px solid color-mix(in srgb, ' + docColor(status) + ' 26%, #fff); border-radius:10px; font-size:13px; color:' + docColor(status) + '; margin-bottom:16px;">Текущий статус: ' + docLabel(status) + '. При необходимости загрузите файл заново.</div>'
      : '';
    var fileName = state.docUpload.fileName || '';
    var picker = '<label class="file-drop" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1.5px dashed var(--line); border-radius:12px; background:var(--bg); cursor:pointer;">' +
      '<span style="flex-shrink:0; font-size:13px; font-weight:600; color:#fff; background:var(--ink); padding:8px 14px; border-radius:8px;">Выбрать файл</span>' +
      '<span style="min-width:0; flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:' + (fileName ? 'var(--ink)' : 'var(--muted)') + '; font-weight:' + (fileName ? '600' : '400') + ';">' + (fileName ? esc(fileName) : 'Файл не выбран · PDF или фото') + '</span>' +
      '<input id="doc-file" data-file-input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none;">' +
    '</label>';
    var err = state.docUpload.error ? '<div style="margin-top:8px; font-size:13px; color:#b3261e; font-weight:600;">' + esc(state.docUpload.error) + '</div>' : '';

    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:440px; width:100%; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-family:\'Space Grotesk\',sans-serif; font-weight:600; font-size:20px; letter-spacing:-0.01em; margin:0;">' + title + '</h3>' +
        '<button data-action="closeModal" style="background:none; border:none; font-size:24px; line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      '<p style="font-size:14px; color:var(--muted); line-height:1.55; margin:10px 0 18px;">' + desc + '</p>' +
      statusNote + tmpl + picker + err +
      '<button data-action="submitDoc"' + (loading ? ' disabled' : '') + ' style="margin-top:16px; width:100%; ' + S.primary + (loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (loading ? 'Отправка…' : 'Отправить на проверку') + '</button>' +
      '<button data-action="closeModal" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button>' +
    '</div>';

    return '<div data-action="closeModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  function render() {
    root.innerHTML = header() + viewHtml() + footer() + modalHtml();
    setupReveal();
    if (state.view === 'home') startStats();
  }
  // Перерисовывает только шапку и оверлей (для открытия/закрытия меню), не трогая тело страницы.
  function paintHeader() {
    var ov = root.querySelector('[data-menu-overlay]');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var hdr = root.querySelector('header');
    if (hdr) hdr.outerHTML = header();
  }

  function init() {
    root = document.getElementById('root');
    loadTelegramScript();
    restoreSession();
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (t && actions[t.getAttribute('data-action')]) {
        e.preventDefault();
        var name = t.getAttribute('data-action');
        // любое действие, кроме переключения меню, закрывает выпадающее меню
        if (name !== 'toggleMenu' && state.menuOpen) state.menuOpen = false;
        actions[name](t);
      }
    });
    root.addEventListener('input', function (e) { var f = e.target.getAttribute && e.target.getAttribute('data-field'); if (f) state.form[f] = e.target.value; });
    root.addEventListener('change', function (e) {
      // выбор файла в модалке загрузки документа
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-file-input')) {
        pendingDocFile = (e.target.files && e.target.files[0]) || null;
        setState({ docUpload: { loading: false, error: '', fileName: pendingDocFile ? pendingDocFile.name : '' } });
        return;
      }
      var f = e.target.getAttribute && e.target.getAttribute('data-field'); if (f) state.form[f] = e.target.value;
    });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
