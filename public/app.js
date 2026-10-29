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
  const refresh = s.static
    ? (s.actionsUrl ? `<a class="btn ghost small" href="${esc(s.actionsUrl)}" target="_blank" rel="noopener" title="متاح لمالك المستودع: Run workflow">تحديث يدوي</a>` : '')
    : `<button class="btn small" id="refresh" ${s.running ? 'disabled' : ''}>${s.running ? '<span class="spinner"></span> جارٍ التحديث' : 'تحديث الآن'}</button>`;
  el.innerHTML = `
    <div class="dateline">${esc(todayLine())}</div>
    <div class="statusline" role="status">
      <span class="item"><span class="dot ${failed ? 'bad' : ''}"></span>آخر تحديث <b>${s.lastSuccessAt ? esc(ago(s.lastSuccessAt)) : 'لم يكتمل بعد'}</b></span>
      ${s.schedulerEnabled ? `<span class="item" title="${esc(fmt(s.schedule.nextRunAt))}${s.static ? ' — عبر GitHub Actions وقد يتأخر حتى ساعة' : ''}">القادم <b>${esc(fmtTime(s.schedule.nextRunAt))}</b> <span class="sub">${esc(until(s.schedule.nextRunAt))}</span></span>` : '<span class="item">الجدولة معطلة</span>'}
      <span class="item"><span class="dot ${failing.length ? 'warn' : ''}"></span><a href="#/sources" title="${failing.length ? 'متعطل: ' + esc(failing.map((f) => f.name).join('، ')) : 'لا أعطال'}">المصادر ${ok}/${enabled.length}</a></span>
      ${s.aiMode === 'ai' ? '<span class="pill ok">ملخصات آلية</span>' : '<span class="pill warn">وضع محدود</span>'}
      <span class="spacer"></span>
      ${refresh}
    </div>
    ${s.aiMode !== 'ai' ? '<details class="explain"><summary>ما معنى «وضع محدود»؟</summary><p>التلخيص الآلي غير مفعّل: العناوين تظهر بلغة المصدر، والنص مقتطف قصير منه، ولا يُعرض «لماذا يهم؟». الأخبار نفسها حقيقية ومرتبطة بمصادرها.</p></details>' : ''}
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
    ${s.section === 'w_science' ? `<div class="science">${s.research_note ? '' : 'لم يحدد المصدر طبيعة البحث. '}النتائج البحثية ليست توصيات علاجية.</div>` : ''}
    ${tags.length ? `<div class="chips">${tags.map((t) => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
    ${others.length ? `<details class="more"><summary>${others.length === 1 ? 'مصدر آخر غطّى الخبر' : `${others.length} مصادر أخرى غطّت الخبر`}</summary><ul>${others.map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(o.source)}</a> — <span dir="auto">${esc(o.title)}</span> <span class="sub">(${esc(fmtS(o.published_at))})</span></li>`).join('')}</ul></details>` : ''}
    <div class="foot">
      <span class="times"><span>نشر المصدر: ${p.published_at ? esc(fmtS(p.published_at)) : 'غير محدد'}</span><span>أُضيف: ${esc(fmtS(s.first_seen_at))}</span>${s.updates?.length ? `<span>آخر تطور: ${esc(fmtS(s.last_update_at))}</span>` : ''}</span>
      ${laterUpdates ? `<a href="#/event/${s.id}">${laterUpdates} تحديث لاحق</a>` : ''}
      <a class="more-link" href="#/event/${s.id}">التفاصيل ←</a>
    </div>
  </article>`;
}

const SHOW_PER_SECTION = 8;
const cardOf = (it) => card(it.snapshot, { highlight: it.highlight, kind: it.kind, laterUpdates: it.later_updates });

function renderBulletinBody(b) {
  const bySection = new Map();
  for (const it of b.items) {
    // sections removed from the product (e.g. stocks) fall back to the economy section of their scope
    const sec = SECTIONS.some((s) => s.key === it.section) ? it.section : it.section.startsWith('sa_') ? 'sa_economy' : 'w_economy';
    it.section = sec;
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(it);
  }
  const hl = b.items.filter((x) => x.highlight);
  let html = '';
  if (hl.length) {
    html += `<section class="highlights" aria-label="العاجل والمهم"><div class="label">العاجل والمهم</div>
      <div class="hl-grid">${hl.map((x) => `<a class="hl-card" data-sec="${esc(x.section)}" href="#ev-${x.event_id}" data-jump="${x.event_id}">
        <div class="t" ${isArabic(x.snapshot?.title) ? '' : 'dir="auto"'}>${esc(x.snapshot?.title)}</div>
        <div class="m"><span class="badge hl-${esc(x.highlight)}">${esc(x.highlight)}</span><span>${esc(secName(x.section))}</span></div></a>`).join('')}</div>
      <div class="hl-note">«عاجل» فقط لما وقع خلال 3 ساعات من صدور النشرة. النشرة تصدر مرتين يوميًا (7 صباحًا و7 مساءً) وليست تنبيهات لحظية.</div></section>`;
  }
  const scopes = [['saudi', 'السعودية'], ['world', 'العالم']];
  const rail = scopes.map(([scope, label]) => `<div class="group"><div class="group-title">${label}</div><nav aria-label="أقسام ${label}">${SECTIONS.filter((s) => s.scope === scope).map((s) => {
    const n = bySection.get(s.key)?.length || 0;
    return `<a href="#sec-${s.key}" data-jump-sec="${s.key}" data-sec="${s.key}" class="${n ? '' : 'empty'}">${esc(s.name)} <span class="c">${n}</span></a>`;
  }).join('')}</nav></div>`).join('');
  let content = '';
  for (const [scope, label] of scopes) {
    const secs = SECTIONS.filter((s) => s.scope === scope);
    const total = secs.reduce((n, s) => n + (bySection.get(s.key)?.length || 0), 0);
    content += `<section class="scope"><h2 class="scope-title">${label} <span class="n">${total} حدث</span></h2>`;
    if (!total) content += '<div class="empty-scope">لا جديد في هذا النطاق ضمن هذه النشرة.</div>';
    for (const s of secs) {
      const items = bySection.get(s.key) || [];
      // empty sections stay reachable from the rail but take no space in the page
      if (!items.length) {
        content += `<span id="sec-${s.key}"></span>`;
        continue;
      }
      const hint = s.key === 'sa_economy' || s.key === 'w_economy' ? 'الأرقام والأسعار في الأخبار تخص وقت نشر المصدر وليست لحظية، ولا تُنسب أسباب لحركة الأسواق إلا إذا ذكرها المصدر.' : '';
      content += `<section class="section" id="sec-${s.key}" data-sec="${s.key}">
        <div class="section-head"><h3>${esc(s.name)}</h3><span class="n">${items.length}</span></div>
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
        <div class="cards">${items.slice(0, SHOW_PER_SECTION).map(cardOf).join('')}</div>
        ${items.length > SHOW_PER_SECTION ? `<details class="more-sec"><summary>عرض ${items.length - SHOW_PER_SECTION} خبرًا آخر في هذا القسم</summary><div class="cards">${items.slice(SHOW_PER_SECTION).map(cardOf).join('')}</div></details>` : ''}
      </section>`;
    }
    content += '</section>';
  }
  html += `<div class="layout"><aside class="rail">${rail}</aside><div class="content">${content}</div></div>`;
  return html;
}

function bulletinHead(b, kicker) {
  const period = b.period_from ? `من ${esc(fmtS(b.period_from))} إلى ${esc(fmtS(b.period_to))}` : 'أول نشرة';
  return `<div class="bulletin-head"><div><div class="kicker">${kicker}</div><h1>${esc(b.title)}</h1></div>
    <div class="facts-line">${b.event_count} حدث · ${period} · <a href="#/bulletin/${b.id}">رابط دائم</a></div></div>`;
}

function wireJumps() {
  // in-page anchors must not change the hash router
  app.querySelectorAll('[data-jump], [data-jump-sec]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const id = a.dataset.jump ? `ev-${a.dataset.jump}` : `sec-${a.dataset.jumpSec}`;
    const el = document.getElementById(id);
    const folded = el?.closest('details');
    if (folded) folded.open = true;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ---------- pages ----------
async function pageHome() {
  setNav('home');
  app.innerHTML = '<div id="status"></div><div id="body"><p class="sub">جارٍ التحميل…</p></div>';
  // awaited at the end so the status strip's height is in place before the reading place is restored
  const statusDone = renderStatus(document.getElementById('status'));
  const { bulletin, newerEmpty } = await api('/api/bulletins/latest');
  const body = document.getElementById('body');
  if (!bulletin) {
    body.innerHTML = '<div class="notice info">لم تُنشر أي نشرة بعد. سيبدأ الخادم أول تحديث تلقائيًا، أو اضغط «تحديث الآن».</div>';
    return;
  }
  body.innerHTML = `${bulletinHead(bulletin, 'آخر نشرة')}
    ${newerEmpty ? `<div class="notice info">آخر تحديث (${esc(fmt(newerEmpty.created_at))}) لم يجد أخبارًا جديدة مهمة، لذلك تبقى هذه النشرة معروضة. لا نعيد تدوير الأخبار القديمة.</div>` : ''}
    ${bulletin.note ? `<div class="notice warn">${esc(bulletin.note)}</div>` : ''}
    ${renderBulletinBody(bulletin)}`;
  wireJumps();
  await statusDone;
}

async function pageBulletin(id) {
  setNav('archive');
  const b = await api(`/api/bulletins/${encodeURIComponent(id)}`);
  app.innerHTML = `${bulletinHead(b, 'من الأرشيف')}
    <div class="sub">تُعرض العناصر كما ظهرت وقت النشر، والتطورات اللاحقة تظهر كروابط.</div>
    ${b.status === 'empty' ? `<div class="notice info">${esc(b.note || 'لا أخبار جديدة')}</div>` : ''}
    ${b.note && b.status !== 'empty' ? `<div class="notice warn">${esc(b.note)}</div>` : ''}
    ${renderBulletinBody(b)}`;
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
  app.innerHTML = `<h1 class="page" dir="auto">${esc(e.title)}</h1>
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
    <div class="table-wrap"><table class="data"><thead><tr><th>المصدر</th><th>النوع</th><th>الحالة</th><th>آخر نجاح</th><th>ملاحظات / آخر خطأ</th></tr></thead><tbody>
    ${s.sources.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>${x.is_official ? ' <span class="badge ver-official">رسمي</span>' : ''}</td>
      <td>${esc(x.type === 'rss' ? 'RSS' : x.type === 'spa' ? 'صفحة عامة' : 'قائمة HTML')}</td>
      <td class="health-${x.health}">${esc(HEALTH[x.health])}${x.consecutive_failures ? ` (${x.consecutive_failures} مرات)` : ''}</td>
      <td>${esc(fmtS(x.last_success_at))}</td><td class="sub">${esc(x.last_error || x.notes || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ---------- router ----------
async function route() {
  clearInterval(statusTimer);
  const h = location.hash || '#/';
  const [path, qs] = h.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  try {
    if (!SECTIONS.length) SECTIONS = await api('/api/sections');
    if (!parts.length) await pageHome();
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
function saveReadingPlace() {
  const open = [...app.querySelectorAll('details')].flatMap((d, i) => (d.open ? [i] : []));
  history.replaceState({ ...(history.state || {}), y: window.scrollY, open }, '');
}
function restoreReadingPlace() {
  const s = history.state;
  if (!s || s.y == null) return window.scrollTo(0, 0);
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
