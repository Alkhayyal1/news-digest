import { esc, fmt, fmtS, ago, until, api, TYPE, VERIFY, RESEARCH, HEALTH, isArabic } from './common.js';

const app = document.getElementById('app');
let SECTIONS = [];
let statusTimer = null;
const secName = (k) => SECTIONS.find((s) => s.key === k)?.name || k;

function setNav(name) {
  document.querySelectorAll('nav.main a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

// ---------- status bar ----------
async function renderStatus(el) {
  let s;
  try {
    s = await api('/api/status');
  } catch (e) {
    el.innerHTML = `<div class="notice danger">تعذر جلب حالة الخدمة: ${esc(e.message)}</div>`;
    return null;
  }
  const enabled = s.sources.filter((x) => x.enabled);
  const ok = enabled.filter((x) => x.health === 'ok').length;
  const failing = enabled.filter((x) => x.health === 'failing');
  const lr = s.lastRun;
  const failed = lr && lr.status === 'failed';
  // one quiet line: the reader only needs to know when the next bulletin comes (details live on «المصادر»)
  const refresh = s.static ? '' : `<button class="btn small" id="refresh" ${s.running ? 'disabled' : ''}>${s.running ? '<span class="spinner"></span> جارٍ التحديث' : 'تحديث الآن'}</button>`;
  el.innerHTML = `
    <div class="status-mini" role="status">
      <span class="dot ${failed ? 'bad' : failing.length ? 'warn' : ''}"></span>
      ${s.schedulerEnabled ? `<span title="${esc(fmt(s.schedule.nextRunAt))}">النشرة القادمة <b>${esc(fmtTime(s.schedule.nextRunAt))}</b> <span class="sub">(${esc(until(s.schedule.nextRunAt))})</span></span>` : '<span>الجدولة معطلة</span>'}
      <a href="#/sources" title="${failing.length ? 'متعطل: ' + esc(failing.map((f) => f.name).join('، ')) : 'لا أعطال'}">${ok}/${enabled.length} مصدر</a>
      ${refresh}
    </div>
    ${failed ? `<div class="notice danger">فشل آخر تحديث (${esc(fmt(lr.started_at))}). تُعرض آخر نشرة سليمة.</div>` : ''}`;
  el.querySelector('#refresh')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> جارٍ التحديث';
    try {
      await api('/api/refresh', { method: 'POST' });
      pollUntilDone(el);
    } catch (e) {
      b.disabled = false;
      b.textContent = 'تحديث الآن';
      alert(e.message);
    }
  });
  if (s.running) pollUntilDone(el);
  return s;
}

function pollUntilDone(el) {
  clearInterval(statusTimer);
  statusTimer = setInterval(async () => {
    try {
      const s = await api('/api/status');
      if (!s.running) {
        clearInterval(statusTimer);
        route();
      }
    } catch {}
  }, 4000);
}

// ---------- dates ----------
const fmtWeekday = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtHijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric' });
const fmtClock = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true });
function todayLine() {
  const d = new Date();
  let hijri = '';
  try {
    hijri = ' · ' + fmtHijri.format(d);
  } catch {}
  return `${fmtWeekday.format(d)}${hijri} · بتوقيت الرياض`;
}
function fmtTime(ms) {
  if (!ms) return '—';
  const sameDay = fmtWeekday.format(new Date(ms)) === fmtWeekday.format(new Date());
  return sameDay ? fmtClock.format(new Date(ms)) : fmtS(ms);
}

// ---------- cards ----------
const NOTABLE_VERIFY = { official: 'رسمي', confirmed: 'مؤكد', multi_source: 'عدة مصادر', preliminary: 'معلومات أولية', conflicting: 'روايات متضاربة' };

function card(s, { highlight = null, kind = 'new', laterUpdates = 0 } = {}) {
  if (!s) return '';
  const p = s.primary || {};
  const limited = s.ai_status !== 'done';
  const type = kind === 'update' ? 'update' : s.content_type;
  const others = (s.sources || []).slice(1);
  const lastUpdate = (s.updates || []).slice(-1)[0];
  // an update card leads with the new development, not the headline readers already saw
  const headline = kind === 'update' && lastUpdate?.title ? lastUpdate.title : s.title;
  const ver = NOTABLE_VERIFY[s.verification];
  const tags = (s.tags || []).filter((t) => !(s.entities || []).some((e) => e.label === t)).slice(0, 4);
  return `<article class="card" id="ev-${s.id}" data-sec="${esc(s.section)}">
    <div class="top">
      ${highlight ? `<span class="badge hl-${esc(highlight)}">${esc(highlight)}</span>` : ''}
      ${type !== 'news' ? `<span class="badge type-${esc(type)}">${esc(TYPE[type] || type)}</span>` : ''}
      ${p.url ? `<a class="src" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(p.source)}</a>` : `<span class="src">${esc(p.source || '—')}</span>`}
      <span class="sep">·</span><span>${esc(ago(p.published_at || s.first_seen_at))}</span>
      ${ver ? `<span class="badge ver-${esc(s.verification)}">${esc(ver)}</span>` : ''}
      ${s.research_note ? `<span class="badge ver-preliminary">${esc(RESEARCH[s.research_note] || '')}</span>` : ''}
      ${limited && !isArabic(s.title) ? '<span class="badge limited">بلغة المصدر</span>' : ''}
    </div>
    <h4><a href="#/event/${s.id}" ${isArabic(headline) ? '' : 'dir="auto"'}>${esc(headline)}</a></h4>
    ${kind === 'update' && lastUpdate ? `<div class="changed"><b>ما الذي تغيّر:</b> ${esc(lastUpdate.changed)}<div class="sub">الخبر الأصلي: ${esc(s.title)}</div></div>` : ''}
    ${s.summary ? `<p class="summary" dir="auto">${limited ? '<span class="excerpt-tag">مقتطف:</span>' : ''}${esc(s.summary)}</p>` : ''}
    ${s.facts?.length ? `<ul class="facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${s.why ? `<div class="why"><b>لماذا يهم؟</b> ${esc(s.why)} <span class="sub">(تقدير تحريري)</span></div>` : ''}
    ${s.section === 'w_science' || s.section === 'w_health' ? `<div class="science">${s.research_note ? '' : 'لم يحدد المصدر طبيعة البحث. '}النتائج البحثية ليست توصيات علاجية.</div>` : ''}
    ${tags.length ? `<div class="chips">${tags.map((t) => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
    ${others.length ? `<details class="more"><summary>${others.length === 1 ? 'مصدر آخر غطّى الخبر' : `${others.length} مصادر أخرى غطّت الخبر`}</summary><ul>${others.map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(o.source)}</a> — <span dir="auto">${esc(o.title)}</span> <span class="sub">(${esc(fmtS(o.published_at))})</span></li>`).join('')}</ul></details>` : ''}
    <div class="foot">
      <span class="times"><span>نشر المصدر: ${p.published_at ? esc(fmtS(p.published_at)) : 'غير محدد'}</span><span>أُضيف: ${esc(fmtS(s.first_seen_at))}</span>${s.updates?.length ? `<span>آخر تطور: ${esc(fmtS(s.last_update_at))}</span>` : ''}</span>
      ${laterUpdates ? `<a href="#/event/${s.id}">${laterUpdates} تحديث لاحق</a>` : ''}
      <a class="more-link" href="#/event/${s.id}">التفاصيل ←</a>
    </div>
  </article>`;
}

// ---------- bulletin layout: tabs → sections → compact rows ----------
const SHOW_PER_SECTION = 5;
const TABS = [
  { key: 'top', path: '#/', name: 'الأهم' },
  { key: 'trend', path: '#/trend', name: 'ترند' },
  { key: 'saudi', path: '#/saudi', name: 'السعودية' },
  { key: 'world', path: '#/world', name: 'العالم' },
  { key: 'fields', path: '#/fields', name: 'المجالات' },
];
const GROUP_NAMES = { saudi: 'السعودية', world: 'العالم', fields: 'المجالات' };
// Bulletins published before world politics was split by region: shown under «الشرق الأوسط» when the headline names the region.
const MIDEAST = /(الشرق الأوسط|الخليج|غز[ةه]|فلسطين|الفلسطيني|إسرائيل|الإسرائيلي|إيران|الإيراني|طهران|لبنان|اللبناني|سوريا|السوري|العراق|العراقي|اليمن|اليمني|الحوثي|حماس|حزب الله|مصر|المصري|الأردن|الأردني|قطر|القطري|الإمارات|الإماراتي|الكويت|البحرين|عُ?مان|تركيا|التركي|السودان|ليبيا|تونس|الجزائر|المغرب|هرمز)/;

function sectionOf(it) {
  // sections removed from the product (e.g. stocks) fall back to the economy section of their scope
  if (it.section === 'w_politics' && MIDEAST.test(it.snapshot?.title || '')) return 'w_mideast';
  if (SECTIONS.some((s) => s.key === it.section)) return it.section;
  return it.section.startsWith('sa_') ? 'sa_economy' : 'w_economy';
}
// Arabic counted nouns: 1 خبر، 2 خبران، 3–10 أخبار، 11+ خبرًا
const counted = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : `${n} ${n >= 3 && n <= 10 ? few : many}`);
const NEWS = ['خبر واحد', 'خبران', 'أخبار', 'خبرًا'];
const SOURCES = ['مصدر واحد', 'مصدران', 'مصادر', 'مصدرًا'];
const groupOf = (sec) => SECTIONS.find((s) => s.key === sec)?.group || (sec.startsWith('sa_') ? 'saudi' : 'world');
const sourceCount = (s) => new Set((s?.sources || []).map((x) => x.source)).size;

function row(it, { rank = null, showSection = false } = {}) {
  const s = it.snapshot;
  if (!s) return '';
  const p = s.primary || {};
  const lastUpdate = (s.updates || []).slice(-1)[0];
  const headline = it.kind === 'update' && lastUpdate?.title ? lastUpdate.title : s.title;
  const n = sourceCount(s);
  const type = it.kind === 'update' ? 'update' : s.content_type;
  return `<a class="row" href="#/event/${s.id}" data-sec="${esc(it.section)}">
    ${rank ? `<span class="rank">${rank}</span>` : ''}
    <span class="row-body">
      <span class="row-t" ${isArabic(headline) ? '' : 'dir="auto"'}>${esc(headline)}</span>
      ${it.kind === 'update' && lastUpdate ? `<span class="row-u">تحديث: ${esc(lastUpdate.changed)}</span>` : ''}
      <span class="row-m">
        ${it.highlight ? `<span class="badge hl-${esc(it.highlight)}">${esc(it.highlight)}</span>` : ''}
        ${type !== 'news' ? `<span class="badge type-${esc(type)}">${esc(TYPE[type] || type)}</span>` : ''}
        ${showSection ? `<span class="sec-tag">${esc(secName(it.section))}</span>` : ''}
        <span class="src">${esc(p.source || '—')}</span><span>${esc(ago(p.published_at || s.first_seen_at))}</span>
        ${n > 1 ? `<span class="n">${counted(n, SOURCES)}</span>` : ''}
      </span>
    </span>
  </a>`;
}

function prepareItems(b) {
  for (const it of b.items) it.section = sectionOf(it);
  return b.items;
}

// ranked by independent coverage first: a story many outlets carry is what the day is about
function topStories(items, limit = 10) {
  const score = (it) => sourceCount(it.snapshot) * 3 + (it.snapshot?.importance || 0) + (it.highlight ? 2 : 0);
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

function sectionsHtml(items, group) {
  const bySection = new Map();
  for (const it of items) {
    if (!bySection.has(it.section)) bySection.set(it.section, []);
    bySection.get(it.section).push(it);
  }
  const secs = SECTIONS.filter((s) => s.group === group && bySection.has(s.key));
  if (!secs.length) return '<div class="empty-scope">لا جديد هنا في هذه النشرة.</div>';
  const index = `<nav class="sec-index" aria-label="أقسام ${esc(GROUP_NAMES[group])}">${secs.map((s) => `<a href="#sec-${s.key}" data-jump-sec="${s.key}" data-sec="${s.key}">${esc(s.name)} <span class="c">${bySection.get(s.key).length}</span></a>`).join('')}</nav>`;
  return index + secs.map((s) => {
    const list = bySection.get(s.key).sort((a, b) => sourceCount(b.snapshot) - sourceCount(a.snapshot) || (b.snapshot?.importance || 0) - (a.snapshot?.importance || 0));
    const hint = s.key === 'sa_economy' || s.key === 'w_economy' ? 'الأرقام والأسعار تخص وقت نشر المصدر وليست لحظية.' : s.hint && s.group === 'fields' ? s.hint : '';
    return `<section class="section" id="sec-${s.key}" data-sec="${s.key}">
      <div class="section-head"><h3>${esc(s.name)}</h3><span class="n">${list.length}</span></div>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      <div class="rows">${list.slice(0, SHOW_PER_SECTION).map((it) => row(it)).join('')}</div>
      ${list.length > SHOW_PER_SECTION ? `<details class="more-sec"><summary>عرض الكل (${list.length})</summary><div class="rows">${list.slice(SHOW_PER_SECTION).map((it) => row(it)).join('')}</div></details>` : ''}
    </section>`;
  }).join('');
}

function trendsHtml(trends, { full = false } = {}) {
  if (!trends?.length) return '<div class="empty-scope">لا توجد مواضيع تتناولها عدة مصادر في آخر 24 ساعة.</div>';
  if (!full) return `<div class="trend-chips">${trends.slice(0, 8).map((t, i) => `<a class="trend-chip" href="#/trend?t=${i}"><b>${esc(t.label)}</b><span>${counted(t.events, NEWS)}</span></a>`).join('')}</div>`;
  return trends.map((t, i) => `<section class="trend" id="trend-${i}">
    <div class="trend-head"><span class="rank">${i + 1}</span><h3>${esc(t.label)}</h3><span class="n">${counted(t.events, NEWS)} من ${counted(t.sources, SOURCES)}</span></div>
    <div class="rows">${t.items.map((x) => `<a class="row" href="#/event/${x.id}" data-sec="${esc(x.section)}"><span class="row-body"><span class="row-t" dir="auto">${esc(x.title)}</span>
      <span class="row-m"><span class="sec-tag">${esc(secName(x.section))}</span>${x.n > 1 ? `<span class="n">${counted(x.n, SOURCES)}</span>` : ''}</span></span></a>`).join('')}</div>
  </section>`).join('');
}

function tabsBar(active, items) {
  const count = (g) => items.filter((it) => groupOf(it.section) === g).length;
  return `<nav class="tabs" aria-label="أقسام النشرة">${TABS.map((t) => `<a href="${t.path}" class="${t.key === active ? 'on' : ''}">${t.name}${GROUP_NAMES[t.key] ? ` <span class="c">${count(t.key)}</span>` : ''}</a>`).join('')}</nav>`;
}

function tabHtml(tab, items, trends) {
  if (tab === 'trend') {
    return `<h2 class="tab-title">ترند عالمي</h2><p class="sub">المواضيع التي تناولتها عدة مصادر مستقلة خلال آخر 24 ساعة، مرتبة حسب عدد المصادر.</p>${trendsHtml(trends, { full: true })}`;
  }
  if (tab === 'top') {
    const tiles = Object.keys(GROUP_NAMES).map((g) => {
      const secs = SECTIONS.filter((s) => s.group === g).map((s) => [s, items.filter((it) => it.section === s.key).length]).filter(([, n]) => n);
      return secs.length ? `<div class="tiles-group"><div class="tiles-title">${GROUP_NAMES[g]}</div><div class="tiles">${secs.map(([s, n]) => `<a class="tile" data-sec="${s.key}" href="#/${g}?sec=${s.key}">${esc(s.name)}<span>${n}</span></a>`).join('')}</div></div>` : '';
    }).join('');
    return `<h2 class="tab-title">الأهم الآن</h2>
      <div class="rows ranked">${topStories(items).map((it, i) => row(it, { rank: i + 1, showSection: true })).join('')}</div>
      <div class="block-head"><h2 class="tab-title">ترند عالمي</h2><a href="#/trend">عرض الكل ←</a></div>
      ${trendsHtml(trends)}
      <h2 class="tab-title">تصفّح الأقسام</h2>${tiles}`;
  }
  return sectionsHtml(items.filter((it) => groupOf(it.section) === tab), tab);
}

function bulletinHead(b, kicker) {
  const period = b.period_from ? `من ${esc(fmtS(b.period_from))} إلى ${esc(fmtS(b.period_to))}` : 'أول نشرة';
  return `<div class="bulletin-head"><div><div class="kicker">${kicker}</div><h1>${esc(b.title)}</h1></div>
    <div class="facts-line">${b.event_count} حدث · ${period} · <a href="#/bulletin/${b.id}">رابط دائم</a></div></div>`;
}

function wireJumps() {
  // in-page anchors must not change the hash router
  app.querySelectorAll('[data-jump-sec]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    jumpTo(`sec-${a.dataset.jumpSec}`);
  }));
}
function jumpTo(id, smooth = true) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  return !!el;
}

// ---------- pages ----------
async function pageHome(tab = 'top') {
  setNav('home');
  app.innerHTML = '<div id="status"></div><div id="body"><p class="sub">جارٍ التحميل…</p></div>';
  // awaited at the end so the status strip's height is in place before the reading place is restored
  const statusDone = renderStatus(document.getElementById('status'));
  const { bulletin, newerEmpty, trends } = await api('/api/bulletins/latest');
  const body = document.getElementById('body');
  if (!bulletin) {
    body.innerHTML = '<div class="notice info">لم تُنشر أي نشرة بعد. سيبدأ الخادم أول تحديث تلقائيًا، أو اضغط «تحديث الآن».</div>';
    return;
  }
  const items = prepareItems(bulletin);
  body.innerHTML = `${bulletinHead(bulletin, 'آخر نشرة')}
    ${newerEmpty ? `<div class="notice info">آخر تحديث (${esc(fmt(newerEmpty.created_at))}) لم يجد أخبارًا جديدة مهمة، لذلك تبقى هذه النشرة معروضة. لا نعيد تدوير الأخبار القديمة.</div>` : ''}
    ${bulletin.note ? `<div class="notice warn">${esc(bulletin.note)}</div>` : ''}
    ${tabsBar(tab, items)}
    <div class="tab-body">${tabHtml(tab, items, trends)}</div>`;
  wireJumps();
  await statusDone;
}

async function pageBulletin(id) {
  setNav('archive');
  const b = await api(`/api/bulletins/${encodeURIComponent(id)}`);
  const items = prepareItems(b);
  app.innerHTML = `${bulletinHead(b, 'من الأرشيف')}
    <div class="sub">تُعرض العناصر كما ظهرت وقت النشر، والتطورات اللاحقة تظهر كروابط.</div>
    ${b.status === 'empty' ? `<div class="notice info">${esc(b.note || 'لا أخبار جديدة')}</div>` : ''}
    ${b.note && b.status !== 'empty' ? `<div class="notice warn">${esc(b.note)}</div>` : ''}
    ${Object.entries(GROUP_NAMES).map(([g, label]) => {
      const list = items.filter((it) => groupOf(it.section) === g);
      return list.length ? `<section class="scope"><h2 class="scope-title">${label} <span class="n">${list.length} حدث</span></h2>${sectionsHtml(list, g)}</section>` : '';
    }).join('')}`;
  wireJumps();
}

async function pageArchive(params) {
  setNav('archive');
  const page = +(params.get('page') || 1);
  const showEmpty = params.get('empty') === '1';
  const d = await api(`/api/bulletins?page=${page}${showEmpty ? '&empty=1' : ''}`);
  app.innerHTML = `<h1 class="page">أرشيف النشرات</h1>
    <div class="sub">${d.total} نشرة، الأحدث أولًا. <a href="#/archive?${showEmpty ? '' : 'empty=1'}">${showEmpty ? 'إخفاء' : 'إظهار'} التحديثات التي لم تجد جديدًا</a></div>
    ${d.bulletins.map((b) => `<div class="list-row"><div><a href="#/bulletin/${b.id}"><b>${esc(b.title)}</b></a>
      <div class="sub">الفترة: ${esc(fmtS(b.period_from))} ← ${esc(fmtS(b.period_to))}</div></div>
      <div class="sub">${b.status === 'empty' ? 'بلا أخبار جديدة' : `${b.event_count} حدث`}</div></div>`).join('') || '<p class="sub">لا توجد نشرات بعد.</p>'}
    ${pager(d.page, d.pages, (p) => `#/archive?page=${p}${showEmpty ? '&empty=1' : ''}`)}`;
}

function pager(page, pages, href) {
  if (pages <= 1) return '';
  return `<div class="pager">${page > 1 ? `<a class="btn secondary small" href="${href(page - 1)}">السابق</a>` : ''}<span class="sub">صفحة ${page} من ${pages}</span>${page < pages ? `<a class="btn secondary small" href="${href(page + 1)}">التالي</a>` : ''}</div>`;
}

async function pageEvent(id) {
  setNav('search');
  const e = await api(`/api/events/${encodeURIComponent(id)}`);
  if (e.merged_into) {
    location.hash = `#/event/${e.merged_into}`;
    return;
  }
  app.innerHTML = `<button class="btn secondary small" id="back" type="button">→ رجوع</button>
    <h1 class="page" dir="auto">${esc(e.title)}</h1>
    <div class="sub">رابط المشاركة: <span class="ltr">${esc(location.href.split('#')[0] + '#/event/' + e.id)}</span></div>
    ${card(e)}
    <h2>التسلسل الزمني والمصادر</h2>
    <div class="sub">وقت الوقوع (أقدم نشر معروف): ${esc(fmt(e.occurred_at))} — أول رصد لدينا: ${esc(fmt(e.first_seen_at))}</div>
    <div class="timeline">${e.timeline.map((t) => `<div class="t"><div><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(t.source)}</a>
      ${t.relation === 'update' ? '<span class="badge type-update">تحديث جوهري</span>' : t.relation === 'repost' ? '<span class="badge">إعادة نشر</span>' : ''}</div>
      <div dir="auto">${esc(t.title)}</div>
      <div class="sub">نشر المصدر: ${esc(fmt(t.published_at))} — أُرشف: ${esc(fmt(t.fetched_at))}${t.merge_reason ? ` — سبب الربط: ${esc(t.merge_reason)} (تشابه ${t.merge_score ?? '—'})` : ''}</div></div>`).join('')}</div>
    ${e.updates.length ? `<h2>التطورات الجوهرية</h2>${e.updates.map((u) => `<div class="notice info"><b>${esc(fmt(u.created_at))}:</b> ${esc(u.changed)}<div dir="auto" class="sub">${esc(u.title || '')}</div></div>`).join('')}` : ''}
    <h2>ظهر في النشرات</h2>
    ${e.bulletins.length ? e.bulletins.map((b) => `<div class="list-row"><a href="#/bulletin/${b.id}">${esc(b.title)}</a><span class="sub">${b.kind === 'update' ? 'كتحديث' : 'كخبر جديد'}</span></div>`).join('') : '<p class="sub">لم يُدرج في نشرة بعد (سيظهر في النشرة القادمة).</p>'}`;
  // back to where the reader came from; a shared link opened directly goes to the latest bulletin
  document.getElementById('back').addEventListener('click', () => (history.state?.fromApp ? history.back() : (location.hash = '#/')));
}

async function pageSearch(params) {
  setNav('search');
  const sources = await api('/api/sources');
  const v = (k) => esc(params.get(k) || '');
  const dateVal = (k) => (params.get(k) ? new Date(+params.get(k) + 3 * 3600_000).toISOString().slice(0, 10) : '');
  app.innerHTML = `<h1 class="page">البحث في الأرشيف</h1>
    <form class="search" id="sf">
      <input class="q" name="q" placeholder="ابحث في العناوين والملخصات والجهات والوسوم" value="${v('q')}">
      <label class="f">النطاق<select name="scope"><option value="">الكل</option><option value="saudi">السعودية</option><option value="world">العالم</option></select></label>
      <label class="f">القسم<select name="section"><option value="">الكل</option>${SECTIONS.map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">المصدر<select name="source"><option value="">الكل</option>${sources.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">نوع المحتوى<select name="type"><option value="">الكل</option><option value="news">خبر</option><option value="analysis">تحليل</option><option value="statement">تصريح</option><option value="update">له تحديثات جوهرية</option></select></label>
      <label class="f">من تاريخ<input type="date" name="from" value="${dateVal('from')}"></label>
      <label class="f">إلى تاريخ<input type="date" name="to" value="${dateVal('to')}"></label>
      <label class="f">الترتيب<select name="sort"><option value="relevance">حسب الصلة</option><option value="latest">الأحدث</option></select></label>
      <button class="btn" type="submit">بحث</button>
    </form>
    <div id="results"></div>`;
  const form = document.getElementById('sf');
  for (const k of ['scope', 'section', 'source', 'type', 'sort']) if (params.get(k)) form.elements[k].value = params.get(k);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, val] of new FormData(form)) {
      if (!val) continue;
      // dates are interpreted as Riyadh calendar days (UTC+3)
      if (k === 'from') p.set(k, String(Date.parse(val + 'T00:00:00+03:00')));
      else if (k === 'to') p.set(k, String(Date.parse(val + 'T23:59:59+03:00')));
      else p.set(k, val);
    }
    location.hash = '#/search?' + p.toString();
  });
  if (![...params.keys()].length) return;
  const d = await api('/api/search?' + params.toString());
  const allLink = () => { const p = new URLSearchParams(params); p.set('all', '1'); p.delete('page'); return '#/search?' + p.toString(); };
  document.getElementById('results').innerHTML = `<p class="sub">${d.total} نتيجة (أحداث موحّدة؛ تغطيات المصادر المختلفة مجمّعة في نتيجة واحدة). رابط هذه النتائج قابل للمشاركة.</p>
    ${d.limited ? `<div class="notice info">البحث شمل آخر 3 أشهر. <a href="${allLink()}">ابحث في كامل الأرشيف (${d.totalMonths} شهرًا)</a> أو حدّد تاريخًا.</div>` : ''}
    ${d.results.map((r) => `<div class="list-row"><div class="grow"><a href="#/event/${r.id}" dir="auto"><b>${esc(r.title)}</b></a>
      <div class="sub" dir="auto">${esc(r.summary || '')}</div>
      <div class="badges"><span class="badge">${r.scope === 'saudi' ? 'سعودي' : 'عالمي'}</span><span class="badge">${esc(secName(r.section))}</span><span class="badge">${esc(TYPE[r.content_type])}</span>
      <span class="badge">${r.source_count} مصدر</span>${r.update_count ? `<span class="badge type-update">${r.update_count} تحديث</span>` : ''}</div></div>
      <div class="sub">وقع: ${esc(fmtS(r.occurred_at))}<br>أُضيف: ${esc(fmtS(r.first_seen_at))}</div></div>`).join('')}
    ${pager(d.page, d.pages, (pg) => { const p = new URLSearchParams(params); p.set('page', pg); return '#/search?' + p.toString(); })}`;
}

async function pageSources() {
  setNav('sources');
  const s = await api('/api/status');
  app.innerHTML = `<h1 class="page">المصادر وحالة التغطية</h1>
    <p class="sub">المصادر الرسمية مقدّمة. «معطّل» يعني أن المصدر غير متاح للجلب الآلي حاليًا (السبب مذكور)، وليس أنه غير موثوق.</p>
    ${s.aiMode !== 'ai' ? '<div class="notice warn">التلخيص الآلي غير مفعّل: النص المعروض مع كل خبر مقتطف قصير من المصدر نفسه. الأخبار حقيقية ومرتبطة بمصادرها.</div>' : ''}
    <div class="table-wrap"><table class="data"><thead><tr><th>المصدر</th><th>النوع</th><th>الحالة</th><th>آخر نجاح</th><th>ملاحظات / آخر خطأ</th></tr></thead><tbody>
    ${s.sources.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>${x.is_official ? ' <span class="badge ver-official">رسمي</span>' : ''}</td>
      <td>${esc(x.type === 'rss' ? 'RSS' : x.type === 'spa' ? 'صفحة عامة' : 'قائمة HTML')}</td>
      <td class="health-${x.health}">${esc(HEALTH[x.health])}${x.consecutive_failures ? ` (${x.consecutive_failures} مرات)` : ''}</td>
      <td>${esc(fmtS(x.last_success_at))}</td><td class="sub">${esc(x.last_error || x.notes || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ---------- router ----------
let firstRoute = true;
async function route() {
  clearInterval(statusTimer);
  // pages reached by moving inside the site are marked, so "رجوع" knows it can go back
  if (!firstRoute && !history.state?.fromApp) history.replaceState({ ...(history.state || {}), fromApp: true }, '');
  firstRoute = false;
  const h = location.hash || '#/';
  const [path, qs] = h.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  try {
    if (!SECTIONS.length) SECTIONS = await api('/api/sections');
    if (!parts.length) await pageHome('top');
    else if (TABS.some((t) => t.key === parts[0] && t.key !== 'top')) await pageHome(parts[0]);
    else if (parts[0] === 'archive') await pageArchive(params);
    else if (parts[0] === 'bulletin' && parts[1]) await pageBulletin(parts[1]);
    else if (parts[0] === 'event' && parts[1]) await pageEvent(parts[1]);
    else if (parts[0] === 'search') await pageSearch(params);
    else if (parts[0] === 'sources') await pageSources();
    else app.innerHTML = '<p>الصفحة غير موجودة.</p>';
    restoreReadingPlace();
  } catch (e) {
    app.innerHTML = `<div class="notice danger">حدث خطأ: ${esc(e.message)}</div>`;
  }
}

// ---------- reading place ----------
// Each history entry remembers how far the reader scrolled and which "more" sections were open,
// so going back from a news item returns to the same spot instead of the top of the bulletin.
// A newly opened page has no saved place and starts at the top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// Each tab of the latest bulletin also keeps its place when reopened from the menu or the tab bar
// (not only via Back), since the installed phone app has no Back button.
// The saved place belongs to one bulletin: once a new bulletin is out, it opens from the top.
const homeTab = () => {
  const path = (location.hash || '#/').split('?')[0];
  return path === '#/' || TABS.some((t) => t.path === path) ? path : null;
};
const homeBulletin = () => app.querySelector('a[href^="#/bulletin/"]')?.getAttribute('href') || '';
function saveReadingPlace() {
  const open = [...app.querySelectorAll('details')].flatMap((d, i) => (d.open ? [i] : []));
  const place = { y: window.scrollY, open };
  history.replaceState({ ...(history.state || {}), ...place }, '');
  const tab = homeTab();
  if (tab) try { sessionStorage.setItem('place:' + tab, JSON.stringify({ ...place, bulletin: homeBulletin() })); } catch {}
}
function restoreReadingPlace() {
  let s = history.state;
  const tab = homeTab();
  if ((!s || s.y == null) && tab) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('place:' + tab));
      if (saved && saved.bulletin === homeBulletin()) s = saved;
    } catch {}
  }
  if (!s || s.y == null) {
    // a tile or trend chip asks for a specific section
    const q = new URLSearchParams((location.hash.split('?')[1]) || '');
    if (q.get('sec') && jumpTo('sec-' + q.get('sec'), false)) return;
    if (q.get('t') && jumpTo('trend-' + q.get('t'), false)) return;
    return window.scrollTo(0, 0);
  }
  const all = app.querySelectorAll('details');
  for (const i of s.open || []) if (all[i]) all[i].open = true;
  window.scrollTo(0, s.y);
}
let saveTimer;
window.addEventListener('scroll', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveReadingPlace, 150); }, { passive: true });
app.addEventListener('toggle', () => saveReadingPlace(), true);
// save right before leaving the page through a link (the scroll timer may not have fired yet)
document.addEventListener('click', (e) => { if (e.target.closest?.('a[href^="#/"]')) { clearTimeout(saveTimer); saveReadingPlace(); } }, true);

window.addEventListener('hashchange', route);
route();
