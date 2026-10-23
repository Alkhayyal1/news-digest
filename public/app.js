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
  el.innerHTML = `
    <div class="statusbar">
      <div class="stat"><div class="k">آخر تحديث ناجح</div><div class="v">${s.lastSuccessAt ? `${esc(fmt(s.lastSuccessAt))}` : 'لم يكتمل أي تحديث بعد'}</div><div class="k">${esc(ago(s.lastSuccessAt))}</div></div>
      <div class="stat"><div class="k">التحديث القادم (كل ${s.schedule.intervalHours} ساعات)</div><div class="v">${s.schedulerEnabled ? esc(fmt(s.schedule.nextRunAt)) : 'الجدولة معطلة على هذا الخادم'}</div><div class="k">${s.schedulerEnabled ? esc(until(s.schedule.nextRunAt)) : ''}${s.schedule.retry ? ' — إعادة محاولة بعد فشل' : ''}${s.static ? ' — يُنفَّذ عبر GitHub Actions وقد يتأخر حتى ساعة' : ''}</div></div>
      <div class="stat"><div class="k">حالة المصادر</div><div class="v"><a href="#/sources">${ok} من ${enabled.length} تعمل</a></div><div class="k">${failing.length ? `متعطل: ${failing.slice(0, 3).map((f) => esc(f.name)).join('، ')}${failing.length > 3 ? '…' : ''}` : 'لا أعطال مسجلة'}</div></div>
      <div class="stat actions"><div><div class="k">التلخيص</div><div class="v">${s.aiMode === 'ai' ? 'بالذكاء الاصطناعي' : 'وضع محدود (بدون تلخيص آلي)'}</div></div>
        ${s.static ? (s.actionsUrl ? `<a class="btn" href="${esc(s.actionsUrl)}" target="_blank" rel="noopener" title="لمالك المستودع: اضغط Run workflow">تحديث يدوي</a>` : '') : `<button class="btn" id="refresh" ${s.running ? 'disabled' : ''}>${s.running ? '<span class="spinner"></span> جارٍ التحديث' : 'تحديث الآن'}</button>`}</div>
    </div>
    ${lr && lr.status === 'failed' ? `<div class="notice danger">فشل آخر تحديث (${esc(fmt(lr.started_at))}). تُعرض آخر نشرة سليمة.</div>` : ''}
    ${s.aiMode !== 'ai' ? '<div class="notice warn">يعمل الموقع في وضع محدود: العناوين تُعرض بلغة المصدر، والملخص مقتطف قصير من المصدر، ولا يُولَّد قسم «لماذا يهم؟». لتفعيل التلخيص يلزم مفتاح خدمة الذكاء الاصطناعي على الخادم.</div>' : ''}
    ${s.static ? `<div class="sub">نسخة ثابتة بُنيت ${esc(fmt(s.builtAt))}. التحديث اليدوي متاح لمالك المستودع فقط، ولا يعمل تحديثان في الوقت نفسه.</div>` : ''}`;
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

// ---------- cards ----------
function card(s, { highlight = null, kind = 'new', laterUpdates = 0 } = {}) {
  if (!s) return '';
  const p = s.primary || {};
  const limited = s.ai_status !== 'done';
  const type = kind === 'update' ? 'update' : s.content_type;
  const others = (s.sources || []).slice(1);
  const lastUpdate = (s.updates || []).slice(-1)[0];
  const titleLangNote = limited && !isArabic(s.title) ? '<span class="badge limited">العنوان بلغة المصدر</span>' : '';
  return `<article class="card" id="ev-${s.id}">
    <div class="badges">
      ${highlight ? `<span class="badge hl-${esc(highlight)}">${esc(highlight)}</span>` : ''}
      <span class="badge type-${esc(type)}">${esc(TYPE[type] || type)}</span>
      <span class="badge">${s.scope === 'saudi' ? 'سعودي' : 'عالمي'}</span>
      <span class="badge">${esc(secName(s.section))}</span>
      <span class="badge ver-${esc(s.verification)}">${esc(VERIFY[s.verification] || s.verification)}</span>
      ${s.research_note ? `<span class="badge ver-preliminary">${esc(RESEARCH[s.research_note] || '')}</span>` : ''}
      ${titleLangNote}
    </div>
    <h4><a href="#/event/${s.id}" ${isArabic(s.title) ? '' : 'dir="auto"'}>${esc(s.title)}</a></h4>
    ${kind === 'update' && lastUpdate ? `<div class="changed"><b>ما الذي تغيّر:</b> ${esc(lastUpdate.changed)}</div>` : ''}
    ${s.summary ? `<p class="summary" dir="auto">${limited ? '<span class="badge limited">مقتطف من المصدر</span> ' : ''}${esc(s.summary)}</p>` : ''}
    ${s.facts?.length ? `<ul class="facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${s.why ? `<div class="why"><b>لماذا يهم؟</b> ${esc(s.why)} <span class="sub">(تقدير تحريري وليس حقيقة منشورة)</span></div>` : limited ? '<div class="why sub">«لماذا يهم؟» غير متاح في الوضع المحدود.</div>' : ''}
    ${s.section === 'w_science' && !s.research_note ? '<div class="sub">لم يحدد المصدر طبيعة البحث (محكّم/أولي، بشر/حيوان). النتائج ليست توصيات علاجية.</div>' : s.section === 'w_science' ? '<div class="sub">النتائج البحثية ليست توصيات علاجية.</div>' : ''}
    <div class="meta">
      <span>المصدر: ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(p.source)}</a>` : esc(p.source || '—')}</span>
      <span>نشره المصدر: ${p.published_at ? esc(fmtS(p.published_at)) : 'غير محدد'}</span>
      <span>أُضيف: ${esc(fmtS(s.first_seen_at))}</span>
      ${s.updates?.length ? `<span>آخر تطور: ${esc(fmtS(s.last_update_at))}</span>` : ''}
      ${laterUpdates ? `<a href="#/event/${s.id}">${laterUpdates} تحديث لاحق ←</a>` : ''}
    </div>
    ${s.entities?.filter((e) => e.kind !== 'name').length || s.tags?.length ? `<div class="badges mt">${(s.entities || []).filter((e) => e.kind === 'company').map((e) => `<a class="badge" href="#/company/${esc(e.symbol)}">${esc(e.label)} ${esc(e.symbol)}</a>`).join('')}${(s.tags || []).filter((t) => !(s.entities || []).some((e) => e.label === t)).map((t) => `<a class="badge" href="#/search?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
    ${others.length ? `<details class="more"><summary>مصادر إضافية (${others.length})</summary><ul>${others.map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(o.source)}</a> — <span dir="auto">${esc(o.title)}</span> <span class="sub">(${esc(fmtS(o.published_at))})</span></li>`).join('')}</ul></details>` : ''}
  </article>`;
}

const SHOW_PER_SECTION = 8;
const cardOf = (it) => card(it.snapshot, { highlight: it.highlight, kind: it.kind, laterUpdates: it.later_updates });

function renderBulletinBody(b) {
  const bySection = new Map();
  for (const it of b.items) {
    if (!bySection.has(it.section)) bySection.set(it.section, []);
    bySection.get(it.section).push(it);
  }
  const hl = b.items.filter((x) => x.highlight);
  let html = '';
  if (hl.length) {
    html += `<section class="highlights" aria-label="العاجل والمهم"><h2>العاجل والمهم</h2><ol>${hl.map((x) => `<li><span class="badge hl-${esc(x.highlight)}">${esc(x.highlight)}</span> <a href="#ev-${x.event_id}" data-jump="${x.event_id}">${esc(x.snapshot?.title)}</a> <span class="sub">— ${esc(secName(x.section))}</span></li>`).join('')}</ol>
      <div class="sub">«عاجل» فقط لما وقع خلال 3 ساعات من صدور النشرة؛ النشرة تصدر كل 7 ساعات وليست تنبيهات لحظية.</div></section>`;
  }
  for (const scope of ['saudi', 'world']) {
    const secs = SECTIONS.filter((s) => s.scope === scope);
    html += `<h2 class="scope-title">${scope === 'saudi' ? 'السعودية' : 'العالم'}</h2><nav class="toc">${secs.map((s) => `<a href="#sec-${s.key}" data-jump-sec="${s.key}">${esc(s.name)} (${bySection.get(s.key)?.length || 0})</a>`).join('')}</nav>`;
    for (const s of secs) {
      const items = bySection.get(s.key) || [];
      html += `<section class="section" id="sec-${s.key}"><h3>${esc(s.name)}</h3>${s.hint ? `<div class="hint">${esc(s.hint)}</div>` : ''}
        ${s.key === 'sa_market' || s.key === 'w_economy' ? '<div class="hint">الأرقام والأسعار الواردة في الأخبار تخص وقت نشر المصدر وليست بيانات لحظية. لا تُنسب أسباب لحركة الأسواق إلا إذا ذكرها المصدر.</div>' : ''}
        ${s.key === 'sa_companies' ? '<div class="hint">للتحليل المالي المبني على الإفصاحات راجع <a href="#/companies">صفحة شركات تداول</a>.</div>' : ''}
        ${items.length ? items.slice(0, SHOW_PER_SECTION).map(cardOf).join('') : '<div class="empty-sec">لا جديد في هذا القسم ضمن هذه النشرة.</div>'}
        ${items.length > SHOW_PER_SECTION ? `<details class="more-sec"><summary>عرض ${items.length - SHOW_PER_SECTION} خبرًا آخر في هذا القسم</summary>${items.slice(SHOW_PER_SECTION).map(cardOf).join('')}</details>` : ''}</section>`;
    }
  }
  return html;
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
  renderStatus(document.getElementById('status'));
  const { bulletin, newerEmpty } = await api('/api/bulletins/latest');
  const body = document.getElementById('body');
  if (!bulletin) {
    body.innerHTML = '<div class="notice info">لم تُنشر أي نشرة بعد. سيبدأ الخادم أول تحديث تلقائيًا، أو اضغط «تحديث الآن».</div>';
    return;
  }
  body.innerHTML = `<h1 class="page">${esc(bulletin.title)}</h1>
    <div class="sub">${bulletin.period_from ? `تغطي الفترة من ${esc(fmt(bulletin.period_from))} إلى ${esc(fmt(bulletin.period_to))}` : 'أول نشرة: تغطي آخر ما نشرته المصادر قبل التشغيل الأول'} — ${bulletin.event_count} حدث. <a href="#/bulletin/${bulletin.id}">رابط دائم لهذه النشرة</a></div>
    ${newerEmpty ? `<div class="notice info">آخر تحديث (${esc(fmt(newerEmpty.created_at))}) لم يجد أخبارًا جديدة مهمة، لذلك تبقى هذه النشرة معروضة. لا نعيد تدوير الأخبار القديمة.</div>` : ''}
    ${bulletin.note ? `<div class="notice warn">${esc(bulletin.note)}</div>` : ''}
    ${renderBulletinBody(bulletin)}`;
  wireJumps();
}

async function pageBulletin(id) {
  setNav('archive');
  const b = await api(`/api/bulletins/${encodeURIComponent(id)}`);
  app.innerHTML = `<h1 class="page">${esc(b.title)}</h1>
    <div class="sub">نُشرت ${esc(fmt(b.created_at))}. تُعرض العناصر كما ظهرت وقت النشر؛ التطورات اللاحقة تظهر كروابط.</div>
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
  const [sources, companies] = await Promise.all([api('/api/sources'), api('/api/companies')]);
  const v = (k) => esc(params.get(k) || '');
  const dateVal = (k) => (params.get(k) ? new Date(+params.get(k) + 3 * 3600_000).toISOString().slice(0, 10) : '');
  app.innerHTML = `<h1 class="page">البحث في الأرشيف</h1>
    <form class="search" id="sf">
      <input class="q" name="q" placeholder="ابحث في العناوين والملخصات والشركات والرموز والجهات والوسوم" value="${v('q')}">
      <label class="f">النطاق<select name="scope"><option value="">الكل</option><option value="saudi">السعودية</option><option value="world">العالم</option></select></label>
      <label class="f">القسم<select name="section"><option value="">الكل</option>${SECTIONS.map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">المصدر<select name="source"><option value="">الكل</option>${sources.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">الشركة<select name="company"><option value="">الكل</option>${companies.map((c) => `<option value="${esc(c.symbol)}">${esc(c.name)} (${esc(c.symbol)})</option>`).join('')}</select></label>
      <label class="f">نوع المحتوى<select name="type"><option value="">الكل</option><option value="news">خبر</option><option value="analysis">تحليل</option><option value="statement">تصريح</option><option value="update">له تحديثات جوهرية</option></select></label>
      <label class="f">من تاريخ<input type="date" name="from" value="${dateVal('from')}"></label>
      <label class="f">إلى تاريخ<input type="date" name="to" value="${dateVal('to')}"></label>
      <label class="f">الترتيب<select name="sort"><option value="relevance">حسب الصلة</option><option value="latest">الأحدث</option></select></label>
      <button class="btn" type="submit">بحث</button>
    </form>
    <div id="results"></div>`;
  const form = document.getElementById('sf');
  for (const k of ['scope', 'section', 'source', 'company', 'type', 'sort']) if (params.get(k)) form.elements[k].value = params.get(k);
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

const fmtNum = (x, d = 1) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: d }));

async function pageCompanies() {
  setNav('companies');
  const list = await api('/api/companies');
  app.innerHTML = `<h1 class="page">تحليل شركات تداول</h1>
    <div class="notice info">التحليل يعتمد فقط على أرقام مُدخلة من الإفصاحات والقوائم المالية الأصلية مع رابط كل إفصاح. لا تُعرض أرقام غير مُسندة، ولا توجد توصيات شراء أو بيع.
    الشركات التي لا تملك بيانات مُدخلة تعرض الأخبار المرتبطة فقط.</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>الرمز</th><th>الشركة</th><th>القطاع</th><th>فترات مالية مُدخلة</th><th>أخبار مرتبطة</th></tr></thead>
    <tbody>${list.map((c) => `<tr><td>${esc(c.symbol)}</td><td><a href="#/company/${esc(c.symbol)}">${esc(c.name)}</a></td><td>${esc(c.sector)}</td><td>${c.reports}</td><td>${c.events}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pageCompany(symbol) {
  setNav('companies');
  const d = await api(`/api/companies/${encodeURIComponent(symbol)}`);
  const a = d.analysis;
  const m = a.metrics || {};
  const L = a.latest;
  const metric = (k, v, suffix = '') => `<div class="metric"><div class="k">${k}</div><div class="v">${v === null || v === undefined ? '—' : esc(fmtNum(v)) + suffix}</div></div>`;
  app.innerHTML = `<h1 class="page">${esc(d.company.name)} <span class="sub">(${esc(d.company.symbol)}) — ${esc(d.company.sector)}</span></h1>
    ${L ? `<div class="sub">آخر فترة: <b>${esc(L.period)}</b>${L.period_end ? ` (تنتهي ${esc(L.period_end)})` : ''} — تاريخ الإفصاح: ${esc(L.disclosed_at || 'غير مُدخل')} — <a href="${esc(L.source_url)}" target="_blank" rel="noopener noreferrer">الإفصاح الأصلي</a>. المبالغ بالمليون ريال.</div>
    <h2>الأداء</h2><div class="grid2">
      ${metric('الإيرادات', L.revenue)}${metric('الربح التشغيلي', L.operating_profit)}${metric('صافي الربح', L.net_profit)}${metric('بنود غير متكررة', L.non_recurring)}${metric('صافي الربح المتكرر (محسوب)', m.recurring_net_profit)}
      ${metric('نمو الإيرادات سنويًا', m.revenue_yoy_pct, '٪')}${metric('نمو صافي الربح سنويًا', m.net_profit_yoy_pct, '٪')}${metric('نمو الإيرادات عن الربع السابق', m.revenue_qoq_pct, '٪')}${metric('نمو صافي الربح عن الربع السابق', m.net_profit_qoq_pct, '٪')}
      ${metric('هامش إجمالي', m.gross_margin_pct, '٪')}${metric('هامش تشغيلي', m.operating_margin_pct, '٪')}${metric('هامش صافٍ', m.net_margin_pct, '٪')}
    </div><h2>المركز المالي والتدفقات</h2><div class="grid2">
      ${metric('إجمالي الديون', L.total_debt)}${metric('النقد', L.cash)}${metric('صافي الدين (محسوب)', m.net_debt)}${metric('الدين إلى حقوق الملكية', m.debt_to_equity)}
      ${metric('التدفق النقدي التشغيلي', L.operating_cash_flow)}${metric('الإنفاق الرأسمالي', L.capex)}${metric('التدفق النقدي الحر (محسوب)', m.free_cash_flow)}${metric('التوزيع للسهم', L.dps)}
    </div><h2>التقييم</h2>
    ${a.valuation.price_as_of ? `<div class="sub">السعر المستخدم بتاريخ ${esc(a.valuation.price_as_of)} — <a href="${esc(a.valuation.price_source)}" target="_blank" rel="noopener noreferrer">مصدر السعر</a>. السعر ليس لحظيًا.</div>` : ''}
    <div class="grid2">${metric('القيمة السوقية (مليون ريال)', a.valuation.market_cap, '')}${metric('مكرر الربحية (آخر 12 شهرًا)', a.valuation.pe_ttm)}${metric('عائد التوزيع', a.valuation.dividend_yield_pct, '٪')}
      ${metric(`وسيط مكرر القطاع (${a.sector.peers_count} شركات ببيانات)`, a.sector.pe_median)}${metric('وسيط الهامش الصافي للقطاع', a.sector.net_margin_median, '٪')}</div>` : ''}
    ${a.notes.length ? `<h2>حدود البيانات</h2><ul>${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="notice warn">الفرص والمخاطر: تُقرأ من الأرقام أعلاه ومن الإفصاحات الأصلية. هذه الصفحة لا تقدم توصية شخصية بالشراء أو البيع.</div>
    ${d.reports.length ? `<h2>الفترات المُدخلة</h2><div class="table-wrap"><table class="data"><thead><tr><th>الفترة</th><th>الإيرادات</th><th>صافي الربح</th><th>غير متكرر</th><th>المصدر</th></tr></thead><tbody>
      ${d.reports.map((r) => `<tr><td>${esc(r.period)}</td><td>${fmtNum(r.revenue)}</td><td>${fmtNum(r.net_profit)}</td><td>${fmtNum(r.non_recurring)}</td><td><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">إفصاح</a></td></tr>`).join('')}</tbody></table></div>` : ''}
    <h2>أخبار مرتبطة</h2>
    ${d.events.map((e) => `<div class="list-row"><a href="#/event/${e.id}" dir="auto">${esc(e.title)}</a><span class="sub">${esc(fmtS(e.occurred_at || e.first_seen_at))}</span></div>`).join('') || '<p class="sub">لا أخبار مرتبطة بعد.</p>'}`;
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
    else if (parts[0] === 'companies') await pageCompanies();
    else if (parts[0] === 'company' && parts[1]) await pageCompany(parts[1]);
    else if (parts[0] === 'sources') await pageSources();
    else app.innerHTML = '<p>الصفحة غير موجودة.</p>';
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<div class="notice danger">حدث خطأ: ${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();
