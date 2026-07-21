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
  // Числовой bot_id (первая часть токена до ':') — нужен для redirect-флоу входа через Telegram.
  var TELEGRAM_BOT_ID = '8827034426';
  // Эндпоинт Edge Function, которая проверяет подпись Telegram и выдаёт сессию.
  var TG_AUTH_FN = SUPABASE_URL + '/functions/v1/telegram-auth';
  // Та же подпись, но для привязки Telegram к уже открытому аккаунту (без выдачи сессии).
  var TG_LINK_FN = SUPABASE_URL + '/functions/v1/link-telegram';
  // Возврат из Telegram стирает состояние страницы, поэтому намерение переживает редирект
  // в localStorage: 'link' — привязываем к текущему аккаунту, иначе это обычный вход.
  var TG_INTENT_KEY = 'iuz_tg_intent';

  /* ---------- документы студента ---------- */
  var SUBMIT_DOC_FN = SUPABASE_URL + '/functions/v1/submit-doc';
  // ИИ-тест: генерация новых вопросов через Claude (см. supabase/functions/generate-test).
  // Если функция ещё не задеплоена/недоступна, клиент тихо остаётся на статическом банке
  // из ai_test_bank.js — см. tryGenerateAiTest() и activeTestBank().
  var GENERATE_TEST_FN = SUPABASE_URL + '/functions/v1/generate-test';
  var DOC_BUCKET = 'student-docs';
  // Путь к шаблону согласия (статика Netlify). Положите файл в /templates/.
  // Пути к своим файлам — от корня, а не относительные: на вложенном адресе вроде
  // /cert/<id> относительный путь разрешается в /cert/templates/... и даёт 404.
  var CONSENT_TEMPLATE_URL = '/templates/parental-consent-template.pdf';

  /* ---------- заявки компаний ---------- */
  var SUBMIT_COMPANY_FN = SUPABASE_URL + '/functions/v1/submit-company';
  var POST_GIG_FN = SUPABASE_URL + '/functions/v1/post-gig';
  // Привязка к аккаунту заявок, поданных до появления входа для компаний
  // (тогда «сессией» был company_app_id в localStorage). Нужна один раз на компанию.
  var CLAIM_COMPANY_FN = SUPABASE_URL + '/functions/v1/claim-company';

  /* ---------- state ---------- */
  var state = {
    view: 'home',
    authRole: null,            // null | 'student' | 'company'
    studentStep: 'login',      // login | profile | consent | done
    companyStep: 'login',      // login | email | otp | form | done
    otpRole: 'student',        // чей вход сейчас идёт по коду: 'student' | 'company'
    studentProfile: null,
    companyProfile: null,
    session: null,
    form: {},
    files: [],                 // student_files: все загруженные файлы со статусом модерации
    filesLoading: false,
    isAdmin: false,
    // Админка: очередь модерации. tab — что показываем, rejectFor — id, для которого
    // открыт ввод причины отказа.
    admin: { tab: 'pending', items: [], companies: [], statusReqs: [], certs: [], gigs: [], loading: false, error: '', rejectFor: null, reason: '', busy: null },
    tgDraft: false,
    // Фильтр в плоском списке откликов компании: по умолчанию — те, что ждут ответа.
    respTab: 'pending',
    navOpen: false,        // мобильное меню под бургером
    certs: [],            // справки компании — чтобы приложить свидетельство
    certDocBusy: null,
    // Форма завершения стажировки и публичная страница справки.
    certModal: { appId: null, score: 5, error: '', loading: false },
    cert: { loading: false, data: null, error: '' },
    history: [],
    menuOpen: false,
    modal: null,               // null | 'study' | 'consent'
    testView: null,            // null | 'intro' | 'running' | 'result'
    testConfirmExit: false,    // показан ли вопрос «прервать тест?»
    undoItem: null,            // {key, index, item, label} — что можно вернуть после удаления
    itemConfirmClose: false,   // показан ли вопрос «закрыть без сохранения?»
    confirmRejectApp: null,    // id отклика, по которому спрошено подтверждение отказа
    testResult: null,
    otp: { email: '', error: '', loading: false },
    tgAuth: { loading: false, error: '' },
    // Привязки аккаунта: какой Telegram привязан и синтетический ли логин
    // (tg_<id>@telegram.local — значит настоящую почту ещё не привязывали).
    links: { telegram_id: null, telegram_username: '', login_email: '', login_is_synthetic: false, loading: false, error: '' },
    // Привязка почты к тг-аккаунту: 'form' — ввод адреса, 'code' — ввод кода из письма.
    emailLink: { step: null, email: '', error: '', loading: false },
    // Своя заявка на смену статуса, пока она на рассмотрении. Пока она есть — откликаться
    // нельзя; то же условие продублировано в политике вставки отклика, чтобы его нельзя
    // было снять через консоль.
    statusReq: null,
    profileSave: { loading: false, error: '' },
    docUpload: { loading: false, error: '', fileName: '' },
    extrasSave: { loading: false, error: '', ok: false },
    companySubmit: { loading: false, error: '' },
    gigs: [],                  // задачи из БД (каталог)
    gigModal: false,           // форма публикации задачи (модалка)
    gigSubmit: { loading: false, error: '' },
    applications: [],          // отклики: студент видит свои, компания — адресованные ей
    appsLoading: false,
    applyState: {},            // gigId -> { loading: bool, error: '' }
    // Открытая ветка чата. peer — с кем говорим (имя компании или студента).
    chat: null,                // null | { appId, peer, gigTitle, messages, loading, error, sending }
    // Просмотр чужого профиля: студент смотрит компанию, компания — откликнувшегося студента.
    profileView: null,         // null | { kind: 'company'|'student', id, data, loading, error, back }
    itemModal: null,           // null | { type: 'skill'|'language'|'project'|'achievement', index: null|number }
    itemForm: {},
    itemUpload: { loading: false, error: '', fileName: '' },
    avatarUpload: { loading: false, error: '' },
    fieldEdit: null,           // null | 'email' | 'status' | 'institution'
    fieldEditConfirm: null,    // null | { field, value, warning }
    fieldEditError: '',
    skillDetail: null,         // null | index — просмотр детальной карточки навыка
    projectDetail: null,       // null | index — просмотр детальной карточки проекта
    projectGalleryIndex: 0,    // текущее фото в галерее проекта
    mediaPreview: null,        // null | { url, name, isImage } — просмотр фото/файла на месте
    testFlags: 0,              // счётчик подозрительной активности во время ИИ-теста (переключение окна/выход из fullscreen)
    testFullscreenWarn: false,
    dynamicBank: null,         // {mcq, open} — вопросы, сгенерированные ИИ (generate-test); null = используется статический банк
    testGenLoading: false,
    _statsRan: false
  };


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
  // Каталог наполняется реальными профилями/задачами по мере регистрации. Пока пусто.
  var catalogStudents = [];
  var catalogGigs = [];

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fv(k) { return esc(state.form[k] || ''); }
  function isMinor() { return !!(state.studentProfile && state.studentProfile.minor); }
  function studentName() { var p = state.studentProfile; return p ? ((p.first + ' ' + p.last).trim() || 'Студент') : 'Студент'; }
  function studentInitials() { var p = state.studentProfile; if (!p) return 'С'; return (((p.first || '')[0] || '') + ((p.last || '')[0] || '')).toUpperCase() || 'С'; }
  function companyName() { return state.companyProfile ? state.companyProfile.name : 'Ваша компания'; }
  function companyDomain() { return state.companyProfile ? (state.companyProfile.domain || '') : ''; }
  // Статус конкретного документа: none | pending | approved | rejected.
  // Статус документа берём из загруженных student_files: единственный источник правды,
  // писать в который студент не может (в отличие от старого docStatus в profiles.data).
  function docStat(type) {
    var f = fileFor(type);
    return f ? f.status : 'none';
  }
  // Последний файл нужного вида (по одному на avatar/study/consent).
  function fileFor(kind) {
    var list = state.files || [], found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === kind && (!found || list[i].created_at > found.created_at)) found = list[i];
    }
    return found;
  }
  // Статус конкретного файла элемента профиля (сертификат, файл проекта) — по пути в сторадже.
  function fileStatusByPath(path) {
    if (!path) return null;
    var list = state.files || [];
    for (var i = 0; i < list.length; i++) if (list[i].path === path) return list[i];
    return null;
  }
  var MOD_BADGE = { pending: ['на проверке', 'var(--warn)'], approved: ['одобрено', 'var(--ok)'], rejected: ['отклонено', 'var(--err)'] };
  // Бейдж модерации рядом с файлом: студент видит, дошёл ли файл до компаний.
  function modBadge(path) {
    var f = fileStatusByPath(path);
    var m = f && MOD_BADGE[f.status];
    if (!m) return '';
    var tip = (f.status === 'rejected' && f.reason) ? ' title="' + esc(f.reason) + '"' : '';
    return '<span' + tip + ' style="font-size:var(--text-micro); font-weight:600; color:' + m[1] + '; background:color-mix(in srgb, ' + m[1] + ' 12%, #fff); padding:2px 7px; border-radius:999px; white-space:nowrap;">' + m[0] + '</span>';
  }
  function docLabel(status) {
    return { pending: 'на проверке', approved: 'подтверждено', rejected: 'отклонено — загрузите заново', none: '' }[status] || '';
  }
  function docColor(status) {
    return { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--err)', none: 'var(--muted)' }[status] || 'var(--muted)';
  }
  // Динамический тег доступности студента: looking | team | hired.
  function availLabel(v) {
    return { looking: 'Ищу проекты', team: 'В команде', hired: 'Нанят(а)' }[v] || 'Статус не указан';
  }
  function availColor(v) {
    return { looking: 'var(--accent)', team: 'var(--warn)', hired: 'var(--ok)' }[v] || 'var(--muted)';
  }
  function availOptions(selected) {
    return [['', 'Указать статус'], ['looking', 'Ищу проекты'], ['team', 'В команде'], ['hired', 'Нанят(а)']].map(function (o) {
      var sel = (selected || '') === o[0] ? ' selected' : '';
      return '<option value="' + o[0] + '"' + sel + '>' + o[1] + '</option>';
    }).join('');
  }
  // Ключ коллекции профиля по типу элемента (используется модалкой добавления/редактирования).
  function collectionKey(type) {
    return { skill: 'hardSkills', language: 'languages', project: 'projects', achievement: 'achievements' }[type];
  }
  // Название удалённого элемента для плашки отмены — в единственном числе.
  function itemTypeLabel(type) {
    return { skill: 'Навык', language: 'Язык', project: 'Проект', achievement: 'Сертификат' }[type] || 'Элемент';
  }
  var undoTimer = null;
  /* Есть ли в форме элемента что-то, что жалко потерять. Пустые строки, пустые
     массивы и служебные поля не считаются: иначе вопрос всплывал бы при закрытии
     нетронутой формы. */
  function itemFormDirty() {
    var f = state.itemForm;
    if (!f) return false;
    return Object.keys(f).some(function (k) {
      var v = f[k];
      if (v == null || v === '' || v === false) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
  }
  // Локальный id для элементов динамических списков внутри модалки (разделы, детали, файловые слоты).
  function newLocalId(prefix) { return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  // Типы элементов, где допустимо несколько файлов (проекты) — остальные хранят один файл.
  function isMultiFileType(type) { return type === 'project'; }
  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(file.name || '');
  }
  function fmtBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' КБ';
    return (n / (1024 * 1024)).toFixed(1) + ' МБ';
  }
  function confidenceColor(n) {
    if (n == null) return 'var(--muted)';
    if (n >= 8) return 'var(--ok)';
    if (n >= 5) return 'var(--warn)';
    return 'var(--err)';
  }
  // Рекомендуемые hard skills по специальности — подсказки при выборе специальностей.
  var SPECIALTY_SKILLS = {
    'Разработка / программирование': ['Frontend', 'Backend', 'JavaScript', 'Python', 'SQL', 'Git'],
    'Дизайн (UI/UX, графика)': ['Figma', 'UI/UX', 'Прототипирование', 'Adobe Photoshop', 'Иллюстрация'],
    'Маркетинг': ['SMM', 'Таргетированная реклама', 'Аналитика', 'Копирайтинг', 'SEO'],
    'SMM и контент': ['SMM', 'Контент-план', 'Копирайтинг', 'Canva', 'Соцсети'],
    'Аналитика данных': ['SQL', 'Python', 'Excel', 'Визуализация данных', 'Статистика'],
    'Тестирование (QA)': ['Тест-кейсы', 'Баг-репорты', 'Ручное тестирование', 'Postman', 'QA'],
    'Копирайтинг': ['Копирайтинг', 'SEO-тексты', 'Редактура', 'Сторителлинг'],
    'Проектный менеджмент': ['Планирование', 'Agile/Scrum', 'Trello/Jira', 'Коммуникация']
  };
  function suggestedSkills(specialties, already) {
    var have = {}; (already || []).forEach(function (s) { have[(s.name || s).toLowerCase()] = true; });
    var seen = {}, out = [];
    (specialties || []).forEach(function (spec) {
      (SPECIALTY_SKILLS[spec] || []).forEach(function (sk) {
        var k = sk.toLowerCase();
        if (!have[k] && !seen[k]) { seen[k] = true; out.push(sk); }
      });
    });
    return out;
  }
  // Векторные иконки (не эмодзи) — единый набор для всего приложения.
  var ICON_PATHS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
    paperclip: '<path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.48"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
  };
  function icon(name, size, extraAttrs) {
    var s = size || 14;
    return '<svg' + (extraAttrs || '') + ' width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; vertical-align:middle;">' + (ICON_PATHS[name] || '') + '</svg>';
  }
  // Рейтинг — фирменный стиль платформы: спасательные круги вместо звёзд.
  function lifeRing(size, filled) {
    var s = size || 30;
    /* Цвет идёт через style, а не через атрибут stroke: var() в презентационных
       атрибутах SVG держит Chromium, но у Safari с этим исторически плохо, а
       здесь заметная доля айфонов. В style поддержка гарантирована везде.
       Янтарь у круга означает оценку, а не статус — это отдельная роль. */
    var c = 'stroke:' + (filled ? 'var(--rating)' : 'var(--line)') + ';';
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">' +
      '<circle cx="12" cy="12" r="9.5" style="' + c + '" stroke-width="3"/>' +
      '<circle cx="12" cy="12" r="3.5" style="' + c + '" stroke-width="2" fill="#fff"/>' +
      '<line x1="12" y1="1.3" x2="12" y2="7.5" style="' + c + '" stroke-width="3"/>' +
      '<line x1="12" y1="16.5" x2="12" y2="22.7" style="' + c + '" stroke-width="3"/>' +
      '<line x1="1.3" y1="12" x2="7.5" y2="12" style="' + c + '" stroke-width="3"/>' +
      '<line x1="16.5" y1="12" x2="22.7" y2="12" style="' + c + '" stroke-width="3"/>' +
    '</svg>';
  }
  function starRating(score, size) {
    var full = Math.round(score);
    var out = '<span style="display:inline-flex; gap:4px; align-items:center;">';
    for (var i = 1; i <= 5; i++) out += lifeRing(size || 30, i <= full);
    return out + '</span>';
  }
  function pluralRu(n, one, few, many) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
  // Аватар профиля: фото, если загружено, иначе инициалы.
  function avatarHtml(size, radius) {
    var sp = state.studentProfile;
    if (sp && sp.photoUrl) {
      return '<img src="' + esc(sp.photoUrl) + '" style="width:' + size + 'px; height:' + size + 'px; border-radius:' + radius + 'px; object-fit:cover; flex-shrink:0; display:block;">';
    }
    return '<span style="width:' + size + 'px; height:' + size + 'px; border-radius:' + radius + 'px; background:color-mix(in srgb, var(--accent) 14%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:' + Math.round(size * 0.37) + 'px; flex-shrink:0;">' + esc(studentInitials()) + '</span>';
  }
  function companyStatus() { return (state.companyProfile && state.companyProfile.status) || 'pending'; }
  // Короткий статус верификации для шапки/меню.
  function verifyStatus() {
    if (state.authRole === 'company') {
      var cs = companyStatus();
      if (cs === 'approved') return 'Профиль подтверждён';
      if (cs === 'rejected') return 'Заявка отклонена';
      return 'На подтверждении';
    }
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
  // Цвет к тому же статусу. Раньше он захардкоживался по роли — компания всегда была
  // оранжевой, студент всегда зелёным, — и подпись «Профиль подтверждён» соседствовала
  // с точкой «на проверке». Теперь цвет считается из того же состояния, что и текст.
  function verifyColor() {
    if (state.authRole === 'company') {
      var cs = companyStatus();
      return cs === 'approved' ? 'var(--ok)' : cs === 'rejected' ? 'var(--err)' : 'var(--warn)';
    }
    if (state.authRole === 'student') {
      if (isMinor()) {
        var c = docStat('consent');
        return c === 'approved' ? 'var(--ok)' : c === 'rejected' ? 'var(--err)' : c === 'pending' ? 'var(--warn)' : 'var(--err)';
      }
      return 'var(--ok)';
    }
    return 'var(--muted)';
  }
  function companyDirector() { return state.companyProfile ? (state.companyProfile.director || '') : ''; }

  /* ---------- shared style snippets ---------- */
  var S = {
    /* Поля ввода строго на --text-body (16px): мобильный Safari принудительно
       зумит страницу при фокусе на поле с кеглем меньше 16px. Было 15px и 14px,
       то есть зумило на каждой форме сайта. */
    input: 'padding:13px 14px; border:1.5px solid var(--line); border-radius:11px; font-size:var(--text-body); background:#fff; width:100%;',
    label: 'display:flex; flex-direction:column; gap:7px;',
    labelSpan: 'font-size:var(--text-caption); font-weight:600;',
    primary: 'font-size:var(--text-body); font-weight:600; color:#fff; background:var(--accent); border:none; padding:15px; border-radius:11px; cursor:pointer;',
    dark: 'font-size:var(--text-body); font-weight:600; color:#fff; background:var(--ink); border:none; padding:13px 24px; border-radius:11px; cursor:pointer;',
    ghost: 'font-size:var(--text-body); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:14px; border-radius:11px; cursor:pointer;',
    back: 'font-size:var(--text-caption); color:var(--muted); cursor:pointer; font-weight:400;',
    field: 'width:100%; font-size:var(--text-body); padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; background:#fff; color:var(--ink);',
    iconBtn: 'width:26px; height:26px; border-radius:8px; border:1.5px solid var(--line); background:#fff; color:var(--muted); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:var(--text-caption); flex-shrink:0; padding:0;',
    chipIcon: 'width:20px; height:20px; border-radius:6px; border:none; background:none; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; padding:0;',
    wrap: 'overflow-wrap:anywhere; word-break:break-word;'
  };

  function inputField(label, field, ph, hint) {
    return '<label style="' + S.label + '"><span style="' + S.labelSpan + '">' + label + '</span>' +
      '<input data-field="' + field + '" value="' + fv(field) + '" placeholder="' + esc(ph) + '" style="' + S.input + '">' +
      (hint ? '<span style="font-size:var(--text-micro); color:var(--muted);">' + hint + '</span>' : '') + '</label>';
  }
  // Поле в модалке добавления/редактирования элемента профиля (data-item-field, не data-field).
  function itemField(label, key, val, ph, optional) {
    return '<label style="display:block; margin-bottom:12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">' + label + (optional ? ' <span style="color:var(--muted); font-weight:400;">(необязательно)</span>' : '') + '</span>' +
      '<input data-item-field="' + key + '" value="' + esc(val || '') + '" placeholder="' + esc(ph) + '" style="' + S.field + '"></label>';
  }
  function itemTextarea(label, key, val, ph) {
    return '<label style="display:block;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">' + label + ' <span style="color:var(--muted); font-weight:400;">(необязательно)</span></span>' +
      '<textarea data-item-field="' + key + '" rows="2" placeholder="' + esc(ph) + '" style="' + S.field + ' resize:vertical; font-family:inherit; line-height:1.5;">' + esc(val || '') + '</textarea></label>';
  }

  /* ---------- header ---------- */
  // Пункт меню. Раньше это всегда был <a> без href — такой элемент не фокусируется
  // с клавиатуры и не объявляется скринридером как ссылка, то есть вся навигация была
  // недоступна. Теперь: якорь на секцию — настоящая <a href="#...">, её можно скопировать
  // и открыть; переключатель вида — <button>, потому что семантически это кнопка, а не
  // ссылка на документ.
  function navLink(action, label, href) {
    var active = state.view === action.replace(/^go/, '').toLowerCase();
    var css = 'font-size:var(--text-caption); font-weight:400; color:' + (active ? 'var(--ink)' : 'var(--muted)') + ';';
    if (href) {
      return '<a href="' + href + '" data-action="' + action + '" class="nav-link" style="' + css + '">' + label + '</a>';
    }
    return '<button type="button" data-action="' + action + '" class="nav-link" style="' + css + ' background:none; border:none; padding:0; cursor:pointer; font-family:inherit;">' + label + '</button>';
  }
  function header() {
    var role = state.authRole;

    // центральная навигация — свой набор для каждой роли
    var nav;
    if (role === 'student') {
      nav = navLink('goCatalog', 'Каталог') + navLink('goResponses', 'Мои отклики') + (state.isAdmin ? navLink('goAdmin', 'Модерация') : '');
    } else if (role === 'company') {
      // Каталога у компании нет: витрины студентов не существует (студенты приходят
      // сами, откликаясь), а чужие задачи компании ни к чему.
      nav = navLink('goVacancies', 'Мои вакансии') + navLink('goResponses', 'Отклики') + (state.isAdmin ? navLink('goAdmin', 'Модерация') : '');
    } else {
      nav = navLink('scrollHow', 'Как это работает', '#sec-how') + navLink('scrollVerify', 'Верификация', '#sec-verify') + navLink('goCatalog', 'Каталог');
    }

    // правая часть — кнопки для гостя или аватар с выпадающим меню
    var auth, overlay = '';
    if (role === 'student' || role === 'company') {
      var avatar = role === 'student'
        ? avatarHtml(30, 15)
        : '<span style="width:30px; height:30px; border-radius:8px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-body); flex-shrink:0;">◆</span>';
      var name = role === 'student' ? studentName() : companyName();
      var caret = '<span style="color:var(--muted); font-size:var(--text-micro);' + (state.menuOpen ? ' transform:rotate(180deg);' : '') + '">▾</span>';
      var btn = '<button data-action="toggleMenu" style="display:flex; align-items:center; gap:9px; font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1px solid ' + (state.menuOpen ? 'var(--accent)' : 'var(--line)') + '; padding:6px 13px 6px 6px; border-radius:999px; cursor:pointer;">' + avatar + '<span style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(name) + '</span>' + caret + '</button>';

      var dropdown = '';
      if (state.menuOpen) {
        var dot = verifyColor();
        var mItem = function (action, label, color) {
          return '<a data-action="' + action + '" class="menu-item" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:9px; font-size:var(--text-caption); font-weight:600; color:' + color + '; cursor:pointer;">' + label + '</a>';
        };
        dropdown = '<div class="profile-menu" style="position:absolute; right:0; top:calc(100% + 10px); width:252px; background:#fff; border:1.5px solid var(--line); border-radius:14px; box-shadow:0 22px 48px -22px rgba(18,20,26,0.34); padding:8px; z-index:60;">' +
          '<div style="display:flex; align-items:center; gap:11px; padding:8px 10px 12px; border-bottom:1.5px solid var(--line); margin-bottom:6px;">' + avatar +
            '<div style="min-width:0;"><div style="font-weight:600; font-size:var(--text-caption); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</div>' +
            '<div style="font-size:var(--text-micro); color:var(--muted); display:flex; align-items:center; gap:6px; margin-top:3px;"><span style="width:6px; height:6px; border-radius:50%; background:' + dot + '; flex-shrink:0;"></span>' + esc(verifyStatus()) + '</div></div></div>' +
          mItem('goCabinet', 'Личный кабинет', 'var(--ink)') +
          mItem('logout', 'Выйти', 'var(--err)') +
        '</div>';
      }
      auth = '<div style="position:relative;">' + btn + dropdown + '</div>';
      // невидимый оверлей на весь экран — клик вне меню закрывает его (рендерится вне header из-за backdrop-filter)
      if (state.menuOpen) overlay = '<div data-menu-overlay data-action="toggleMenu" style="position:fixed; inset:0; z-index:40;"></div>';
    } else {
      auth = '<span style="display:flex; align-items:center; gap:12px;">' +
        '<button data-action="goStudent" style="font-size:var(--text-caption); font-weight:600; color:var(--ink); background:none; border:1.5px solid var(--line); padding:9px 16px; border-radius:9px; cursor:pointer; white-space:nowrap;">Найти стажировку</button>' +
        '<button data-action="goStartupForm" style="font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); border:1px solid var(--ink); padding:9px 16px; border-radius:9px; cursor:pointer; white-space:nowrap;">Разместить задачу</button></span>';
    }
    return overlay + '<header style="position:sticky; top:0; z-index:50; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(10px); border-bottom:1.5px solid var(--line);">' +
      '<div class="hdr' + (state.navOpen ? ' nav-open' : '') + '" style="max-width:1180px; margin:0 auto; padding:16px 28px;">' +
        '<a href="/" data-action="goHome" style="display:flex; align-items:center; gap:8px; cursor:pointer;">' +
          '<span style="display:inline-block; width:58px; height:34px; overflow:hidden; flex-shrink:0;"><img src="/logo.png" alt="" style="width:90px; height:90px; max-width:none; margin:-29px 0 0 -17px; display:block;"></span>' +
          '<span class="brand-name" style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em;">internship<span style="color:var(--muted); font-weight:400;">.uz</span></span>' +
        '</a>' +
        // Бургер виден только на узком экране (см. CSS). До него шапка занимала две
        // строки, меню приходилось листать вбок, и вся страница ощущалась «ездящей».
        '<button type="button" data-action="toggleNav" class="burger" aria-label="Меню" aria-expanded="' + (state.navOpen ? 'true' : 'false') + '">' +
          '<span></span><span></span><span></span></button>' +
        '<nav style="display:flex; align-items:center; justify-content:center; gap:30px; white-space:nowrap;">' + nav + '</nav>' +
        '<div style="display:flex; align-items:center; justify-content:flex-end; gap:12px;">' + auth + '</div>' +
      '</div></header>';
  }

  /* ---------- footer ---------- */
  function footer() {
    return '<footer style="border-top:1.5px solid var(--line); background:#fff;">' +
      '<div class="foot-row" style="max-width:1180px; margin:0 auto; padding:36px 28px; display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:51px; height:30px; overflow:hidden; flex-shrink:0;"><img src="/logo.png" alt="" style="width:80px; height:80px; max-width:none; margin:-26px 0 0 -15px; display:block;"></span><span style="font-weight:600; font-size:var(--text-body);">internship.uz</span></div>' +
        // Раньше в футере были только логотип и слоган — ноль ссылок. Для платформы,
        // которая просит у несовершеннолетних имя как в паспорте и подписанное согласие
        // родителя, анонимный низ страницы — крупнейшая утечка доверия. Контакты и
        // юрлицо добавляются отдельно: выдумывать их нельзя.
        '<nav style="display:flex; align-items:center; gap:22px; flex-wrap:wrap; font-size:var(--text-caption); color:var(--muted);">' +
          '<a href="#sec-how" data-action="scrollHow" class="nav-link">Как это работает</a>' +
          '<a href="#sec-verify" data-action="scrollVerify" class="nav-link">Верификация</a>' +
          '<a href="' + CONSENT_TEMPLATE_URL + '" download class="nav-link">Шаблон согласия родителя</a>' +
        '</nav>' +
        '<div class="foot-meta" style="font-size:var(--text-caption); color:var(--muted); text-align:right; line-height:1.7;">' +
          'Платформа стажировок для стартапов и студентов Узбекистана<br>' +
          // Живой контакт: родителю, решающему подписать согласие, и компании, решающей
          // заплатить, нужен адрес, по которому отвечает человек.
          '<a href="mailto:markingmark33@gmail.com" style="color:var(--ink); font-weight:600; border-bottom:1.5px solid color-mix(in srgb, var(--ink) 22%, transparent);">markingmark33@gmail.com</a><br>' +
          'Проект в стадии пилота · Ташкент · 2026' +
        '</div>' +
      '</div></footer>';
  }

  /* ---------- HOME ---------- */
  function homeView() {
    var trust = ['Бесплатно на старте', 'Верификация через вуз', 'Официальная практика, не трудоустройство'].map(function (t) {
      return '<span style="display:flex; align-items:center; gap:7px;"><span style="color:var(--accent); font-weight:600;">✓</span>' + t + '</span>';
    }).join('');


    // Блок «Платформа в цифрах» удалён: числа были выдуманные (148 студентов,
    // 41 закрытый проект) и подавались как живая статистика. Показывать такое
    // компании, которая заплатила и увидит внутри пустой каталог, — быстрый способ
    // потерять доверие, то есть ровно то, что платформа и продаёт.

    var hero = '<section class="hero-sec" style="max-width:1180px; margin:0 auto; padding:76px 28px 40px;">' +
      // Одна колонка: правую занимал блок с цифрами, без него сетка оставляла пустоту.
      // Ширина под самую длинную строку заголовка — на 760px «—» переносилось отдельно.
      '<div style="max-width:920px;">' +
        '<div>' +
          // Пилюля с точкой «Платформа стажировок · Узбекистан» убрана: она дублировала
          // подзаголовок и была ровно тем ИИ-штампом, который отмечала критика.
          '<h1 class="hero-up" style="font-weight:700; font-size:var(--text-display); line-height:1.04; letter-spacing:-0.025em; margin:0; animation-delay:.08s;">Стартапам — руки.<br>Студентам и школьникам —<br>первый реальный опыт.</h1>' +
          '<p class="hero-up" style="font-size:var(--text-title); line-height:1.55; color:var(--muted); max-width:500px; margin:22px 0 0; animation-delay:.14s;">internship.uz связывает узбекские стартапы со студентами и школьниками: живые проекты, верифицированные профили и официальный документ о пройденной практике.</p>' +
          '<div class="hero-up" style="display:flex; gap:12px; margin-top:30px; flex-wrap:wrap; animation-delay:.2s;">' +
            '<button data-action="goStartupForm" style="font-size:var(--text-body); font-weight:600; color:#fff; background:var(--accent); border:none; padding:14px 24px; border-radius:11px; cursor:pointer;">Разместить задачу</button>' +
            '<button data-action="goStudent" style="font-size:var(--text-body); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:14px 24px; border-radius:11px; cursor:pointer;">Найти стажировку</button>' +
          '</div>' +
          '<div class="hero-up" style="display:flex; gap:22px; margin-top:26px; flex-wrap:wrap; font-size:var(--text-caption); color:var(--muted); animation-delay:.26s;">' + trust + '</div>' +
        '</div>' +
      '</div></section>';

    var valItem = function (v, dark) {
      var line = dark ? 'rgba(255,255,255,0.12)' : 'var(--line)';
      var descColor = dark ? 'rgba(255,255,255,0.6)' : 'var(--muted)';
      /* Галочка тоже зависит от фона. Здесь уже подстраивались линия и описание,
         а она оставалась базовым --accent — на тёмной карточке это давало 2.91:1
         против нужных 4.5. Осветлённый вариант даёт 6.80. */
      var tick = dark ? 'var(--accent-on-dark)' : 'var(--accent)';
      return '<div style="display:flex; gap:12px; padding:13px 0; border-top:1px solid ' + line + ';"><span style="color:' + tick + '; font-weight:600; margin-top:1px;">✓</span><div><div style="font-weight:600; font-size:var(--text-body);">' + v.title + '</div><div style="font-size:var(--text-caption); color:' + descColor + '; margin-top:2px;">' + v.desc + '</div></div></div>';
    };
    var value = '<section data-reveal style="max-width:1180px; margin:0 auto; padding:56px 28px;">' +
      '<div style="text-align:center; max-width:640px; margin:0 auto 44px;"><h2 style="font-weight:700; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:0;">Каждый получает то, чего ему не хватает</h2></div>' +
      '<div class="g2" style="display:grid; gap:24px;">' +
        '<div data-stagger style="background:#fff; border:1.5px solid var(--line); border-radius:18px; padding:32px;"><div style="display:flex; align-items:center; gap:11px; margin-bottom:8px;"><span style="width:34px; height:34px; border-radius:9px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-body);">◆</span><span style="font-weight:600; font-size:var(--text-title);">Для стартапов</span></div><p style="color:var(--muted); font-size:var(--text-body); margin:0 0 20px;">Ранние команды с ограниченным бюджетом — быстрые руки без затрат на найм.</p>' + startupValue.map(function (v) { return valItem(v, false); }).join('') + '<button data-action="goStartupForm" style="margin-top:22px; width:100%; font-size:var(--text-body); font-weight:600; color:#fff; background:var(--ink); border:none; padding:13px; border-radius:11px; cursor:pointer;">Разместить задачу</button></div>' +
        '<div data-stagger style="background:var(--ink); border:1px solid var(--ink); border-radius:18px; padding:32px; color:#fff;"><div style="display:flex; align-items:center; gap:11px; margin-bottom:8px;"><span style="width:34px; height:34px; border-radius:9px; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-body);">●</span><span style="font-weight:600; font-size:var(--text-title);">Для студентов и школьников</span></div><p style="color:rgba(255,255,255,0.62); font-size:var(--text-body); margin:0 0 20px;">Реальные проекты в резюме и официальный документ — сильный аргумент при поступлении.</p>' + studentValue.map(function (v) { return valItem(v, true); }).join('') + '<button data-action="goStudent" style="margin-top:22px; width:100%; font-size:var(--text-body); font-weight:600; color:var(--ink); background:#fff; border:none; padding:13px; border-radius:11px; cursor:pointer;">Найти стажировку</button></div>' +
      '</div></section>';

    var stepItem = function (s, accent) {
      var circle = accent
        ? 'border:1.5px solid color-mix(in srgb, var(--accent) 40%, #fff); color:var(--accent); background:color-mix(in srgb, var(--accent) 6%, #fff);'
        : 'border:1.5px solid var(--line); background:#fff;';
      return '<div data-stagger style="display:flex; gap:16px; padding-bottom:26px; position:relative;"><div style="flex-shrink:0; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:var(--text-body); ' + circle + '">' + s.n + '</div><div><div style="font-weight:600; font-size:var(--text-body);">' + s.title + '</div><div style="font-size:var(--text-caption); color:var(--muted); margin-top:3px;">' + s.desc + '</div></div></div>';
    };
    var how = '<section id="sec-how" data-reveal style="background:#fff; border-top:1.5px solid var(--line); border-bottom:1.5px solid var(--line);">' +
      '<div style="max-width:1180px; margin:0 auto; padding:64px 28px;"><div style="text-align:center; max-width:640px; margin:0 auto 44px;"><h2 style="font-weight:700; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:0;">Два простых пути навстречу</h2></div>' +
      '<div class="g2" style="display:grid; gap:48px;">' +
        '<div><div style="font-weight:600; font-size:var(--text-body); margin-bottom:20px; display:flex; align-items:center; gap:9px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--ink);"></span>Стартап</div>' + stepsStartup.map(function (s) { return stepItem(s, false); }).join('') + '</div>' +
        '<div><div style="font-weight:600; font-size:var(--text-body); margin-bottom:20px; display:flex; align-items:center; gap:9px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--accent);"></span>Студент</div>' + stepsStudent.map(function (s) { return stepItem(s, true); }).join('') + '</div>' +
      '</div></div></section>';

    var verifyCard = function (q) {
      return '<div data-lift data-stagger style="background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:22px;"><div style="width:36px; height:36px; border-radius:9px; background:color-mix(in srgb, var(--accent) 10%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-body); margin-bottom:14px;">' + q.icon + '</div><div style="font-weight:600; font-size:var(--text-body);">' + q.title + '</div><div style="font-size:var(--text-caption); color:var(--muted); margin-top:5px; line-height:1.5;">' + q.desc + '</div><div style="margin-top:12px; font-size:var(--text-micro); font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.04em;">' + q.tag + '</div></div>';
    };
    var verify = '<section id="sec-verify" data-reveal style="max-width:1180px; margin:0 auto; padding:72px 28px;">' +
      '<div class="g-split" style="display:grid; gap:56px; align-items:center;">' +
        '<div><h2 style="font-weight:700; font-size:clamp(28px,3vw,38px); letter-spacing:-0.02em; margin:0 0 16px;">Профили проверены. Результат — оформлен официально.</h2><p style="font-size:var(--text-body); color:var(--muted); line-height:1.6;">Мы снижаем два главных риска: сомнительное качество исполнителей для компаний и юридическую неопределённость для обеих сторон. Верификация — бесплатная, а практика оформляется как учебная, а не как трудоустройство.</p>' +
          '<div style="margin-top:24px; padding:18px 20px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 20%, #fff); border-radius:14px; font-size:var(--text-caption); line-height:1.55;"><strong style="font-weight:600;">Официальный документ о практике</strong> — студент получает подтверждение пройденной учебной практики, которое можно приложить к резюме или заявке на поступление.</div>' +
          '<div style="margin-top:14px; padding:18px 20px; background:color-mix(in srgb, var(--warn) 8%, #fff); border:1px solid color-mix(in srgb, var(--warn) 26%, #fff); border-radius:14px; font-size:var(--text-caption); line-height:1.55;"><strong style="font-weight:600;">Защита несовершеннолетних</strong> — участникам до 18 лет доступ открывается только после письменного согласия родителя (по законодательству РУз). <a href="' + CONSENT_TEMPLATE_URL + '" download style="font-weight:600; color:var(--accent); border-bottom:1.5px solid color-mix(in srgb, var(--accent) 35%, transparent);">Скачать шаблон согласия</a> — он уже готов, останется подписать.</div>' +
        '</div>' +
        '<div class="g2" style="display:grid; gap:16px;">' + verifyItems.map(verifyCard).join('') + '</div>' +
      '</div></section>';

    var waitlist = '<section data-reveal style="max-width:1180px; margin:0 auto; padding:32px 28px 88px;"><div style="background:var(--ink); border-radius:22px; padding:56px 40px; text-align:center; color:#fff; position:relative; overflow:hidden;"><div style="position:absolute; inset:0; background:radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 45%, transparent), transparent 60%); opacity:0.5;"></div><div style="position:relative;"><h2 style="font-weight:700; font-size:clamp(28px,3.2vw,42px); letter-spacing:-0.02em; margin:0;">Присоединяйтесь к пилоту</h2><p style="font-size:var(--text-body); color:rgba(255,255,255,0.66); max-width:480px; margin:14px auto 0;">Набираем первые 5–10 стартапов и 10–20 студентов. Ранние участники получают бесплатный доступ и приоритет в матчинге.</p><div style="display:flex; gap:12px; justify-content:center; margin-top:30px; flex-wrap:wrap;"><button data-action="goStartupForm" style="font-size:var(--text-body); font-weight:600; color:var(--ink); background:#fff; border:none; padding:14px 26px; border-radius:11px; cursor:pointer;">Разместить задачу</button><button data-action="goStudent" style="font-size:var(--text-body); font-weight:600; color:#fff; background:var(--accent); border:none; padding:14px 26px; border-radius:11px; cursor:pointer;">Найти стажировку</button></div></div></div></section>';

    return '<main class="view-in">' + hero + value + how + verify + waitlist + '</main>';
  }

  /* ---------- вход по одноразовому коду (общий для студента и компании) ---------- */
  function emailStepHtml(title, subtitle) {
    var noClient = !supabase;
    return '<div style="max-width:440px;">' +
      '<a data-action="backToLogin" style="' + S.back + ' display:inline-block; margin:20px 0 4px;">← Назад</a>' +
      '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:10px 0 8px;">' + title + '</h1>' +
      '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 24px;">' + subtitle + '</p>' +
      (noClient ? '<div style="padding:13px 15px; background:color-mix(in srgb, var(--err) 8%, #fff); border:1px solid color-mix(in srgb, var(--err) 22%, #fff); border-radius:12px; margin-bottom:16px; font-size:var(--text-caption); color:var(--err); line-height:1.5;">Supabase не настроен: укажите SUPABASE_URL и SUPABASE_ANON_KEY в int_app.js.</div>' : '') +
      '<div style="display:flex; flex-direction:column; gap:16px;">' +
        inputField('Email', 'semail', 'you@email.com') +
        (state.otp.error ? '<span style="font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.otp.error) + '</span>' : '') +
        '<button data-action="sendOtp"' + (state.otp.loading || noClient ? ' disabled' : '') + ' style="' + S.primary + (state.otp.loading || noClient ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.otp.loading ? 'Отправка…' : 'Получить код') + '</button>' +
      '</div></div>';
  }
  function otpStepHtml() {
    return '<div style="max-width:440px;">' +
      '<a data-action="backToEmail" style="' + S.back + ' display:inline-block; margin:20px 0 4px;">← Изменить email</a>' +
      '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:10px 0 8px;">Введите код</h1>' +
      '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 24px;">Шестизначный код отправлен на <strong style="color:var(--ink);">' + esc(state.otp.email) + '</strong>. Проверьте почту (и папку «Спам»).</p>' +
      '<div style="display:flex; flex-direction:column; gap:16px;">' +
        inputField('Код из письма', 'otpInput', '000000') +
        (state.otp.error ? '<span style="font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.otp.error) + '</span>' : '') +
        '<button data-action="verifyOtp"' + (state.otp.loading ? ' disabled' : '') + ' style="' + S.primary + (state.otp.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.otp.loading ? 'Проверка…' : 'Подтвердить и войти') + '</button>' +
        '<button data-action="resendOtp"' + (state.otp.loading ? ' disabled' : '') + ' style="' + S.ghost + (state.otp.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">Отправить код повторно</button>' +
      '</div></div>';
  }

  /* ---------- STUDENT FORM ---------- */
  function studentView() {
    var inner = '';
    if (state.studentStep === 'login') {
      inner = '<div style="max-width:440px;">' +
        '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:20px 0 8px;">Найти стажировку</h1>' +
        '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 28px;">Быстрый вход без барьеров. При входе через Telegram имя и фамилия подтянутся автоматически — останется только подтвердить их.</p>' +
        '<button data-action="loginTelegram" class="tg-btn"' + (state.tgAuth.loading ? ' disabled' : '') + '>' +
          '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>' +
          '<span>' + (state.tgAuth.loading ? 'Открываем Telegram…' : 'Войти через Telegram') + '</span>' +
        '</button>' +
        (state.tgAuth.loading ? '<div style="margin-top:12px; text-align:center; font-size:var(--text-caption); color:var(--muted);">Проверяем вход через Telegram…</div>' : '') +
        (state.tgAuth.error ? '<div style="margin-top:12px; padding:11px 14px; background:color-mix(in srgb, var(--err) 8%, #fff); border:1px solid color-mix(in srgb, var(--err) 22%, #fff); border-radius:10px; font-size:var(--text-caption); color:var(--err); line-height:1.5;">' + esc(state.tgAuth.error) + '</div>' : '') +
        '<div style="display:flex; align-items:center; gap:14px; margin:20px 0;"><div style="flex:1; height:1px; background:var(--line);"></div><span style="font-size:var(--text-caption); color:var(--muted);">или</span><div style="flex:1; height:1px; background:var(--line);"></div></div>' +
        '<button data-action="continueEmail" style="width:100%; ' + S.ghost + '">Продолжить по email</button>' +
        '<div style="margin-top:28px; padding-top:22px; border-top:1.5px solid var(--line);"><div style="font-size:var(--text-micro); font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:16px;">Четыре шага регистрации</div>' +
          '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:6px;">' +
            stepDot('1', 'Вход', true) + arrow() + stepDot('2', 'Контакты', false) + arrow() + stepDot('3', 'Личные данные', false) + arrow() + stepDot('4', 'Тестирование', false) +
          '</div></div></div>';
    } else if (state.studentStep === 'email') {
      inner = emailStepHtml('Вход по email', 'Подходит и студентам, и школьникам. Укажите email — пришлём одноразовый код подтверждения.');
    } else if (state.studentStep === 'otp') {
      inner = otpStepHtml();
    } else if (state.studentStep === 'profileContacts') {
      inner = '<div>' +
        '<div style="display:inline-flex; align-items:center; gap:8px; font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:5px 11px; border-radius:7px; text-transform:uppercase; letter-spacing:0.05em; margin-top:20px;">Шаг 1 из 2 · Контакты</div>' +
        '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:14px 0 8px;">Как с вами связаться</h1>' +
        '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 24px;">Email нужен для входа и уведомлений, Telegram — необязательно, только для связи.</p>' +
        (state.tgDraft ? '<div style="display:flex; gap:11px; align-items:flex-start; padding:13px 15px; background:color-mix(in srgb, var(--tg) 8%, #fff); border:1px solid color-mix(in srgb, var(--tg) 22%, #fff); border-radius:12px; margin-bottom:20px;"><span style="color:var(--tg); font-weight:600;">✈</span><span style="font-size:var(--text-caption); color:var(--muted); line-height:1.5;">Данные подтянуты из Telegram. Проверьте email и при необходимости исправьте.</span></div>' : '') +
        '<div style="display:flex; flex-direction:column; gap:18px;">' +
          inputField('Email', 'semail', 'you@email.com') +
          inputField('Telegram для связи <span style="color:var(--muted); font-weight:400;">(необязательно)</span>', 'tg', '@username', 'Используется только как способ связи, не как отображаемое имя в профиле.') +
          (state.profileSave.error ? '<span style="font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.profileSave.error) + '</span>' : '') +
          '<button data-action="goProfileDetails" style="margin-top:4px; ' + S.primary + '">Продолжить</button>' +
        '</div></div>';
    } else if (state.studentStep === 'profileDetails') {
      inner = '<div>' +
        '<a data-action="backToProfileContacts" style="' + S.back + ' display:inline-block; margin:20px 0 4px;">← Назад</a>' +
        '<div style="display:inline-flex; align-items:center; gap:8px; font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:5px 11px; border-radius:7px; text-transform:uppercase; letter-spacing:0.05em; margin-top:14px;">Шаг 2 из 2 · Личные данные</div>' +
        '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:14px 0 8px;">Заполните профиль</h1>' +
        '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 24px;">Укажите имя и фамилию <strong style="color:var(--ink);">как в паспорте или студенческом</strong> — именно это имя попадёт в официальный документ о практике.</p>' +
        '<div style="display:flex; flex-direction:column; gap:18px;">' +
          '<label style="' + S.label + '"><span style="' + S.labelSpan + '">Ваш статус</span><select data-field="status" style="' + S.input + '">' + statusOptions() + '</select><span style="font-size:var(--text-micro); color:var(--muted);">Если вам ещё нет 18 — для доступа к каталогу потребуется согласие родителя.</span></label>' +
          '<div class="g2" style="display:grid; gap:14px;">' + inputField('Имя <span style="color:var(--muted); font-weight:400;">(как в документах)</span>', 'sfirst', 'Азиз') + inputField('Фамилия <span style="color:var(--muted); font-weight:400;">(как в документах)</span>', 'slast', 'Каримов') + '</div>' +
          (state.profileSave.error ? '<span style="font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.profileSave.error) + '</span>' : '') +
          '<button data-action="saveStudentProfile"' + (state.profileSave.loading ? ' disabled' : '') + ' style="margin-top:4px; ' + S.primary + (state.profileSave.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.profileSave.loading ? 'Сохранение…' : 'Сохранить и завершить') + '</button>' +
        '</div></div>';
    } else { // done
      var body = isMinor()
        ? '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0 0 10px;">Профиль сохранён</h1><p style="color:var(--muted); font-size:var(--text-body); max-width:460px; margin:0 auto 8px;">Имя для официальных документов: <strong style="color:var(--ink);">' + esc(studentName()) + '</strong></p><p style="color:var(--muted); font-size:var(--text-body); max-width:460px; margin:0 auto 28px;">Дальше в личном кабинете загрузите <strong style="color:var(--ink);">справку о месте учёбы</strong> и <strong style="color:var(--ink);">согласие родителя</strong>. После ручной проверки откроется каталог задач.</p>'
        : '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0 0 10px;">Профиль сохранён</h1><p style="color:var(--muted); font-size:var(--text-body); max-width:460px; margin:0 auto 8px;">Имя для официальных документов: <strong style="color:var(--ink);">' + esc(studentName()) + '</strong></p><p style="color:var(--muted); font-size:var(--text-body); max-width:440px; margin:0 auto 28px;">Дальше можно подтвердить место учёбы и пройти ИИ-тест — статусы доверия добавятся к профилю.</p>';
      inner = '<div style="text-align:center; padding-top:56px;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-h1); margin:0 auto 22px;">✓</div>' + body + '<button data-action="goCabinet" style="' + S.dark + '">Перейти в личный кабинет</button></div>';
    }
    return '<main class="view-in" style="max-width:640px; margin:0 auto; padding:56px 28px 88px;"><a data-action="goHome" style="' + S.back + '">← На главную</a>' + inner + '</main>';
  }
  var STATUS_OPTS = ['', 'Студент вуза (18+)', 'Студент колледжа (18+)', 'Школьник, 10–11 класс (до 18)', 'Лицей, 1–2 курс (до 18)'];
  function statusOptions(selected) {
    var sel0 = selected == null ? state.form.status : selected;
    return STATUS_OPTS.map(function (o) { var sel = sel0 === o ? ' selected' : ''; return '<option' + sel + '>' + (o || 'Выберите…') + '</option>'; }).join('');
  }
  // Категория учебного заведения по статусу — определяет список мест учёбы и сброс справки при смене.
  function statusCategory(status) {
    if (/вуза/.test(status || '')) return 'university';
    if (/колледжа/.test(status || '')) return 'college';
    if (/Школьник/.test(status || '')) return 'school';
    if (/Лицей/.test(status || '')) return 'lyceum';
    return '';
  }
  var INSTITUTIONS_BY_CATEGORY = {
    university: ['ТУИТ (Университет информационных технологий)', 'Национальный университет Узбекистана (НУУз)', 'Ташкентский государственный экономический университет', 'INHA University in Tashkent', 'Westminster International University in Tashkent', 'УзГУМЯ', 'Turin Polytechnic University in Tashkent', 'Ташкентский финансовый институт', 'Webster University in Tashkent', 'Amity University Tashkent', 'Другой вуз'],
    college: ['IT-колледж', 'Технический колледж', 'Экономический колледж', 'Медицинский колледж', 'Педагогический колледж', 'Другой колледж'],
    school: ['Школа №1', 'Школа №6', 'Школа №64', 'Школа №110', 'Школа №157', 'Специализированная школа', 'Другая школа'],
    lyceum: ['Президентский лицей', 'Академический лицей при вузе', 'IT-лицей', 'Другой лицей']
  };
  function institutionOptions(status, selected) {
    var cat = statusCategory(status);
    var list = INSTITUTIONS_BY_CATEGORY[cat] || [];
    return '<option value=""' + (selected ? '' : ' selected') + '>Выберите…</option>' +
      list.map(function (o) { return '<option value="' + esc(o) + '"' + (selected === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
      (selected && list.indexOf(selected) === -1 ? '<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>' : '');
  }
  var SPECIALTIES = ['Разработка / программирование', 'Дизайн (UI/UX, графика)', 'Маркетинг', 'SMM и контент', 'Аналитика данных', 'Тестирование (QA)', 'Копирайтинг', 'Проектный менеджмент'];
  // Профиль компании: направления для мэтчинга со студентами в каталоге.
  var FOCUS_AREAS = ['Frontend', 'Backend', 'Full-stack', 'UI/UX Дизайн', 'Мобильная разработка', 'Маркетинг / SMM', 'Аналитика данных', 'Тестирование (QA)'];
  var MEETING_CADENCE_OPTIONS = [['none', 'Без созвонов (только текст)'], ['weekly', 'Раз в неделю'], ['daily', 'Ежедневные созвоны']];
  var DURATION_OPTIONS = [['2w', '2 недели'], ['1m', '1 месяц'], ['3m', '3 месяца']];
  function stepDot(n, label, active) {
    var c = active ? 'background:var(--accent); color:#fff;' : 'background:#fff; border:1.5px solid var(--line); color:var(--muted);';
    return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:9px; text-align:center;"><span style="width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:var(--text-caption); flex-shrink:0; ' + c + '">' + n + '</span><span style="font-size:var(--text-micro); font-weight:600; line-height:1.3;">' + label + '</span></div>';
  }
  function arrow() { return '<span style="margin-top:9px; color:var(--muted); font-size:var(--text-caption);">→</span>'; }

  /* ---------- COMPANY FORM ---------- */
  function companyView() {
    var inner;
    // Заявку подаёт залогиненная компания: без аккаунта её нельзя привязать к владельцу,
    // а значит и переписку по откликам показать некому. Роль ещё не назначена — она появится
    // вместе с заявкой, поэтому здесь смотрим только на наличие сессии.
    if (!state.companyProfile && !state.session) {
      if (state.companyStep === 'otp') {
        inner = otpStepHtml();
      } else {
        inner = emailStepHtml('Вход для компаний',
          'Укажите корпоративную почту — пришлём одноразовый код. Аккаунт нужен, чтобы вести переписку со студентами с любого устройства.');
      }
      return '<main class="view-in" style="max-width:640px; margin:0 auto; padding:56px 28px 88px;"><a data-action="goHome" style="' + S.back + '">← На главную</a>' + inner + '</main>';
    }
    if (!state.companyProfile) {
      inner = '<div>' +
        '<div style="display:inline-flex; align-items:center; gap:8px; font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:5px 11px; border-radius:7px; text-transform:uppercase; letter-spacing:0.05em; margin-top:20px;">Шаг 1 · Подтверждение профиля</div>' +
        '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:14px 0 8px;">Заявка на подтверждение компании</h1>' +
        '<p style="color:var(--muted); font-size:var(--text-body); margin:0 0 28px;">На старте профили компаний подтверждаются вручную — так мы защищаем студентов. Проверяем госреестр, корпоративный домен и созваниваемся с командой.</p>' +
        '<div style="display:flex; flex-direction:column; gap:18px;">' +
          inputField('Название компании', 'company', 'Напр. GreenTech Tashkent LLC') +
          '<div class="g2" style="display:grid; gap:14px;">' + inputField('ИНН <span style="color:var(--muted); font-weight:400;">(госреестр)</span>', 'inn', '9 цифр') + inputField('Руководитель', 'director', 'ФИО по реестру') + '</div>' +
          inputField('Корпоративная почта <span style="color:var(--muted); font-weight:400;">(@домен, необязательно)</span>', 'corpEmail', 'you@company.uz') +
          inputField('LinkedIn или соцсети компании <span style="color:var(--muted); font-weight:400;">(необязательно)</span>', 'linkedin', 'Ссылка на профиль представителя или страницу') +
          '<div class="g2" style="display:grid; gap:14px;">' + inputField('Контактное лицо', 'contact', 'Имя') + inputField('Телефон для созвона', 'phone', '+998 ...') + '</div>' +
          '<div style="display:flex; gap:11px; align-items:flex-start; padding:14px 16px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 18%, #fff); border-radius:12px;"><span style="color:var(--accent); font-weight:600;">ⓘ</span><span style="font-size:var(--text-caption); color:var(--muted); line-height:1.5;">Для первых компаний обязателен короткий созвон с командой платформы — это даёт максимальное доверие для студентов. Занимает 10–15 минут.</span></div>' +
          (state.companySubmit.error ? '<span style="font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.companySubmit.error) + '</span>' : '') +
          '<button data-action="submitCompany"' + (state.companySubmit.loading ? ' disabled' : '') + ' style="margin-top:4px; ' + S.primary + (state.companySubmit.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (state.companySubmit.loading ? 'Отправка…' : 'Отправить заявку') + '</button>' +
          '<p style="font-size:var(--text-micro); color:var(--muted); text-align:center; margin:0;">Участие бесплатно на старте. Задачи можно размещать после подтверждения профиля.</p>' +
        '</div></div>';
    } else {
      inner = '<div style="text-align:center; padding-top:60px;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-h1); margin:0 auto 22px;" class="pop-in">✓</div><h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0 0 10px;">Заявка отправлена</h1><p style="color:var(--muted); font-size:var(--text-body); max-width:440px; margin:0 auto 28px;">Сверим данные в госреестре и по корпоративному домену, затем свяжемся для короткого созвона. Обычно 1–2 дня. Профиль компании уже доступен в личном кабинете.</p><div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;"><button data-action="goCabinet" style="' + S.primary + '">Перейти в профиль компании</button><button data-action="goVacancies" style="' + S.ghost + '">Мои вакансии</button></div></div>';
    }
    return '<main class="view-in" style="max-width:640px; margin:0 auto; padding:56px 28px 88px;"><a data-action="goHome" style="' + S.back + '">← На главную</a>' + inner + '</main>';
  }

  /* ---------- catalog cards ---------- */
  function studentCard(s) {
    return '<div data-lift style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:20px;"><div style="display:flex; align-items:center; justify-content:space-between;"><div style="width:44px; height:44px; border-radius:11px; background:color-mix(in srgb, var(--accent) 11%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:var(--text-body);">' + s.initials + '</div><span style="font-size:var(--text-micro); font-weight:600; color:var(--accent);">✓ verified</span></div><div style="font-weight:600; font-size:var(--text-body); margin-top:14px;">' + s.name + '</div><div style="font-size:var(--text-caption); color:var(--muted);">' + s.school + '</div><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;">' + s.skills.map(function (sk) { return '<span style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:var(--bg); border:1.5px solid var(--line); padding:4px 9px; border-radius:6px;">' + sk + '</span>'; }).join('') + '</div><div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:14px; border-top:1.5px solid var(--line);"><span style="font-size:var(--text-micro); color:var(--muted);">ИИ-тест: <strong style="color:var(--ink);">' + s.score + '</strong></span><button style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ink); border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Пригласить</button></div></div>';
  }
  // Строка из БД -> объект для gigCard (все поля экранируем, данные вводят компании).
  function gigView(r) {
    var name = (r.company_name || 'Компания').trim();
    var initials = name.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '◆';
    return {
      id: r.id, companyAppId: r.company_app_id,
      initials: esc(initials), title: esc(r.title || ''), format: esc(r.format || 'Формат не указан'),
      company: esc(name), desc: esc(r.description || ''), duration: esc(r.duration || '—'), slots: esc(String(r.slots || '1'))
    };
  }
  // Название компании в карточке задачи ведёт на её витрину.
  function companyLink(g) {
    if (!g.companyAppId) return g.company;
    return '<a data-action="openCompanyProfile" data-company-id="' + esc(g.companyAppId) + '" data-back="catalog" style="cursor:pointer; color:var(--muted); border-bottom:1.5px solid var(--line);">' + g.company + '</a>';
  }
  // Кнопка отклика меняет смысл: гость -> вход, уже откликнулся -> чат, компания -> ничего.
  function gigActionHtml(gigId) {
    var base = 'font-size:var(--text-caption); font-weight:600; border:none; padding:10px 16px; border-radius:9px; cursor:pointer; flex-shrink:0;';
    if (state.authRole === 'company') return '';
    var applied = applicationForGig(gigId);
    if (applied) {
      return '<button class="gig-action" data-action="openChat" data-app-id="' + esc(applied.id) + '" style="' + base + ' color:var(--ink); background:var(--bg); border:1.5px solid var(--line);">Открыть чат</button>';
    }
    var st = state.applyState[gigId] || {};
    var btn = '<button class="gig-action" data-action="applyToGig" data-gig-id="' + esc(gigId) + '"' + (st.loading ? ' disabled' : '') +
      ' style="' + base + ' color:#fff; background:var(--accent);' + (st.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' +
      (st.loading ? 'Отправляем…' : 'Откликнуться') + '</button>';
    if (!st.error) return btn;
    return '<div class="gig-action" style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0;">' + btn +
      '<span style="font-size:var(--text-micro); color:var(--err); font-weight:600; max-width:180px; text-align:right;">' + esc(st.error) + '</span></div>';
  }
  function gigCard(g) {
    return '<div data-lift class="gig-card" style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:22px; display:flex; gap:18px; align-items:flex-start;"><div style="width:46px; height:46px; border-radius:12px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:var(--text-body); flex-shrink:0;">' + g.initials + '</div><div style="flex:1;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-weight:600; font-size:var(--text-body);">' + g.title + '</span><span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 8px; border-radius:6px;">' + g.format + '</span></div><div style="font-size:var(--text-caption); color:var(--muted); margin-top:2px;">' + companyLink(g) + '</div><div style="font-size:var(--text-caption); color:var(--muted); margin-top:10px; line-height:1.5;">' + g.desc + '</div><div style="display:flex; gap:18px; margin-top:12px; font-size:var(--text-micro); color:var(--muted);"><span>⏱ ' + g.duration + '</span><span>👥 нужно ' + g.slots + '</span></div></div>' + gigActionHtml(g.id) + '</div>';
  }
  function minorLock(title) {
    var c = docStat('consent');
    var action;
    if (c === 'pending') action = '<div style="display:inline-flex; align-items:center; gap:8px; font-size:var(--text-caption); font-weight:600; color:var(--warn); background:color-mix(in srgb, var(--warn) 14%, #fff); padding:10px 16px; border-radius:10px;"><span style="width:7px; height:7px; border-radius:50%; background:var(--warn);"></span>Согласие на проверке · обычно 1–2 дня</div>';
    else action = '<button data-action="openConsentDoc" style="' + S.primary.replace('padding:15px', 'padding:13px 24px') + '">' + (c === 'rejected' ? 'Загрузить согласие заново' : 'Загрузить согласие родителя') + '</button>';
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:52px 32px; text-align:center;"><div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--warn) 16%, #fff); display:flex; align-items:center; justify-content:center; font-size:var(--text-h1); margin:0 auto 20px;">🔒</div><h3 style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em; margin:0 0 10px;">' + title + '</h3><p style="color:var(--muted); font-size:var(--text-body); max-width:440px; margin:0 auto 22px; line-height:1.55;">Вам ещё нет 18 лет. Доступ откроется после загрузки и ручной проверки согласия родителя.</p>' + action + '</div>';
  }

  /* ---------- CATALOG ---------- */
  function catalogView() {
    var role = state.authRole;
    // Компания сюда попасть не должна (нав-ссылки нет), но вид мог остаться в состоянии
    // после смены роли — показываем ей вакансии, а не пустую витрину студентов.
    if (role === 'company') return vacanciesView();
    // Витрины студентов нет: компания видит студента только после его отклика. Пока это так,
    // каталог у всех — это каталог задач. Ветка со студентами ниже сохранена: она понадобится,
    // если появится опт-ин витрина, где студент сам включает себе показ.
    var studentsActive = false;
    // несовершеннолетний видит замок, пока согласие родителя не подтверждено
    var minorLocked = role === 'student' && isMinor() && docStat('consent') !== 'approved';

    var catTitle = 'Каталог задач';
    var catSub = 'Задачи от стартапов и компаний';
    var head = '<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:26px;">' +
      '<div><h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0;">' + catTitle + '</h1><div style="font-size:var(--text-caption); color:var(--muted); margin-top:6px;">' + catSub + '</div></div>';
    // Переключателя «Студенты / Задачи» здесь больше нет: показывать вкладку, которая
    // всегда пуста, — значит выдавать отсутствующую функцию за сломанную.
    if (role === 'company') {
      head += companyStatus() === 'approved'
        ? '<button data-action="openGigForm" style="font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--accent); border:none; padding:11px 18px; border-radius:10px; cursor:pointer;">Разместить задачу</button>'
        : '<button disabled style="font-size:var(--text-caption); font-weight:600; color:var(--muted); background:var(--bg); border:1.5px solid var(--line); padding:11px 18px; border-radius:10px; cursor:not-allowed;">Разместить задачу (после подтверждения)</button>';
    }
    head += '</div>';

    // sidebar
    var sidebar;
    if (role === 'student') {
      /* Раньше здесь безусловно стояло «✓ Профиль подтверждён» синим: текст не
         спрашивал состояние вообще. Несовершеннолетний с отклонённым или ещё не
         загруженным согласием родителя видел в каталоге подтверждение, которого
         нет, — и это на той самой группе, ради которой согласие и собирается.
         Такого статуса у студента к тому же не существует: verifyStatus() даёт
         «Профиль активен» либо состояние согласия. Берём текст и цвет оттуда же,
         откуда их берёт соседняя ветка компании. Галочка — только у ok-состояния,
         иначе она утверждает то же самое молча. */
      var svText = verifyStatus();
      var svColor = verifyColor();
      var svTick = svColor === 'var(--ok)' ? '✓ ' : '';
      sidebar = '<aside class="cat-aside" style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:22px; position:sticky; top:88px;"><div style="display:flex; align-items:center; gap:12px;">' + avatarHtml(46, 12) + '<div><div style="font-weight:600; font-size:var(--text-body);">' + esc(studentName()) + '</div><div style="font-size:var(--text-micro); color:' + svColor + '; font-weight:600;">' + svTick + esc(svText) + '</div></div></div></aside>';
    } else if (role === 'company') {
      var scs = companyStatus();
      /* Текст и цвет здесь дословно повторяли verifyStatus()/verifyColor() для
         роли компании. Пока совпадало, но две копии одного правила расходятся
         при первой же правке — а расхождение в статусе верификации выглядит
         именно так, как выглядел баг в студенческой ветке выше. */
      var scColor = verifyColor();
      var scText = verifyStatus();
      var scPost = scs === 'approved'
        ? '<button data-action="openGigForm" style="margin-top:18px; width:100%; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--accent); border:none; padding:12px; border-radius:10px; cursor:pointer;">Разместить задачу</button>'
        : '<button disabled style="margin-top:18px; width:100%; font-size:var(--text-caption); font-weight:600; color:var(--muted); background:var(--bg); border:1.5px solid var(--line); padding:12px; border-radius:10px; cursor:not-allowed;">Разместить задачу (после подтверждения)</button>';
      sidebar = '<aside class="cat-aside" style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:22px; position:sticky; top:88px;"><div style="display:flex; align-items:center; gap:12px;"><div style="width:46px; height:46px; border-radius:12px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-title);">◆</div><div><div style="font-weight:600; font-size:var(--text-body);">' + esc(companyName()) + '</div><div style="display:inline-flex; align-items:center; gap:5px; font-size:var(--text-micro); color:' + scColor + '; font-weight:600;"><span style="width:6px; height:6px; border-radius:50%; background:' + scColor + ';"></span>' + scText + '</div></div></div><div style="margin-top:18px; padding-top:18px; border-top:1.5px solid var(--line);"><div style="font-size:var(--text-micro); color:var(--muted);">Что дальше</div><div style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin-top:2px;">Отбирайте подходящих студентов и приглашайте их в свои задачи.</div></div>' + scPost + '<button data-action="goCabinet" style="margin-top:10px; width:100%; font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:11px; border-radius:10px; cursor:pointer;">Профиль компании</button></aside>';
    } else {
      sidebar = '<div aria-hidden="true"></div>';
    }

    // listings
    var emptyCard = function (title, text) {
      return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:52px 32px; text-align:center;">' +
        '<div style="width:56px; height:56px; border-radius:15px; background:var(--bg); display:flex; align-items:center; justify-content:center; font-size:var(--text-h2); margin:0 auto 18px;">📭</div>' +
        '<h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0 0 8px;">' + title + '</h3>' +
        '<p style="color:var(--muted); font-size:var(--text-caption); max-width:420px; margin:0 auto; line-height:1.55;">' + text + '</p></div>';
    };
    var listings;
    if (studentsActive) {
      listings = catalogStudents.length
        ? '<div class="g2" style="display:grid; gap:16px;">' + catalogStudents.map(studentCard).join('') + '</div>'
        : emptyCard('Пока нет студентов', 'Здесь появятся верифицированные студенты, как только они пройдут регистрацию.');
    } else if (minorLocked) {
      listings = minorLock('Каталог заблокирован');
    } else {
      // Каталог — это «куда можно откликнуться». Обычному студенту закрытые задачи
      // не приходят вовсе (политика), а админу приходят все — здесь их и отсеиваем.
      var openGigs = state.gigs.filter(function (r) { return r.is_open !== false; });
      listings = openGigs.length
        ? '<div style="display:flex; flex-direction:column; gap:14px;">' + openGigs.map(function (r) { return gigCard(gigView(r)); }).join('') + '</div>'
        : emptyCard('Пока нет задач', 'Компании ещё не разместили задачи. Загляните позже — здесь появятся реальные проекты.');
    }

    return '<main class="view-in" style="max-width:1180px; margin:0 auto; padding:40px 28px 88px;">' + head +
      '<div class="g-cat" style="display:grid; gap:24px; align-items:start;">' + sidebar + '<div>' + listings + '</div></div></main>';
  }

  /* ---------- STUDENT CABINET ---------- */
  function studentCabinetView() {
    var sp = state.studentProfile || {};
    var minor = isMinor();
    var cs = docStat('consent');
    var statusColor = !minor ? 'var(--ok)' : (cs === 'approved' ? 'var(--ok)' : cs === 'pending' ? 'var(--warn)' : 'var(--err)');
    var card = 'background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:24px;';
    var cardTitle = 'font-weight:600; font-size:var(--text-body); margin-bottom:4px;';
    var row = function (label, right) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1.5px solid var(--line);"><span style="font-size:var(--text-caption); color:var(--muted);">' + label + '</span>' + right + '</div>';
    };
    var val = function (v) { return '<span style="font-size:var(--text-caption); font-weight:600; text-align:right; ' + S.wrap + '">' + esc(v || '—') + '</span>'; };
    var editBtn = function (type, i) { return '<button class="icon-btn" data-action="openItemModal" data-item-type="' + type + '" data-item-index="' + i + '" title="Изменить" style="' + S.iconBtn + '">' + icon('pencil', 13) + '</button>'; };
    var removeBtn = function (type, i) { return '<button class="icon-btn" data-action="removeItem" data-item-type="' + type + '" data-item-index="' + i + '" title="Удалить" style="' + S.iconBtn + ' color:var(--err);">' + icon('x', 13) + '</button>'; };
    var addBtn = function (type, label) { return '<button data-action="openItemModal" data-item-type="' + type + '" style="display:inline-flex; align-items:center; gap:7px; font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ink); border:none; padding:8px 14px; border-radius:9px; cursor:pointer;">' + icon('plus', 13) + label + '</button>'; };
    var chipIconStyle = 'width:20px; height:20px; border-radius:6px; border:none; background:none; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; padding:0;';
    var chipEditBtn = function (type, i) { return '<button class="icon-btn" data-action="openItemModal" data-item-type="' + type + '" data-item-index="' + i + '" title="Изменить" style="' + chipIconStyle + ' color:var(--muted);">' + icon('pencil', 12) + '</button>'; };
    var chipRemoveBtn = function (type, i) { return '<button class="icon-btn" data-action="removeItem" data-item-type="' + type + '" data-item-index="' + i + '" title="Удалить" style="' + chipIconStyle + ' color:var(--err);">' + icon('x', 12) + '</button>'; };
    var fileBadge = function (file) { return (file && file.url) ? '<a href="' + esc(file.url) + '" target="_blank" rel="noopener" title="' + esc(file.name || 'файл') + '" style="color:var(--muted); display:inline-flex;">' + icon('paperclip', 13) + '</a>' + modBadge(file.path) : ''; };
    var editFieldBtn = function (field) { return '<button class="icon-btn" data-action="startFieldEdit" data-field-edit="' + field + '" title="Изменить" style="' + chipIconStyle + ' color:var(--muted); margin-left:6px;">' + icon('pencil', 12) + '</button>'; };

    var availTag = '<span style="display:inline-flex; align-items:center; gap:6px; font-size:var(--text-micro); font-weight:600; color:' + availColor(sp.availability) + '; background:color-mix(in srgb, ' + availColor(sp.availability) + ' 12%, #fff); padding:4px 11px; border-radius:999px;"><span style="width:6px; height:6px; border-radius:50%; background:' + availColor(sp.availability) + ';"></span>' + esc(availLabel(sp.availability)) + '</span>' +
      '<select data-select-action="setAvailability" style="font-size:var(--text-body); font-weight:600; color:var(--muted); background:#fff; border:1.5px solid var(--line); padding:5px 8px; border-radius:8px; cursor:pointer;">' + availOptions(sp.availability) + '</select>';

    var avatarUp = state.avatarUpload;
    var avatarBlock = '<div style="position:relative; flex-shrink:0;">' + avatarHtml(64, 18) +
      '<label title="Изменить фото" style="position:absolute; right:-6px; bottom:-6px; width:24px; height:24px; border-radius:50%; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; border:2px solid #fff;">' + icon('camera', 12) +
        '<input data-avatar-input type="file" accept="image/*" style="display:none;"></label></div>';

    var profile = '<div style="' + card + ' display:flex; align-items:center; gap:18px; flex-wrap:wrap;">' +
      avatarBlock +
      '<div style="min-width:0; flex:1;"><div style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em;">' + esc(studentName()) + '</div>' +
      '<div style="display:inline-flex; align-items:center; gap:7px; font-size:var(--text-caption); font-weight:600; color:' + statusColor + '; margin-top:5px;"><span style="width:7px; height:7px; border-radius:50%; background:' + statusColor + ';"></span>' + esc(verifyStatus()) + (sp.institution ? ' · ' + esc(sp.institution) : '') + '</div>' +
      (avatarUp.error ? '<div style="font-size:var(--text-micro); color:var(--err); margin-top:4px;">' + esc(avatarUp.error) + '</div>' : '') +
      (avatarUp.loading ? '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:4px;">Загрузка фото…</div>' : '') +
      '<div style="display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;">' + availTag + '</div></div></div>';

    // Строка с инлайн-редактированием (карандаш): email, статус, место учёбы.
    // extra — необязательная приписка справа от значения (бейдж/кнопка). Нужна, чтобы не
    // заводить вторую строку под то же самое поле: у почты это пометка про вход.
    var editableRow = function (field, label, kind, extra) {
      if (state.fieldEditConfirm && state.fieldEditConfirm.field === field) {
        return '<div style="padding:12px 0; border-top:1.5px solid var(--line);">' +
          '<div style="display:flex; align-items:flex-start; gap:8px; font-size:var(--text-micro); color:var(--warn); font-weight:600; margin-bottom:10px;">' + icon('warn', 15) + '<span>' + esc(state.fieldEditConfirm.warning) + '</span></div>' +
          '<div style="display:flex; gap:8px;"><button data-action="confirmFieldEdit" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--warn); border:none; padding:7px 14px; border-radius:8px; cursor:pointer;">Подтвердить</button>' +
          '<button data-action="cancelFieldEditConfirm" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:7px 14px; border-radius:8px; cursor:pointer;">Отмена</button></div></div>';
      }
      if (state.fieldEdit === field) {
        var inputHtml;
        if (kind === 'status') inputHtml = '<select id="field-edit-input" style="' + S.field + '">' + statusOptions(sp.status) + '</select>';
        else if (kind === 'institution') inputHtml = (statusCategory(sp.status) ? '<select id="field-edit-input" style="' + S.field + '">' + institutionOptions(sp.status, sp.institution) + '</select>' : '<div style="font-size:var(--text-micro); color:var(--muted);">Сначала укажите статус.</div>');
        else inputHtml = '<input id="field-edit-input" value="' + esc(sp[field] || '') + '" style="' + S.field + '">';
        return '<div style="padding:12px 0; border-top:1.5px solid var(--line);"><div style="font-size:var(--text-caption); color:var(--muted); margin-bottom:7px;">' + label + '</div>' +
          '<div style="display:flex; gap:8px; align-items:center;">' + inputHtml +
          '<button class="icon-btn" data-action="saveFieldEdit" title="Сохранить" style="' + chipIconStyle + ' color:var(--ok);">' + icon('check', 14) + '</button>' +
          '<button class="icon-btn" data-action="cancelFieldEdit" title="Отмена" style="' + chipIconStyle + '">' + icon('x', 14) + '</button></div>' +
          (state.fieldEditError ? '<div style="font-size:var(--text-micro); color:var(--err); margin-top:6px;">' + esc(state.fieldEditError) + '</div>' : '') + '</div>';
      }
      return row(label, '<span style="display:inline-flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:2px;">' + val(sp[field]) + editFieldBtn(field) + (extra || '') + '</span>');
    };
    // Кнопка-ссылка в строке контактов: мелкая, не перетягивает внимание с данных.
    var linkBtnStyle = 'font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:5px 11px; border-radius:8px; cursor:pointer; margin-left:8px; white-space:nowrap;';
    var badge = function (text, color, title) {
      return '<span' + (title ? ' title="' + esc(title) + '"' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:' + color +
        '; background:color-mix(in srgb, ' + color + ' 12%, #fff); padding:2px 8px; border-radius:999px; margin-left:6px; white-space:nowrap;">' + esc(text) + '</span>';
    };
    var lk = state.links;

    // Telegram: привязанный (подтверждён подписью) отличаем от вписанного руками.
    var tgCell;
    if (lk.telegram_id) {
      tgCell = '<span style="display:inline-flex; align-items:center; justify-content:flex-end; flex-wrap:wrap;">' +
        val(lk.telegram_username ? '@' + lk.telegram_username : (sp.tg || '')) +
        badge('вход', 'var(--ok)', 'Подтверждён через Telegram — по нему можно входить') + '</span>';
    } else {
      tgCell = '<span style="display:inline-flex; align-items:center; justify-content:flex-end; flex-wrap:wrap;">' + val(sp.tg) +
        '<button data-action="linkTelegram"' + (state.tgAuth.loading ? ' disabled' : '') + ' style="' + linkBtnStyle + '">' +
        (state.tgAuth.loading ? 'Открываем…' : 'Привязать') + '</button></span>';
    }

    // Пометка про вход живёт в той же строке, что и почта: заводить под это отдельную
    // строку — значит показать в одном блоке два разных email и запутать.
    var el = state.emailLink;
    var emailMark;
    if (lk.login_is_synthetic) {
      emailMark = '<button data-action="startLinkEmail" style="' + linkBtnStyle + '">Сделать входом</button>';
    } else if (lk.login_email && sp.email && lk.login_email.toLowerCase() === sp.email.toLowerCase()) {
      emailMark = badge('вход', 'var(--ok)');
    } else if (lk.login_email) {
      // Контактная почта и логин разошлись — показываем, каким адресом на самом деле входят.
      emailMark = '<span style="font-size:var(--text-micro); color:var(--muted); margin-left:6px;">вход: ' + esc(lk.login_email) + '</span>';
    } else emailMark = '';

    // Форма привязки — отдельным блоком во всю ширину под строками: в ячейке значения
    // она ломала выравнивание, из-за чего подпись строки переносилась на две.
    var linkForm = '';
    if (el.step === 'form') {
      linkForm = '<div style="padding:12px 0; border-top:1.5px solid var(--line);">' +
        '<div style="font-size:var(--text-micro); color:var(--muted); margin-bottom:8px;">Почта для входа — по ней можно будет заходить кодом, как через Telegram.</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<input id="link-email-input" type="email" value="' + esc(el.email || sp.email || '') + '" placeholder="you@email.com" style="flex:1; min-width:200px; ' + S.field + '">' +
        '<button data-action="sendLinkEmailCode"' + (el.loading ? ' disabled' : '') + ' style="' + linkBtnStyle + ' margin-left:0;">' + (el.loading ? 'Отправляем…' : 'Прислать код') + '</button>' +
        '<button data-action="cancelLinkEmail" style="' + linkBtnStyle + ' margin-left:0;">Отмена</button></div>';
    } else if (el.step === 'code') {
      linkForm = '<div style="padding:12px 0; border-top:1.5px solid var(--line);">' +
        '<div style="font-size:var(--text-micro); color:var(--muted); margin-bottom:8px;">Код отправлен на ' + esc(el.email) + '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<input id="link-code-input" inputmode="numeric" placeholder="Код из письма" style="flex:1; min-width:160px; ' + S.field + '">' +
        '<button data-action="confirmLinkEmail"' + (el.loading ? ' disabled' : '') + ' style="' + linkBtnStyle + ' margin-left:0;">' + (el.loading ? 'Проверяем…' : 'Подтвердить') + '</button>' +
        '<button data-action="cancelLinkEmail" style="' + linkBtnStyle + ' margin-left:0;">Отмена</button></div>';
    }
    if (linkForm && el.error) linkForm += '<div style="font-size:var(--text-micro); color:var(--err); margin-top:8px;">' + esc(el.error) + '</div>';
    if (linkForm) linkForm += '</div>';

    // Статус меняется только заявкой с документом: напрямую его не отдать в редактирование,
    // потому что от него зависит гейт про согласие родителя (см. 0014).
    var sr = state.statusReq;
    var statusRow;
    if (sr && sr.status === 'pending') {
      statusRow = row('Статус', '<span style="display:inline-flex; align-items:center; justify-content:flex-end; flex-wrap:wrap;">' +
        val(sp.status) + badge('на подтверждении', 'var(--warn)', 'Заявка на «' + (sr.to_status || '') + '» рассматривается') + '</span>');
    } else {
      statusRow = row('Статус', '<span style="display:inline-flex; align-items:center; justify-content:flex-end; flex-wrap:wrap;">' +
        val(sp.status) + '<button data-action="openStatusModal" style="' + linkBtnStyle + '">Изменить</button></span>');
      if (sr && sr.status === 'rejected' && sr.reason) {
        statusRow += '<div style="font-size:var(--text-micro); color:var(--err); padding:0 0 10px;">Заявка на «' + esc(sr.to_status || '') + '» отклонена: ' + esc(sr.reason) + '</div>';
      }
    }

    var contacts = '<div style="' + card + '"><div style="' + cardTitle + '">Контакты и статус</div>' +
      editableRow('email', 'Email', 'text', emailMark) +
      row('Telegram', tgCell) +
      linkForm +
      statusRow + editableRow('institution', 'Место учёбы', 'institution') + '</div>';

    // строка документа со статусом и кнопкой загрузки (открывает модалку)
    var docRow = function (label, type) {
      var s = docStat(type);
      var right;
      if (s === 'pending') right = '<span style="font-size:var(--text-micro); font-weight:600; color:' + docColor(s) + ';">на проверке</span>';
      else if (s === 'approved') right = '<span style="font-size:var(--text-micro); font-weight:600; color:' + docColor(s) + ';">✓ подтверждено</span>';
      else {
        var lbl = s === 'rejected' ? 'Загрузить заново' : (type === 'consent' ? 'Загрузить' : 'Подтвердить');
        var bg = type === 'consent' ? 'var(--warn)' : 'var(--accent)';
        var btn = '<button data-action="' + (type === 'consent' ? 'openConsentDoc' : 'openStudyDoc') + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:' + bg + '; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;">' + lbl + '</button>';
        right = s === 'rejected'
          ? '<span style="display:inline-flex; align-items:center; gap:8px;"><span style="font-size:var(--text-micro); font-weight:600; color:var(--err);">отклонено</span>' + btn + '</span>'
          : btn;
      }
      /* Модератор пишет причину в поле, подписанное «её увидит студент», и в схеме
         student_files у колонки reason тот же комментарий. Но студенту выводилось
         одно слово «отклонено»: причина приходила с сервера и молча терялась.
         Несовершеннолетний с отклонённым согласием при этом заблокирован в
         каталоге и не знает, что исправить — загрузит тот же документ снова.
         Формат взят у соседней ветки заявок на смену статуса (выше). */
      var out = row(label, right);
      if (s === 'rejected') {
        var f = fileFor(type);
        var why = (f && f.reason) ? esc(f.reason)
          : 'Причина не указана. Загрузите документ заново — фото целиком, все углы в кадре, текст читаем.';
        out += '<div style="font-size:var(--text-micro); color:var(--err); padding:0 0 10px; line-height:1.45;">' + why + '</div>';
      }
      return out;
    };
    var at = sp.aiTest;
    var testRight = at
      ? '<span style="display:inline-flex; align-items:center; gap:8px;"><span style="font-size:var(--text-micro); font-weight:600; color:' + levelColor(at.level) + ';">' + esc(at.level) + '</span><button data-action="openTest" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:6px 12px; border-radius:8px; cursor:pointer;">Заново</button></span>'
      : '<button data-action="openTest" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--accent); border:none; padding:6px 12px; border-radius:8px; cursor:pointer;">Пройти тест</button>';
    var verification = '<div style="' + card + '"><div style="' + cardTitle + '">Верификация</div>' +
      docRow('Место учёбы (справка)', 'study') +
      row('ИИ-тест навыков', testRight) +
      (minor ? docRow('Согласие родителя', 'consent') : '') + '</div>';

    // ---- Специальности (комбинируемые) ----
    var specialties = sp.specialties || (sp.specialty ? [sp.specialty] : []);
    var specPill = function (spec) {
      var active = specialties.indexOf(spec) !== -1;
      return '<button data-action="toggleSpecialty" data-spec="' + esc(spec) + '" style="font-size:var(--text-micro); font-weight:600; padding:7px 13px; border-radius:999px; cursor:pointer; ' +
        (active ? 'color:#fff; background:var(--ink); border:1px solid var(--ink);' : 'color:var(--ink); background:#fff; border:1.5px solid var(--line);') + '">' + esc(spec) + '</button>';
    };
    var specialtiesSection = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">Специальности</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); margin:0 0 14px;">Можно выбрать несколько — первая выбранная используется для ИИ-теста навыков.</p>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px;">' + SPECIALTIES.map(specPill).join('') + '</div></div>';

    var es = state.extrasSave;
    var esNote = es.error ? '<span style="font-size:var(--text-micro); color:var(--err); font-weight:600;">' + esc(es.error) + '</span>'
      : (es.ok ? '<span style="font-size:var(--text-micro); color:var(--ok); font-weight:600;">Сохранено ✓</span>' : '');
    var about = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:14px;">О себе</div>' +
      '<label style="display:block;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:7px;">О себе <span style="color:var(--muted); font-weight:400;">(необязательно)</span></span>' +
        '<textarea id="desc-input" rows="4" placeholder="Коротко о себе: опыт, интересы, чем хотите заниматься…" style="' + S.field + ' resize:vertical; font-family:inherit; line-height:1.5;">' + esc(sp.description || '') + '</textarea></label>' +
      '<div style="display:flex; align-items:center; gap:14px; margin-top:16px;"><button data-action="saveProfileExtras"' + (es.loading ? ' disabled' : '') + ' style="' + S.primary.replace('padding:15px', 'padding:11px 22px') + (es.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (es.loading ? 'Сохранение…' : 'Сохранить') + '</button>' + esNote + '</div></div>';

    // ---- Матрица навыков: hard skills (карточка + сертификат) + языки ----
    var hardSkills = (sp.hardSkills || []);
    var fileTile = function (file, type, index) {
      if (!file) return '';
      var isImg = isImageFile(file);
      var thumb = isImg
        ? '<img src="' + esc(file.url) + '" style="width:32px; height:32px; border-radius:7px; object-fit:cover; flex-shrink:0;">'
        : '<div style="width:32px; height:32px; border-radius:7px; background:#fff; border:1.5px solid var(--line); display:flex; align-items:center; justify-content:center; color:var(--muted); flex-shrink:0;">' + icon('file', 15) + '</div>';
      return '<div data-action="openMediaPreview" data-preview-url="' + esc(file.url) + '" data-preview-name="' + esc(file.name) + '" data-preview-image="' + (isImg ? '1' : '0') + '" style="display:flex; align-items:center; gap:8px; margin-top:9px; padding:6px 9px; background:var(--bg); border-radius:9px; cursor:pointer;">' + thumb +
        '<div style="min-width:0;"><div style="font-size:var(--text-micro); font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(file.name) + '</div><div style="margin-top:3px;">' + modBadge(file.path) + '</div>' + (file.size ? '<div style="font-size:var(--text-micro); color:var(--muted);">' + fmtBytes(file.size) + '</div>' : '') + '</div></div>';
    };
    var skillCard = function (sk, i) {
      var name = typeof sk === 'string' ? sk : sk.name;
      var file = typeof sk === 'string' ? null : sk.file;
      var conf = typeof sk === 'object' ? sk.confidence : null;
      return '<div style="border:1.5px solid var(--line); border-radius:12px; padding:13px 14px; cursor:pointer; position:relative;" data-action="openSkillDetail" data-item-index="' + i + '">' +
        '<div style="position:absolute; top:9px; right:9px; display:flex; gap:4px;">' + chipEditBtn('skill', i) + chipRemoveBtn('skill', i) + '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; padding-right:50px; min-width:0;"><span style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(name) + '</span>' +
        (typeof conf === 'number' ? '<span style="font-size:var(--text-micro); font-weight:600; color:' + confidenceColor(conf) + '; background:color-mix(in srgb, ' + confidenceColor(conf) + ' 12%, #fff); padding:2px 8px; border-radius:999px; flex-shrink:0;">' + conf + '/10</span>' : '') + '</div>' +
        fileTile(file) + '</div>';
    };
    var suggestions = suggestedSkills(specialties, hardSkills);
    var suggestRow = suggestions.length ? '<div style="display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px;">' +
      suggestions.map(function (sk) { return '<button data-action="quickAddSkill" data-skill="' + esc(sk) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:#fff; border:1px dashed color-mix(in srgb, var(--accent) 40%, #fff); padding:5px 10px; border-radius:8px; cursor:pointer;">+ ' + esc(sk) + '</button>'; }).join('') +
      '</div>' : '';
    var languages = (sp.languages || []);
    var langRow = function (l, i) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-top:1.5px solid var(--line);">' +
        '<span style="font-size:var(--text-caption); display:flex; align-items:center; gap:8px; min-width:0; ' + S.wrap + '"><strong style="font-weight:600;">' + esc(l.name) + '</strong>' + (l.level ? '<span style="color:var(--muted);">— ' + esc(l.level) + '</span>' : '') + fileBadge(l.file) + '</span>' +
        '<span style="display:flex; align-items:center; gap:6px; flex-shrink:0;">' + editBtn('language', i) + removeBtn('language', i) + '</span></div>';
    };
    var skillMatrix = '<div style="' + card + '"><div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;"><div style="' + cardTitle + '">Матрица навыков</div></div>' +
      '<div style="display:flex; align-items:center; justify-content:space-between; margin:12px 0 9px;"><span style="font-size:var(--text-caption); font-weight:600;">Hard skills</span>' + addBtn('skill', 'Навык') + '</div>' +
      (suggestions.length ? '<div style="font-size:var(--text-micro); color:var(--muted); margin-bottom:7px;">Рекомендации по вашим специальностям:</div>' + suggestRow : '') +
      (hardSkills.length ? '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-bottom:20px;">' + hardSkills.map(skillCard).join('') + '</div>' : '<div style="font-size:var(--text-caption); color:var(--muted); margin-bottom:20px;">Пока не добавлено ни одного навыка</div>') +
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; padding-top:4px; border-top:1.5px solid var(--line);"><span style="font-size:var(--text-caption); font-weight:600; margin-top:14px;">Знание языков</span><span style="margin-top:10px;">' + addBtn('language', 'Язык') + '</span></div>' +
      (languages.length ? languages.map(langRow).join('') : '<div style="font-size:var(--text-caption); color:var(--muted); padding:10px 0 0;">Языки ещё не указаны</div>') +
      '</div>';

    // ---- Проекты — свободная форма: любые специальности, «продуктовая» карточка с обложкой ----
    var projects = (sp.projects || []);
    var projectCard = function (p, i) {
      var files = p.files || [];
      var cover = files[0];
      var coverHtml = cover
        ? (isImageFile(cover)
            ? '<img src="' + esc(cover.url) + '" style="width:100%; height:140px; object-fit:cover; border-radius:13px 13px 0 0; display:block;">'
            : '<div style="width:100%; height:140px; background:var(--bg); border-radius:13px 13px 0 0; display:flex; align-items:center; justify-content:center; color:var(--muted);">' + icon('file', 30) + '</div>')
        : '';
      var specTag = p.specialty ? '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 8px; border-radius:6px;">' + esc(p.specialty) + '</span>' : '';
      var tagChips = (p.tags || []).slice(0, 3).map(function (t) { return '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:2px 7px; border-radius:999px;">#' + esc(t) + '</span>'; }).join('');
      var photoCount = files.length > 1 ? '<div style="margin-top:8px; font-size:var(--text-micro); color:var(--muted); display:flex; align-items:center; gap:4px;">' + icon('image', 12) + files.length + ' фото</div>' : '';
      return '<div style="border:1.5px solid var(--line); border-radius:14px; overflow:hidden; cursor:pointer;" data-action="openProjectDetail" data-item-index="' + i + '">' +
        coverHtml +
        '<div style="padding:14px 16px; position:relative;">' +
          '<div style="position:absolute; top:12px; right:12px; display:flex; gap:6px;">' + editBtn('project', i) + removeBtn('project', i) + '</div>' +
          '<div style="font-weight:600; font-size:var(--text-body); padding-right:56px; ' + S.wrap + '">' + esc(p.name) + '</div>' +
          (specTag ? '<div style="margin-top:6px;">' + specTag + '</div>' : '') +
          (p.desc ? '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.5; margin:8px 0 0; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; ' + S.wrap + '">' + esc(p.desc) + '</p>' : '') +
          (tagChips ? '<div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:8px;">' + tagChips + '</div>' : '') +
          photoCount +
        '</div></div>';
    };
    var addProjectCard = '<button data-action="openItemModal" data-item-type="project" style="border:1.5px dashed var(--line); border-radius:14px; padding:18px; background:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:var(--muted); min-height:180px;"><span style="font-size:var(--text-title);">+</span><span style="font-size:var(--text-caption); font-weight:600;">Добавить проект</span></button>';
    var projectsHint = projects.length ? '' : '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:0 0 16px;">Пет-проект, учебное задание, работа на хакатоне или курсовая — подойдёт всё, что вы реально сделали. Не обязательно быть «фрилансером»: даже один разобранный по шагам пример уже показывает, как вы работаете.</p>';
    var projectsSection = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">Проекты <span style="color:var(--muted); font-weight:400; font-size:var(--text-caption);">(учебные, пет-проекты, хакатоны — всё считается)</span></div>' +
      projectsHint +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-top:' + (projects.length ? '14px' : '0') + ';">' + projects.map(projectCard).join('') + addProjectCard + '</div></div>';

    // ---- История на платформе (завершённые стажировки) ----
    // Источник — опубликованные справки (0016), а не profiles.data: туда студент пишет
    // сам и мог бы приписать себе стажировки в компаниях, где никогда не был.
    var history = state.history || [];
    var historyItem = function (h) {
      var period = (h.started_at ? fmtDate(h.started_at) : '') + (h.finished_at ? ' — ' + fmtDate(h.finished_at) : '');
      return '<div style="display:flex; gap:14px; padding:16px 0; border-top:1.5px solid var(--line);">' +
        '<div style="width:9px; height:9px; border-radius:50%; background:var(--accent); margin-top:6px; flex-shrink:0;"></div>' +
        '<div style="flex:1; min-width:0;"><div style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(h.gig_title || 'Стажировка') + '</div>' +
        '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:2px;">' + esc(h.company_name || '') + (period ? ' · ' + esc(period) : '') + '</div>' +
        (h.body ? '<div style="margin-top:8px; padding:11px 13px; background:var(--bg); border-radius:10px; font-size:var(--text-caption); color:var(--muted); line-height:1.55; white-space:pre-wrap; ' + S.wrap + '">' + esc(h.body) + '</div>' : '') +
        '<div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:8px;">' +
        '<a href="/cert/' + esc(h.public_id) + '" target="_blank" rel="noopener" style="font-size:var(--text-micro); font-weight:600; color:var(--accent);">Ссылка на справку ↗</a>' +
        // Официальное свидетельство лежит в приватном бакете, прямой ссылки нет —
        // подписываем по клику.
        (h.doc_status === 'approved' && h.doc_path
          ? '<a data-action="downloadCertDoc" data-path="' + esc(h.doc_path) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--accent); cursor:pointer;">📄 Официальное свидетельство ↓</a>'
          : h.doc_status === 'pending'
            ? '<span style="font-size:var(--text-micro); color:var(--muted);">Свидетельство от компании на проверке</span>'
            : '') +
        '</div></div></div>';
    };
    var historySection = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">История на платформе</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); margin:0 0 4px;">Завершённые стажировки, подтверждённые компаниями через internship.uz.</p>' +
      (history.length ? history.map(historyItem).join('') : '<p style="font-size:var(--text-caption); color:var(--muted); padding:14px 0 0;">Пока нет завершённых стажировок — они появятся здесь автоматически после подтверждения проекта стартапом.</p>') + '</div>';

    // ---- Верифицированные документы и достижения (слайдер сертификатов) ----
    var achievements = (sp.achievements || []);
    var achCard = function (a, i) {
      var link = a.file ? a.file.url : a.link;
      var fileLabel = a.file ? a.file.name : (a.link ? 'внешняя ссылка' : '');
      return '<div style="scroll-snap-align:start; flex-shrink:0; width:230px; border:1.5px solid var(--line); border-radius:14px; padding:16px; position:relative;">' +
        '<div style="position:absolute; top:10px; right:10px; display:flex; gap:6px;">' + editBtn('achievement', i) + removeBtn('achievement', i) + '</div>' +
        '<div style="width:34px; height:34px; border-radius:9px; background:color-mix(in srgb, var(--accent) 10%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-body); margin-bottom:12px;">★</div>' +
        '<div style="font-weight:600; font-size:var(--text-caption); padding-right:40px; ' + S.wrap + '">' + esc(a.title) + '</div>' +
        '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:4px; ' + S.wrap + '">' + esc(a.issuer || '') + (a.date ? ' · ' + esc(a.date) : '') + '</div>' +
        (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:var(--text-micro); font-weight:600; color:var(--accent); ' + S.wrap + '">📎 ' + esc(fileLabel || 'Открыть') + ' ↗</a>' : '') + '</div>';
    };
    var addAchCard = '<button data-action="openItemModal" data-item-type="achievement" style="scroll-snap-align:start; flex-shrink:0; width:230px; border:1.5px dashed var(--line); border-radius:14px; padding:16px; background:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:var(--muted);"><span style="font-size:var(--text-title);">+</span><span style="font-size:var(--text-caption); font-weight:600;">Добавить сертификат</span></button>';
    // Заглушка «Скачать документ о практике» убрана: кнопка была всегда неактивной, а
    // настоящие документы теперь живут в блоке «Завершённые стажировки» — там и справка
    // с проверяемой ссылкой, и официальное свидетельство от компании.
    var documents = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:8px;">Сертификаты и достижения</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:0 0 16px;">Дипломы, курсы, олимпиады. Файл проходит проверку — компании видят только подтверждённые.</p>' +
      '<div style="display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:6px;">' + achievements.map(achCard).join('') + addAchCard + '</div></div>';

    // ---- Завершённые стажировки ----
    // Числовой оценки здесь намеренно нет: компания ставит её, зная, что она внутренняя,
    // а показывать подростку «3 из 5» — верный способ получить спор вместо пользы.
    // Характеристики студент видит: они всё равно попадают на публичную страницу.
    var ratingSection = '<div style="' + card + ' text-align:center;">' +
      '<div style="' + cardTitle + ' margin-bottom:10px;">Завершённые стажировки</div>' +
      (history.length
        ? '<div style="font-weight:600; font-size:var(--text-h2);">' + history.length + '</div>' +
          '<div style="font-size:var(--text-caption); color:var(--muted); margin-top:6px;">' + pluralRu(history.length, 'справка выдана', 'справки выдано', 'справок выдано') + '</div>' +
          '<a data-action="openReviews" style="display:inline-block; margin-top:12px; font-size:var(--text-caption); font-weight:600; color:var(--accent); cursor:pointer;">Смотреть характеристики →</a>'
        : '<div style="font-size:var(--text-caption); color:var(--muted); line-height:1.55;">Появятся после первой завершённой стажировки. Компания напишет характеристику, а вы получите справку с проверяемой ссылкой.</div>') +
      '</div>';

    return '<main class="view-in" style="width:100%; max-width:1200px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0 0 24px;">Личный кабинет</h1>' +
      profile +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-top:20px;">' + contacts + verification + '</div>' +
      '<div style="margin-top:20px;">' + specialtiesSection + '</div>' +
      '<div style="margin-top:20px;">' + about + '</div>' +
      '<div style="margin-top:20px;">' + skillMatrix + '</div>' +
      '<div style="margin-top:20px;">' + projectsSection + '</div>' +
      '<div style="margin-top:20px;">' + historySection + '</div>' +
      '<div style="margin-top:20px;">' + documents + '</div>' +
      '<div style="margin-top:20px;">' + ratingSection + '</div>' +
      '<div style="margin-top:24px; text-align:center;"><button data-action="logout" style="font-size:var(--text-caption); font-weight:600; color:var(--err); background:#fff; border:1.5px solid var(--line); padding:11px 24px; border-radius:10px; cursor:pointer;">Выйти из аккаунта</button></div>' +
      '</main>';
  }

  /* ---------- COMPANY CABINET ---------- */
  function companyCabinetView() {
    var cp = state.companyProfile || {};
    var card = 'background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:24px;';
    var cardTitle = 'font-weight:600; font-size:var(--text-body); margin-bottom:4px;';
    var row = function (label, v) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1.5px solid var(--line);"><span style="font-size:var(--text-caption); color:var(--muted);">' + label + '</span><span style="font-size:var(--text-caption); font-weight:600; text-align:right; word-break:break-word;">' + esc(v || '—') + '</span></div>';
    };

    var cs = companyStatus();
    /* Третья копия того же правила. Вид отдаётся только при authRole === 'company'
       (диспетчер ниже), поэтому verifyStatus()/verifyColor() дают здесь ровно те
       же значения — но уже из одного места. */
    var stColor = verifyColor();
    var stText = verifyStatus();
    var profile = '<div style="' + card + ' display:flex; align-items:center; gap:18px;">' +
      '<span style="width:64px; height:64px; border-radius:16px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-h2); flex-shrink:0;">◆</span>' +
      '<div style="min-width:0;"><div style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em;">' + esc(companyName()) + '</div>' +
      '<div style="display:inline-flex; align-items:center; gap:7px; font-size:var(--text-caption); font-weight:600; color:' + stColor + '; margin-top:5px;"><span style="width:7px; height:7px; border-radius:50%; background:' + stColor + ';"></span>' + stText + '</div></div></div>';

    var details = '<div style="' + card + '"><div style="' + cardTitle + '">Реквизиты компании</div>' +
      row('ИНН', cp.inn) + row('Руководитель', cp.director) + row('Корпоративная почта', cp.corpEmail) +
      row('Домен', companyDomain()) + row('Контактное лицо', cp.contact) + row('Телефон', cp.phone) +
      row('LinkedIn / соцсети', cp.linkedin) + '</div>';

    var checksNote = cs === 'approved'
      ? '<div style="margin-top:16px; padding:13px 15px; background:color-mix(in srgb, var(--ok) 8%, #fff); border:1px solid color-mix(in srgb, var(--ok) 24%, #fff); border-radius:12px; font-size:var(--text-caption); color:var(--ok); line-height:1.5;">Профиль подтверждён — можно размещать задачи.</div>'
      : cs === 'rejected'
        ? '<div style="margin-top:16px; padding:13px 15px; background:color-mix(in srgb, var(--err) 8%, #fff); border:1px solid color-mix(in srgb, var(--err) 24%, #fff); border-radius:12px; font-size:var(--text-caption); color:var(--err); line-height:1.5;">Заявка отклонена. Свяжитесь с командой платформы для уточнения.</div>'
        : '<div style="margin-top:16px; padding:13px 15px; background:color-mix(in srgb, var(--accent) 6%, #fff); border:1px solid color-mix(in srgb, var(--accent) 18%, #fff); border-radius:12px; font-size:var(--text-caption); color:var(--muted); line-height:1.5;">Заявка на проверке. Размещение задач откроется после подтверждения профиля админом.</div>';
    var postBtn = cs === 'approved'
      ? '<button data-action="openGigForm" style="margin-top:16px; width:100%; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--accent); border:none; padding:12px; border-radius:10px; cursor:pointer;">Разместить задачу</button>'
      : '<button disabled style="margin-top:16px; width:100%; font-size:var(--text-caption); font-weight:600; color:var(--muted); background:var(--bg); border:1.5px solid var(--line); padding:12px; border-radius:10px; cursor:not-allowed;">Разместить задачу (после подтверждения)</button>';
    var checks = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:12px;">Статус проверки</div>' +
      '<div style="font-size:var(--text-caption); color:var(--muted); line-height:1.6;">Госреестр · корпоративный домен · созвон с командой</div>' +
      checksNote + postBtn + '</div>';

    // Прямая привязка к state.companyProfile[field] на каждое нажатие (data-company-field) —
    // без неё любой мгновенный экшен рядом (переключение направления, выбор в select) вызывает
    // setState() и полный re-render, который стирает ещё не сохранённый текст в этих полях.
    var textInput = function (field, label, val, ph, hint, maxlen) {
      return '<label style="display:block; margin-bottom:12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">' + label + '</span>' +
        '<input data-company-field="' + field + '" value="' + esc(val || '') + '" placeholder="' + esc(ph) + '"' + (maxlen ? ' maxlength="' + maxlen + '"' : '') + ' style="' + S.field + '">' +
        (hint ? '<span style="display:block; font-size:var(--text-micro); color:var(--muted); margin-top:5px;">' + hint + '</span>' : '') + '</label>';
    };

    var about = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:10px;">Описание компании <span style="color:var(--muted); font-weight:400; font-size:var(--text-caption);">(необязательно)</span></div>' +
      '<textarea data-company-field="description" rows="4" maxlength="1000" placeholder="Чем занимается компания, какие задачи и стажировки предлагаете…" style="width:100%; font-size:var(--text-body); padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); resize:vertical; font-family:inherit; line-height:1.5;">' + esc(cp.description || '') + '</textarea></div>';

    // ---- Мэтчинг и поиск (технический профиль) ----
    var focusAreas = cp.focusAreas || [];
    var focusPill = function (area) {
      var active = focusAreas.indexOf(area) !== -1;
      return '<button type="button" data-action="toggleFocusArea" data-focus="' + esc(area) + '" style="font-size:var(--text-micro); font-weight:600; padding:7px 13px; border-radius:999px; cursor:pointer; ' +
        (active ? 'color:#fff; background:var(--ink); border:1px solid var(--ink);' : 'color:var(--ink); background:#fff; border:1.5px solid var(--line);') + '">' + esc(area) + '</button>';
    };
    var techStack = cp.techStack || [];
    var techChips = techStack.map(function (t) {
      return '<span style="display:inline-flex; align-items:center; gap:5px; font-size:var(--text-micro); font-weight:600; color:var(--ink); background:var(--bg); border:1.5px solid var(--line); padding:4px 6px 4px 10px; border-radius:999px;">' + esc(t) +
        '<button type="button" data-action="removeTechTag" data-tag="' + esc(t) + '" style="border:none; background:none; color:var(--muted); cursor:pointer; padding:0; display:flex;">' + icon('x', 11) + '</button></span>';
    }).join('');
    var techProfile = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">Технический профиль</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); margin:0 0 14px;">Используется для подбора студентов в каталоге — чем точнее, тем лучше совпадения.</p>' +
      '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Основные направления</div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px;">' + FOCUS_AREAS.map(focusPill).join('') + '</div>' +
      '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Технологический стек</div>' +
      (techChips ? '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">' + techChips + '</div>' : '') +
      '<div style="display:flex; gap:8px;"><input id="tech-tag-input" placeholder="Например, React, Supabase, Figma" style="' + S.field + '"><button type="button" data-action="addTechTag" style="flex-shrink:0; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); border:none; padding:0 16px; border-radius:9px; cursor:pointer;">+</button></div></div>';

    // ---- Формат работы (онлайн-правила, авто-применяются ко всем будущим задачам) ----
    var commStyle = cp.commStyle || 'async';
    var commBtn = function (val, label) {
      var active = commStyle === val;
      return '<button type="button" data-action="setCommStyle" data-comm="' + val + '" style="flex:1; font-size:var(--text-caption); font-weight:600; padding:11px; border-radius:10px; cursor:pointer; ' +
        (active ? 'color:#fff; background:var(--ink); border:1px solid var(--ink);' : 'color:var(--ink); background:#fff; border:1.5px solid var(--line);') + '">' + label + '</button>';
    };
    var cadenceSelect = '<select data-select-action="setMeetingCadence" style="' + S.field + '">' + MEETING_CADENCE_OPTIONS.map(function (o) {
      var sel = (cp.meetingCadence || 'weekly') === o[0] ? ' selected' : '';
      return '<option value="' + o[0] + '"' + sel + '>' + o[1] + '</option>';
    }).join('') + '</select>';
    var workspaceRules = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">Формат работы</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); margin:0 0 14px;">Работа идёт полностью онлайн — эти настройки применяются автоматически ко всем будущим задачам.</p>' +
      '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Стиль коммуникации</div>' +
      '<div style="display:flex; gap:8px; margin-bottom:16px;">' + commBtn('async', 'Асинхронно (гибкие часы)') + commBtn('sync', 'Синхронно (фикс. часы)') + '</div>' +
      (commStyle === 'sync' ? textInput('syncHours', 'Рабочие часы', cp.syncHours, 'Например, 10:00–15:00') : '') +
      '<label style="display:block; margin:2px 0 12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Периодичность созвонов</span>' + cadenceSelect + '</label>' +
      textInput('meetingLink', 'Постоянная ссылка на созвон', cp.meetingLink, 'https://meet.google.com/xxx-xxxx-xxx', 'Откроется автоматически, когда вы наймёте студента') +
      '</div>';

    // ---- Шаблон вакансии (подставляется при размещении новой задачи) ----
    var durationSelect = '<select data-select-action="setDefaultDuration" style="' + S.field + '">' + DURATION_OPTIONS.map(function (o) {
      var sel = (cp.defaultDuration || '1m') === o[0] ? ' selected' : '';
      return '<option value="' + o[0] + '"' + sel + '>' + o[1] + '</option>';
    }).join('') + '</select>';
    var jobTemplate = '<div style="' + card + '"><div style="' + cardTitle + ' margin-bottom:4px;">Шаблон вакансии</div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); margin:0 0 14px;">Заполните один раз — эти данные будут подставляться в каждую новую задачу, которую вы размещаете.</p>' +
      textInput('pitch', 'Питч компании (до 200 симв.)', cp.pitch, 'Коротко — чем занимается компания', '', 200) +
      '<label style="display:block; margin:2px 0 12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Длительность проекта по умолчанию</span>' + durationSelect + '</label>' +
      '<div style="font-size:var(--text-caption); font-weight:600; margin:14px 0 8px;">Куратор для стажёров</div>' +
      '<div class="g2" style="display:grid; gap:12px;">' +
      textInput('mentorName', 'Имя куратора', cp.mentorName, 'Например, Данил Темиргалиев') +
      textInput('mentorRole', 'Роль', cp.mentorRole, 'Например, Lead Engineer') +
      '</div>' +
      textInput('mentorContact', 'Telegram куратора', cp.mentorContact, '@username') +
      '</div>';

    var es = state.extrasSave;
    var saveText = es.loading ? 'Сохранение…' : es.error ? esc(es.error) : es.ok ? 'Все изменения сохранены ✓' : 'Изменения сохраняются автоматически';
    var saveColor = es.error ? 'var(--err)' : es.ok ? 'var(--ok)' : 'var(--muted)';
    var saveBar = '<div style="display:flex; align-items:center; gap:8px; margin-top:18px; font-size:var(--text-micro); font-weight:600; color:' + saveColor + ';">' + icon(es.error ? 'warn' : 'check', 14) + '<span>' + saveText + '</span></div>';

    return '<main class="view-in" style="width:100%; max-width:1200px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:0 0 24px;">Личный кабинет компании</h1>' +
      profile +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-top:20px;">' + details + checks + '</div>' +
      '<div style="margin-top:20px;">' + about + '</div>' +
      '<div style="margin-top:20px;">' + techProfile + '</div>' +
      '<div style="margin-top:20px;">' + workspaceRules + '</div>' +
      '<div style="margin-top:20px;">' + jobTemplate + '</div>' +
      saveBar +
      '<div style="margin-top:24px; text-align:center;"><button data-action="logout" style="font-size:var(--text-caption); font-weight:600; color:var(--err); background:#fff; border:1.5px solid var(--line); padding:11px 24px; border-radius:10px; cursor:pointer;">Выйти из аккаунта</button></div>' +
      '</main>';
  }

  /* ---------- MY RESPONSES / MY VACANCIES ---------- */
  function emptyState(icon, title, text, btnAction, btnLabel) {
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:56px 32px; text-align:center;">' +
      '<div style="width:60px; height:60px; border-radius:16px; background:color-mix(in srgb, var(--accent) 12%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-h2); margin:0 auto 20px;">' + icon + '</div>' +
      '<h3 style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em; margin:0 0 10px;">' + title + '</h3>' +
      '<p style="color:var(--muted); font-size:var(--text-body); max-width:420px; margin:0 auto 22px; line-height:1.55;">' + text + '</p>' +
      '<button data-action="' + btnAction + '" style="' + S.primary.replace('padding:15px', 'padding:13px 24px') + '">' + btnLabel + '</button></div>';
  }
  function pageWrap(title, inner, width) {
    return '<main class="view-in" style="width:100%; max-width:' + (width || 820) + 'px; margin:0 auto; padding:40px 28px 88px;">' +
      '<h1 style="font-weight:700; font-size:var(--text-h1); letter-spacing:-0.02em; margin:8px 0 24px;">' + title + '</h1>' + inner + '</main>';
  }
  function statusChip(status) {
    var m = appStatusMeta(status);
    return '<span style="font-size:var(--text-micro); font-weight:600; color:' + m.color + '; background:color-mix(in srgb, ' + m.color + ' 12%, #fff); padding:4px 9px; border-radius:6px; white-space:nowrap;">' + m.label + '</span>';
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  function chatButton(appId, label) {
    return '<button data-action="openChat" data-app-id="' + esc(appId) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ink); border:none; padding:9px 15px; border-radius:8px; cursor:pointer; white-space:nowrap;">' + label + '</button>';
  }
  // Карточка отклика. Студент видит задачу и компанию, компания — студента и своё решение.
  // У компании карточки сгруппированы под задачей, поэтому её название здесь не повторяем.
  function applicationCard(a) {
    var asCompany = state.authRole === 'company';
    var back = asCompany ? 'vacancies' : 'responses';
    var title, subtitle;
    if (asCompany) {
      // Имя студента ведёт в его профиль — компании он доступен, раз студент откликнулся.
      title = '<a data-action="openStudentProfile" data-student-id="' + esc(a.student_id || '') + '" data-back="' + back + '" style="cursor:pointer; color:var(--ink); border-bottom:1.5px solid var(--line);">' + esc(a.student_name || 'Студент') + '</a>';
      subtitle = esc(fmtDate(a.created_at));
    } else {
      title = esc((a.gigs && a.gigs.title) || 'Задача удалена');
      subtitle = '<a data-action="openCompanyProfile" data-company-id="' + esc(a.company_app_id || '') + '" data-back="' + back + '" style="cursor:pointer; color:var(--muted); border-bottom:1.5px solid var(--line);">' + esc((a.gigs && a.gigs.company_name) || 'Компания') + '</a> · ' + esc(fmtDate(a.created_at));
    }

    var decision = '';
    // Завершённая стажировка: слот под официальное свидетельство. Шаблона нет —
    // компания составляет документ сама, платформа только принимает и проверяет.
    if (asCompany && a.status === 'completed') {
      var cert = (state.certs || []).filter(function (c) { return c.application_id === a.id; })[0];
      if (cert) {
        var ds = cert.doc_status;
        var dsLine = ds === 'pending'  ? '<span style="color:var(--warn); font-weight:600;">на проверке</span>'
                   : ds === 'approved' ? '<span style="color:var(--ok); font-weight:600;">принято, студент может скачать</span>'
                   : ds === 'rejected' ? '<span style="color:var(--err); font-weight:600;">отклонено' + (cert.doc_reason ? ': ' + esc(cert.doc_reason) : '') + '</span>'
                   : '<span style="color:var(--muted);">не приложено</span>';
        var busyDoc = state.certDocBusy === cert.id;
        decision = '<div style="margin-top:14px; padding-top:14px; border-top:1.5px solid var(--line);">' +
          '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:4px;">Официальное свидетельство</div>' +
          '<div style="font-size:var(--text-micro); color:var(--muted); line-height:1.5; margin-bottom:8px;">Документ на вашем бланке с подписью и печатью. Студент приложит его в Common App или портфолио. Проверяется платформой перед выдачей.</div>' +
          '<div style="font-size:var(--text-micro); margin-bottom:8px;">Статус: ' + dsLine + (cert.doc_name ? ' <span style="color:var(--muted);">· ' + esc(cert.doc_name) + '</span>' : '') + '</div>' +
          (busyDoc
            ? '<div style="font-size:var(--text-micro); color:var(--muted);">Загружаем…</div>'
            : '<label style="display:inline-flex; align-items:center; gap:9px; cursor:pointer; font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:8px 14px; border-radius:8px;">' +
              (ds ? 'Заменить файл' : 'Загрузить свидетельство') +
              '<input data-cert-doc-input data-cert-id="' + esc(cert.id) + '" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none;"></label>') +
          '</div>';
      }
    }
    // Завершить можно только то, что начиналось: студента должны были пригласить.
    if (asCompany && a.status === 'invited') {
      decision = '<div style="display:flex; gap:8px; margin-top:12px;">' +
        '<button data-action="openCompleteModal" data-app-id="' + esc(a.id) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ink); border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Завершить стажировку</button></div>';
    }
    if (asCompany && a.status === 'pending') {
      /* Отказ спрашивает подтверждение и называет студента по имени: решение
         необратимо и закрывает человеку один путь к документу. */
      decision = state.confirmRejectApp === a.id
        ? '<div style="margin-top:12px; padding:12px 14px; background:color-mix(in srgb, var(--err) 8%, #fff); border:1px solid color-mix(in srgb, var(--err) 26%, #fff); border-radius:10px;">' +
          '<div style="font-size:var(--text-micro); color:var(--err); font-weight:600; margin-bottom:10px; line-height:1.45;">Отказать: ' + esc(a.student_name || 'студенту') + '? Отменить решение будет нельзя.</div>' +
          '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button data-action="setAppStatus" data-app-id="' + esc(a.id) + '" data-status="rejected" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--err); border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Отказать</button>' +
            '<button data-action="cancelRejectApp" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:8px 14px; border-radius:8px; cursor:pointer;">Не отказывать</button>' +
          '</div></div>'
        : '<div style="display:flex; gap:8px; margin-top:12px;">' +
          '<button data-action="setAppStatus" data-app-id="' + esc(a.id) + '" data-status="invited" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Пригласить</button>' +
          '<button data-action="askRejectApp" data-app-id="' + esc(a.id) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1px solid color-mix(in srgb, var(--err) 30%, #fff); padding:8px 14px; border-radius:8px; cursor:pointer;">Отказать</button>' +
        '</div>';
    }

    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:22px 26px;">' +
      '<div class="row-split" style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-weight:600; font-size:var(--text-body); letter-spacing:-0.01em; ' + S.wrap + '">' + title + '</div>' +
          '<div style="font-size:var(--text-caption); color:var(--muted); margin-top:4px;">' + subtitle + '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">' + statusChip(a.status) + chatButton(a.id, 'Открыть чат') + '</div>' +
      '</div>' + decision + '</div>';
  }
  // Отклики компании одним списком по всем вакансиям. «Мои вакансии» отвечают на вопрос
  // «что происходит по этой задаче», а этот вид — на «что требует ответа прямо сейчас»:
  // когда вакансий много, новые отклики иначе приходится выискивать по всей странице.
  function companyResponsesView() {
    var appId = state.companyProfile && state.companyProfile.id;
    var mine = (state.applications || []).filter(function (a) { return a.company_app_id === appId; });

    if (!mine.length) {
      return pageWrap('Отклики', state.appsLoading
        ? '<div style="text-align:center; padding:48px; color:var(--muted); font-size:var(--text-caption);">Загружаем отклики…</div>'
        : emptyState('◎', 'Пока нет откликов', 'Как только студенты откликнутся на ваши задачи, они появятся здесь — все вакансии в одном списке.', 'goVacancies', 'Мои вакансии'), 1200);
    }

    var counts = { pending: 0, invited: 0, rejected: 0, completed: 0 };
    mine.forEach(function (a) { if (counts[a.status] != null) counts[a.status]++; });
    var tab = state.respTab || 'pending';
    var shown = tab === 'all' ? mine : mine.filter(function (a) { return a.status === tab; });

    var tb = function (id, label, n) {
      var active = tab === id;
      return '<button data-action="respTab" data-tab="' + id + '" style="font-size:var(--text-caption); font-weight:600; padding:9px 16px; border-radius:10px; cursor:pointer; border:1.5px solid ' + (active ? 'var(--ink)' : 'var(--line)') + '; background:' + (active ? 'var(--ink)' : '#fff') + '; color:' + (active ? '#fff' : 'var(--muted)') + ';">' +
        label + (n ? ' · ' + n : '') + '</button>';
    };
    var tabs = '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;">' +
      tb('pending', 'Ждут ответа', counts.pending) +
      tb('invited', 'Приглашены', counts.invited) +
      tb('rejected', 'Отказ', counts.rejected) +
      // Завершённые — не архив: именно здесь компания прикладывает свидетельство.
      tb('completed', 'Завершены', counts.completed) +
      tb('all', 'Все', mine.length) + '</div>';

    // К какой задаче относится отклик — в плоском списке это главное, чего не хватает
    // карточке: она рассчитана на показ внутри секции вакансии.
    var list = shown.length
      ? '<div style="display:flex; flex-direction:column; gap:14px;">' + shown.map(function (a) {
          var gigTitle = (a.gigs && a.gigs.title) || 'Задача удалена';
          return '<div><div style="font-size:var(--text-micro); color:var(--muted); margin-bottom:6px; ' + S.wrap + '">' + esc(gigTitle) + '</div>' + applicationCard(a) + '</div>';
        }).join('') + '</div>'
      : '<div style="' + RO_CARD + ' text-align:center; color:var(--muted); font-size:var(--text-caption);">' +
        (tab === 'pending' ? 'Все отклики разобраны — никто не ждёт ответа.' : 'Пусто.') + '</div>';

    return pageWrap('Отклики', tabs + list, 1200);
  }

  // Публичная страница справки. Открывается по ссылке без входа: её показывают
  // работодателю, которого на платформе нет. Оценки здесь нет — только характеристика.
  function certView() {
    var c = state.cert;
    if (c.loading) return pageWrap('Справка о стажировке', '<div style="text-align:center; padding:48px; color:var(--muted); font-size:var(--text-caption);">Проверяем справку…</div>', 780);
    if (!c.data) {
      return pageWrap('Справка о стажировке',
        '<div style="' + RO_CARD + ' text-align:center;">' +
        '<div style="font-size:var(--text-h1); margin-bottom:12px;">🔍</div>' +
        '<div style="font-weight:600; font-size:var(--text-title); margin-bottom:8px;">Справка не найдена</div>' +
        '<p style="color:var(--muted); font-size:var(--text-caption); line-height:1.55; margin:0;">Такой справки нет или она ещё не опубликована. Проверьте ссылку целиком — она длинная и легко обрезается при копировании.</p></div>', 780);
    }
    var d = c.data;
    var period = (d.started_at ? fmtDate(d.started_at) : '') + (d.finished_at ? ' — ' + fmtDate(d.finished_at) : '');
    return pageWrap('Справка о стажировке',
      // Страницу открывают редко и показывают работодателю — перерисовок здесь нет,
      // так что появление проиграется ровно один раз.
      '<div class="rise-in" style="' + RO_CARD + '">' +
        '<div style="display:flex; align-items:center; gap:9px; font-size:var(--text-micro); font-weight:600; color:var(--ok); margin-bottom:18px;">' +
          '<span style="width:8px; height:8px; border-radius:50%; background:var(--ok);"></span>Подтверждено платформой internship.uz</div>' +
        '<div style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.02em;">' + esc(d.student_name || 'Студент') + '</div>' +
        '<div style="font-size:var(--text-body); color:var(--muted); margin-top:6px;">' + esc(d.gig_title || '') + '</div>' +
        '<div style="font-size:var(--text-body); margin-top:2px;"><strong style="font-weight:600;">' + esc(d.company_name || '') + '</strong>' +
          (period ? '<span style="color:var(--muted);"> · ' + esc(period) + '</span>' : '') + '</div>' +
        '<div style="margin-top:22px; padding-top:22px; border-top:1.5px solid var(--line);">' +
          '<div style="font-size:var(--text-caption); color:var(--muted); margin-bottom:8px;">Характеристика от компании</div>' +
          /* Единственный по-настоящему длинный текст на сайте — и до этого он был
             единственным местом, где мера строки не ограничена: ~90 знаков против
             комфортных 65–75. Именно эту страницу студент показывает работодателю. */
          '<div style="font-size:var(--text-body); line-height:1.65; max-width:68ch; white-space:pre-wrap; ' + S.wrap + '">' + esc(d.body || '') + '</div></div>' +
        '<div style="margin-top:22px; padding-top:18px; border-top:1.5px solid var(--line); font-size:var(--text-micro); color:var(--muted); line-height:1.6;">' +
          'Справка №' + esc(d.public_id) + (d.issued_at ? ' · выдана ' + esc(fmtDate(d.issued_at)) : '') + '<br>' +
          'Текст написан компанией и проверен платформой. После выдачи не редактируется.</div>' +
      '</div>', 780);
  }

  function responsesView() {
    if (state.authRole === 'company') return companyResponsesView();
    if (state.authRole !== 'student') return homeView();
    if (!state.applications.length) {
      return pageWrap('Мои отклики', state.appsLoading
        ? '<div style="text-align:center; padding:48px; color:var(--muted); font-size:var(--text-caption);">Загружаем отклики…</div>'
        : emptyState('◎', 'Пока нет откликов', 'Откликнитесь на задачи в каталоге — здесь появится статус каждого отклика и переписка с компанией.', 'goCatalog', 'Открыть каталог задач'));
    }
    return pageWrap('Мои отклики',
      '<div style="display:flex; flex-direction:column; gap:14px;">' + state.applications.map(applicationCard).join('') + '</div>', 1200);
  }
  function vacanciesView() {
    if (state.authRole !== 'company') return homeView();
    var appId = state.companyProfile && state.companyProfile.id;
    var myGigs = state.gigs.filter(function (g) { return g.company_app_id === appId; });

    if (!myGigs.length) {
      return pageWrap('Мои вакансии', emptyState('▤', 'Пока нет вакансий', 'Разместите первую задачу — здесь появятся ваши вакансии и отклики студентов.', 'openGigForm', 'Разместить задачу'), 1200);
    }

    var blocks = myGigs.map(function (g) {
      var apps = state.applications.filter(function (a) { return a.gig_id === g.id; });
      // Занятыми считаем приглашённых и завершивших — так же, как в политике каталога.
      var taken = apps.filter(function (a) { return a.status === 'invited' || a.status === 'completed'; }).length;
      var seats = Math.max(parseInt(String(g.slots || '1').match(/\d+/), 10) || 1, 1);
      var closed = !!g.closed_at;
      var full = taken >= seats;

      var mark = closed ? ['снята с публикации', 'var(--err)']
               : full   ? ['мест нет — не показывается в каталоге', 'var(--muted)']
                        : ['в каталоге · занято ' + taken + ' из ' + seats, 'var(--ok)'];
      var toggle = '<button data-action="toggleGigClosed" data-gig-id="' + esc(g.id) + '" data-closed="' + (closed ? '1' : '') + '" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:6px 12px; border-radius:8px; cursor:pointer;">' +
        (closed ? 'Вернуть в каталог' : 'Снять с публикации') + '</button>';

      var head = '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; flex-wrap:wrap;">' +
        '<div><div style="font-weight:600; font-size:var(--text-title);">' + esc(g.title || '') + '</div>' +
        '<div style="font-size:var(--text-micro); color:' + mark[1] + '; margin-top:3px;">' + esc(mark[0]) + '</div></div>' +
        '<div style="display:flex; align-items:center; gap:10px;">' + toggle +
        '<span style="font-size:var(--text-micro); color:var(--muted);">' + apps.length + ' ' + pluralRu(apps.length, 'отклик', 'отклика', 'откликов') + '</span></div></div>';
      var body = apps.length
        ? '<div style="display:flex; flex-direction:column; gap:10px;">' + apps.map(applicationCard).join('') + '</div>'
        : '<div style="font-size:var(--text-caption); color:var(--muted); padding:14px 0 4px;">' +
          (closed || full ? 'Откликов нет, и задача больше не показывается в каталоге.' : 'Откликов пока нет — задача видна студентам в каталоге.') + '</div>';
      return '<section style="margin-bottom:30px;">' + head + body + '</section>';
    }).join('');

    return pageWrap('Мои вакансии', blocks, 1200);
  }

  /* ---------- ADMIN: очередь модерации ---------- */
  var KIND_LABEL = {
    study: 'Справка о месте учёбы', consent: 'Согласие родителя', avatar: 'Фото профиля',
    skill: 'Сертификат к навыку', language: 'Сертификат по языку',
    project: 'Файл проекта', achievement: 'Сертификат достижения'
  };
  // Справка и согласие — юридически значимые, ИИ их не решает сам, только подсказывает.
  var HUMAN_ONLY = { study: true, consent: true };

  function adminTab(id, label, count) {
    var active = state.admin.tab === id;
    return '<button data-action="adminTab" data-tab="' + id + '" style="font-size:var(--text-caption); font-weight:600; padding:9px 16px; border-radius:10px; cursor:pointer; ' +
      (active ? 'color:#fff; background:var(--ink); border:1px solid var(--ink);' : 'color:var(--ink); background:#fff; border:1.5px solid var(--line);') + '">' +
      label + (count ? ' <span style="opacity:0.7;">' + count + '</span>' : '') + '</button>';
  }

  function aiVerdictBlock(v) {
    if (!v) return '';
    var verdict = v.verdict || '—';
    var color = verdict === 'ok' ? 'var(--ok)' : verdict === 'reject' ? 'var(--err)' : 'var(--warn)';
    var fields = '';
    if (v.extracted && typeof v.extracted === 'object') {
      var parts = [];
      for (var k in v.extracted) if (v.extracted[k]) parts.push(esc(k) + ': ' + esc(String(v.extracted[k])));
      if (parts.length) fields = '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:6px;">' + parts.join(' · ') + '</div>';
    }
    return '<div style="margin-top:10px; padding:11px 13px; background:var(--bg); border:1.5px solid var(--line); border-radius:10px;">' +
      '<div style="font-size:var(--text-micro); font-weight:600; color:' + color + '; text-transform:uppercase; letter-spacing:0.04em;">ИИ: ' + esc(verdict) + '</div>' +
      (v.reason ? '<div style="font-size:var(--text-caption); color:var(--ink); margin-top:5px; line-height:1.45;">' + esc(v.reason) + '</div>' : '') +
      fields + '</div>';
  }

  function adminFileCard(f) {
    var m = MOD_BADGE[f.status] || ['—', 'var(--muted)'];
    var who = (f.decided_by === 'ai') ? 'решил ИИ' : (f.decided_by === 'admin' ? 'решил админ' : '');
    var busy = state.admin.busy === f.id;

    var decide = '';
    if (state.admin.rejectFor === f.id) {
      decide = '<div style="margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
        '<input data-field="adminReason" value="' + esc(state.admin.reason || '') + '" placeholder="Причина отказа — её увидит студент" style="flex:1; min-width:240px; font-size:var(--text-body); padding:9px 12px; border:1.5px solid var(--line); border-radius:9px;">' +
        '<button data-action="adminConfirmReject" data-id="' + esc(f.id) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--err); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button>' +
        '<button data-action="adminCancelReject" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Отмена</button></div>';
    } else {
      var approveLabel = f.status === 'approved' ? 'Одобрено' : 'Одобрить';
      decide = '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button data-action="adminOpenFile" data-path="' + esc(f.path) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Открыть файл</button>' +
        '<button data-action="adminApprove" data-id="' + esc(f.id) + '"' + (busy || f.status === 'approved' ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;' + (busy || f.status === 'approved' ? ' opacity:0.5; cursor:not-allowed;' : '') + '">' + approveLabel + '</button>' +
        '<button data-action="adminStartReject" data-id="' + esc(f.id) + '"' + (busy ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1.5px solid color-mix(in srgb, var(--err) 30%, #fff); padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button></div>';
    }

    var context = [f.student_status, f.student_institution].filter(Boolean).join(' · ');
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:18px 20px;">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap;">' +
        '<div style="min-width:0;">' +
          '<div style="font-weight:600; font-size:var(--text-body);">' + esc(KIND_LABEL[f.kind] || f.kind) + (HUMAN_ONLY[f.kind] ? ' <span style="font-size:var(--text-micro); font-weight:600; color:var(--warn); background:color-mix(in srgb, var(--warn) 12%, #fff); padding:2px 7px; border-radius:999px;">только вручную</span>' : '') + '</div>' +
          '<div style="font-size:var(--text-caption); color:var(--muted); margin-top:3px;">' + esc(f.student_name || 'Студент') + (context ? ' · ' + esc(context) : '') + '</div>' +
          '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:3px;">' + esc(f.name || '—') + ' · ' + esc(fmtDate(f.created_at)) + '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
          '<span style="font-size:var(--text-micro); font-weight:600; color:' + m[1] + '; background:color-mix(in srgb, ' + m[1] + ' 12%, #fff); padding:4px 9px; border-radius:6px;">' + m[0] + '</span>' +
          (who ? '<span style="font-size:var(--text-micro); color:var(--muted);">' + who + '</span>' : '') +
        '</div>' +
      '</div>' +
      (f.reason ? '<div style="margin-top:8px; font-size:var(--text-caption); color:var(--err);">Причина: ' + esc(f.reason) + '</div>' : '') +
      aiVerdictBlock(f.ai_verdict) + decide + '</div>';
  }

  function adminCompanyCard(c) {
    var d = c.data || {};
    var st = { pending: ['на проверке', 'var(--warn)'], approved: ['подтверждена', 'var(--ok)'], rejected: ['отклонена', 'var(--err)'] }[c.status] || ['—', 'var(--muted)'];
    var rows = [['ИНН', d.inn], ['Руководитель', d.director], ['Контакт', d.contact], ['Телефон', d.phone], ['Почта', d.corpEmail], ['LinkedIn', d.linkedin]]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return '<div style="font-size:var(--text-caption); color:var(--muted);">' + esc(r[0]) + ': <span style="color:var(--ink); font-weight:600;">' + esc(r[1]) + '</span></div>'; }).join('');
    var busy = state.admin.busy === c.id;
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:18px 20px;">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px;">' +
        '<div style="min-width:0;"><div style="font-weight:600; font-size:var(--text-body);">' + esc(d.name || 'Компания') + '</div>' +
        '<div style="margin-top:6px; display:flex; flex-direction:column; gap:3px;">' + rows + '</div></div>' +
        '<span style="font-size:var(--text-micro); font-weight:600; color:' + st[1] + '; background:color-mix(in srgb, ' + st[1] + ' 12%, #fff); padding:4px 9px; border-radius:6px; flex-shrink:0;">' + st[0] + '</span>' +
      '</div>' +
      '<div style="margin-top:12px; display:flex; gap:8px;">' +
        '<button data-action="adminCompanyDecide" data-id="' + esc(c.id) + '" data-status="approved"' + (busy || c.status === 'approved' ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;' + (busy || c.status === 'approved' ? ' opacity:0.5; cursor:not-allowed;' : '') + '">Подтвердить</button>' +
        '<button data-action="adminCompanyDecide" data-id="' + esc(c.id) + '" data-status="rejected"' + (busy || c.status === 'rejected' ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1.5px solid color-mix(in srgb, var(--err) 30%, #fff); padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button>' +
      '</div></div>';
  }

  // Заявка на смену статуса. Отличается от файла тем, что решение меняет данные профиля,
  // поэтому рядом со ссылкой на документ показываем, что именно изменится.
  function adminStatusCard(r) {
    var st = { pending: ['ждёт решения', 'var(--warn)'], approved: ['одобрена', 'var(--ok)'], rejected: ['отклонена', 'var(--err)'] }[r.status] || ['—', 'var(--muted)'];
    var busy = state.admin.busy === r.id;
    var actionsHtml = '';
    if (state.admin.rejectFor === r.id) {
      actionsHtml = '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<input data-field="adminReason" value="' + esc(state.admin.reason || '') + '" placeholder="Причина отказа — её увидит студент" style="flex:1; min-width:240px; font-size:var(--text-body); padding:9px 12px; border:1.5px solid var(--line); border-radius:9px;">' +
        '<button data-action="adminStatusConfirmReject" data-id="' + esc(r.id) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--err); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button>' +
        '<button data-action="adminCancelReject" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Отмена</button></div>';
    } else if (r.status === 'pending') {
      actionsHtml = '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
        (r.path ? '<button data-action="adminOpenFile" data-path="' + esc(r.path) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Открыть документ</button>' : '') +
        '<button data-action="adminStatusApprove" data-id="' + esc(r.id) + '" data-path="' + esc(r.path || '') + '"' + (busy ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;' + (busy ? ' opacity:0.5;' : '') + '">Подтвердить статус</button>' +
        '<button data-action="adminStatusStartReject" data-id="' + esc(r.id) + '"' + (busy ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1.5px solid color-mix(in srgb, var(--err) 30%, #fff); padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button></div>';
    }
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:18px 20px;">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px;">' +
        '<div style="min-width:0;"><div style="font-weight:600; font-size:var(--text-body);">' + esc(r.student_name || 'Студент') + '</div>' +
        '<div style="margin-top:6px; font-size:var(--text-caption); color:var(--muted);">' + esc(r.from_status || '—') + ' → <span style="color:var(--ink); font-weight:600;">' + esc(r.to_status || '') + '</span></div>' +
        (r.reason ? '<div style="margin-top:4px; font-size:var(--text-micro); color:var(--err);">Причина отказа: ' + esc(r.reason) + '</div>' : '') +
        (!r.path && r.status === 'pending' ? '<div style="margin-top:4px; font-size:var(--text-micro); color:var(--err);">Документ не приложен</div>' : '') +
        '</div>' +
        '<span style="font-size:var(--text-micro); font-weight:600; color:' + st[1] + '; background:color-mix(in srgb, ' + st[1] + ' 12%, #fff); padding:4px 9px; border-radius:6px; flex-shrink:0;">' + st[0] + '</span>' +
      '</div>' + actionsHtml + '</div>';
  }

  // Справка о стажировке. Текст пойдёт на публичную страницу с именем человека, поэтому
  // читаем его целиком — это главное, что здесь проверяется.
  function adminCertCard(c) {
    var st = { pending: ['на проверке', 'var(--warn)'], published: ['опубликована', 'var(--ok)'], rejected: ['отклонена', 'var(--err)'] }[c.status] || ['—', 'var(--muted)'];
    var busy = state.admin.busy === c.id;
    var period = (c.started_at ? fmtDate(c.started_at) : '') + (c.finished_at ? ' — ' + fmtDate(c.finished_at) : '');
    var actionsHtml = '';
    if (state.admin.rejectFor === c.id) {
      actionsHtml = '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<input data-field="adminReason" value="' + esc(state.admin.reason || '') + '" placeholder="Причина отказа — её увидит компания" style="flex:1; min-width:240px; font-size:var(--text-body); padding:9px 12px; border:1.5px solid var(--line); border-radius:9px;">' +
        '<button data-action="adminCertConfirmReject" data-id="' + esc(c.id) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--err); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button>' +
        '<button data-action="adminCancelReject" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Отмена</button></div>';
    } else if (c.status === 'pending') {
      actionsHtml = '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button data-action="adminCertPublish" data-id="' + esc(c.id) + '"' + (busy ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;' + (busy ? ' opacity:0.5;' : '') + '">Опубликовать</button>' +
        '<button data-action="adminCertStartReject" data-id="' + esc(c.id) + '"' + (busy ? ' disabled' : '') + ' style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1.5px solid color-mix(in srgb, var(--err) 30%, #fff); padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button></div>';
    } else if (c.status === 'published') {
      actionsHtml = '<div style="margin-top:12px;"><a href="/cert/' + esc(c.public_id) + '" target="_blank" rel="noopener" style="font-size:var(--text-micro); font-weight:600; color:var(--accent);">Открыть публичную страницу ↗</a></div>';
    }

    // Официальное свидетельство от компании — отдельное решение: справка может быть уже
    // опубликована, а бумагу компания приложит позже.
    var docBlock = '';
    if (c.doc_status) {
      var dst = { pending: ['ждёт проверки', 'var(--warn)'], approved: ['принято', 'var(--ok)'], rejected: ['отклонено', 'var(--err)'] }[c.doc_status] || ['—', 'var(--muted)'];
      docBlock = '<div style="margin-top:14px; padding-top:14px; border-top:1.5px solid var(--line);">' +
        '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Официальное свидетельство ' +
        '<span style="font-size:var(--text-micro); font-weight:600; color:' + dst[1] + '; background:color-mix(in srgb, ' + dst[1] + ' 12%, #fff); padding:3px 8px; border-radius:6px; margin-left:4px;">' + dst[0] + '</span></div>' +
        '<div style="font-size:var(--text-micro); color:var(--muted); margin-bottom:8px;">От: ' + esc(c.company_name || '') + ' · Для: ' + esc(c.student_name || '') + (c.doc_name ? ' · ' + esc(c.doc_name) : '') + '</div>' +
        (c.doc_status === 'pending'
          ? '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            (c.doc_path ? '<button data-action="adminOpenFile" data-path="' + esc(c.doc_path) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 14px; border-radius:9px; cursor:pointer;">Открыть документ</button>' : '') +
            '<button data-action="adminCertDocApprove" data-id="' + esc(c.id) + '" style="font-size:var(--text-micro); font-weight:600; color:#fff; background:var(--ok); border:none; padding:9px 14px; border-radius:9px; cursor:pointer;">Принять</button>' +
            '<button data-action="adminCertDocReject" data-id="' + esc(c.id) + '" style="font-size:var(--text-micro); font-weight:600; color:var(--err); background:#fff; border:1.5px solid color-mix(in srgb, var(--err) 30%, #fff); padding:9px 14px; border-radius:9px; cursor:pointer;">Отклонить</button></div>'
          : (c.doc_reason ? '<div style="font-size:var(--text-micro); color:var(--err);">Причина: ' + esc(c.doc_reason) + '</div>' : '')) +
        '</div>';
    }
    return '<div style="background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:18px 20px;">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px;">' +
        '<div style="min-width:0;"><div style="font-weight:600; font-size:var(--text-body);">' + esc(c.student_name || 'Студент') + '</div>' +
        '<div style="margin-top:5px; font-size:var(--text-caption); color:var(--muted);">' + esc(c.company_name || '') + ' · ' + esc(c.gig_title || '') + (period ? ' · ' + esc(period) : '') + '</div>' +
        '<div style="margin-top:4px; font-size:var(--text-micro); color:var(--muted);">Оценка компании: <strong style="color:var(--ink);">' + esc(String(c.score)) + '/5</strong> <span style="opacity:0.7;">(в справку не попадёт)</span></div>' +
        '<div style="margin-top:10px; padding:12px 14px; background:var(--bg); border-radius:10px; font-size:var(--text-caption); line-height:1.6; white-space:pre-wrap; ' + S.wrap + '">' + esc(c.body || '') + '</div>' +
        (c.reason ? '<div style="margin-top:6px; font-size:var(--text-micro); color:var(--err);">Причина отказа: ' + esc(c.reason) + '</div>' : '') +
        '</div>' +
        '<span style="font-size:var(--text-micro); font-weight:600; color:' + st[1] + '; background:color-mix(in srgb, ' + st[1] + ' 12%, #fff); padding:4px 9px; border-radius:6px; flex-shrink:0;">' + st[0] + '</span>' +
      '</div>' + actionsHtml + docBlock + '</div>';
  }

  // Все задачи платформы. Не модерация — обзор: что размещено, набралось ли, чем кончилось.
  function adminGigsTable(gigs) {
    if (!gigs.length) return '<div style="' + RO_CARD + ' text-align:center; color:var(--muted); font-size:var(--text-caption);">Задач пока нет.</div>';
    var rows = gigs.map(function (g, i) {
      var seats = Math.max(parseInt(String(g.slots || '1').match(/\d+/), 10) || 1, 1);
      var st = g.closed_at ? ['снята', 'var(--err)'] : g.is_open ? ['в каталоге', 'var(--ok)'] : ['мест нет', 'var(--muted)'];
      /* Разделитель отделяет строки друг от друга, поэтому у первой его быть не
         должно: раньше он рисовался у всех и висел под самым краем карточки,
         а компенсировали это, урезав верхний отступ контейнера с 24 до 6px. */
      var sep = i ? 'border-top:1.5px solid var(--line); ' : '';
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:14px; padding:13px 0; ' + sep + 'flex-wrap:wrap;">' +
        '<div style="min-width:0; flex:1;">' +
          '<div style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(g.title || 'Без названия') + '</div>' +
          '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:2px;">' + esc(g.company_name || '') + ' · ' + esc(fmtDate(g.created_at)) + '</div></div>' +
        '<div style="display:flex; align-items:center; gap:16px; font-size:var(--text-micro); color:var(--muted); flex-wrap:wrap;">' +
          '<span title="Откликов всего">' + g.applications + ' ' + pluralRu(g.applications, 'отклик', 'отклика', 'откликов') + '</span>' +
          '<span title="Занято мест">занято ' + g.taken + ' из ' + seats + '</span>' +
          '<span title="Завершено стажировок">завершено ' + g.completed + '</span>' +
          '<span style="font-size:var(--text-micro); font-weight:600; color:' + st[1] + '; background:color-mix(in srgb, ' + st[1] + ' 12%, #fff); padding:4px 9px; border-radius:6px;">' + st[0] + '</span>' +
        '</div></div>';
    }).join('');
    /* Строки несут по 13px своих вертикальных отступов, поэтому у контейнера
       11px: 11+13 = 24 сверху и снизу, ровно как по бокам. До этого было
       19px сверху и 37px снизу. */
    return '<div style="' + RO_CARD + ' padding:11px 24px;">' + rows + '</div>';
  }

  function adminView() {
    if (!state.isAdmin) return homeView();
    var a = state.admin;
    var items = a.items || [];
    var pending = items.filter(function (f) { return f.status === 'pending'; });
    var byAi = items.filter(function (f) { return f.decided_by === 'ai'; });
    var shown = a.tab === 'pending' ? pending : a.tab === 'ai' ? byAi : items;
    var pendingCompanies = (a.companies || []).filter(function (c) { return c.status === 'pending'; });
    var certs = a.certs || [];

    var tabs = '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;">' +
      // Считаем всё, что ждёт решения, а не только файлы: иначе счётчик показывает 0,
      // когда в очереди висит справка или заявка на смену статуса.
      adminTab('pending', 'Ждут решения', pending.length + pendingCompanies.length +
        (a.statusReqs || []).filter(function (r) { return r.status === 'pending'; }).length +
        certs.filter(function (c) { return c.status === 'pending' || c.doc_status === 'pending'; }).length) +
      adminTab('ai', 'Одобрено ИИ', byAi.length) +
      adminTab('all', 'Все решения', items.length) +
      adminTab('gigs', 'Задачи', (a.gigs || []).length) +
      '<button data-action="adminRefresh" style="font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 16px; border-radius:10px; cursor:pointer; margin-left:auto;">Обновить</button></div>';

    var companies = (a.tab === 'pending' && pendingCompanies.length)
      ? '<div style="font-weight:600; font-size:var(--text-title); margin:6px 0 12px;">Заявки компаний</div>' +
        '<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:30px;">' + pendingCompanies.map(adminCompanyCard).join('') + '</div>'
      : (a.tab === 'all'
        ? '<div style="font-weight:600; font-size:var(--text-title); margin:6px 0 12px;">Заявки компаний</div>' +
          '<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:30px;">' + (a.companies || []).map(adminCompanyCard).join('') + '</div>'
        : '');

    var body;
    if (a.loading) body = '<div style="' + RO_CARD + ' text-align:center; color:var(--muted); font-size:var(--text-caption);">Загружаем очередь…</div>';
    else if (a.error) body = '<div style="' + RO_CARD + ' text-align:center; color:var(--err); font-size:var(--text-caption); font-weight:600;">' + esc(a.error) + '</div>';
    else if (!shown.length) body = '<div style="' + RO_CARD + ' text-align:center; color:var(--muted); font-size:var(--text-caption);">' + (a.tab === 'pending' ? 'Ничего не ждёт решения — очередь пуста.' : 'Пока пусто.') + '</div>';
    else body = '<div style="display:flex; flex-direction:column; gap:12px;">' + shown.map(adminFileCard).join('') + '</div>';

    // Заявки на смену статуса: решение меняет данные профиля, поэтому держим их
    // отдельным блоком выше файлов — их мало, и пропускать их нельзя.
    var sReqs = a.statusReqs || [];
    var sShown = a.tab === 'all' ? sReqs : sReqs.filter(function (r) { return r.status === 'pending'; });
    var statuses = (a.tab === 'ai' || !sShown.length) ? ''
      : '<div style="font-weight:600; font-size:var(--text-title); margin:6px 0 12px;">Смена статуса</div>' +
        '<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:30px;">' + sShown.map(adminStatusCard).join('') + '</div>';

    // Справки: текст уходит на публичную страницу с именем человека, поэтому раздел
    // держим сразу под заявками на статус — пропускать его нельзя.
    // Решения ждёт либо сама справка, либо приложенное к ней свидетельство: справка
    // может быть давно опубликована, а бумагу компания принесёт через неделю.
    var cShown = a.tab === 'all' ? certs : certs.filter(function (c) {
      return c.status === 'pending' || c.doc_status === 'pending';
    });
    var certsBlock = (a.tab === 'ai' || !cShown.length) ? ''
      : '<div style="font-weight:600; font-size:var(--text-title); margin:6px 0 12px;">Справки о стажировке</div>' +
        '<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:30px;">' + cShown.map(adminCertCard).join('') + '</div>';

    // Отдельная вкладка: это обзор, а не очередь — смешивать с модерацией незачем.
    if (a.tab === 'gigs') return pageWrap('Модерация', tabs + adminGigsTable(a.gigs || []), 1200);

    var title = '<div style="font-weight:600; font-size:var(--text-title); margin:6px 0 12px;">Файлы студентов</div>';
    return pageWrap('Модерация', tabs + companies + statuses + certsBlock + title + body, 1200);
  }

  /* ---------- PROFILE (чужой) ---------- */
  function chipList(items) {
    if (!items || !items.length) return '';
    return '<div style="display:flex; flex-wrap:wrap; gap:7px;">' + items.map(function (t) {
      return '<span style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:var(--bg); border:1.5px solid var(--line); padding:5px 10px; border-radius:7px;">' + esc(String(t)) + '</span>';
    }).join('') + '</div>';
  }
  function profileText(s) {
    if (!s) return '';
    return '<p style="font-size:var(--text-body); line-height:1.6; color:var(--ink); margin:0; white-space:pre-wrap;">' + esc(s) + '</p>';
  }
  var COMM_STYLE = { async: 'Асинхронно', sync: 'Синхронно, в рабочие часы' };
  var CADENCE = { weekly: 'Раз в неделю', biweekly: 'Раз в две недели', daily: 'Ежедневно' };

  // Read-only карточки под вид личного кабинета: тот же стиль, но без кнопок редактирования.
  var RO_CARD = 'background:#fff; border:1.5px solid var(--line); border-radius:16px; padding:24px;';
  var RO_TITLE = 'font-weight:600; font-size:var(--text-body);';
  // Ссылка на подтверждающий файл в чужом профиле. Сюда доходят только одобренные файлы:
  // неодобренные вырезает student_public ещё в базе. url — подписанная ссылка, выданная
  // при загрузке, поэтому компании отдельный доступ к приватному бакету не нужен.
  function roFileLink(file, inline) {
    if (!file || !file.url) return '';
    return '<a href="' + esc(file.url) + '" target="_blank" rel="noopener" style="display:inline-block; ' +
      (inline ? '' : 'margin-top:10px; ') + 'font-size:var(--text-micro); font-weight:600; color:var(--accent); ' + S.wrap + '">📎 ' +
      esc(file.name || 'Документ') + ' ↗</a>';
  }

  function roCard(title, inner) {
    return '<div style="' + RO_CARD + '">' + (title ? '<div style="' + RO_TITLE + ' margin-bottom:14px;">' + title + '</div>' : '') + inner + '</div>';
  }
  function roRow(label, value) {
    return '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1.5px solid var(--line);"><span style="font-size:var(--text-caption); color:var(--muted);">' + label + '</span><span style="font-size:var(--text-caption); font-weight:600; text-align:right; word-break:break-word;">' + esc(value || '—') + '</span></div>';
  }
  function roAvatar(photo, name) {
    if (photo) return '<img src="' + esc(photo) + '" alt="" style="width:64px; height:64px; border-radius:18px; object-fit:cover; flex-shrink:0;">';
    var init = (name || 'С').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'С';
    return '<span style="width:64px; height:64px; border-radius:18px; background:color-mix(in srgb, var(--accent) 11%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:var(--text-h2); flex-shrink:0;">' + esc(init) + '</span>';
  }
  function roStack(cards) {
    return cards.filter(Boolean).map(function (c) { return '<div style="margin-top:20px;">' + c + '</div>'; }).join('');
  }

  // Профиль компании глазами студента — вид как в кабинете компании, только без полей ввода.
  function companyProfileHtml(c) {
    var header = '<div style="' + RO_CARD + ' display:flex; align-items:center; gap:18px;">' +
      '<span style="width:64px; height:64px; border-radius:16px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--text-h2); flex-shrink:0;">◆</span>' +
      '<div style="min-width:0;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em;">' + esc(c.name || 'Компания') + '</span>' +
      '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 10%, #fff); padding:4px 9px; border-radius:6px;">✓ подтверждена</span></div>' +
      (c.pitch ? '<div style="font-size:var(--text-caption); color:var(--muted); margin-top:6px;">' + esc(c.pitch) + '</div>' : '') + '</div></div>';

    var cards = [];
    if (c.description) cards.push(roCard('О компании', profileText(c.description)));

    var techInner = '';
    if (c.focus_areas && c.focus_areas.length) techInner += '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Основные направления</div>' + chipList(c.focus_areas);
    if (c.tech_stack && c.tech_stack.length) techInner += '<div style="font-size:var(--text-caption); font-weight:600; margin:' + (techInner ? '16px' : '0') + ' 0 8px;">Технологический стек</div>' + chipList(c.tech_stack);
    if (techInner) cards.push(roCard('Технический профиль', techInner));

    var fmt = '';
    if (c.comm_style) fmt += roRow('Коммуникация', COMM_STYLE[c.comm_style] || c.comm_style);
    if (c.sync_hours) fmt += roRow('Рабочие часы', c.sync_hours);
    if (c.meeting_cadence) fmt += roRow('Периодичность созвонов', CADENCE[c.meeting_cadence] || c.meeting_cadence);
    if (fmt) cards.push(roCard('Формат работы', fmt));

    if (c.mentor_name) cards.push(roCard('Куратор для стажёров', '<div style="font-size:var(--text-body);"><strong>' + esc(c.mentor_name) + '</strong>' + (c.mentor_role ? '<span style="color:var(--muted);"> · ' + esc(c.mentor_role) + '</span>' : '') + '</div>'));

    if (c.linkedin) cards.push(roCard('Ссылки', '<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener noreferrer" style="font-size:var(--text-caption); color:var(--accent); font-weight:600; word-break:break-all;">' + esc(c.linkedin) + '</a>'));

    if (!cards.length) cards.push('<div style="' + RO_CARD + ' font-size:var(--text-caption); color:var(--muted); line-height:1.55;">Компания ещё не заполнила профиль. Детали о задаче можно обсудить в чате отклика.</div>');

    return header + roStack(cards);
  }

  // Профиль студента глазами компании — вид как в кабинете студента, только без редактирования.
  function studentProfileHtml(s) {
    var name = ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || 'Студент';
    var sub = [s.study_status, s.institution].filter(Boolean).join(' · ');
    var availTag = s.availability
      ? '<span style="display:inline-flex; align-items:center; gap:6px; font-size:var(--text-micro); font-weight:600; color:' + availColor(s.availability) + '; background:color-mix(in srgb, ' + availColor(s.availability) + ' 12%, #fff); padding:4px 11px; border-radius:999px;"><span style="width:6px; height:6px; border-radius:50%; background:' + availColor(s.availability) + ';"></span>' + esc(availLabel(s.availability)) + '</span>'
      : '';

    var header = '<div style="' + RO_CARD + ' display:flex; align-items:center; gap:18px; flex-wrap:wrap;">' +
      roAvatar(s.photo_url, name) +
      '<div style="min-width:0; flex:1;"><div style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em;">' + esc(name) + '</div>' +
      (sub ? '<div style="font-size:var(--text-caption); color:var(--muted); margin-top:5px;">' + esc(sub) + '</div>' : '') +
      (availTag ? '<div style="margin-top:10px;">' + availTag + '</div>' : '') + '</div></div>';

    var cards = [];

    // Контакты: представление отдаёт email/tg только после приглашения; иначе поля null.
    if (s.email || s.tg) {
      cards.push(roCard('Контакты', (s.email ? roRow('Email', s.email) : '') + (s.tg ? roRow('Telegram', s.tg) : '')));
    } else {
      cards.push(roCard('Контакты', '<div style="font-size:var(--text-caption); color:var(--muted); background:var(--bg); border:1.5px solid var(--line); border-radius:10px; padding:12px 14px; line-height:1.5;">Контакты откроются после того, как вы пригласите студента. До этого пишите в чате отклика.</div>'));
    }

    if (s.specialties && s.specialties.length) cards.push(roCard('Специальности', chipList(s.specialties)));
    if (s.description) cards.push(roCard('О себе', profileText(s.description)));

    var skills = (s.hard_skills || []);
    var langs = (s.languages || []);
    if (skills.length || langs.length) {
      var inner = '';
      if (skills.length) {
        inner += '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:10px;">Hard skills</div>' +
          '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">' +
          skills.map(function (sk) {
            var nm = typeof sk === 'string' ? sk : sk.name;
            var conf = typeof sk === 'object' ? sk.confidence : null;
            return '<div style="border:1.5px solid var(--line); border-radius:12px; padding:13px 14px;"><div style="display:flex; align-items:center; gap:8px;"><span style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(nm) + '</span>' +
              (typeof conf === 'number' ? '<span style="font-size:var(--text-micro); font-weight:600; color:' + confidenceColor(conf) + '; background:color-mix(in srgb, ' + confidenceColor(conf) + ' 12%, #fff); padding:2px 8px; border-radius:999px; flex-shrink:0;">' + conf + '/10</span>' : '') + '</div>' +
              (sk && sk.description ? '<p style="font-size:var(--text-micro); color:var(--muted); line-height:1.5; margin:8px 0 0; ' + S.wrap + '">' + esc(sk.description) + '</p>' : '') +
              roFileLink(sk && sk.file) + '</div>';
          }).join('') + '</div>';
      }
      if (langs.length) {
        inner += '<div style="font-size:var(--text-caption); font-weight:600; margin:' + (skills.length ? '18px' : '0') + ' 0 4px;">Знание языков</div>' +
          langs.map(function (l) {
            var nm = typeof l === 'string' ? l : l.name;
            var lvl = typeof l === 'object' ? l.level : '';
            return '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 0; border-top:1.5px solid var(--line); font-size:var(--text-caption);"><strong style="font-weight:600;">' + esc(nm) + '</strong>' + (lvl ? '<span style="color:var(--muted);">— ' + esc(lvl) + '</span>' : '') + roFileLink(l && l.file, true) + '</div>';
          }).join('');
      }
      cards.push(roCard('Матрица навыков', inner));
    }

    if (s.ai_test && s.ai_test.level) {
      cards.push(roCard('ИИ-тест навыков', '<div style="font-size:var(--text-body);">Уровень: <strong style="color:' + levelColor(s.ai_test.level) + ';">' + esc(s.ai_test.level) + '</strong>' +
        (s.ai_test.correct != null && s.ai_test.total != null ? '<span style="color:var(--muted);"> · ' + esc(String(s.ai_test.correct)) + ' из ' + esc(String(s.ai_test.total)) + '</span>' : '') + '</div>'));
    }

    if (s.projects && s.projects.length) {
      var pcards = s.projects.map(function (p) {
        var files = p.files || [];
        var cover = files[0];
        var coverHtml = cover
          ? (isImageFile(cover)
              ? '<img src="' + esc(cover.url) + '" style="width:100%; height:140px; object-fit:cover; border-radius:13px 13px 0 0; display:block;">'
              : '<div style="width:100%; height:140px; background:var(--bg); border-radius:13px 13px 0 0; display:flex; align-items:center; justify-content:center; color:var(--muted);">' + icon('file', 30) + '</div>')
          : '';
        var specTag = p.specialty ? '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 8px; border-radius:6px;">' + esc(p.specialty) + '</span>' : '';
        var tagChips = (p.tags || []).slice(0, 4).map(function (t) { return '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:2px 7px; border-radius:999px;">#' + esc(t) + '</span>'; }).join('');
        return '<div style="border:1.5px solid var(--line); border-radius:14px; overflow:hidden;">' + coverHtml +
          '<div style="padding:14px 16px;"><div style="font-weight:600; font-size:var(--text-body); ' + S.wrap + '">' + esc(p.name || 'Проект') + '</div>' +
          (specTag ? '<div style="margin-top:6px;">' + specTag + '</div>' : '') +
          (p.desc ? '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.5; margin:8px 0 0; ' + S.wrap + '">' + esc(p.desc) + '</p>' : '') +
          (tagChips ? '<div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:8px;">' + tagChips + '</div>' : '') + '</div></div>';
      }).join('');
      cards.push(roCard('Проекты', '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">' + pcards + '</div>'));
    }

    if (s.achievements && s.achievements.length) {
      var acards = s.achievements.map(function (a) {
        var link = a.file ? a.file.url : a.link;
        var fileLabel = a.file ? a.file.name : (a.link ? 'ссылка' : '');
        return '<div style="scroll-snap-align:start; flex-shrink:0; width:230px; border:1.5px solid var(--line); border-radius:14px; padding:16px;">' +
          '<div style="width:34px; height:34px; border-radius:9px; background:color-mix(in srgb, var(--accent) 10%, #fff); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:var(--text-body); margin-bottom:12px;">★</div>' +
          '<div style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(a.title) + '</div>' +
          '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:4px; ' + S.wrap + '">' + esc(a.issuer || '') + (a.date ? ' · ' + esc(a.date) : '') + '</div>' +
          (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:var(--text-micro); font-weight:600; color:var(--accent); ' + S.wrap + '">📎 ' + esc(fileLabel || 'Открыть') + ' ↗</a>' : '') + '</div>';
      }).join('');
      cards.push(roCard('Сертификаты и достижения', '<div style="display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:6px;">' + acards + '</div>'));
    }

    return header + roStack(cards);
  }

  function profileViewPage() {
    var pv = state.profileView;
    if (!pv) return homeView();
    var inner;
    if (pv.loading) inner = '<div style="' + RO_CARD + ' text-align:center; color:var(--muted); font-size:var(--text-caption);">Загружаем профиль…</div>';
    else if (pv.error) inner = '<div style="' + RO_CARD + ' text-align:center; color:var(--err); font-size:var(--text-caption); font-weight:600;">' + esc(pv.error) + '</div>';
    else inner = pv.kind === 'company' ? companyProfileHtml(pv.data) : studentProfileHtml(pv.data);

    return '<main class="view-in" style="width:100%; max-width:1200px; margin:0 auto; padding:40px 28px 88px;">' +
      '<button data-action="closeProfile" style="' + S.back + ' background:none; border:none; cursor:pointer; padding:0; margin-bottom:20px;">← Назад</button>' +
      inner + '</main>';
  }

  /* ---------- CHAT ---------- */
  // Ссылку на созвон приписывает триггер в БД, в конец системного сообщения. Ссылкой делаем
  // только то, что прошло строгую проверку: https, без пробелов и кавычек.
  var MEET_URL = /https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]*)?$/;
  function systemBubble(body) {
    var wrap = 'align-self:center; max-width:80%; font-size:var(--text-micro); color:var(--muted); background:var(--bg); border:1.5px solid var(--line); padding:9px 14px; border-radius:10px;';
    var hit = String(body).match(MEET_URL);
    if (!hit) return '<div style="' + wrap + ' text-align:center;">' + esc(body) + '</div>';

    var url = hit[0];
    var text = String(body).slice(0, hit.index).replace(/[\s:·—-]+$/, '');
    return '<div style="' + wrap + ' text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px;">' +
      '<span>' + esc(text) + '</span>' +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:8px; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--accent); padding:9px 16px; border-radius:9px; text-decoration:none;">Присоединиться к созвону</a>' +
      '<span style="font-size:var(--text-micro); color:var(--muted); word-break:break-all;">' + esc(url) + '</span>' +
    '</div>';
  }
  function messageBubble(m) {
    if (m.sender_role === 'system') return systemBubble(m.body);
    var mine = m.sender_role === state.authRole;
    var bubble = mine
      ? 'align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:4px;'
      : 'align-self:flex-start; background:#fff; color:var(--ink); border:1.5px solid var(--line); border-bottom-left-radius:4px;';
    var time = new Date(m.created_at);
    var stamp = isNaN(time) ? '' : time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return '<div style="max-width:76%; padding:10px 14px; border-radius:14px; font-size:var(--text-caption); line-height:1.45; white-space:pre-wrap; word-break:break-word; ' + bubble + '">' +
      esc(m.body) +
      '<span style="display:block; margin-top:4px; font-size:var(--text-micro); opacity:0.65;">' + esc(stamp) + '</span></div>';
  }
  function chatView() {
    var c = state.chat;
    if (!c || !state.authRole) return homeView();

    var thread;
    if (c.loading) thread = '<div style="text-align:center; padding:40px; color:var(--muted); font-size:var(--text-caption);">Загружаем переписку…</div>';
    else if (c.messages.length) thread = c.messages.map(messageBubble).join('');
    else thread = '<div style="text-align:center; padding:40px; color:var(--muted); font-size:var(--text-caption);">Сообщений пока нет.</div>';

    // Имя собеседника ведёт в его профиль; вернёмся оттуда обратно в эту же ветку.
    var peerAttrs = state.authRole === 'company'
      ? 'data-action="openStudentProfile" data-student-id="' + esc(c.studentId || '') + '"'
      : 'data-action="openCompanyProfile" data-company-id="' + esc(c.companyAppId || '') + '"';
    var head = '<div style="display:flex; align-items:center; gap:14px; margin-bottom:18px;">' +
      '<button data-action="closeChat" style="' + S.back + ' background:none; border:none; cursor:pointer; padding:0;">← Назад</button>' +
      '<div style="min-width:0;">' +
        '<a ' + peerAttrs + ' data-back="chat" style="font-weight:600; font-size:var(--text-h2); letter-spacing:-0.01em; cursor:pointer; text-decoration:none; color:var(--ink); border-bottom:1.5px solid var(--line);">' + esc(c.peer) + '</a>' +
        (c.gigTitle ? '<div style="font-size:var(--text-caption); color:var(--muted);">' + esc(c.gigTitle) + '</div>' : '') +
      '</div></div>';

    var composer = '<div style="display:flex; gap:10px; align-items:flex-end; margin-top:14px;">' +
      /* --text-body, а не --text-caption: это поле ввода, а мобильный Safari
         принудительно зумит страницу при фокусе на поле мельче 16px. В S.input
         и S.field это уже исправлено, а сюда правка не дошла — переписку
         студент ведёт как раз с телефона. */
      '<textarea data-field="chatDraft" data-chat-input rows="1" placeholder="Написать сообщение…" style="flex:1; font-size:var(--text-body); padding:12px 14px; border:1.5px solid var(--line); border-radius:12px; font-family:inherit; line-height:1.45; resize:none; max-height:140px; background:#fff; color:var(--ink);">' + esc(state.form.chatDraft || '') + '</textarea>' +
      '<button data-action="sendMessage"' + (c.sending ? ' disabled' : '') + ' style="font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); border:none; padding:12px 20px; border-radius:12px; cursor:pointer;' + (c.sending ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (c.sending ? '…' : 'Отправить') + '</button>' +
    '</div>';

    var inner = head +
      '<div data-chat-thread style="background:var(--bg); border:1.5px solid var(--line); border-radius:16px; padding:18px; height:52vh; min-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">' + thread + '</div>' +
      (c.error ? '<div style="margin-top:10px; font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(c.error) + '</div>' : '') +
      composer;

    return '<main class="view-in" style="max-width:820px; margin:0 auto; padding:40px 28px 88px;">' + inner + '</main>';
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
      case 'chat': return chatView();
      case 'profile': return profileViewPage();
      case 'admin': return adminView();
      case 'cert': return certView();
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
  function setState(patch) {
    // Переход на другой экран закрывает мобильное меню — иначе оно остаётся
    // открытым поверх нового содержимого.
    if (patch.view && patch.view !== state.view) state.navOpen = false;
    for (var k in patch) state[k] = patch[k];
    render();
  }
  function top() { try { window.scrollTo(0, 0); } catch (e) {} }
  // Экран входа по коду общий для студента и компании — шаг пишется в свою ветку состояния.
  // У компании нет входа через Telegram, поэтому её первый экран — сразу ввод почты.
  function otpStepPatch(step) {
    if (state.otpRole !== 'company') return { studentStep: step };
    return { companyStep: step === 'login' ? 'email' : step };
  }

  var actions = {
    // Залогиненного логотип ведёт в рабочий раздел (каталог), а не на маркетинговый лендинг.
    goHome: function () { setState({ view: state.authRole ? 'catalog' : 'home' }); top(); },
    goStudent: function () {
      setState({ view: 'student', studentStep: 'login', otpRole: 'student', otp: { email: '', error: '', loading: false } }); top();
    },
    goStartupForm: function () {
      var step = state.companyProfile ? 'done' : (state.session && state.authRole === 'company' ? 'form' : 'email');
      setState({ view: 'company', companyStep: step, otpRole: 'company', otp: { email: '', error: '', loading: false } }); top();
    },
    // У компании каталога нет — уводим её в свои вакансии, чтобы старые ссылки
    // и кнопки не приводили на пустую витрину.
    goCatalog: function () {
      if (state.authRole === 'company') { actions.goVacancies(); return; }
      setState({ view: 'catalog' }); top();
    },
    goCabinet: function () { setState({ view: 'cabinet', extrasSave: { loading: false, error: '', ok: false } }); top(); },
    goResponses: function () { loadApplications(); setState({ view: 'responses' }); top(); },
    goVacancies: function () { loadApplications(); setState({ view: 'vacancies' }); top(); },
    respTab: function (el) { setState({ respTab: el.getAttribute('data-tab') }); },
    toggleGigClosed: function (el) {
      var id = el.getAttribute('data-gig-id');
      var closed = !!el.getAttribute('data-closed');
      if (!supabase || !id) return;
      supabase.rpc('set_gig_closed', { p_gig: id, p_closed: !closed }).then(function (r) {
        if (r.error) { alert(r.error.message || 'Не удалось изменить публикацию'); return; }
        loadGigs();
      });
    },
    openCompleteModal: function (el) {
      var a = findApplication(el.getAttribute('data-app-id'));
      if (!a) return;
      state.form.certBody = '';
      // Начало подставляем датой отклика, окончание — сегодняшним: компания поправит.
      state.form.certStart = (a.created_at || '').slice(0, 10);
      state.form.certEnd = new Date().toISOString().slice(0, 10);
      setState({ modal: 'complete', certModal: { appId: a.id, score: 5, error: '', loading: false } });
    },
    setCertScore: function (el) {
      state.certModal.score = Number(el.getAttribute('data-score'));
      setState({});
    },
    submitComplete: function () {
      var cm = state.certModal;
      var body = (state.form.certBody || '').trim();
      if (body.length < 120) { setState({ certModal: Object.assign({}, cm, { error: 'Характеристика слишком короткая — опишите, что студент делал и чего добился' }) }); return; }
      setState({ certModal: Object.assign({}, cm, { error: '', loading: true }) });
      supabase.rpc('complete_internship', {
        p_application_id: cm.appId, p_score: cm.score, p_body: body,
        p_started_at: state.form.certStart || null, p_finished_at: state.form.certEnd || null
      }).then(function (r) {
        if (r.error) {
          setState({ certModal: Object.assign({}, state.certModal, { loading: false, error: r.error.message || 'Не удалось завершить стажировку' }) });
          return;
        }
        state.form.certBody = '';
        setState({ modal: null, certModal: { appId: null, score: 5, error: '', loading: false } });
        loadApplications();
      });
    },
    // Меню открывается/закрывается без полной перерисовки — иначе тело страницы «дёргается» (повтор анимаций).
    toggleMenu: function () { state.menuOpen = !state.menuOpen; paintHeader(); },
    toggleNav: function () { state.navOpen = !state.navOpen; paintHeader(); },
    // Открывает окно авторизации Telegram через JS-API (своя кнопка вместо iframe-виджета).
    loginTelegram: function () { goToTelegram('login'); },
    // Привязка Telegram к открытому аккаунту. Уходим тем же редиректом, что и вход;
    // отличает их только намерение, сохранённое до перехода.
    linkTelegram: function () { goToTelegram('link'); },
    // Возврат из Telegram с намерением «привязать»: подпись проверяет Edge Function,
    // она же следит, чтобы этот Telegram не был занят другим аккаунтом.
    finishLinkTelegram: function (user) {
      if (!supabase || !user || !user.id) { setState({ tgAuth: { loading: false, error: 'Telegram не вернул данные' } }); return; }
      setState({ tgAuth: { loading: true, error: '' } });
      supabase.auth.getSession().then(function (s) {
        var token = s && s.data && s.data.session && s.data.session.access_token;
        if (!token) { setState({ tgAuth: { loading: false, error: 'Сессия истекла — войдите заново' } }); return; }
        return fetch(TG_LINK_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(user),
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok) { setState({ tgAuth: { loading: false, error: (res.body && res.body.error) || 'Не удалось привязать Telegram' } }); return; }
            state.tgAuth = { loading: false, error: '' };
            if (state.studentProfile && res.body.username) state.studentProfile.tg = '@' + res.body.username;
            loadAccountLinks();   // перерисует строку как «привязан»
            setState({});
          });
      }).catch(function (err) {
        setState({ tgAuth: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    /* --- привязка настоящей почты к аккаунту, заведённому через Telegram --- */
    startLinkEmail: function () { setState({ emailLink: { step: 'form', email: '', error: '', loading: false } }); },
    cancelLinkEmail: function () { setState({ emailLink: { step: null, email: '', error: '', loading: false } }); },
    // Меняем почту в auth.users. Supabase сам шлёт код на новый адрес — своего письма
    // не отправляем. Старый адрес синтетический, письма туда не идут, поэтому в настройках
    // Supabase должно быть выключено подтверждение с обоих адресов (Secure email change).
    sendLinkEmailCode: function () {
      var input = document.getElementById('link-email-input');
      var email = input ? input.value.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setState({ emailLink: { step: 'form', email: email, error: 'Укажите корректный email', loading: false } });
        return;
      }
      setState({ emailLink: { step: 'form', email: email, error: '', loading: true } });
      supabase.auth.updateUser({ email: email }).then(function (r) {
        if (r.error) {
          var msg = /already|registered|exists/i.test(r.error.message || '')
            ? 'На эту почту уже заведён аккаунт. Войдите в него или укажите другой адрес.'
            : (r.error.message || 'Не удалось отправить код');
          setState({ emailLink: { step: 'form', email: email, error: msg, loading: false } });
          return;
        }
        setState({ emailLink: { step: 'code', email: email, error: '', loading: false } });
      });
    },
    confirmLinkEmail: function () {
      var input = document.getElementById('link-code-input');
      var code = input ? input.value.trim() : '';
      var email = state.emailLink.email;
      if (!code) { setState({ emailLink: { step: 'code', email: email, error: 'Введите код из письма', loading: false } }); return; }
      setState({ emailLink: { step: 'code', email: email, error: '', loading: true } });
      // email_change — отдельный тип OTP: подтверждает смену почты, а не вход.
      supabase.auth.verifyOtp({ email: email, token: code, type: 'email_change' }).then(function (r) {
        if (r.error) {
          setState({ emailLink: { step: 'code', email: email, error: 'Неверный или устаревший код', loading: false } });
          return;
        }
        // Теперь по этой почте можно входить кодом — и это будет тот же аккаунт.
        state.emailLink = { step: null, email: '', error: '', loading: false };
        if (state.studentProfile && !state.studentProfile.email) {
          state.studentProfile.email = email;
          saveProfileToDb();
        }
        loadAccountLinks();
        setState({});
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
              // новый пользователь — черновик из Telegram и форма профиля.
              // Почту НЕ подставляем: res.body.email — синтетический tg_<id>@telegram.local
              // (идентификатор в auth.users), письма на него не идут. Пусть впишет реальную.
              state.form.sfirst = user.first_name || state.form.sfirst || '';
              state.form.slast = user.last_name || state.form.slast || '';
              state.form.tg = user.username ? '@' + user.username : (state.form.tg || '');
              if (/@telegram\.local$/i.test(state.form.semail || '')) state.form.semail = '';
              setState({ view: 'student', tgDraft: true, studentStep: 'profileContacts', tgAuth: { loading: false, error: '' } });
            }
            top();
          });
        });
      }).catch(function (err) {
        setState({ tgAuth: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    continueEmail: function () { setState({ tgDraft: false, studentStep: 'email', otpRole: 'student', otp: { email: '', error: '', loading: false } }); top(); },
    backToLogin: function () {
      var patch = otpStepPatch('login');
      patch.otp = { email: '', error: '', loading: false };
      setState(patch); top();
    },
    backToEmail: function () {
      var patch = otpStepPatch('email');
      patch.otp = { email: state.otp.email, error: '', loading: false };
      setState(patch); top();
    },
    // Шаг 1 из 2 (контакты) -> шаг 2 (личные данные) при заполнении профиля.
    goProfileDetails: function () {
      var email = (state.form.semail || '').trim();
      if (/@telegram\.local$/i.test(email)) { setState({ profileSave: { loading: false, error: 'Укажите настоящий email — на него придут уведомления' } }); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setState({ profileSave: { loading: false, error: 'Укажите корректный email' } }); return; }
      setState({ studentStep: 'profileDetails', profileSave: { loading: false, error: '' } }); top();
    },
    backToProfileContacts: function () { setState({ studentStep: 'profileContacts', profileSave: { loading: false, error: '' } }); top(); },
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
        var patch = otpStepPatch('otp');
        patch.otp = { email: email, error: '', loading: false };
        setState(patch);
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
      var asCompany = state.otpRole === 'company';
      setState({ otp: { email: email, error: '', loading: true } });
      supabase.auth.verifyOtp({ email: email, token: entered, type: 'email' }).then(function (res) {
        if (res.error) { setState({ otp: { email: email, error: 'Неверный или устаревший код', loading: false } }); return; }
        state.form.semail = email;
        var done = { otp: { email: email, error: '', loading: false } };

        if (asCompany) {
          state.session = res.data.session;
          // Заявка, поданная до появления входа, лежит в localStorage — привяжем её к аккаунту.
          claimLegacyCompanyApp().then(loadCompanyProfile).then(function (hasProfile) {
            done.view = hasProfile ? 'cabinet' : 'company';
            done.companyStep = hasProfile ? 'done' : 'form';
            if (hasProfile) { state.authRole = 'company'; loadApplications(); }
            setState(done);
            top();
          });
          return;
        }

        applyStudentProfile(res.data.session).then(function (hasProfile) {
          if (hasProfile) {
            done.view = state.studentStep === 'consent' ? 'student' : 'cabinet';
            loadApplications();
          } else {
            done.view = 'student';
            done.studentStep = 'profileContacts';
          }
          setState(done);
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
      if (/@telegram\.local$/i.test(email)) { setState({ profileSave: { loading: false, error: 'Укажите настоящий email — на него придут уведомления' } }); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setState({ profileSave: { loading: false, error: 'Укажите корректный email' } }); return; }
      var minor = /до 18/.test(status);
      state.studentProfile = { first: first, last: last, tg: (state.form.tg || '').trim(), email: email, status: status, minor: minor, specialty: '', specialties: [], description: '', aiTest: null, aiTestSeenQuestions: [], availability: '', institution: '', photoPath: '', photoUrl: '', hardSkills: [], languages: [], projects: [], achievements: [], platformHistory: [] };
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
    // Сохранение специальности и описания из кабинета студента
    saveProfileExtras: function () {
      if (!state.studentProfile) return;
      var descEl = document.getElementById('desc-input');
      state.studentProfile.description = (descEl ? descEl.value : (state.studentProfile.description || '')).slice(0, 1000);
      if (!supabase || !currentUserId()) { setState({ extrasSave: { loading: false, error: '', ok: true } }); return; }
      setState({ extrasSave: { loading: true, error: '', ok: false } });
      saveProfileToDb().then(function (res) {
        if (res.error) { setState({ extrasSave: { loading: false, error: 'Не удалось сохранить: ' + res.error.message, ok: false } }); return; }
        setState({ extrasSave: { loading: false, error: '', ok: true } });
      });
    },
    // Динамический тег доступности — сохраняется сразу при выборе.
    setAvailability: function (val) {
      if (!state.studentProfile) return;
      state.studentProfile.availability = val;
      setState({});
      if (supabase && currentUserId()) saveProfileToDb();
    },
    // Комбинируемые специальности — переключение сохраняется сразу. Первая выбранная используется для ИИ-теста.
    toggleSpecialty: function (t) {
      if (!state.studentProfile) return;
      var spec = t.getAttribute('data-spec');
      var list = (state.studentProfile.specialties || (state.studentProfile.specialty ? [state.studentProfile.specialty] : [])).slice();
      var idx = list.indexOf(spec);
      if (idx === -1) list.push(spec); else list.splice(idx, 1);
      state.studentProfile.specialties = list;
      state.studentProfile.specialty = list[0] || '';
      setState({});
      if (supabase && currentUserId()) saveProfileToDb();
    },
    quickAddSkill: function (t) {
      if (!state.studentProfile) return;
      var sk = t.getAttribute('data-skill');
      state.studentProfile.hardSkills = (state.studentProfile.hardSkills || []).concat([{ name: sk }]);
      setState({});
      if (supabase && currentUserId()) saveProfileToDb();
    },
    // Универсальная модалка добавления/редактирования элемента профиля (навык, язык, проект, достижение).
    openItemModal: function (t) {
      var type = t.getAttribute('data-item-type');
      var idxAttr = t.getAttribute('data-item-index');
      var index = idxAttr === null ? null : Number(idxAttr);
      var sp = state.studentProfile;
      var list = sp ? (sp[collectionKey(type)] || []) : [];
      var existing = index != null ? list[index] : null;
      var form = {};
      if (existing) { for (var k in existing) if (k !== 'file' && k !== 'files') form[k] = existing[k]; }
      if (type === 'skill' && existing) form.name = typeof existing === 'string' ? existing : existing.name;
      if (type === 'project') {
        var links = (existing && existing.links) || [];
        form.link1Label = links[0] ? links[0].label : ''; form.link1Url = links[0] ? links[0].url : '';
        form.link2Label = links[1] ? links[1].label : ''; form.link2Url = links[1] ? links[1].url : '';
        form.sections = existing && existing.sections ? existing.sections.map(function (s) { return { id: s.id || newLocalId('sec'), title: s.title || '', text: s.text || '' }; }) : [];
        form.details = existing && existing.details ? existing.details.map(function (d) { return { id: d.id || newLocalId('det'), label: d.label || '', value: d.value || '' }; }) : [];
        form.tags = existing && existing.tags ? existing.tags.slice() : [];
      }
      // слоты файлов: уже загруженные (kind:'existing') + новые, ещё не загруженные (kind:'staged')
      var slots = [];
      if (existing && existing.file) slots.push({ id: newLocalId('slot'), kind: 'existing', name: existing.file.name, url: existing.file.url, path: existing.file.path, type: existing.file.type, size: existing.file.size });
      if (existing && existing.files) existing.files.forEach(function (fl) { slots.push({ id: newLocalId('slot'), kind: 'existing', name: fl.name, url: fl.url, path: fl.path, type: fl.type, size: fl.size }); });
      form.fileSlots = slots;
      state.itemForm = form;
      setState({ itemModal: { type: type, index: index }, skillDetail: null, projectDetail: null, itemConfirmClose: false, itemUpload: { loading: false, error: '', fileName: '' } });
    },
    /* Подложка модалки закрывает её же, а форма проекта — это разделы, детали,
       ссылки и загруженные фото. Случайное касание мимо окна стирало всё разом
       и молча. Если что-то заполнено, сначала спрашиваем. */
    closeItemModal: function () {
      if (itemFormDirty() && !state.itemConfirmClose) { setState({ itemConfirmClose: true }); return; }
      setState({ itemModal: null, itemForm: {}, itemConfirmClose: false, itemUpload: { loading: false, error: '', fileName: '' } });
    },
    cancelCloseItemModal: function () { setState({ itemConfirmClose: false }); },
    toggleItemFormArrayValue: function (t) {
      var field = t.getAttribute('data-arr-field');
      var val = t.getAttribute('data-arr-value');
      state.itemForm = state.itemForm || {};
      var arr = (state.itemForm[field] || []).slice();
      var idx = arr.indexOf(val);
      if (idx === -1) arr.push(val); else arr.splice(idx, 1);
      state.itemForm[field] = arr;
      setState({});
    },
    // Файлы/фото проекта (и вложение для навыка/языка/достижения) — добавляются кликом или перетаскиванием.
    addFileSlots: function (files) {
      var im = state.itemModal;
      if (!im) return;
      var multi = isMultiFileType(im.type);
      var arr = Array.prototype.slice.call(files || []);
      if (!multi) arr = arr.slice(0, 1);
      if (!arr.length) return;
      state.itemForm = state.itemForm || {};
      var slots = multi ? (state.itemForm.fileSlots || []).slice() : [];
      arr.forEach(function (f) {
        var isImg = isImageFile(f);
        slots.push({ id: newLocalId('slot'), kind: 'staged', name: f.name, size: f.size, type: f.type, fileObj: f, previewUrl: isImg ? URL.createObjectURL(f) : '' });
      });
      state.itemForm.fileSlots = slots;
      setState({});
    },
    removeFileSlot: function (t) {
      var id = t.getAttribute('data-slot-id');
      state.itemForm = state.itemForm || {};
      state.itemForm.fileSlots = (state.itemForm.fileSlots || []).filter(function (s) { return s.id !== id; });
      setState({});
    },
    addProjectSection: function () {
      state.itemForm = state.itemForm || {};
      var list = (state.itemForm.sections || []).slice();
      list.push({ id: newLocalId('sec'), title: '', text: '' });
      state.itemForm.sections = list;
      setState({});
    },
    removeProjectSection: function (t) {
      var id = t.getAttribute('data-sec-id');
      state.itemForm.sections = (state.itemForm.sections || []).filter(function (s) { return s.id !== id; });
      setState({});
    },
    addProjectDetail: function () {
      state.itemForm = state.itemForm || {};
      var list = (state.itemForm.details || []).slice();
      list.push({ id: newLocalId('det'), label: '', value: '' });
      state.itemForm.details = list;
      setState({});
    },
    removeProjectDetail: function (t) {
      var id = t.getAttribute('data-det-id');
      state.itemForm.details = (state.itemForm.details || []).filter(function (d) { return d.id !== id; });
      setState({});
    },
    addProjectTag: function () {
      var el = document.getElementById('proj-tag-input');
      var v = el ? el.value.trim().replace(/^#/, '') : '';
      if (!v) return;
      state.itemForm = state.itemForm || {};
      var tags = (state.itemForm.tags || []).slice();
      if (tags.indexOf(v) === -1) tags.push(v.slice(0, 24));
      state.itemForm.tags = tags;
      if (el) el.value = '';
      setState({});
    },
    removeProjectTag: function (t) {
      var tag = t.getAttribute('data-tag');
      state.itemForm.tags = (state.itemForm.tags || []).filter(function (x) { return x !== tag; });
      setState({});
    },
    saveItemModal: function () {
      var im = state.itemModal;
      if (!im || !state.studentProfile) return;
      var type = im.type, f = state.itemForm || {}, item;
      if (type === 'skill') {
        var skName = (f.name || '').trim();
        if (!skName) { setState({ itemUpload: { loading: false, error: 'Укажите название навыка', fileName: state.itemUpload.fileName } }); return; }
        item = { name: skName.slice(0, 40), description: (f.description || '').trim().slice(0, 500), confidence: f.confidence != null && f.confidence !== '' ? Math.max(1, Math.min(10, Number(f.confidence))) : null, relatedProjects: f.relatedProjects || [] };
      } else if (type === 'language') {
        var lname = (f.name || '').trim();
        if (!lname) { setState({ itemUpload: { loading: false, error: 'Укажите язык', fileName: state.itemUpload.fileName } }); return; }
        item = { name: lname.slice(0, 40), level: (f.level || '').trim().slice(0, 60) };
      } else if (type === 'project') {
        var pname = (f.name || '').trim();
        if (!pname) { setState({ itemUpload: { loading: false, error: 'Укажите название проекта', fileName: state.itemUpload.fileName } }); return; }
        var links = [];
        if ((f.link1Url || '').trim()) links.push({ label: (f.link1Label || '').trim().slice(0, 30) || 'Ссылка', url: f.link1Url.trim().slice(0, 300) });
        if ((f.link2Url || '').trim()) links.push({ label: (f.link2Label || '').trim().slice(0, 30) || 'Ссылка', url: f.link2Url.trim().slice(0, 300) });
        var sections = (f.sections || []).filter(function (s) { return (s.title || '').trim() || (s.text || '').trim(); }).map(function (s) { return { title: (s.title || '').trim().slice(0, 80), text: (s.text || '').trim().slice(0, 1000) }; });
        var details = (f.details || []).filter(function (d) { return (d.label || '').trim() || (d.value || '').trim(); }).map(function (d) { return { label: (d.label || '').trim().slice(0, 40), value: (d.value || '').trim().slice(0, 80) }; });
        var tags = (f.tags || []).slice(0, 15);
        item = { name: pname.slice(0, 80), specialty: (f.specialty || '').trim(), desc: (f.desc || '').trim().slice(0, 280), links: links, sections: sections, details: details, tags: tags };
      } else if (type === 'achievement') {
        var title = (f.title || '').trim();
        if (!title) { setState({ itemUpload: { loading: false, error: 'Укажите название', fileName: state.itemUpload.fileName } }); return; }
        item = { title: title.slice(0, 100), issuer: (f.issuer || '').trim().slice(0, 100), date: (f.date || '').trim().slice(0, 30) };
      } else return;

      var key = collectionKey(type);
      var slots = (f.fileSlots || []).slice();
      var staged = [];
      slots.forEach(function (s, i) { if (s.kind === 'staged') staged.push({ index: i, file: s.fileObj }); });

      function finalizeFiles(resolvedMetas) {
        resolvedMetas.forEach(function (meta, k) {
          var slotIdx = staged[k].index;
          slots[slotIdx] = { id: slots[slotIdx].id, kind: 'existing', name: meta.name, url: meta.url, path: meta.path, type: meta.type, size: meta.size };
        });
        var metas = slots.map(function (s) { return { name: s.name, url: s.url, path: s.path, type: s.type, size: s.size }; });
        if (isMultiFileType(type)) item.files = metas;
        else if (metas.length) item.file = metas[0];
        // Каждый только что загруженный файл уходит на модерацию: компания увидит его
        // лишь после одобрения. Уже существующие (без свежей загрузки) не трогаем.
        resolvedMetas.forEach(function (meta, k) {
          if (meta && meta.path) registerFile(type, meta.path, staged[k] && staged[k].file);
        });
        commit();
      }

      function commit() {
        var list = (state.studentProfile[key] || []).slice();
        if (im.index != null) list[im.index] = item; else list.push(item);
        state.studentProfile[key] = list;
        setState({ itemModal: null, itemForm: {}, itemUpload: { loading: false, error: '', fileName: '' } });
        if (supabase && currentUserId()) saveProfileToDb();
      }

      if (staged.length && supabase && currentUserId()) {
        for (var i = 0; i < staged.length; i++) {
          if (staged[i].file.size > 10 * 1024 * 1024) { setState({ itemUpload: { loading: false, error: 'Файл «' + staged[i].file.name + '» больше 10 МБ', fileName: state.itemUpload.fileName } }); return; }
        }
        var userId = currentUserId();
        setState({ itemUpload: { loading: true, error: '', fileName: state.itemUpload.fileName } });
        Promise.all(staged.map(function (entry) {
          var file = entry.file;
          var ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          var path = userId + '/extra/' + type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
          return supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' }).then(function (up) {
            if (up.error) throw new Error(up.error.message);
            return supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365).then(function (su) {
              return { name: file.name, path: path, url: (su && su.data && su.data.signedUrl) || '', type: file.type || '', size: file.size || 0 };
            });
          });
        })).then(finalizeFiles).catch(function (err) {
          setState({ itemUpload: { loading: false, error: 'Ошибка загрузки: ' + (err && err.message ? err.message : err), fileName: state.itemUpload.fileName } });
        });
        return;
      }
      if (staged.length) {
        finalizeFiles(staged.map(function (entry) { return { name: entry.file.name, url: entry.file ? (slots[entry.index].previewUrl || '') : '', path: '', type: entry.file.type || '', size: entry.file.size || 0 }; }));
        return;
      }
      finalizeFiles([]);
    },
    /* Удаление даёт отмену, а не спрашивает разрешения. Кнопки «изменить» и
       «удалить» стоят в нескольких пикселях друг от друга, а на грубом указателе
       область нажатия у каждой 44×44 — промахнуться легко, и раньше промах
       навсегда уносил проект вместе с загруженными фото. Диалог подтверждения
       мешал бы при намеренном удалении; отмена не мешает никогда. */
    removeItem: function (t) {
      if (!state.studentProfile) return;
      var type = t.getAttribute('data-item-type');
      var key = collectionKey(type);
      var i = Number(t.getAttribute('data-item-index'));
      var list = state.studentProfile[key] || [];
      var removed = list[i];
      if (!removed) return;
      state.studentProfile[key] = list.filter(function (_, idx) { return idx !== i; });
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(function () { undoTimer = null; setState({ undoItem: null }); }, 8000);
      setState({ undoItem: { key: key, index: i, item: removed, label: itemTypeLabel(type) } });
      if (supabase && currentUserId()) saveProfileToDb();
    },
    undoRemoveItem: function () {
      var u = state.undoItem;
      if (!u || !state.studentProfile) return;
      var list = (state.studentProfile[u.key] || []).slice();
      list.splice(Math.min(u.index, list.length), 0, u.item);
      state.studentProfile[u.key] = list;
      if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
      setState({ undoItem: null });
      if (supabase && currentUserId()) saveProfileToDb();
    },
    // Загрузка фото профиля — сразу при выборе файла.
    uploadAvatar: function (file) {
      if (!state.studentProfile || !file) return;
      if (file.size > 5 * 1024 * 1024) { setState({ avatarUpload: { loading: false, error: 'Файл больше 5 МБ' } }); return; }
      var userId = currentUserId();
      if (!supabase || !userId) {
        state.studentProfile.photoUrl = URL.createObjectURL(file);
        state.studentProfile.photoPath = '';
        setState({ avatarUpload: { loading: false, error: '' } });
        return;
      }
      setState({ avatarUpload: { loading: true, error: '' } });
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var path = userId + '/avatar-' + Date.now() + '.' + ext;
      supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' }).then(function (up) {
        if (up.error) { setState({ avatarUpload: { loading: false, error: 'Ошибка загрузки: ' + up.error.message } }); return; }
        return supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365).then(function (su) {
          state.studentProfile.photoPath = path;
          state.studentProfile.photoUrl = (su && su.data && su.data.signedUrl) || '';
          setState({ avatarUpload: { loading: false, error: '' } });
          saveProfileToDb();
          registerFile('avatar', path, file);
        });
      }).catch(function (err) {
        setState({ avatarUpload: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    openReviews: function () { setState({ modal: 'reviews' }); },
    openSkillDetail: function (t) { setState({ skillDetail: Number(t.getAttribute('data-item-index')) }); },
    closeSkillDetail: function () { setState({ skillDetail: null }); },
    openProjectDetail: function (t) { setState({ projectDetail: Number(t.getAttribute('data-item-index')), projectGalleryIndex: 0 }); },
    closeProjectDetail: function () { setState({ projectDetail: null, projectGalleryIndex: 0 }); },
    projectGalleryPrev: function () { setState({ projectGalleryIndex: Math.max(0, (state.projectGalleryIndex || 0) - 1) }); },
    projectGalleryNext: function (t) { var max = Number(t.getAttribute('data-max')) || 0; setState({ projectGalleryIndex: Math.min(max, (state.projectGalleryIndex || 0) + 1) }); },
    projectGalleryGoto: function (t) { setState({ projectGalleryIndex: Number(t.getAttribute('data-idx')) }); },
    openMediaPreview: function (t) {
      setState({ mediaPreview: { url: t.getAttribute('data-preview-url'), name: t.getAttribute('data-preview-name'), isImage: t.getAttribute('data-preview-image') === '1' } });
    },
    closeMediaPreview: function () { setState({ mediaPreview: null }); },
    // Инлайн-редактирование email / статуса / места учёбы прямо в карточке контактов.
    startFieldEdit: function (t) {
      setState({ fieldEdit: t.getAttribute('data-field-edit'), fieldEditConfirm: null, fieldEditError: '' });
    },
    cancelFieldEdit: function () { setState({ fieldEdit: null, fieldEditConfirm: null, fieldEditError: '' }); },
    cancelFieldEditConfirm: function () { setState({ fieldEditConfirm: null }); },
    saveFieldEdit: function () {
      var sp = state.studentProfile;
      if (!sp) return;
      var field = state.fieldEdit;
      var el = document.getElementById('field-edit-input');
      var newVal = el ? el.value.trim() : '';
      if (field === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newVal)) { setState({ fieldEditError: 'Укажите корректный email' }); return; }
        sp.email = newVal;
        setState({ fieldEdit: null, fieldEditError: '' });
        if (supabase && currentUserId()) saveProfileToDb();
        return;
      }
      if (field === 'status') {
        if (!newVal) { setState({ fieldEditError: 'Выберите статус' }); return; }
        var oldCat = statusCategory(sp.status), newCat = statusCategory(newVal);
        if (newCat !== oldCat && (sp.institution || docStat('study') !== 'none')) {
          var w = 'Смена статуса сбросит выбранное место учёбы' + (docStat('study') !== 'none' ? ' и справку о месте учёбы — её нужно будет загрузить заново.' : '.');
          setState({ fieldEditConfirm: { field: 'status', value: newVal, warning: w } });
          return;
        }
        sp.status = newVal;
        sp.minor = /до 18/.test(newVal);
        setState({ fieldEdit: null, fieldEditError: '' });
        if (supabase && currentUserId()) saveProfileToDb();
        return;
      }
      if (field === 'institution') {
        if (newVal !== (sp.institution || '') && docStat('study') !== 'none') {
          setState({ fieldEditConfirm: { field: 'institution', value: newVal, warning: 'Справка о месте учёбы будет сброшена — её нужно будет загрузить заново.' } });
          return;
        }
        sp.institution = newVal;
        setState({ fieldEdit: null, fieldEditError: '' });
        if (supabase && currentUserId()) saveProfileToDb();
        return;
      }
    },
    confirmFieldEdit: function () {
      var sp = state.studentProfile, conf = state.fieldEditConfirm;
      if (!sp || !conf) return;
      if (conf.field === 'status') {
        sp.status = conf.value;
        sp.minor = /до 18/.test(conf.value);
        sp.institution = '';
      } else if (conf.field === 'institution') {
        sp.institution = conf.value;
      }
      setState({ fieldEdit: null, fieldEditConfirm: null, fieldEditError: '' });
      if (supabase && currentUserId()) saveProfileToDb();
    },
    // Поля выше (data-company-field) пишутся в state.companyProfile сразу при вводе —
    // кнопка "Сохранить" здесь только подтверждает пользователю, что всё применено.
    // Направления для мэтчинга (Frontend/Backend/и т.п.) — переключается сразу.
    toggleFocusArea: function (t) {
      if (!state.companyProfile) return;
      var area = t.getAttribute('data-focus');
      var list = (state.companyProfile.focusAreas || []).slice();
      var idx = list.indexOf(area);
      if (idx === -1) list.push(area); else list.splice(idx, 1);
      state.companyProfile.focusAreas = list;
      setState({});
      autoSaveCompany();
    },
    addTechTag: function () {
      var el = document.getElementById('tech-tag-input');
      var v = el ? el.value.trim() : '';
      if (!v || !state.companyProfile) return;
      var list = (state.companyProfile.techStack || []).slice();
      if (list.indexOf(v) === -1) list.push(v.slice(0, 24));
      state.companyProfile.techStack = list;
      if (el) el.value = '';
      setState({});
      autoSaveCompany();
    },
    removeTechTag: function (t) {
      if (!state.companyProfile) return;
      var tag = t.getAttribute('data-tag');
      state.companyProfile.techStack = (state.companyProfile.techStack || []).filter(function (x) { return x !== tag; });
      setState({});
      autoSaveCompany();
    },
    // Стиль коммуникации / периодичность созвонов / длительность проекта — сохраняются сразу при выборе.
    setCommStyle: function (t) {
      if (!state.companyProfile) return;
      state.companyProfile.commStyle = t.getAttribute('data-comm');
      setState({});
      autoSaveCompany();
    },
    setMeetingCadence: function (val) {
      if (!state.companyProfile) return;
      state.companyProfile.meetingCadence = val;
      setState({});
      autoSaveCompany();
    },
    setDefaultDuration: function (val) {
      if (!state.companyProfile) return;
      state.companyProfile.defaultDuration = val;
      setState({});
      autoSaveCompany();
    },
    // ИИ-тест
    openTest: function () {
      var spec = state.studentProfile && state.studentProfile.specialty;
      if (!spec) { setState({ view: 'cabinet', extrasSave: { loading: false, error: 'Сначала выберите специальность выше и сохраните', ok: false } }); top(); return; }
      setState({ testView: 'intro', testResult: null, dynamicBank: null, testGenLoading: false });
      tryGenerateAiTest();  // фоновая попытка получить свежие вопросы от ИИ; при неудаче — тихий откат на статический банк
    },
    startTest: function () {
      if (!activeTestBank()) return;
      setState({ testView: 'running', testConfirmExit: false });
      state.testFlags = 0;
      startTestTimer();  // после setState DOM отрисован, #test-timer существует
      enterTestFullscreen();
      attachAntiCheat();
    },
    submitTest: function () {
      stopTestTimer();
      detachAntiCheat();
      exitTestFullscreen();
      var bank = activeTestBank();
      if (!bank) { setState({ testView: null }); return; }
      var correct = 0, total = bank.mcq.length;
      for (var i = 0; i < total; i++) {
        var sel = document.querySelector('input[name="q' + i + '"]:checked');
        if (sel && Number(sel.value) === bank.mcq[i].c) correct++;
      }
      var openEl = document.getElementById('test-open');
      var level = levelFor(correct, total);
      var at = new Date().toISOString();
      var flags = state.testFlags || 0;
      var askedTexts = bank.mcq.map(function (q) { return q.q; });
      state.studentProfile.aiTestSeenQuestions = ((state.studentProfile.aiTestSeenQuestions || []).concat(askedTexts)).slice(-120);
      state.studentProfile.aiTest = { specialty: state.studentProfile.specialty, level: level, correct: correct, total: total, at: at, flags: flags };
      var result = { specialty: state.studentProfile.specialty, level: level, correct: correct, total: total, open: (openEl ? openEl.value : '').slice(0, 2000), at: at, flags: flags };
      setState({ testView: 'result', testResult: result, dynamicBank: null });
      if (supabase && currentUserId()) saveProfileToDb();
    },
    // Спрашиваем, прежде чем уничтожить единственную попытку.
    askCloseTest: function () { setState({ testConfirmExit: true }); },
    cancelCloseTest: function () { setState({ testConfirmExit: false }); },
    closeTest: function () {
      stopTestTimer();
      detachAntiCheat();
      exitTestFullscreen();
      setState({ testView: null, testResult: null, dynamicBank: null, testConfirmExit: false });
    },
    // Модальные окна загрузки документов
    openStudyDoc: function () { pendingDocFile = null; setState({ modal: 'study', docUpload: { loading: false, error: '', fileName: '' } }); },
    openConsentDoc: function () { pendingDocFile = null; setState({ modal: 'consent', docUpload: { loading: false, error: '', fileName: '' } }); },
    openStatusModal: function () { pendingDocFile = null; setState({ modal: 'status', docUpload: { loading: false, error: '', fileName: '' } }); },
    // Заявка на смену статуса: файл в приватный бакет, затем строка в status_requests.
    // Сам статус в профиле не трогаем — его поставит админ при одобрении (триггер из 0014
    // прямую запись отклонит).
    submitStatusRequest: function () {
      var sel = document.getElementById('status-new');
      var to = sel ? sel.value : '';
      var sp = state.studentProfile || {};
      if (!to) { setState({ docUpload: { loading: false, error: 'Выберите новый статус', fileName: state.docUpload.fileName } }); return; }
      if (to === sp.status) { setState({ docUpload: { loading: false, error: 'Это ваш текущий статус', fileName: state.docUpload.fileName } }); return; }
      var file = pendingDocFile;
      if (!file) { setState({ docUpload: { loading: false, error: 'Приложите документ, подтверждающий личность', fileName: '' } }); return; }
      if (file.size > 10 * 1024 * 1024) { setState({ docUpload: { loading: false, error: 'Файл больше 10 МБ', fileName: file.name } }); return; }
      var userId = currentUserId();
      if (!supabase || !userId) { setState({ docUpload: { loading: false, error: 'Сессия истекла — войдите заново', fileName: file.name } }); return; }

      var ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
      var path = userId + '/identity-' + Date.now() + '.' + ext;
      setState({ docUpload: { loading: true, error: '', fileName: file.name } });
      supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' }).then(function (up) {
        if (up.error) { setState({ docUpload: { loading: false, error: 'Ошибка загрузки: ' + up.error.message, fileName: file.name } }); return; }
        return supabase.from('status_requests').insert({
          student_id: userId, from_status: sp.status || null, to_status: to,
          path: path, name: file.name || '', mime: file.type || '', size: file.size || 0, status: 'pending'
        }).then(function (ins) {
          if (ins.error) {
            var msg = /status_requests_one_pending|duplicate/i.test(ins.error.message || '')
              ? 'Заявка уже подана и ждёт решения модератора.'
              : 'Не удалось отправить заявку';
            setState({ docUpload: { loading: false, error: msg, fileName: file.name } });
            return;
          }
          pendingDocFile = null;
          setState({ modal: null, docUpload: { loading: false, error: '', fileName: '' } });
          loadStatusRequest();
        });
      }).catch(function (err) {
        setState({ docUpload: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err), fileName: file.name } });
      });
    },
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
      var path = userId + '/' + type + '-' + Date.now() + '.' + ext;
      setState({ docUpload: { loading: true, error: '', fileName: file.name } });
      supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' }).then(function (up) {
        if (up.error) { setState({ docUpload: { loading: false, error: 'Ошибка загрузки: ' + up.error.message, fileName: file.name } }); return; }
        return fetch(SUBMIT_DOC_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
          body: JSON.stringify({ type: type, path: path })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
          if (!res.ok || !res.body || res.body.error) { setState({ docUpload: { loading: false, error: (res.body && res.body.error) || 'Не удалось отправить на проверку', fileName: file.name } }); return; }
          pendingDocFile = null;
          registerFile(type, path, file);
          setState({ modal: null, docUpload: { loading: false, error: '', fileName: '' } });
        });
      }).catch(function (err) {
        setState({ docUpload: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err), fileName: file.name } });
      });
    },
    submitCompany: function () {
      var f = state.form;
      // Обязательные поля (кроме корпоративной почты и LinkedIn)
      var name = (f.company || '').trim(), inn = (f.inn || '').trim(), director = (f.director || '').trim();
      var contact = (f.contact || '').trim(), phone = (f.phone || '').trim();
      if (!name) { setState({ companySubmit: { loading: false, error: 'Укажите название компании' } }); return; }
      if (!inn) { setState({ companySubmit: { loading: false, error: 'Укажите ИНН' } }); return; }
      if (!director) { setState({ companySubmit: { loading: false, error: 'Укажите руководителя' } }); return; }
      if (!contact) { setState({ companySubmit: { loading: false, error: 'Укажите контактное лицо' } }); return; }
      if (!phone) { setState({ companySubmit: { loading: false, error: 'Укажите телефон для созвона' } }); return; }
      var corpEmail = (f.corpEmail || '').trim();
      var profile = {
        name: name, inn: inn, director: director,
        corpEmail: corpEmail, domain: corpEmail.split('@')[1] || '',
        linkedin: (f.linkedin || '').trim(), contact: contact, phone: phone,
        status: 'pending',
        description: '', focusAreas: [], techStack: [], commStyle: 'async', syncHours: '',
        meetingCadence: 'weekly', meetingLink: '', pitch: '', defaultDuration: '1m',
        mentorName: '', mentorRole: '', mentorContact: ''
      };
      if (!supabase) { setState({ companySubmit: { loading: false, error: 'Supabase не настроен' } }); return; }
      if (!state.session) { setState({ companySubmit: { loading: false, error: 'Сессия истекла — войдите заново' } }); return; }
      setState({ companySubmit: { loading: true, error: '' } });
      fetch(SUBMIT_COMPANY_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
        body: JSON.stringify({ name: name, inn: inn, director: director, corpEmail: corpEmail, domain: profile.domain, linkedin: profile.linkedin, contact: contact, phone: phone })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        if (!res.ok || !res.body || !res.body.id) { setState({ companySubmit: { loading: false, error: (res.body && res.body.error) || 'Не удалось отправить заявку' } }); return; }
        profile.id = res.body.id;
        profile.status = res.body.status || 'pending';
        state.companyProfile = profile;
        setState({ authRole: 'company', companyStep: 'done', companySubmit: { loading: false, error: '' } }); top();
      }).catch(function (err) {
        setState({ companySubmit: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    // Публикация задачи компанией (только подтверждённой)
    openGigForm: function () {
      if (companyStatus() !== 'approved') { setState({ view: 'cabinet' }); top(); return; }
      setState({ gigModal: true, gigSubmit: { loading: false, error: '' } });
    },
    closeGigForm: function () { setState({ gigModal: false, gigSubmit: { loading: false, error: '' } }); },
    submitGig: function () {
      var title = (state.form.gigTitle || '').trim();
      if (!title) { setState({ gigSubmit: { loading: false, error: 'Укажите название задачи' } }); return; }
      if (!supabase || !state.session) { setState({ gigSubmit: { loading: false, error: 'Сессия истекла — войдите заново' } }); return; }
      setState({ gigSubmit: { loading: true, error: '' } });
      fetch(POST_GIG_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
        body: JSON.stringify({ title: title, description: state.form.gigDesc || '', format: state.form.gigFormat || '', duration: state.form.gigDuration || '', slots: state.form.gigSlots || '1' })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        if (!res.ok || !res.body || !res.body.gig) { setState({ gigSubmit: { loading: false, error: (res.body && res.body.error) || 'Не удалось опубликовать задачу' } }); return; }
        state.gigs = [res.body.gig].concat(state.gigs);
        state.form.gigTitle = ''; state.form.gigDesc = ''; state.form.gigFormat = ''; state.form.gigDuration = ''; state.form.gigSlots = '';
        setState({ gigModal: false, gigSubmit: { loading: false, error: '' } });
      }).catch(function (err) {
        setState({ gigSubmit: { loading: false, error: 'Сеть недоступна: ' + (err && err.message ? err.message : err) } });
      });
    },
    // Отклик на задачу. Ветка чата создаётся триггером в БД вместе с системным сообщением.
    applyToGig: function (el) {
      var gigId = el.getAttribute('data-gig-id');
      if (!gigId) return;
      if (state.authRole !== 'student') { actions.goStudent(); return; }
      var existing = applicationForGig(gigId);
      if (existing) { openChat(existing.id); return; }
      // Обе проверки продублированы в политике вставки (0014) — здесь они только для того,
      // чтобы объяснить причину, а не показать сухую ошибку от сервера.
      // Уводим в кабинет: там на строке статуса стоит бейдж «на подтверждении», то есть
      // причина видна на месте — так же, как это сделано для согласия родителя.
      if (state.statusReq && state.statusReq.status === 'pending') { setState({ view: 'cabinet' }); top(); return; }
      if (isMinor() && docStat('consent') !== 'approved') { setState({ view: 'cabinet' }); top(); return; }
      var gig = findGig(gigId);
      if (!gig || !supabase || !state.session) return;

      state.applyState[gigId] = { loading: true, error: '' };
      render();
      supabase.from('gig_applications')
        .insert({ gig_id: gigId, student_id: currentUserId(), company_app_id: gig.company_app_id, status: 'pending' })
        .select('id, gig_id, company_app_id, student_name, status, created_at').single()
        .then(function (r) {
          if (r.error || !r.data) {
            // 23505 — уникальный индекс (gig_id, student_id): отклик уже есть.
            var dup = r.error && r.error.code === '23505';
            state.applyState[gigId] = { loading: false, error: dup ? 'Вы уже откликнулись на эту задачу' : 'Не удалось откликнуться' };
            if (dup) loadApplications();
            render();
            return;
          }
          delete state.applyState[gigId];
          var row = r.data;
          row.gigs = { title: gig.title, company_name: gig.company_name };
          state.applications = [row].concat(state.applications);
          openChat(row.id);
        });
    },
    goAdmin: function () { setState({ view: 'admin' }); loadAdminQueue(); top(); },
    adminTab: function (el) { state.admin.tab = el.getAttribute('data-tab'); state.admin.rejectFor = null; setState({}); },
    adminRefresh: function () { loadAdminQueue(); },
    // Ссылку на файл делаем короткоживущей и по требованию — она не хранится нигде,
    // поэтому не протухает, как было в телеграме.
    adminOpenFile: function (el) {
      var path = el.getAttribute('data-path');
      if (!path || !supabase) return;
      supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 300).then(function (r) {
        var url = r && r.data && r.data.signedUrl;
        if (url) window.open(url, '_blank', 'noopener');
        else setState({ admin: Object.assign({}, state.admin, { error: 'Не удалось открыть файл' }) });
      });
    },
    adminApprove: function (el) { adminDecideFile(el.getAttribute('data-id'), 'approved', null); },
    adminStartReject: function (el) { state.admin.rejectFor = el.getAttribute('data-id'); state.admin.reason = ''; setState({}); },
    adminCancelReject: function () { state.admin.rejectFor = null; state.admin.reason = ''; setState({}); },
    adminConfirmReject: function (el) {
      var reason = (state.form.adminReason || '').trim();
      adminDecideFile(el.getAttribute('data-id'), 'rejected', reason || 'Без указания причины');
    },
    downloadCertDoc: function (el) {
      var path = el.getAttribute('data-path');
      if (!supabase || !path) return;
      supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 300).then(function (r) {
        if (r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank', 'noopener');
        else alert('Не удалось открыть файл');
      });
    },
    adminCertDocApprove: function (el) { adminDecideCertDoc(el.getAttribute('data-id'), 'approved', null); },
    adminCertDocReject: function (el) {
      var why = window.prompt('Причина отказа — её увидит компания:', '');
      if (why === null) return;
      adminDecideCertDoc(el.getAttribute('data-id'), 'rejected', why.trim() || 'Без указания причины');
    },
    adminCertStartReject: function (el) { state.admin.rejectFor = el.getAttribute('data-id'); state.admin.reason = ''; setState({}); },
    adminCertPublish: function (el) { adminDecideCertificate(el.getAttribute('data-id'), 'published', null); },
    adminCertConfirmReject: function (el) {
      adminDecideCertificate(el.getAttribute('data-id'), 'rejected', (state.form.adminReason || '').trim() || 'Без указания причины');
    },
    adminStatusStartReject: function (el) { state.admin.rejectFor = el.getAttribute('data-id'); state.admin.reason = ''; setState({}); },
    adminStatusApprove: function (el) { adminDecideStatus(el.getAttribute('data-id'), 'approved', null, el.getAttribute('data-path')); },
    adminStatusConfirmReject: function (el) {
      var reason = (state.form.adminReason || '').trim();
      // Путь берём из очереди: у кнопки отказа его нет, а файл всё равно надо стереть.
      var req = (state.admin.statusReqs || []).filter(function (r) { return r.id === el.getAttribute('data-id'); })[0];
      adminDecideStatus(el.getAttribute('data-id'), 'rejected', reason || 'Без указания причины', req && req.path);
    },
    adminCompanyDecide: function (el) {
      var id = el.getAttribute('data-id'), status = el.getAttribute('data-status');
      if (!supabase || !id) return;
      state.admin.busy = id; setState({});
      supabase.rpc('admin_decide_company', { p_id: id, p_status: status }).then(function (r) {
        state.admin.busy = null;
        if (r.error) { state.admin.error = 'Не удалось сохранить решение'; setState({}); return; }
        loadAdminQueue();
      });
    },
    openChat: function (el) { openChat(el.getAttribute('data-app-id')); },
    openCompanyProfile: function (el) { openProfile('company', el.getAttribute('data-company-id'), el.getAttribute('data-back')); },
    openStudentProfile: function (el) { openProfile('student', el.getAttribute('data-student-id'), el.getAttribute('data-back')); },
    closeProfile: function () {
      var back = (state.profileView && state.profileView.back) || 'catalog';
      state.profileView = null;
      // Из профиля, открытого из переписки, возвращаемся в ту же ветку — она ещё в state.chat.
      setState({ view: back === 'chat' && state.chat ? 'chat' : back });
      top();
    },
    closeChat: function () {
      unsubscribeMessages();
      state.chat = null;
      setState({ view: state.authRole === 'company' ? 'vacancies' : 'responses' });
      top();
    },
    sendMessage: function () {
      var body = (state.form.chatDraft || '').trim();
      if (!body || !state.chat || state.chat.sending) return;
      if (!supabase || !state.session) { state.chat.error = 'Сессия истекла — войдите заново'; render(); return; }
      state.chat.sending = true;
      state.chat.error = '';
      render();
      supabase.from('messages')
        .insert({ application_id: state.chat.appId, sender_role: state.authRole, sender_id: currentUserId(), body: body })
        .select('id, sender_role, sender_id, body, created_at').single()
        .then(function (r) {
          if (!state.chat) return;
          state.chat.sending = false;
          if (r.error || !r.data) { state.chat.error = 'Не удалось отправить сообщение'; render(); return; }
          state.form.chatDraft = '';
          focusChatInput = true;
          // Своё сообщение может прийти и по realtime — вставляем только если его ещё нет.
          if (!haveMessage(r.data.id)) state.chat.messages = state.chat.messages.concat(r.data);
          render();
        });
    },
    // Решение компании по отклику: приглашение или отказ.
    askRejectApp: function (el) { setState({ confirmRejectApp: el.getAttribute('data-app-id') }); },
    cancelRejectApp: function () { setState({ confirmRejectApp: null }); },
    setAppStatus: function (el) {
      var appId = el.getAttribute('data-app-id');
      var status = el.getAttribute('data-status');
      var a = findApplication(appId);
      if (!a || !supabase || state.authRole !== 'company' || a.status === status) return;
      /* Отказ необратим: после него ветка «ждёт решения» больше не отрисуется ни
         у компании, ни у студента, и один путь к документу закрывается навсегда.
         Приглашение обратимо, поэтому вопрос только про отказ. */
      if (status === 'rejected' && state.confirmRejectApp !== appId) { setState({ confirmRejectApp: appId }); return; }
      if (state.confirmRejectApp) state.confirmRejectApp = null;
      var before = a.status;
      a.status = status;
      render();
      supabase.from('gig_applications').update({ status: status }).eq('id', appId).then(function (r) {
        if (r.error) { a.status = before; render(); }
      });
    },
    scrollHow: function () { scrollToId('sec-how'); },
    scrollVerify: function () { scrollToId('sec-verify'); },
    logout: function () {
      if (supabase && state.session) supabase.auth.signOut();
      pendingDocFile = null;
      stopTestTimer();
      unsubscribeMessages();
      try { localStorage.removeItem('company_app_id'); } catch (e) {}
      setState({
        authRole: null, studentProfile: null, companyProfile: null, session: null,
        studentStep: 'login', companyStep: 'login', otpRole: 'student',
        files: [], filesLoading: false, isAdmin: false,
        admin: { tab: 'pending', items: [], companies: [], statusReqs: [], certs: [], gigs: [], loading: false, error: '', rejectFor: null, reason: '', busy: null }, tgDraft: false, respTab: 'pending',
        otp: { email: '', error: '', loading: false },
        tgAuth: { loading: false, error: '' },
        // Иначе следующий вход в этом же браузере увидел бы привязки предыдущего человека.
        links: { telegram_id: null, telegram_username: '', login_email: '', login_is_synthetic: false, loading: false, error: '' },
        emailLink: { step: null, email: '', error: '', loading: false },
        statusReq: null, history: [], certs: [], certDocBusy: null, cert: { loading: false, data: null, error: '' },
        profileSave: { loading: false, error: '' },
        docUpload: { loading: false, error: '', fileName: '' },
        extrasSave: { loading: false, error: '', ok: false },
        companySubmit: { loading: false, error: '' },
        gigModal: false, gigSubmit: { loading: false, error: '' },
        applications: [], appsLoading: false, applyState: {}, chat: null, profileView: null,
        menuOpen: false, modal: null, testView: null, testResult: null,
        form: {}, view: 'home'
      });
      top();
    }
  };
  function scrollToId(id) {
    // Адрес обновляем, чтобы ссылка из меню была настоящей: её можно скопировать,
    // отправить и открыть — обработчик ниже поймает хэш при загрузке.
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    if (state.view !== 'home') { setState({ view: 'home' }); setTimeout(function () { doScroll(id); }, 60); }
    else doScroll(id);
  }
  function doScroll(id) {
    var el = document.getElementById(id);
    if (!el) return;
    // Системная настройка «уменьшить движение» не отменяет behavior:'smooth', заданный
    // из JS, — CSS-правило scroll-behavior на него не влияет. Проверяем сами.
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Высоту шапки меряем, а не хардкодим: на мобильном она в две строки (132px
    // против ~70 на десктопе), и фиксированное число прятало заголовок секции.
    var head = document.querySelector('header');
    var offset = (head ? head.getBoundingClientRect().height : 70) + 16;
    window.scrollTo({ top: Math.max(0, el.offsetTop - offset), behavior: reduce ? 'auto' : 'smooth' });
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
    var data = { first: p.first, last: p.last, tg: p.tg, email: p.email, status: p.status, minor: !!p.minor, specialty: p.specialty || '', specialties: p.specialties || [], description: p.description || '', aiTest: p.aiTest || null, aiTestSeenQuestions: p.aiTestSeenQuestions || [],
      availability: p.availability || '', institution: p.institution || '', photoPath: p.photoPath || '', photoUrl: p.photoUrl || '', hardSkills: p.hardSkills || [], languages: p.languages || [], projects: p.projects || [], achievements: p.achievements || [], platformHistory: p.platformHistory || [] };
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
        state.studentProfile = { first: d.first || '', last: d.last || '', tg: d.tg || '', email: d.email || '', status: d.status || '', minor: !!d.minor, specialty: d.specialty || '', specialties: d.specialties || (d.specialty ? [d.specialty] : []), description: d.description || '', aiTest: d.aiTest || null, aiTestSeenQuestions: d.aiTestSeenQuestions || [],
          availability: d.availability || '', institution: d.institution || '', photoPath: d.photoPath || '', photoUrl: d.photoUrl || '', hardSkills: d.hardSkills || [], languages: d.languages || [], projects: d.projects || [], achievements: d.achievements || [], platformHistory: d.platformHistory || [] };
        state.authRole = 'student';
        state.studentStep = 'done';
        loadStudentFiles();   // статусы документов и файлов — из student_files, не из профиля
        loadAccountLinks();   // привязан ли Telegram, настоящий ли логин-email
        loadStatusRequest();  // не висит ли заявка на смену статуса
        loadStudentHistory(); // завершённые стажировки — из справок, не из профиля
        return true;
      }
      return false;
    });
  }
  // Заявка на смену статуса. Берём последнюю: если она в ожидании — статус менять нельзя
  // и откликаться тоже, если отклонена — показываем причину, чтобы человек знал, что не так.
  function loadStatusRequest() {
    if (!supabase || !currentUserId()) return;
    supabase.from('status_requests')
      .select('id,to_status,status,reason,created_at')
      .eq('student_id', currentUserId())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(function (r) {
        if (r.error) return;   // 0014 не применена — кабинет работает как раньше
        state.statusReq = r.data || null;
        var sp = state.studentProfile;
        // Заявку одобрили, пока вкладка была открыта — подтянем новый статус точечно.
        // Без этого кабинет показывал бы старый до перезагрузки страницы.
        if (sp && r.data && r.data.status === 'approved' && sp.status !== r.data.to_status) {
          supabase.from('profiles').select('data').eq('id', currentUserId()).maybeSingle().then(function (p) {
            var d = p && p.data && p.data.data;
            if (d) { sp.status = d.status || ''; sp.minor = !!d.minor; sp.institution = d.institution || ''; }
            loadStudentFiles();   // справку о месте учёбы при смене статуса сбрасывает 0010
            render();
          });
          return;
        }
        render();
      });
  }

  // Привязки аккаунта. Логин-email лежит в auth.users и клиенту напрямую не виден
  // (в сессии он есть, но после смены почты сессия ещё старая) — поэтому спрашиваем базу.
  function loadAccountLinks() {
    if (!supabase || !currentUserId()) return;
    supabase.rpc('my_account_links').then(function (r) {
      var row = r && r.data && r.data[0];
      if (r.error || !row) return;   // 0013 не применена — молчим, кабинет работает как раньше
      state.links = {
        telegram_id: row.telegram_id || null,
        telegram_username: row.telegram_username || '',
        login_email: row.login_email || '',
        login_is_synthetic: !!row.login_is_synthetic,
        loading: false, error: '',
      };
      render();
    });
  }

  function adminDecideCertDoc(id, decision, reason) {
    if (!supabase || !id) return;
    state.admin.busy = id; render();
    supabase.rpc('admin_decide_certificate_doc', { p_id: id, p_status: decision, p_reason: reason }).then(function (r) {
      state.admin.busy = null;
      if (r.error) { state.admin.error = 'Не удалось сохранить решение'; render(); return; }
      loadAdminQueue();
    });
  }

  // Загрузка официального свидетельства компанией. Кладём в certs/<id справки>/ —
  // в папку студента компания писать не может, да и не должна.
  function uploadCertDoc(certId, file) {
    if (!supabase || !certId || !file) return;
    if (file.size > 10 * 1024 * 1024) { state.admin.error = ''; alert('Файл больше 10 МБ'); return; }
    var ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
    var path = 'certs/' + certId + '/' + Date.now() + '.' + ext;
    state.certDocBusy = certId; render();
    supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' })
      .then(function (up) {
        if (up.error) { state.certDocBusy = null; render(); alert('Ошибка загрузки: ' + up.error.message); return; }
        return supabase.rpc('attach_certificate_doc', {
          p_certificate_id: certId, p_path: path, p_name: file.name || '', p_mime: file.type || '', p_size: file.size || 0
        }).then(function (r) {
          state.certDocBusy = null;
          if (r.error) { render(); alert(r.error.message || 'Не удалось приложить свидетельство'); return; }
          loadApplications();
        });
      });
  }

  // Решение по справке. Публикация делает страницу доступной по ссылке всем.
  function adminDecideCertificate(id, decision, reason) {
    if (!supabase || !id) return;
    state.admin.busy = id; render();
    supabase.rpc('admin_decide_certificate', { p_id: id, p_status: decision, p_reason: reason }).then(function (r) {
      state.admin.busy = null;
      state.admin.rejectFor = null;
      state.form.adminReason = '';
      if (r.error) { state.admin.error = 'Не удалось сохранить решение'; render(); return; }
      loadAdminQueue();
    });
  }

  // История стажировок студента. Выводится из опубликованных справок, а не из
  // profiles.data: туда студент пишет сам и мог бы приписать себе чужие компании.
  function loadStudentHistory() {
    if (!supabase || !currentUserId()) return;
    supabase.rpc('student_history', { p_student: currentUserId() }).then(function (r) {
      if (r.error) return;   // 0016 не применена — блок останется пустым
      state.history = r.data || [];
      render();
    });
  }

  // Решение по заявке на смену статуса. Сам статус в профиле проставляет функция
  // admin_decide_status — напрямую в чужой профиль админу писать нельзя.
  // Документ удаляем сразу после решения: хранить сканы удостоверений (в том числе
  // детских) дольше проверки незачем, а при утечке бакета терять будет нечего.
  function adminDecideStatus(id, decision, reason, path) {
    if (!supabase || !id) return;
    state.admin.busy = id; render();
    supabase.rpc('admin_decide_status', { p_id: id, p_status: decision, p_reason: reason }).then(function (r) {
      state.admin.busy = null;
      state.admin.rejectFor = null;
      state.form.adminReason = '';
      if (r.error) { state.admin.error = 'Не удалось сохранить решение'; render(); return; }
      // Файл убираем после успешного решения. Если удаление не удалось — решение всё
      // равно записано, файл просто останется в бакете; молчать об этом нельзя.
      var done = function () { loadAdminQueue(); };
      if (path) {
        supabase.storage.from(DOC_BUCKET).remove([path]).then(function (rm) {
          if (rm && rm.error) state.admin.error = 'Решение сохранено, но документ не удалился из хранилища';
          done();
        });
      } else done();
    });
  }

  // Решение админа по файлу. Пишем прямо в student_files: RLS пускает сюда только
  // is_admin(), у студента политики update нет вовсе.
  function adminDecideFile(id, status, reason) {
    if (!supabase || !id) return;
    state.admin.busy = id; render();
    supabase.from('student_files')
      .update({ status: status, decided_by: 'admin', reason: reason })
      .eq('id', id)
      .then(function (r) {
        state.admin.busy = null;
        state.admin.rejectFor = null;
        state.form.adminReason = '';
        if (r.error) { state.admin.error = 'Не удалось сохранить решение'; render(); return; }
        loadAdminQueue();
      });
  }
  // Админ ли текущий пользователь. Проверяет база (is_admin), подделать на клиенте
  // бессмысленно: все админские запросы всё равно гейтятся той же функцией на сервере.
  function checkAdmin() {
    if (!supabase || !currentUserId()) return Promise.resolve(false);
    return supabase.rpc('is_admin').then(function (r) {
      state.isAdmin = !r.error && r.data === true;
      if (state.isAdmin) render();
      return state.isAdmin;
    });
  }
  // Очередь модерации: файлы + заявки компаний. Обе выборки закрыты is_admin() на сервере.
  function loadAdminQueue() {
    if (!supabase || !state.isAdmin) return;
    state.admin.loading = true; state.admin.error = ''; render();
    Promise.all([
      supabase.rpc('admin_moderation_queue', { p_status: null }),
      supabase.from('company_applications').select('id, data, status, created_at').order('created_at', { ascending: false }),
      supabase.rpc('admin_status_queue', { p_status: null }),
      supabase.rpc('admin_certificate_queue', { p_status: null }),
      supabase.rpc('admin_gigs')
    ]).then(function (res) {
      state.admin.loading = false;
      if (res[0].error) state.admin.error = 'Не удалось загрузить очередь';
      else state.admin.items = res[0].data || [];
      if (!res[1].error) state.admin.companies = res[1].data || [];
      // 0014 могла быть ещё не применена — тогда просто не показываем этот раздел.
      state.admin.statusReqs = res[2].error ? [] : (res[2].data || []);
      // 0016 могла быть ещё не применена — тогда раздел просто не показываем.
      state.admin.certs = res[3].error ? [] : (res[3].data || []);
      // 0020 могла быть ещё не применена — тогда вкладка «Задачи» будет пустой.
      state.admin.gigs = res[4].error ? [] : (res[4].data || []);
      render();
    });
  }
  // Файлы студента со статусами модерации. RLS отдаёт только свои (админу — все).
  function loadStudentFiles() {
    if (!supabase || !currentUserId()) return Promise.resolve();
    state.filesLoading = true;
    return supabase.from('student_files')
      .select('id, kind, path, name, status, reason, ai_verdict, decided_by, created_at')
      .order('created_at', { ascending: false })
      .then(function (r) {
        state.filesLoading = false;
        if (!r.error && r.data) state.files = r.data;
        render();
      });
  }
  // Регистрирует загруженный файл на модерацию. Статус проставить нельзя — RLS пускает
  // только 'pending', решение принимает админ.
  function registerFile(kind, path, file) {
    if (!supabase || !currentUserId()) return Promise.resolve();
    return supabase.from('student_files').insert({
      student_id: currentUserId(),
      kind: kind,
      path: path,
      name: (file && file.name) || '',
      mime: (file && file.type) || '',
      size: (file && file.size) || 0
    }).then(function () { return loadStudentFiles(); });
  }
  // Заявка компании читается ею самой: RLS пускает к строке с owner_user_id = auth.uid().
  // Возвращает Promise<boolean> — есть ли у аккаунта заявка.
  function loadCompanyProfile() {
    if (!supabase || !state.session) return Promise.resolve(false);
    return supabase.from('company_applications').select('id, status, data, profile')
      .eq('owner_user_id', currentUserId()).maybeSingle()
      .then(function (r) {
        var row = r && r.data;
        if (!row) return false;
        var d = row.data || {};
        // Реквизиты — из data (их проверяли вручную, компания их не правит).
        // Витрина — из profile, единственной колонки, куда компании разрешена запись.
        var p = row.profile || {};
        state.companyProfile = {
          id: row.id,
          name: d.name || '', inn: d.inn || '', director: d.director || '', corpEmail: d.corpEmail || '',
          domain: d.domain || '', linkedin: d.linkedin || '', contact: d.contact || '', phone: d.phone || '',
          status: row.status || 'pending',
          description: p.description || '', focusAreas: p.focusAreas || [], techStack: p.techStack || [],
          commStyle: p.commStyle || 'async', syncHours: p.syncHours || '',
          meetingCadence: p.meetingCadence || 'weekly', meetingLink: p.meetingLink || '',
          pitch: p.pitch || '', defaultDuration: p.defaultDuration || '1m',
          mentorName: p.mentorName || '', mentorRole: p.mentorRole || '', mentorContact: p.mentorContact || ''
        };
        state.authRole = 'company';
        state.companyStep = 'done';
        return true;
      });
  }
  // Витрина компании -> колонка profile. RLS пускает сюда только владельца заявки,
  // а привилегия на запись выдана ровно на эту колонку: ни status, ни data не тронуть.
  function companyProfileJson(cp) {
    return {
      description: cp.description || '', focusAreas: cp.focusAreas || [], techStack: cp.techStack || [],
      commStyle: cp.commStyle || 'async', syncHours: cp.syncHours || '',
      meetingCadence: cp.meetingCadence || 'weekly', meetingLink: cp.meetingLink || '',
      pitch: cp.pitch || '', defaultDuration: cp.defaultDuration || '1m',
      mentorName: cp.mentorName || '', mentorRole: cp.mentorRole || '', mentorContact: cp.mentorContact || ''
    };
  }
  // Автосохранение витрины компании: пишет колонку profile при каждом изменении.
  // Тихо выходит, если сохранять пока некуда (нет сессии/заявки) — без ошибки на экране.
  function autoSaveCompany() {
    var cp = state.companyProfile;
    if (!supabase || !state.session || !cp || !cp.id) return;
    cp.meetingLink = (cp.meetingLink || '').trim();
    cp.mentorName = (cp.mentorName || '').trim();
    cp.mentorRole = (cp.mentorRole || '').trim();
    cp.mentorContact = (cp.mentorContact || '').trim();
    setState({ extrasSave: { loading: true, error: '', ok: false } });
    supabase.from('company_applications').update({ profile: companyProfileJson(cp) })
      .eq('id', cp.id)
      .then(function (r) {
        setState({ extrasSave: r.error ? { loading: false, error: 'Не удалось сохранить', ok: false } : { loading: false, error: '', ok: true } });
      });
  }
  // Заявки, поданные до появления аккаунтов, помнит только localStorage. Привязываем один раз
  // и забываем id: дальше компания находит свою заявку по owner_user_id.
  function claimLegacyCompanyApp() {
    var id;
    try { id = localStorage.getItem('company_app_id'); } catch (e) {}
    if (!id || !supabase || !state.session) return Promise.resolve();
    return fetch(CLAIM_COMPANY_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
      body: JSON.stringify({ id: id })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        // Чужую заявку забрать нельзя — тогда просто перестаём её помнить.
        if (res.ok || (res.body && res.body.error)) { try { localStorage.removeItem('company_app_id'); } catch (e) {} }
      })
      .catch(function () {});
  }
  // При загрузке страницы восстанавливает сессию и профиль из Supabase.
  // Роль определяется по данным: есть заявка компании — компания, иначе студент.
  function restoreSession() {
    if (!supabase) return;
    supabase.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;
      state.session = session;
      checkAdmin();
      return claimLegacyCompanyApp().then(loadCompanyProfile).then(function (isCompany) {
        if (isCompany) return true;
        return applyStudentProfile(session);
      }).then(function (hasProfile) {
        // залогиненного не держим на маркетинговом лендинге — в рабочий раздел (каталог)
        if (hasProfile && state.view === 'home') state.view = 'catalog';
        if (hasProfile) loadApplications();
        render();
      });
    });
  }
  // Загружает задачи из БД (публичное чтение) в каталог.
  function loadGigs() {
    if (!supabase) return;
    // is_open — вычисляемое поле (0019): у админа политика отдаёт все задачи, включая
    // закрытые, поэтому отличить их иначе клиент не может.
    supabase.from('gigs').select('*, is_open').order('created_at', { ascending: false }).limit(100).then(function (r) {
      if (r.error || !r.data) return;
      state.gigs = r.data;
      render();
    });
  }

  /* ---------- отклики и чат ---------- */
  var chatChannel = null;
  // Вернуть курсор в поле ввода после отправки, когда фокус уже сняли кликом по кнопке.
  var focusChatInput = false;

  var APP_STATUS = {
    pending:   { label: 'На рассмотрении', color: 'var(--warn)' },
    invited:   { label: 'Приглашение',     color: 'var(--ok)' },
    rejected:  { label: 'Отказ',           color: 'var(--err)' },
    // Без этой строки завершённая стажировка попадала в запасной вариант ниже
    // и показывалась как «На рассмотрении».
    completed: { label: 'Завершена',       color: 'var(--accent)' }
  };
  function appStatusMeta(status) { return APP_STATUS[status] || APP_STATUS.pending; }

  function findApplication(appId) {
    for (var i = 0; i < state.applications.length; i++) {
      if (state.applications[i].id === appId) return state.applications[i];
    }
    return null;
  }
  function applicationForGig(gigId) {
    for (var i = 0; i < state.applications.length; i++) {
      if (state.applications[i].gig_id === gigId) return state.applications[i];
    }
    return null;
  }
  function findGig(gigId) {
    for (var i = 0; i < state.gigs.length; i++) if (state.gigs[i].id === gigId) return state.gigs[i];
    return null;
  }

  // Что вернёт запрос, решает RLS: студенту — свои отклики, компании — адресованные ей.
  function loadApplications() {
    if (!supabase || !state.session || !state.authRole) return;
    state.appsLoading = true;
    supabase.from('gig_applications')
      .select('id, gig_id, student_id, company_app_id, student_name, status, created_at, gigs(title, company_name)')
      .order('created_at', { ascending: false })
      .then(function (r) {
        state.appsLoading = false;
        if (!r.error && r.data) state.applications = r.data;
        // Компании нужен id справки, чтобы приложить к ней свидетельство. RLS отдаёт
        // только свои — по политике certificates_select_involved.
        if (state.authRole === 'company') {
          supabase.from('certificates')
            .select('id, application_id, doc_path, doc_name, doc_status, doc_reason, status')
            .then(function (c) { if (!c.error) state.certs = c.data || []; render(); });
        }
        render();
      });
  }

  // Собеседник в ветке: компания видит студента, студент — компанию.
  function chatPeer(a) {
    if (state.authRole === 'company') return a.student_name || 'Студент';
    return (a.gigs && a.gigs.company_name) || 'Компания';
  }
  function openChat(appId) {
    var a = findApplication(appId);
    if (!a) return;
    state.chat = {
      appId: appId, peer: chatPeer(a), gigTitle: (a.gigs && a.gigs.title) || '',
      studentId: a.student_id, companyAppId: a.company_app_id,
      messages: [], loading: true, error: '', sending: false
    };
    state.form.chatDraft = '';
    setState({ view: 'chat' });
    top();
    loadMessages(appId);
    subscribeMessages(appId);
  }
  function loadMessages(appId) {
    if (!supabase) return;
    supabase.from('messages').select('id, sender_role, sender_id, body, created_at')
      .eq('application_id', appId).order('created_at', { ascending: true })
      .then(function (r) {
        if (!state.chat || state.chat.appId !== appId) return;  // успели уйти из ветки
        if (r.error) state.chat.error = 'Не удалось загрузить переписку';
        else state.chat.messages = r.data || [];
        state.chat.loading = false;
        render();
      });
  }
  function haveMessage(id) {
    if (!state.chat) return true;
    for (var i = 0; i < state.chat.messages.length; i++) if (state.chat.messages[i].id === id) return true;
    return false;
  }
  // Realtime уважает RLS: в канал приходят только сообщения из веток, где мы участник.
  function subscribeMessages(appId) {
    unsubscribeMessages();
    if (!supabase || !supabase.channel) return;
    // Канал авторизуется отдельно от REST: без свежего токена RLS не пустит в поток.
    try { supabase.realtime.setAuth(state.session.access_token); } catch (e) {}
    chatChannel = supabase.channel('chat-' + appId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'application_id=eq.' + appId },
        function (payload) {
          var m = payload && payload.new;
          if (!m || !state.chat || state.chat.appId !== appId || haveMessage(m.id)) return;
          state.chat.messages = state.chat.messages.concat(m);
          render();
        })
      .subscribe();
  }
  function unsubscribeMessages() {
    if (!chatChannel) return;
    try { supabase.removeChannel(chatChannel); } catch (e) {}
    chatChannel = null;
  }

  /* ---------- просмотр чужого профиля ---------- */

  // Читаем через функции company_public / student_public: они отдают заранее
  // отобранные колонки. Реквизиты компании и контакты неприглашённого студента туда не входят.
  function openProfile(kind, id, back) {
    if (!id || !supabase) return;
    state.profileView = { kind: kind, id: id, data: null, loading: true, error: '', back: back || 'catalog' };
    setState({ view: 'profile' });
    top();
    // company_public / student_public — security-definer функции (RPC), а не вьюхи:
    // так линтер Supabase доволен, а контролируемый обход RLS сохраняется.
    var fn = kind === 'company' ? 'company_public' : 'student_public';
    supabase.rpc(fn, { p_id: id }).then(function (r) {
      var pv = state.profileView;
      if (!pv || pv.id !== id) return;  // успели уйти со страницы
      pv.loading = false;
      var row = r.data && r.data[0];    // set-returning функция отдаёт массив
      if (r.error) pv.error = 'Не удалось загрузить профиль';
      else if (!row) pv.error = kind === 'company' ? 'Профиль компании недоступен' : 'Профиль студента недоступен';
      else pv.data = row;
      render();
    });
  }

  /* ---------- document upload modal ---------- */
  function reviewsModalHtml() {
    // Источник — опубликованные справки; оценки здесь нет по той же причине, что и в
    // кабинете: она внутренняя. Показываем то, что написала компания.
    var history = state.history || [];
    var items = history.length
      ? history.map(function (h) {
          var period = (h.started_at ? fmtDate(h.started_at) : '') + (h.finished_at ? ' — ' + fmtDate(h.finished_at) : '');
          return '<div style="padding:14px 0; border-top:1.5px solid var(--line);">' +
            '<div style="font-weight:600; font-size:var(--text-caption); ' + S.wrap + '">' + esc(h.gig_title || 'Стажировка') + (h.company_name ? ' <span style="color:var(--muted); font-weight:400;">· ' + esc(h.company_name) + '</span>' : '') + '</div>' +
            (period ? '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:2px;">' + esc(period) + '</div>' : '') +
            '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:8px 0 0; white-space:pre-wrap; ' + S.wrap + '">' + esc(h.body || '') + '</p>' +
            '<a href="/cert/' + esc(h.public_id) + '" target="_blank" rel="noopener" style="display:inline-block; margin-top:8px; font-size:var(--text-micro); font-weight:600; color:var(--accent);">Ссылка на справку ↗</a></div>';
        }).join('')
      : '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:10px 0 0;">Пока пусто — характеристики появятся здесь после завершения стажировок.</p>';
    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:460px; width:100%; max-height:80vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">Характеристики от компаний</h3>' +
        '<button data-action="closeModal" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      items +
      '<button data-action="closeModal" style="margin-top:18px; width:100%; ' + S.ghost + '">Закрыть</button></div>';
    return '<div data-action="closeModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  // Смена статуса: объясняем последствия до того, как человек начнёт, — иначе он подаст
  // заявку и удивится, что не может откликаться.
  function statusModalHtml() {
    var sp = state.studentProfile || {};
    var loading = state.docUpload.loading;
    var fileName = state.docUpload.fileName || '';
    var err = state.docUpload.error ? '<div style="margin-top:8px; font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.docUpload.error) + '</div>' : '';

    var warn = '<div style="padding:12px 14px; background:color-mix(in srgb, var(--warn) 10%, #fff); border:1px solid color-mix(in srgb, var(--warn) 26%, #fff); border-radius:10px; font-size:var(--text-caption); color:var(--warn); line-height:1.55; margin-bottom:16px;">' +
      'Пока новый статус не подтверждён, вы <b>не сможете откликаться на новые задачи</b>. Уже начатые проекты и переписка останутся доступны.</div>';

    var picker = '<label class="file-drop" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1.5px dashed var(--line); border-radius:12px; background:var(--bg); cursor:pointer;">' +
      '<span style="flex-shrink:0; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); padding:8px 14px; border-radius:8px;">Выбрать файл</span>' +
      '<span style="min-width:0; flex:1; font-size:var(--text-caption); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:' + (fileName ? 'var(--ink)' : 'var(--muted)') + '; font-weight:' + (fileName ? '600' : '400') + ';">' + (fileName ? esc(fileName) : 'Файл не выбран · PDF или фото') + '</span>' +
      '<input id="doc-file" data-file-input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none;"></label>';

    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:460px; width:100%; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">Смена статуса</h3>' +
        '<button data-action="closeModal" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:10px 0 16px;">Статус влияет на то, какие задачи вам доступны и нужно ли согласие родителя, поэтому его подтверждает модератор. Приложите документ, подтверждающий личность.</p>' +
      warn +
      '<div style="font-size:var(--text-caption); color:var(--muted); margin-bottom:7px;">Новый статус</div>' +
      '<select id="status-new" style="' + S.field + ' width:100%; margin-bottom:14px;">' + statusOptions(sp.status) + '</select>' +
      picker + err +
      '<button data-action="submitStatusRequest"' + (loading ? ' disabled' : '') + ' style="margin-top:16px; width:100%; ' + S.primary + (loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (loading ? 'Отправка…' : 'Отправить на проверку') + '</button>' +
      '<button data-action="closeModal" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button></div>';

    return '<div data-action="closeModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  // Завершение стажировки. Характеристика — то, ради чего справка существует, поэтому
  // здесь подсказки и минимальная длина: без них компании отписываются одной строкой
  // «молодец, всё хорошо», и документ обесценивается.
  function completeModalHtml() {
    var cm = state.certModal;
    var a = findApplication(cm.appId) || {};
    var body = state.form.certBody || '';
    var left = 120 - body.trim().length;

    var scoreBtns = [1, 2, 3, 4, 5].map(function (n) {
      var on = cm.score === n;
      return '<button data-action="setCertScore" data-score="' + n + '" style="font-size:var(--text-caption); font-weight:600; width:42px; height:42px; border-radius:10px; cursor:pointer; border:1.5px solid ' + (on ? 'var(--ink)' : 'var(--line)') + '; background:' + (on ? 'var(--ink)' : '#fff') + '; color:' + (on ? '#fff' : 'var(--muted)') + ';">' + n + '</button>';
    }).join('');

    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:560px; width:100%; max-height:88vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">Завершить стажировку</h3>' +
        '<button data-action="closeModal" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:10px 0 18px;">' + esc(a.student_name || 'Студент') + ' получит справку о стажировке с вашей характеристикой. Справку проверяют по ссылке, поэтому написанное здесь увидят будущие работодатели.</p>' +

      '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Оценка работы <span style="color:var(--muted); font-weight:400;">— видна только внутри платформы</span></div>' +
      '<div style="display:flex; gap:8px; margin-bottom:18px;">' + scoreBtns + '</div>' +

      '<div style="font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Характеристика <span style="color:var(--muted); font-weight:400;">— попадёт в справку</span></div>' +
      '<div style="font-size:var(--text-micro); color:var(--muted); line-height:1.55; margin-bottom:8px;">Напишите по делу: что студент делал, что из этого получилось, с чем справился, как показал себя в работе с людьми. Общие слова вроде «молодец» справку обесценивают.</div>' +
      '<textarea data-field="certBody" rows="7" placeholder="Например: за 8 недель собрал посадочную страницу на React и настроил аналитику. Самостоятельно разобрался с вёрсткой под мобильные, хотя раньше не делал. Задавал точные вопросы, о задержках предупреждал заранее." style="' + S.field + ' width:100%; resize:vertical; font-family:inherit; line-height:1.55;">' + esc(body) + '</textarea>' +
      '<div id="cert-left" style="font-size:var(--text-micro); color:' + (left > 0 ? 'var(--muted)' : 'var(--ok)') + '; margin-top:6px;">' + (left > 0 ? 'Ещё минимум ' + left + ' символов' : 'Достаточно') + '</div>' +

      '<div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">' +
        '<label style="flex:1; min-width:140px;"><span style="display:block; font-size:var(--text-caption); color:var(--muted); margin-bottom:6px;">Начало</span><input type="date" data-field="certStart" value="' + esc(state.form.certStart || '') + '" style="' + S.field + ' width:100%;"></label>' +
        '<label style="flex:1; min-width:140px;"><span style="display:block; font-size:var(--text-caption); color:var(--muted); margin-bottom:6px;">Окончание</span><input type="date" data-field="certEnd" value="' + esc(state.form.certEnd || '') + '" style="' + S.field + ' width:100%;"></label>' +
      '</div>' +

      '<div style="margin-top:16px; padding:11px 14px; background:var(--bg); border-radius:10px; font-size:var(--text-micro); color:var(--muted); line-height:1.5;">Справка уходит на проверку платформе и публикуется после неё. После выдачи текст не редактируется — исправления только через поддержку.</div>' +
      (cm.error ? '<div style="margin-top:10px; font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(cm.error) + '</div>' : '') +
      '<button data-action="submitComplete"' + (cm.loading ? ' disabled' : '') + ' style="margin-top:16px; width:100%; ' + S.primary + (cm.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (cm.loading ? 'Отправляем…' : 'Завершить и выдать справку') + '</button>' +
      '<button data-action="closeModal" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button></div>';

    return '<div data-action="closeModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  function modalHtml() {
    if (!state.modal) return '';
    if (state.modal === 'reviews') return reviewsModalHtml();
    if (state.modal === 'status') return statusModalHtml();
    if (state.modal === 'complete') return completeModalHtml();
    var type = state.modal;
    var isConsent = type === 'consent';
    var title = isConsent ? 'Согласие родителя' : 'Подтверждение места учёбы';
    var desc = isConsent
      ? 'Скачайте шаблон, подпишите его вместе с родителем или опекуном, затем загрузите скан или фото подписанного документа.'
      : 'Загрузите справку о месте учёбы (из вуза, колледжа, школы или лицея). PDF или фото, до 10 МБ.';
    var status = docStat(type);
    var loading = state.docUpload.loading;
    var tmpl = isConsent
      ? '<a href="' + CONSENT_TEMPLATE_URL + '" download style="display:flex; align-items:center; justify-content:center; gap:9px; font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:12px; border-radius:11px; text-decoration:none; margin-bottom:16px;"><span>⬇</span>Скачать шаблон согласия</a>'
      : '';
    var statusNote;
    if (status === 'pending' || status === 'approved') {
      statusNote = '<div style="padding:11px 14px; background:color-mix(in srgb, ' + docColor(status) + ' 10%, #fff); border:1px solid color-mix(in srgb, ' + docColor(status) + ' 26%, #fff); border-radius:10px; font-size:var(--text-caption); color:' + docColor(status) + '; margin-bottom:16px;">Текущий статус: ' + docLabel(status) + '. При необходимости загрузите файл заново.</div>';
    } else if (status === 'rejected') {
      /* Раньше при отклонении модалка не говорила ничего: студент открывал её,
         чтобы понять, что не так, и видел ту же форму загрузки, что и в первый раз. */
      var rf = fileFor(type);
      var rWhy = (rf && rf.reason) ? esc(rf.reason)
        : 'Причина не указана. Проверьте, что документ виден целиком, все углы в кадре и текст читаем.';
      statusNote = '<div style="padding:11px 14px; background:color-mix(in srgb, var(--err) 10%, #fff); border:1px solid color-mix(in srgb, var(--err) 26%, #fff); border-radius:10px; font-size:var(--text-caption); color:var(--err); margin-bottom:16px; line-height:1.5;"><strong style="font-weight:600;">Документ отклонён.</strong> ' + rWhy + '</div>';
    } else {
      statusNote = '';
    }
    var fileName = state.docUpload.fileName || '';
    var picker = '<label class="file-drop" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1.5px dashed var(--line); border-radius:12px; background:var(--bg); cursor:pointer;">' +
      '<span style="flex-shrink:0; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); padding:8px 14px; border-radius:8px;">Выбрать файл</span>' +
      '<span style="min-width:0; flex:1; font-size:var(--text-caption); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:' + (fileName ? 'var(--ink)' : 'var(--muted)') + '; font-weight:' + (fileName ? '600' : '400') + ';">' + (fileName ? esc(fileName) : 'Файл не выбран · PDF или фото') + '</span>' +
      '<input id="doc-file" data-file-input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none;">' +
    '</label>';
    var err = state.docUpload.error ? '<div style="margin-top:8px; font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.docUpload.error) + '</div>' : '';

    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:440px; width:100%; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">' + title + '</h3>' +
        '<button data-action="closeModal" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:10px 0 18px;">' + desc + '</p>' +
      statusNote + tmpl + picker + err +
      '<button data-action="submitDoc"' + (loading ? ' disabled' : '') + ' style="margin-top:16px; width:100%; ' + S.primary + (loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (loading ? 'Отправка…' : 'Отправить на проверку') + '</button>' +
      '<button data-action="closeModal" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button>' +
    '</div>';

    return '<div data-action="closeModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  // Модалка добавления/редактирования элемента профиля: навык, язык, проект, достижение.
  function itemModalHtml() {
    var im = state.itemModal;
    if (!im) return '';
    var type = im.type, f = state.itemForm || {};
    var titles = { skill: 'Hard skill', language: 'Язык', project: 'Проект', achievement: 'Сертификат / достижение' };
    var isEdit = im.index != null;
    var fields;
    if (type === 'skill') {
      var confVal = f.confidence != null && f.confidence !== '' ? f.confidence : 5;
      var projs = (state.studentProfile && state.studentProfile.projects) || [];
      var relSel = f.relatedProjects || [];
      var projChips = projs.length
        ? '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">' + projs.map(function (p) {
            var on = relSel.indexOf(p.name) !== -1;
            return '<button data-action="toggleItemFormArrayValue" data-arr-field="relatedProjects" data-arr-value="' + esc(p.name) + '" style="font-size:var(--text-micro); font-weight:600; padding:5px 10px; border-radius:999px; cursor:pointer; ' + (on ? 'color:#fff; background:var(--ink); border:1px solid var(--ink);' : 'color:var(--ink); background:#fff; border:1.5px solid var(--line);') + '">' + esc(p.name) + '</button>';
          }).join('') + '</div>'
        : '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:6px;">Сначала добавьте проекты, чтобы связать их с навыком.</div>';
      fields = itemField('Навык', 'name', f.name, 'Например, Frontend, Figma, Python') +
        '<label style="display:block; margin-bottom:12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Уверенность: <span id="conf-badge" style="color:' + confidenceColor(Number(confVal)) + '; font-weight:600;">' + confVal + '/10</span></span>' +
          '<input type="range" min="1" max="10" step="1" data-item-field="confidence" value="' + esc(confVal) + '" style="width:100%;"></label>' +
        itemTextarea('Описание навыка', 'description', f.description, 'Например: полтора года пишу на React, делал лендинги и SPA…') +
        '<div style="margin-bottom:4px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:4px;">Работы, где применялся навык</span>' + projChips + '</div>';
    } else if (type === 'language') {
      fields = itemField('Язык', 'name', f.name, 'Например, Английский') + itemField('Уровень', 'level', f.level, 'Например, IELTS 8.0 / Родной', true);
    } else if (type === 'project') {
      var mySpecs = (state.studentProfile && state.studentProfile.specialties) || [];
      var specSelect = mySpecs.length
        ? '<label style="display:block; margin-bottom:12px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Специальность проекта <span style="color:var(--muted); font-weight:400;">(необязательно)</span></span><select data-item-field="specialty" style="' + S.field + '"><option value="">Без привязки</option>' + mySpecs.map(function (s) { return '<option value="' + esc(s) + '"' + (f.specialty === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>'
        : '';
      fields = '<div class="g2" style="display:grid; gap:14px;">' +
          '<div>' + itemField('Название проекта', 'name', f.name, 'Название') + specSelect + '</div>' +
          '<div>' + itemTextarea('Коротко, что вы сделали', 'desc', f.desc, 'Короткая подпись под карточкой — 1–2 предложения') + '</div>' +
        '</div>' +
        '<div style="border-top:1.5px solid var(--line); margin:16px 0 14px; padding-top:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:10px;">Разделы (по желанию)</span><span style="display:block; font-size:var(--text-micro); color:var(--muted); margin:-6px 0 10px;">Например: «Задача», «Что сделал(а)», «Что получилось», «Что узнал(а)».</span>' + sectionsEditorHtml(f.sections || []) + '</div>' +
        '<div style="border-top:1.5px solid var(--line); margin:14px 0; padding-top:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:10px;">Детали проекта (по желанию)</span>' + detailsEditorHtml(f.details || []) + '</div>' +
        '<div style="border-top:1.5px solid var(--line); margin:14px 0; padding-top:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:10px;">Хэштеги / маркеры</span>' + tagsEditorHtml(f.tags || []) + '</div>' +
        '<div class="g2" style="border-top:1.5px solid var(--line); margin:14px 0; padding-top:14px; display:grid; gap:14px;">' +
          itemField('Ссылка 1 — название', 'link1Label', f.link1Label, 'Например, GitHub, Behance, Портфолио', true) +
          itemField('Ссылка 1 — URL', 'link1Url', f.link1Url, 'https://...', true) +
          itemField('Ссылка 2 — название', 'link2Label', f.link2Label, 'Например, Демо, Кейс', true) +
          itemField('Ссылка 2 — URL', 'link2Url', f.link2Url, 'https://...', true) +
        '</div>';
    } else if (type === 'achievement') {
      fields = itemField('Название', 'title', f.title, 'Сертификат, олимпиада…') +
        itemField('Кем выдано', 'issuer', f.issuer, 'Организация', true) +
        itemField('Дата', 'date', f.date, 'Например, 2026', true);
    } else fields = '';

    var multi = isMultiFileType(type);
    var picker = filesDropzoneHtml(type, f.fileSlots || []);
    var err = state.itemUpload.error ? '<div style="margin-top:8px; font-size:var(--text-caption); color:var(--err); font-weight:600;">' + esc(state.itemUpload.error) + '</div>' : '';
    var loading = state.itemUpload.loading;
    var aiNote = type === 'achievement' ? '<div style="margin-top:8px; font-size:var(--text-micro); color:var(--muted); line-height:1.4;">Файл проверяется ИИ на релевантность — спам и нечитаемые файлы отклоняются с уведомлением.</div>' : '';

    var dialogWidth = type === 'project' ? '720px' : '440px';
    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:28px; max-width:' + dialogWidth + '; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">' + (isEdit ? 'Изменить' : 'Добавить') + ': ' + titles[type] + '</h3>' +
        '<button data-action="closeItemModal" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0;">×</button></div>' +
      fields +
      '<label style="display:block; margin-top:8px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">' + (multi ? 'Фото и файлы проекта' : 'Прикрепить файл') + ' <span style="color:var(--muted); font-weight:400;">(необязательно)</span></span>' + picker + aiNote + '</label>' +
      err +
      (state.itemConfirmClose
        ? '<div style="margin-top:16px; padding:12px 14px; background:color-mix(in srgb, var(--warn) 10%, #fff); border:1px solid color-mix(in srgb, var(--warn) 26%, #fff); border-radius:10px;">' +
          '<div style="font-size:var(--text-caption); color:var(--warn); font-weight:600; margin-bottom:10px; line-height:1.45;">Закрыть без сохранения? Заполненное не сохранится.</div>' +
          '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
            '<button data-action="closeItemModal" style="font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--warn); border:none; padding:9px 16px; border-radius:9px; cursor:pointer;">Закрыть</button>' +
            '<button data-action="cancelCloseItemModal" style="font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 16px; border-radius:9px; cursor:pointer;">Вернуться к заполнению</button>' +
          '</div></div>'
        : '') +
      '<button data-action="saveItemModal"' + (loading ? ' disabled' : '') + ' style="margin-top:16px; width:100%; ' + S.primary + (loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (loading ? 'Загрузка…' : (isEdit ? 'Сохранить' : 'Добавить')) + '</button>' +
      '<button data-action="closeItemModal" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button>' +
    '</div>';

    return '<div data-action="closeItemModal" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }
  // Динамический список «разделов» проекта (заголовок + текст) внутри модалки.
  function sectionsEditorHtml(sections) {
    var rows = sections.map(function (s) {
      return '<div style="border:1.5px solid var(--line); border-radius:10px; padding:12px; margin-bottom:8px; position:relative;">' +
        '<button class="icon-btn" type="button" data-action="removeProjectSection" data-sec-id="' + esc(s.id) + '" title="Удалить раздел" style="position:absolute; top:8px; right:8px; ' + S.chipIcon + ' color:var(--err);">' + icon('x', 12) + '</button>' +
        '<input data-item-array-field="sections" data-item-array-id="' + esc(s.id) + '" data-item-array-key="title" value="' + esc(s.title) + '" placeholder="Название раздела" style="' + S.field + ' margin-bottom:6px; font-weight:600; padding-right:32px;">' +
        '<textarea data-item-array-field="sections" data-item-array-id="' + esc(s.id) + '" data-item-array-key="text" rows="2" placeholder="Подробности…" style="' + S.field + ' resize:vertical; font-family:inherit; line-height:1.5;">' + esc(s.text) + '</textarea>' +
      '</div>';
    }).join('');
    return rows + '<button type="button" data-action="addProjectSection" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px dashed var(--line); padding:8px 14px; border-radius:9px; cursor:pointer;">+ Добавить раздел</button>';
  }
  // Динамический список «деталей» проекта (метка + значение) — роль, срок, команда и т.п.
  function detailsEditorHtml(details) {
    var rows = details.map(function (d) {
      return '<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">' +
        '<input data-item-array-field="details" data-item-array-id="' + esc(d.id) + '" data-item-array-key="label" value="' + esc(d.label) + '" placeholder="Например, Роль" style="' + S.field + ' flex:1;">' +
        '<input data-item-array-field="details" data-item-array-id="' + esc(d.id) + '" data-item-array-key="value" value="' + esc(d.value) + '" placeholder="Например, Frontend" style="' + S.field + ' flex:1;">' +
        '<button class="icon-btn" type="button" data-action="removeProjectDetail" data-det-id="' + esc(d.id) + '" title="Удалить" style="' + S.chipIcon + ' color:var(--err); flex-shrink:0;">' + icon('x', 12) + '</button>' +
      '</div>';
    }).join('');
    return rows + '<button type="button" data-action="addProjectDetail" style="font-size:var(--text-micro); font-weight:600; color:var(--ink); background:#fff; border:1.5px dashed var(--line); padding:8px 14px; border-radius:9px; cursor:pointer;">+ Добавить деталь</button>';
  }
  // Хэштеги/маркеры проекта — свободные теги для поиска и категоризации.
  function tagsEditorHtml(tags) {
    var chips = tags.map(function (t) {
      return '<span style="display:inline-flex; align-items:center; gap:5px; font-size:var(--text-micro); font-weight:600; color:var(--ink); background:var(--bg); border:1.5px solid var(--line); padding:4px 6px 4px 10px; border-radius:999px;">#' + esc(t) +
        '<button type="button" data-action="removeProjectTag" data-tag="' + esc(t) + '" style="border:none; background:none; color:var(--muted); cursor:pointer; padding:0; display:flex;">' + icon('x', 11) + '</button></span>';
    }).join('');
    return (chips ? '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">' + chips + '</div>' : '') +
      '<div style="display:flex; gap:8px;"><input id="proj-tag-input" placeholder="Например, react, хакатон, командный" style="' + S.field + '"><button type="button" data-action="addProjectTag" style="flex-shrink:0; font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--ink); border:none; padding:0 16px; border-radius:9px; cursor:pointer;">+</button></div>';
  }
  // Зона загрузки файлов/фото: клик или drag-and-drop; каждый файл — отдельный удаляемый тайл.
  function filesDropzoneHtml(type, slots) {
    var multi = isMultiFileType(type);
    var tiles = slots.map(function (s, i) {
      var isImg = isImageFile(s);
      var thumbSrc = s.kind === 'staged' ? s.previewUrl : s.url;
      var big = multi && i === 0;
      var sizeStyle = big ? 'grid-column: span 2; grid-row: span 2;' : '';
      var body = (isImg && thumbSrc)
        ? '<img src="' + esc(thumbSrc) + '" style="width:100%; height:100%; object-fit:cover; border-radius:9px; display:block;">'
        : '<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--muted); background:#fff; border-radius:9px;">' + icon('file', big ? 26 : 16) + '</div>';
      return '<div style="position:relative; aspect-ratio:1; ' + sizeStyle + '">' + body +
        '<button type="button" data-action="removeFileSlot" data-slot-id="' + esc(s.id) + '" title="Удалить" style="position:absolute; top:5px; right:5px; width:22px; height:22px; border-radius:50%; background:rgba(18,20,26,0.65); border:none; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">' + icon('x', 12) + '</button>' +
        (big ? '<span style="position:absolute; bottom:6px; left:6px; font-size:var(--text-micro); font-weight:600; color:#fff; background:rgba(18,20,26,0.55); padding:2px 7px; border-radius:999px;">Обложка</span>' : '') +
      '</div>';
    }).join('');
    var grid = tiles ? '<div class="g4" style="display:grid; gap:8px; margin-bottom:10px;">' + tiles + '</div>' : '';
    return '<label data-dropzone style="display:block; cursor:pointer;">' + grid +
      '<div style="border:1.5px dashed var(--line); border-radius:12px; padding:16px; text-align:center; background:var(--bg);">' +
        '<div style="font-size:var(--text-caption); font-weight:600; color:var(--ink);">' + (multi ? 'Перетащите фото или файлы сюда, или нажмите, чтобы выбрать' : 'Перетащите файл сюда, или нажмите, чтобы выбрать') + '</div>' +
        (multi ? '<div style="font-size:var(--text-micro); color:var(--muted); margin-top:4px;">Можно добавлять по одному. Первое фото станет обложкой карточки проекта.</div>' : '') +
      '</div>' +
      '<input data-item-file-input type="file"' + (multi ? ' multiple accept="image/*,.pdf,.zip,.doc,.docx"' : ' accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf"') + ' style="display:none;">' +
    '</label>';
  }

  /* ---------- AI skills test ---------- */
  var TEST_MIN = 15;                 // длительность теста в минутах
  var testTimer = null;              // id интервала
  var testEndTime = 0;               // время окончания (ms)
  function testBankFor() {
    var spec = state.studentProfile && state.studentProfile.specialty;
    return (window.AI_TEST_BANK && spec) ? window.AI_TEST_BANK[spec] : null;
  }
  // Действующий банк вопросов: сгенерированный ИИ (если получен), иначе статическая заглушка.
  function activeTestBank() { return state.dynamicBank || testBankFor(); }
  // Фоновая попытка получить свежие, неповторяющиеся вопросы через generate-test.
  // При отсутствии backend/ошибке — тихо остаёмся на статическом банке (никаких сообщений об ошибке).
  function tryGenerateAiTest() {
    if (!supabase || !state.session) return;
    var sp = state.studentProfile;
    if (!sp) return;
    var specs = (sp.specialties && sp.specialties.length) ? sp.specialties : (sp.specialty ? [sp.specialty] : []);
    if (!specs.length) return;
    setState({ testGenLoading: true });
    fetch(GENERATE_TEST_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.session.access_token },
      body: JSON.stringify({ specialties: specs, seenQuestions: (sp.aiTestSeenQuestions || []).slice(-60) })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok && res.body && res.body.ok && res.body.bank) setState({ dynamicBank: res.body.bank, testGenLoading: false });
        else setState({ testGenLoading: false });
      }).catch(function () { setState({ testGenLoading: false }); });
  }
  function fmtTime(sec) { var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  /* ---- Анти-чит во время ИИ-теста ----
     Полная блокировка скриншотов из браузера невозможна, и второй телефон рядом
     не детектируется вообще. Значит строгость здесь ловит не списывающих, а
     честных: раньше любая потеря фокуса засчитывалась мгновенно, поэтому входящее
     уведомление, звонок или появление экранной клавиатуры на iOS делали студента
     нарушителем. Хуже того, три обработчика (blur, visibilitychange,
     fullscreenchange) срабатывали на одно переключение и давали три отметки.

     Теперь считается только уход дольше AWAY_GRACE_MS, одно переключение — одна
     отметка, а выход из полноэкранного режима сам по себе не считается: на iOS
     Safari requestFullscreen для documentElement не работает в принципе, и
     наказывать за это владельца айфона бессмысленно. */
  var AWAY_GRACE_MS = 5000;   // короче — это уведомление, а не списывание
  var FLAG_DEDUP_MS = 1500;   // события в пределах окна считаются одним уходом
  var testAwayAt = 0;
  var testLastFlagAt = 0;

  function flagSuspiciousActivity() {
    var now = Date.now();
    if (now - testLastFlagAt < FLAG_DEDUP_MS) return;
    testLastFlagAt = now;
    state.testFlags = (state.testFlags || 0) + 1;
    setState({ testFullscreenWarn: true });
    setTimeout(function () { setState({ testFullscreenWarn: false }); }, 4000);
  }
  function testMarkAway() {
    if (state.testView !== 'running' || testAwayAt) return;
    testAwayAt = Date.now();
  }
  function testMarkBack() {
    if (!testAwayAt) return;
    var gone = Date.now() - testAwayAt;
    testAwayAt = 0;
    if (state.testView !== 'running') return;
    if (gone >= AWAY_GRACE_MS) flagSuspiciousActivity();
  }
  function onTestVisibilityChange() { if (document.hidden) testMarkAway(); else testMarkBack(); }
  function onTestBlur() { testMarkAway(); }
  function onTestFocus() { testMarkBack(); }
  function attachAntiCheat() {
    testAwayAt = 0; testLastFlagAt = 0;
    document.addEventListener('visibilitychange', onTestVisibilityChange);
    window.addEventListener('blur', onTestBlur);
    window.addEventListener('focus', onTestFocus);
  }
  function detachAntiCheat() {
    testAwayAt = 0;
    document.removeEventListener('visibilitychange', onTestVisibilityChange);
    window.removeEventListener('blur', onTestBlur);
    window.removeEventListener('focus', onTestFocus);
  }
  function enterTestFullscreen() {
    try {
      var el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    } catch (e) {}
  }
  function exitTestFullscreen() {
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
  }
  function testTick() {
    var left = Math.max(0, Math.round((testEndTime - Date.now()) / 1000));
    var el = document.getElementById('test-timer');
    if (el) { el.textContent = fmtTime(left); if (left <= 30) el.style.color = 'var(--err)'; }
    if (left <= 0) { stopTestTimer(); actions.submitTest(); }
  }
  function startTestTimer() {
    stopTestTimer();
    testEndTime = Date.now() + TEST_MIN * 60 * 1000;
    testTick();
    testTimer = setInterval(testTick, 1000);
  }
  function stopTestTimer() { if (testTimer) { clearInterval(testTimer); testTimer = null; } }
  function levelFor(correct, total) {
    var r = total ? correct / total : 0;
    if (r >= 0.85) return 'Продвинутый';
    if (r >= 0.5) return 'Уверенный';
    return 'Базовый';
  }
  /* Уровень владения — порядковая шкала, а не состояние. Раньше он красился
     статусными цветами: «Уверенный» получал янтарь предупреждения, будто с ним
     что-то не так, а «Продвинутый» — зелёный успеха. Один цвет должен значить
     одно и то же везде, поэтому здесь нарастание акцента, а не светофор. */
  function levelColor(level) { return { 'Продвинутый': 'var(--accent)', 'Уверенный': 'var(--ink)', 'Базовый': 'var(--muted)' }[level] || 'var(--muted)'; }

  // Детальная карточка навыка: описание, уверенность, сертификат, связанные работы.
  function skillDetailModalHtml() {
    var idx = state.skillDetail;
    if (idx == null) return '';
    var sp = state.studentProfile || {};
    var sk = (sp.hardSkills || [])[idx];
    if (!sk) return '';
    var name = typeof sk === 'string' ? sk : sk.name;
    var conf = typeof sk === 'object' ? sk.confidence : null;
    var desc = typeof sk === 'object' ? sk.description : '';
    var file = typeof sk === 'object' ? sk.file : null;
    var relNames = (typeof sk === 'object' && sk.relatedProjects) || [];
    var relProjects = (sp.projects || []).filter(function (p) { return relNames.indexOf(p.name) !== -1; });
    var filePreview = '';
    if (file) {
      filePreview = isImageFile(file)
        ? '<img src="' + esc(file.url) + '" style="width:100%; border-radius:10px; margin-top:14px; max-height:280px; object-fit:contain; background:var(--bg);">'
        : '<iframe src="' + esc(file.url) + '" style="width:100%; height:320px; border:1.5px solid var(--line); border-radius:10px; margin-top:14px;"></iframe>';
    }
    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:480px; width:100%; max-height:86vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0; ' + S.wrap + '">' + esc(name) + '</h3>' +
        '<button data-action="closeSkillDetail" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0; flex-shrink:0;">×</button></div>' +
      (typeof conf === 'number' ? '<div style="margin-top:16px;"><div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;"><span style="font-size:var(--text-caption); color:var(--muted);">Уверенность</span><span style="font-weight:600; color:' + confidenceColor(conf) + ';">' + conf + '/10</span></div><div style="height:8px; border-radius:999px; background:var(--bg); overflow:hidden;"><div style="width:' + (conf * 10) + '%; height:100%; background:' + confidenceColor(conf) + ';"></div></div></div>' : '') +
      (desc ? '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:14px 0 0; ' + S.wrap + '">' + esc(desc) + '</p>' : '') +
      filePreview +
      (relProjects.length ? '<div style="margin-top:18px;"><div style="font-size:var(--text-caption); font-weight:600; margin-bottom:8px;">Работы с этим навыком</div>' + relProjects.map(function (p) { return '<div style="padding:9px 0; border-top:1.5px solid var(--line); font-size:var(--text-caption); ' + S.wrap + '">' + esc(p.name) + '</div>'; }).join('') + '</div>' : '') +
      '<button data-action="openItemModal" data-item-type="skill" data-item-index="' + idx + '" style="margin-top:20px; width:100%; ' + S.primary.replace('padding:15px', 'padding:12px') + '">Изменить</button>' +
    '</div>';
    return '<div data-action="closeSkillDetail" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  // Детальная карточка проекта: обложка/галерея (свайп/стрелки), полное описание, разделы, детали, теги, ссылки.
  function projectDetailModalHtml() {
    var idx = state.projectDetail;
    if (idx == null) return '';
    var sp = state.studentProfile || {};
    var p = (sp.projects || [])[idx];
    if (!p) return '';
    var files = p.files || [];
    var gi = Math.max(0, Math.min(files.length - 1, state.projectGalleryIndex || 0));
    var gallery = '';
    if (files.length) {
      var cur = files[gi];
      var body = isImageFile(cur)
        ? '<img src="' + esc(cur.url) + '" style="width:100%; height:280px; object-fit:cover; border-radius:12px; display:block;">'
        : '<div style="width:100%; height:280px; border-radius:12px; background:var(--bg); display:flex; align-items:center; justify-content:center; color:var(--muted);">' + icon('file', 40) + '</div>';
      var arrows = files.length > 1
        ? (gi > 0 ? '<button data-action="projectGalleryPrev" style="position:absolute; left:8px; top:50%; transform:translateY(-50%); width:34px; height:34px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; cursor:pointer; font-size:var(--text-body);">‹</button>' : '') +
          (gi < files.length - 1 ? '<button data-action="projectGalleryNext" data-max="' + (files.length - 1) + '" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); width:34px; height:34px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; cursor:pointer; font-size:var(--text-body);">›</button>' : '')
        : '';
      var dots = files.length > 1 ? '<div style="display:flex; justify-content:center; gap:6px; margin-top:8px;">' + files.map(function (_, i) {
        return '<button data-action="projectGalleryGoto" data-idx="' + i + '" style="width:7px; height:7px; border-radius:50%; border:none; padding:0; cursor:pointer; background:' + (i === gi ? 'var(--ink)' : 'var(--line)') + ';"></button>';
      }).join('') + '</div>' : '';
      gallery = '<div data-swipe data-max="' + (files.length - 1) + '" style="position:relative;">' + body + arrows + '</div>' + dots +
        (cur.name ? '<div style="text-align:center; font-size:var(--text-micro); color:var(--muted); margin-top:6px;">' + esc(cur.name) + '</div>' : '');
    }
    var tags = (p.tags || []).map(function (t) { return '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 9px; border-radius:999px;">#' + esc(t) + '</span>'; }).join(' ');
    var details = (p.details || []).filter(function (d) { return d.label || d.value; }).map(function (d) {
      return '<div style="display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-top:1.5px solid var(--line); font-size:var(--text-caption);"><span style="color:var(--muted); ' + S.wrap + '">' + esc(d.label) + '</span><span style="font-weight:600; text-align:right; ' + S.wrap + '">' + esc(d.value) + '</span></div>';
    }).join('');
    var sections = (p.sections || []).filter(function (s) { return s.title || s.text; }).map(function (s) {
      return '<div style="margin-top:14px;"><div style="font-weight:600; font-size:var(--text-caption); margin-bottom:4px; ' + S.wrap + '">' + esc(s.title) + '</div><p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:0; white-space:pre-wrap; ' + S.wrap + '">' + esc(s.text) + '</p></div>';
    }).join('');
    var links = (p.links || []).filter(function (l) { return l.url; }).map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener" style="font-size:var(--text-micro); font-weight:600; color:var(--accent); margin-right:14px;">' + esc(l.label || 'Ссылка') + ' ↗</a>';
    }).join('');

    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:520px; width:100%; max-height:88vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h3 style="font-weight:600; font-size:var(--text-title); margin:0; ' + S.wrap + '">' + esc(p.name) + '</h3>' +
        '<button data-action="closeProjectDetail" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer; padding:0; flex-shrink:0;">×</button></div>' +
      (p.specialty ? '<span style="font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:3px 8px; border-radius:6px; display:inline-block; margin-top:8px;">' + esc(p.specialty) + '</span>' : '') +
      (gallery ? '<div style="margin-top:14px;">' + gallery + '</div>' : '') +
      (p.desc ? '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.55; margin:14px 0 0; ' + S.wrap + '">' + esc(p.desc) + '</p>' : '') +
      (tags ? '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;">' + tags + '</div>' : '') +
      (links ? '<div style="margin-top:14px;">' + links + '</div>' : '') +
      (details ? '<div style="margin-top:16px;">' + details + '</div>' : '') +
      sections +
      '<button data-action="openItemModal" data-item-type="project" data-item-index="' + idx + '" style="margin-top:20px; width:100%; ' + S.primary.replace('padding:15px', 'padding:12px') + '">Изменить</button>' +
    '</div>';
    return '<div data-action="closeProjectDetail" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:20px; pointer-events:none;">' + dialog + '</div>';
  }

  // Просмотр фото/файла на месте (свой предпросмотр, без ухода с платформы).
  function mediaPreviewHtml() {
    var mp = state.mediaPreview;
    if (!mp) return '';
    var body = mp.isImage
      ? '<img src="' + esc(mp.url) + '" style="max-width:100%; max-height:80vh; border-radius:10px; display:block;">'
      : '<iframe src="' + esc(mp.url) + '" style="width:80vw; max-width:800px; height:80vh; border:none; border-radius:10px; background:#fff;"></iframe>';
    return '<div data-action="closeMediaPreview" style="position:fixed; inset:0; z-index:90; background:rgba(18,20,26,0.75);"></div>' +
      '<div style="position:fixed; inset:0; z-index:91; display:flex; align-items:center; justify-content:center; padding:24px; pointer-events:none;">' +
        '<div style="position:relative; pointer-events:auto;">' + body +
          '<button data-action="closeMediaPreview" style="position:absolute; top:-14px; right:-14px; width:32px; height:32px; border-radius:50%; background:#fff; border:none; color:var(--ink); font-size:var(--text-title); cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,0.3);">×</button>' +
        '</div>' +
      '</div>';
  }

  function testModalHtml() {
    if (!state.testView) return '';
    var spec = (state.studentProfile && state.studentProfile.specialty) || '';
    var bank = activeTestBank();
    var aiGenerated = !!state.dynamicBank;
    var dialogStyle = 'pointer-events:auto; background:#fff; border-radius:18px; width:100%; max-width:760px; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 30px 70px -20px rgba(0,0,0,0.5); overflow:hidden;';
    var inner;

    if (state.testView === 'intro') {
      var li = function (t) { return '<li style="margin-bottom:9px; line-height:1.5;">' + t + '</li>'; };
      inner = '<div style="padding:30px 32px; overflow-y:auto;">' +
        '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><h2 style="font-weight:700; font-size:var(--text-h2); letter-spacing:-0.01em; margin:0;">ИИ-тест навыков</h2><button data-action="closeTest" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer;">×</button></div>' +
        '<p style="color:var(--muted); font-size:var(--text-body); margin:8px 0 18px;">Специальность: <strong style="color:var(--ink);">' + esc(spec) + '</strong></p>' +
        (state.testGenLoading ? '<div style="display:flex; align-items:center; gap:8px; font-size:var(--text-micro); color:var(--muted); margin-bottom:14px;">Готовим свежие вопросы…</div>'
          : aiGenerated ? '<div style="display:inline-flex; align-items:center; gap:6px; font-size:var(--text-micro); font-weight:600; color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, #fff); padding:4px 10px; border-radius:999px; margin-bottom:14px;">Вопросы сгенерированы ИИ специально для вас</div>' : '') +
        '<div style="background:var(--bg); border:1.5px solid var(--line); border-radius:14px; padding:18px 20px;"><div style="font-weight:600; font-size:var(--text-caption); margin-bottom:12px;">Как проходит тест</div><ul style="margin:0; padding-left:20px; font-size:var(--text-caption); color:var(--ink);">' +
          /* Число берётся из банка: он может генерироваться ИИ, и жёстко зашитая
             «8» врала бы, если вопросов пришло другое количество. */
          li('<strong>' + ((bank && bank.mcq) ? bank.mcq.length : 8) + ' вопросов с вариантами</strong> ответа + <strong>1 открытый</strong> практический вопрос.') +
          li('На весь тест — <strong>' + TEST_MIN + ' минут</strong>, идёт обратный отсчёт. По истечении тест завершится автоматически.') +
          /* Раньше здесь стояли две угрозы подряд: «тест сбросится» и «фиксируется
             как подозрительная активность». Подросток читал это перед началом и
             входил в тест уже под давлением. Закрыть окно случайно теперь нельзя
             (подложка инертна, крестик спрашивает), а про отметки честнее сказать,
             что именно они значат: они не приговор и никого не блокируют. */
          li('<strong>Одна попытка.</strong> Прервать можно в любой момент, но начать заново не получится.') +
          li('Если надолго переключитесь на другое приложение, это отметится рядом с результатом — компания увидит пометку. Короткие уведомления и звонки не считаются.') +
          li('По результату вы получите <strong>уровень</strong> (Базовый / Уверенный / Продвинутый).') +
        '</ul></div>' +
        (bank ? '' : '<div style="margin-top:16px; padding:12px 14px; background:color-mix(in srgb, var(--err) 8%, #fff); border:1px solid color-mix(in srgb, var(--err) 22%, #fff); border-radius:10px; font-size:var(--text-caption); color:var(--err);">Для этой специальности пока нет вопросов.</div>') +
        '<div style="display:flex; gap:12px; margin-top:22px;"><button data-action="startTest"' + (bank ? '' : ' disabled') + ' style="' + S.primary.replace('padding:15px', 'padding:13px 26px') + (bank ? '' : ' opacity:0.5; cursor:not-allowed;') + '">Начать тест</button><button data-action="closeTest" style="' + S.ghost + '">Отмена</button></div>' +
      '</div>';
    } else if (state.testView === 'running' && bank) {
      var q = bank.mcq.map(function (item, i) {
        var opts = item.a.map(function (opt, j) {
          return '<label style="display:flex; align-items:flex-start; gap:10px; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; margin-bottom:8px; cursor:pointer; font-size:var(--text-caption); line-height:1.4;"><input type="radio" name="q' + i + '" value="' + j + '" style="margin-top:2px;">' + esc(opt) + '</label>';
        }).join('');
        return '<div style="margin-bottom:22px;"><div style="font-weight:600; font-size:var(--text-body); margin-bottom:11px;">' + (i + 1) + '. ' + esc(item.q) + '</div>' + opts + '</div>';
      }).join('');
      var openBlock = '<div style="margin-bottom:8px;"><div style="font-weight:600; font-size:var(--text-body); margin-bottom:6px;">9. ' + esc(bank.open) + '</div>' +
        '<textarea id="test-open" rows="5" placeholder="Ваш ответ…" style="width:100%; font-size:var(--text-body); padding:12px; border:1.5px solid var(--line); border-radius:10px; font-family:inherit; line-height:1.5; resize:vertical;"></textarea></div>';
      var warnBanner = state.testFullscreenWarn ? '<div style="padding:10px 24px; background:color-mix(in srgb, var(--err) 8%, #fff); border-bottom:1px solid color-mix(in srgb, var(--err) 22%, #fff); font-size:var(--text-micro); color:var(--err); font-weight:600; flex-shrink:0;">Обнаружена подозрительная активность (переключение окна/выход из полноэкранного режима) — это зафиксировано вместе с результатом.</div>' : '';
      inner =
        '<div oncontextmenu="return false" oncopy="return false" onpaste="return false" style="display:flex; flex-direction:column; min-height:0; flex:1; user-select:none;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 24px; border-bottom:1.5px solid var(--line); flex-shrink:0;">' +
          '<div><div style="font-weight:600; font-size:var(--text-body);">ИИ-тест · ' + esc(spec) + '</div></div>' +
          '<div style="display:flex; align-items:center; gap:14px;"><span style="font-size:var(--text-caption); color:var(--muted);">Осталось</span><span id="test-timer" style="font-weight:600; font-size:var(--text-title); min-width:64px; text-align:center;">' + fmtTime(TEST_MIN * 60) + '</span><button data-action="askCloseTest" title="Прервать тест" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer;">×</button></div>' +
        '</div>' +
        /* Крестик раньше вёл прямо в closeTest с подписью «тест сбросится» —
           одно нажатие уничтожало единственную попытку без вопроса. Теперь он
           спрашивает, а решение остаётся за студентом. */
        (state.testConfirmExit
          ? '<div style="padding:14px 24px; background:color-mix(in srgb, var(--err) 8%, #fff); border-bottom:1.5px solid color-mix(in srgb, var(--err) 26%, #fff);">' +
            '<div style="font-size:var(--text-caption); color:var(--err); font-weight:600; margin-bottom:10px;">Прервать тест? Попытка не сохранится, а она одна.</div>' +
            '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
              '<button data-action="closeTest" style="font-size:var(--text-caption); font-weight:600; color:#fff; background:var(--err); border:none; padding:9px 16px; border-radius:9px; cursor:pointer;">Прервать</button>' +
              '<button data-action="cancelCloseTest" style="font-size:var(--text-caption); font-weight:600; color:var(--ink); background:#fff; border:1.5px solid var(--line); padding:9px 16px; border-radius:9px; cursor:pointer;">Продолжить тест</button>' +
            '</div></div>'
          : '') +
        warnBanner +
        '<div style="padding:22px 24px; overflow-y:auto;">' + q + openBlock + '</div>' +
        '<div style="padding:16px 24px; border-top:1.5px solid var(--line); flex-shrink:0;"><button data-action="submitTest" style="width:100%; ' + S.primary + '">Завершить тест</button></div>' +
        '</div>';
    } else if (state.testView === 'result' && state.testResult) {
      var r = state.testResult;
      inner = '<div style="padding:34px 32px; overflow-y:auto; text-align:center;">' +
        '<div style="width:64px; height:64px; border-radius:18px; background:color-mix(in srgb, ' + levelColor(r.level) + ' 14%, #fff); color:' + levelColor(r.level) + '; display:flex; align-items:center; justify-content:center; font-size:var(--text-h1); margin:0 auto 18px;">✓</div>' +
        '<h2 style="font-weight:700; font-size:var(--text-h2); margin:0 0 6px;">Тест завершён</h2>' +
        '<div style="font-size:var(--text-body); color:var(--muted); margin-bottom:20px;">Специальность: ' + esc(r.specialty) + '</div>' +
        '<div style="display:inline-flex; flex-direction:column; gap:6px; background:var(--bg); border:1.5px solid var(--line); border-radius:14px; padding:18px 30px; margin-bottom:20px;">' +
          '<span style="font-size:var(--text-caption); color:var(--muted);">Ваш уровень</span><span style="font-weight:600; font-size:var(--text-h2); color:' + levelColor(r.level) + ';">' + r.level + '</span>' +
          '<span style="font-size:var(--text-caption); color:var(--muted);">Верных ответов: ' + r.correct + ' из ' + r.total + '</span></div>' +
        /* Раньше здесь стояло «Зафиксировано подозрительных действий: N» красным
           и без единого слова о последствиях: максимум тревоги при нуле
           информации. Формулировка нейтральная, последствие названо прямо. */
        (r.flags ? '<div style="font-size:var(--text-caption); color:var(--warn); background:color-mix(in srgb, var(--warn) 10%, #fff); border:1px solid color-mix(in srgb, var(--warn) 24%, #fff); border-radius:10px; padding:10px 14px; margin-bottom:16px; line-height:1.45; max-width:420px; margin-left:auto; margin-right:auto;">Во время теста вы отходили от вкладки: ' + r.flags + ' ' + pluralRu(r.flags, 'раз', 'раза', 'раз') + '. Пометка сохранится рядом с результатом — на уровень она не влияет, но компания её увидит.</div>' : '') +
        /* Было: «Открытый ответ в полной версии оценивается ИИ (Claude)…».
           Две проблемы. Во-первых, «в полной версии» студент читает буквально —
           что ему подсунули неполный продукт. Во-вторых, это неправда по факту:
           submitTest читает поле в openEl, но в aiTest сохраняются только уровень,
           счёт, время и отметки — открытый ответ не записывается никуда и его
           никто никогда не прочитает. Для платформы, чей первый принцип —
           «не обещать статуса, которого нет», обещание несуществующей проверки
           хуже, чем её отсутствие. Текст говорит ровно то, что происходит. */
        '<p style="font-size:var(--text-caption); color:var(--muted); line-height:1.5; max-width:420px; margin:0 auto 22px;">Уровень посчитан по вопросам с вариантами. Открытый вопрос — для практики: автоматическая проверка развёрнутых ответов пока не подключена.</p>' +
        '<button data-action="closeTest" style="' + S.primary.replace('padding:15px', 'padding:13px 30px') + '">Готово</button>' +
      '</div>';
    } else {
      inner = '<div style="padding:30px; text-align:center; color:var(--muted);">Что-то пошло не так.<div style="margin-top:16px;"><button data-action="closeTest" style="' + S.ghost + '">Закрыть</button></div></div>';
    }

    /* Пока тест идёт, подложка инертна. Раньше на ней висел closeTest, который
       без единого вопроса сносил таймер и состояние, — а во вступлении обещана
       «Одна попытка». На телефоне одно случайное касание большим пальцем мимо
       окна заканчивало попытку без возможности восстановления. */
    var backdropAction = state.testView === 'running' ? '' : ' data-action="closeTest"';
    return '<div' + backdropAction + ' style="position:fixed; inset:0; z-index:80; background:rgba(18,20,26,0.55);"></div>' +
      '<div style="position:fixed; inset:0; z-index:81; display:flex; align-items:center; justify-content:center; padding:16px; pointer-events:none;"><div style="' + dialogStyle + '">' + inner + '</div></div>';
  }

  /* ---------- gig posting modal (company) ---------- */
  /* Плашка отмены после удаления. Живёт внизу экрана, где до неё дотягивается
     большой палец, и исчезает сама через 8 секунд. */
  function undoBarHtml() {
    var u = state.undoItem;
    if (!u) return '';
    return '<div class="rise-in" style="position:fixed; left:50%; transform:translateX(-50%); bottom:20px; z-index:95; display:flex; align-items:center; gap:14px; background:var(--ink); color:#fff; padding:12px 16px; border-radius:12px; box-shadow:0 18px 40px -16px rgba(18,20,26,0.55); max-width:calc(100vw - 32px);">' +
      '<span style="font-size:var(--text-caption);">' + esc(u.label) + ' удалён</span>' +
      '<button data-action="undoRemoveItem" style="font-size:var(--text-caption); font-weight:600; color:var(--accent-on-dark); background:none; border:none; cursor:pointer; padding:0; white-space:nowrap;">Отменить</button>' +
    '</div>';
  }

  function gigModalHtml() {
    if (!state.gigModal) return '';
    var f = state.form, gs = state.gigSubmit;
    var field = function (label, key, ph, hint) {
      return '<label style="display:block; margin-bottom:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">' + label + '</span>' +
        '<input data-field="' + key + '" value="' + esc(f[key] || '') + '" placeholder="' + esc(ph) + '" style="width:100%; font-size:var(--text-body); padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; background:#fff; color:var(--ink);">' +
        (hint ? '<span style="display:block; font-size:var(--text-micro); color:var(--muted); margin-top:5px;">' + hint + '</span>' : '') + '</label>';
    };
    var formats = ['Удалённо', 'Гибрид', 'Офис (Ташкент)'];
    var fmtOpts = [''].concat(formats).map(function (o) { var sel = f.gigFormat === o ? ' selected' : ''; return '<option value="' + esc(o) + '"' + sel + '>' + (o || 'Выберите формат…') + '</option>'; }).join('');
    var dialog = '<div style="pointer-events:auto; background:#fff; border-radius:18px; padding:26px; max-width:520px; width:100%; max-height:92vh; overflow-y:auto; box-shadow:0 30px 60px -20px rgba(0,0,0,0.45);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px;"><h3 style="font-weight:600; font-size:var(--text-title); letter-spacing:-0.01em; margin:0;">Новая задача</h3><button data-action="closeGigForm" style="background:none; border:none; font-size:var(--text-h2); line-height:1; color:var(--muted); cursor:pointer;">×</button></div>' +
      field('Название задачи', 'gigTitle', 'Напр. Дизайн лендинга для запуска') +
      '<label style="display:block; margin-bottom:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Описание</span><textarea data-field="gigDesc" rows="4" placeholder="Что нужно сделать, объём работы, требования…" style="width:100%; font-size:var(--text-body); padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-family:inherit; line-height:1.5; resize:vertical;">' + esc(f.gigDesc || '') + '</textarea></label>' +
      '<label style="display:block; margin-bottom:14px;"><span style="display:block; font-size:var(--text-caption); font-weight:600; margin-bottom:6px;">Формат</span><select data-field="gigFormat" style="width:100%; font-size:var(--text-body); padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; background:#fff; color:var(--ink);">' + fmtOpts + '</select></label>' +
      '<div class="g2" style="display:grid; gap:14px;">' + field('Длительность', 'gigDuration', 'Напр. 2 недели') + field('Сколько человек нужно', 'gigSlots', 'Напр. 1') + '</div>' +
      (gs.error ? '<div style="font-size:var(--text-caption); color:var(--err); font-weight:600; margin-bottom:8px;">' + esc(gs.error) + '</div>' : '') +
      '<button data-action="submitGig"' + (gs.loading ? ' disabled' : '') + ' style="width:100%; ' + S.primary + (gs.loading ? ' opacity:0.6; cursor:not-allowed;' : '') + '">' + (gs.loading ? 'Публикация…' : 'Опубликовать задачу') + '</button>' +
      '<button data-action="closeGigForm" style="margin-top:10px; width:100%; ' + S.ghost + '">Отмена</button>' +
    '</div>';
    return '<div data-action="closeGigForm" style="position:fixed; inset:0; z-index:70; background:rgba(18,20,26,0.45);"></div>' +
      '<div class="modal-wrap" style="position:fixed; inset:0; z-index:71; display:flex; align-items:center; justify-content:center; padding:16px; pointer-events:none;">' + dialog + '</div>';
  }

  // Каждый render переписывает innerHTML целиком, а чат перерисовывается на каждое входящее
  // сообщение. Без этого пользователь терял бы курсор в поле ввода и уезжал в начало переписки.
  function chatInputHasFocus() {
    var el = document.activeElement;
    return !!(el && el.hasAttribute && el.hasAttribute('data-chat-input'));
  }
  function restoreChatUi(keepFocus) {
    var thread = root.querySelector('[data-chat-thread]');
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (!keepFocus) return;
    var input = root.querySelector('[data-chat-input]');
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  // Какой вид был отрисован в прошлый раз — чтобы отличить смену вида от обычного
  // обновления состояния.
  var lastRenderedView = null;

  function render() {
    var keepChatFocus = state.view === 'chat' && (chatInputHasFocus() || focusChatInput);
    focusChatInput = false;
    root.innerHTML = header() + viewHtml() + footer() + modalHtml() + itemModalHtml() + skillDetailModalHtml() + projectDetailModalHtml() + mediaPreviewHtml() + testModalHtml() + gigModalHtml() + undoBarHtml();

    // render() переписывает весь root, поэтому <main class="view-in"> создаётся заново
    // при каждом изменении состояния — и анимация появления стартовала с нуля на каждый
    // клик: страница снова уезжала на 14px и всплывала. При просмотре каталога или
    // разборе очереди это повторялось десятки раз подряд и читалось как подтормаживание.
    // Снимаем класс до отрисовки кадра, если вид не менялся: анимация остаётся там, где
    // она осмысленна — на переходе между экранами.
    if (state.view === lastRenderedView) {
      var main = root.querySelector('main.view-in');
      if (main) main.classList.remove('view-in');
    }
    lastRenderedView = state.view;

    setupReveal();
    if (state.view === 'chat') restoreChatUi(keepChatFocus);
  }
  // Перерисовывает только шапку и оверлей (для открытия/закрытия меню), не трогая тело страницы.
  function paintHeader() {
    var ov = root.querySelector('[data-menu-overlay]');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var hdr = root.querySelector('header');
    if (hdr) hdr.outerHTML = header();
  }

  // Уводит на страницу авторизации Telegram. intent переживает редирект в localStorage:
  // вернувшись, страница уже перезагружена и состояние приложения потеряно.
  //
  // Redirect-флоу вместо JS-колбэка: колбэк Telegram.Login.auth молча возвращает false,
  // когда браузер режет стороннее хранилище (Safari ITP, Chrome). Здесь Telegram сам
  // возвращает нас на страницу с подписанными данными — межсайтовое хранилище не нужно.
  function goToTelegram(intent) {
    if (TELEGRAM_BOT.indexOf('YOUR_BOT') !== -1) {
      setState({ tgAuth: { loading: false, error: 'Telegram-бот не настроен (TELEGRAM_BOT / TELEGRAM_BOT_ID в int_app.js).' } });
      return;
    }
    try { localStorage.setItem(TG_INTENT_KEY, intent); } catch (e) { /* приватный режим — упадём в обычный вход */ }
    var origin = location.protocol + '//' + location.host;
    var returnTo = origin + location.pathname;  // без query/hash, чтобы не копить мусор
    var url = 'https://oauth.telegram.org/auth?bot_id=' + encodeURIComponent(TELEGRAM_BOT_ID) +
      '&origin=' + encodeURIComponent(origin) +
      '&request_access=write' +
      '&return_to=' + encodeURIComponent(returnTo);
    setState({ tgAuth: { loading: true, error: '' } });
    window.location.href = url;
  }

  // Считывает и сразу гасит намерение — чтобы повторное обновление страницы
  // не приняло обычный вход за привязку.
  function takeTelegramIntent() {
    var v = null;
    try { v = localStorage.getItem(TG_INTENT_KEY); localStorage.removeItem(TG_INTENT_KEY); } catch (e) {}
    return v;
  }

  // Убирает данные Telegram из адресной строки: чтобы не переобработать при обновлении и не светить hash.
  function stripTelegramReturn() {
    try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
  }
  // Возврат из redirect-флоу Telegram. Основной формат — подписанные поля query-параметрами
  // (?id=..&hash=..&auth_date=..). Запасной — #tgAuthResult=base64(JSON). Возвращает поля или null.
  function readTelegramReturn() {
    var search = window.location.search || '';
    // Пробрасываем ровно то, что прислал Telegram: подпись считается по этому же набору полей,
    // лишнее/недостающее её сломает. return_to мы задаём без своих query, так что тут только Telegram.
    if (search.indexOf('hash=') !== -1) {
      try {
        var params = new URLSearchParams(search);
        if (params.get('id') && params.get('hash') && params.get('auth_date')) {
          var user = {};
          params.forEach(function (v, k) { user[k] = v; });
          stripTelegramReturn();
          return user;
        }
      } catch (e) { /* упадём в разбор hash ниже */ }
    }

    var hash = window.location.hash || '';
    var i = hash.indexOf('tgAuthResult=');
    if (i === -1) return null;
    var raw = hash.slice(i + 'tgAuthResult='.length).split('&')[0];
    stripTelegramReturn();
    try {
      var b64 = decodeURIComponent(raw).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      // atob даёт латиницу-1; decodeURIComponent(escape(...)) восстанавливает UTF-8 (кириллица в имени).
      var json;
      try { json = decodeURIComponent(escape(bin)); } catch (e) { json = bin; }
      var u = JSON.parse(json);
      return (u && u.id && u.hash) ? u : null;
    } catch (e) { return null; }
  }

  function init() {
    root = document.getElementById('root');
    // Публичная справка: /cert/<public_id>. Cloudflare Pages на неизвестный путь отдаёт
    // index.html, поэтому маршрут разбираем здесь. Открывается без входа.
    var certMatch = (window.location.pathname || '').match(/\/cert\/([A-Za-z0-9_-]+)\/?$/);
    if (certMatch) {
      // Справка школьника не должна всплывать в гугле по его имени: ссылку студент
      // даёт сам, но индексировать её не нужно.
      var meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      document.head.appendChild(meta);

      state.view = 'cert';
      state.cert = { loading: true, data: null, error: '' };
      if (supabase) {
        supabase.rpc('certificate_public', { p_public_id: certMatch[1] }).then(function (r) {
          state.cert = { loading: false, data: (r.data && r.data[0]) || null, error: r.error ? 'Не удалось загрузить справку' : '' };
          render();
        });
      } else {
        state.cert = { loading: false, data: null, error: 'Supabase не настроен' };
      }
    }

    var tgUser = certMatch ? null : readTelegramReturn();
    var tgIntent = certMatch ? null : takeTelegramIntent();
    // Сессию на странице справки не восстанавливаем: она публичная и открывается
    // посторонним человеком. Но обработчики ниже вешаются в обоих случаях — иначе
    // на этой странице не работали бы ссылки в шапке.
    if (certMatch) {
      render();
    } else if (tgUser && tgIntent === 'link') {
      // Возврат после привязки: сессия уже есть (человек не выходил), меняем не её,
      // а связь telegram_id → аккаунт. Профиль восстанавливаем как обычно.
      restoreSession();
      actions.finishLinkTelegram(tgUser);
    } else if (tgUser) {
      // Вернулись после авторизации в Telegram — сразу меняем данные на сессию.
      state.view = 'student';
      actions.telegramAuth(tgUser);
    } else {
      restoreSession();  // роль (студент/компания) определяется внутри по данным аккаунта
    }
    loadGigs();

    // Пришли по ссылке вида /#sec-how — доводим до секции после первой отрисовки.
    // Без этого href в меню обещал бы работающий адрес, который на самом деле не работает.
    var wantId = (window.location.hash || '').replace('#', '');
    if (wantId && /^sec-[a-z-]+$/.test(wantId)) {
      setTimeout(function () { doScroll(wantId); }, 80);
    }

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
    function applyItemArrayField(target) {
      var arrField = target.getAttribute && target.getAttribute('data-item-array-field');
      if (!arrField) return false;
      var arrId = target.getAttribute('data-item-array-id');
      var arrKey = target.getAttribute('data-item-array-key');
      state.itemForm = state.itemForm || {};
      var list = state.itemForm[arrField] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === arrId) { list[i][arrKey] = target.value; break; }
      }
      return true;
    }
    // Enter отправляет сообщение, Shift+Enter — перенос строки.
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (!e.target.hasAttribute || !e.target.hasAttribute('data-chat-input')) return;
      e.preventDefault();
      focusChatInput = true;
      actions.sendMessage();
    });
    root.addEventListener('input', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-field'); if (f) state.form[f] = e.target.value;
      var itf = e.target.getAttribute && e.target.getAttribute('data-item-field'); if (itf) { state.itemForm = state.itemForm || {}; state.itemForm[itf] = e.target.value; }
      // Счётчик длины характеристики — тоже точечно: render() сбросил бы фокус и каретку.
      if (f === 'certBody') {
        var cl = document.getElementById('cert-left');
        if (cl) {
          var rest = 120 - e.target.value.trim().length;
          cl.textContent = rest > 0 ? 'Ещё минимум ' + rest + ' символов' : 'Достаточно';
          cl.style.color = rest > 0 ? 'var(--muted)' : 'var(--ok)';
        }
      }
      // Подпись у ползунка обновляем точечно, а не через render(): перерисовка заменит
      // сам input, и перетаскивание оборвётся на первом же движении.
      if (itf === 'confidence') {
        var cb = document.getElementById('conf-badge');
        if (cb) { var cn = Number(e.target.value); cb.textContent = cn + '/10'; cb.style.color = confidenceColor(cn); }
      }
      var cf = e.target.getAttribute && e.target.getAttribute('data-company-field'); if (cf && state.companyProfile) state.companyProfile[cf] = e.target.value;
      applyItemArrayField(e.target);
    });
    root.addEventListener('change', function (e) {
      // Текстовые поля компании автосохраняются при потере фокуса (change = blur после правки),
      // чтобы не писать в БД на каждую букву. Значение уже в state из input-обработчика выше.
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-company-field') && state.companyProfile) {
        autoSaveCompany();
        return;
      }
      // выбор файла в модалке загрузки документа
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-file-input')) {
        pendingDocFile = (e.target.files && e.target.files[0]) || null;
        setState({ docUpload: { loading: false, error: '', fileName: pendingDocFile ? pendingDocFile.name : '' } });
        return;
      }
      // Официальное свидетельство: грузим сразу по выбору файла — отдельная модалка тут
      // ничего не добавляет, компания просто прикладывает готовый документ.
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-cert-doc-input')) {
        uploadCertDoc(e.target.getAttribute('data-cert-id'), (e.target.files && e.target.files[0]) || null);
        return;
      }
      // выбор файла(ов) в модалке добавления/редактирования элемента профиля
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-item-file-input')) {
        actions.addFileSlots(e.target.files);
        e.target.value = '';
        return;
      }
      // выбор фото профиля — загружается сразу
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-avatar-input')) {
        var file = (e.target.files && e.target.files[0]) || null;
        if (file) actions.uploadAvatar(file);
        return;
      }
      // select с немедленным действием (например, тег доступности в кабинете студента)
      var sa = e.target.getAttribute && e.target.getAttribute('data-select-action');
      if (sa && actions[sa]) { actions[sa](e.target.value); return; }
      var f = e.target.getAttribute && e.target.getAttribute('data-field'); if (f) state.form[f] = e.target.value;
      var itf = e.target.getAttribute && e.target.getAttribute('data-item-field'); if (itf) { state.itemForm = state.itemForm || {}; state.itemForm[itf] = e.target.value; }
      applyItemArrayField(e.target);
    });
    // Drag-and-drop файлов/фото в зону загрузки (data-dropzone) — click-to-select обрабатывается обычным <label>+<input>.
    root.addEventListener('dragover', function (e) { if (e.target.closest && e.target.closest('[data-dropzone]')) e.preventDefault(); });
    root.addEventListener('drop', function (e) {
      var dz = e.target.closest && e.target.closest('[data-dropzone]');
      if (!dz) return;
      e.preventDefault();
      var files = (e.dataTransfer && e.dataTransfer.files) || [];
      if (files.length) actions.addFileSlots(files);
    });
    // Свайп по галерее фото проекта (touch) — клик по стрелкам работает и без этого.
    var swipeStartX = null;
    root.addEventListener('touchstart', function (e) {
      var sw = e.target.closest && e.target.closest('[data-swipe]');
      if (sw && e.touches && e.touches[0]) swipeStartX = e.touches[0].clientX;
    }, { passive: true });
    root.addEventListener('touchend', function (e) {
      var sw = e.target.closest && e.target.closest('[data-swipe]');
      if (!sw || swipeStartX == null) return;
      var endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : swipeStartX;
      var dx = endX - swipeStartX;
      swipeStartX = null;
      if (Math.abs(dx) < 40) return;
      var max = Number(sw.getAttribute('data-max')) || 0;
      var cur = state.projectGalleryIndex || 0;
      if (dx < 0) setState({ projectGalleryIndex: Math.min(max, cur + 1) });
      else setState({ projectGalleryIndex: Math.max(0, cur - 1) });
    }, { passive: true });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
