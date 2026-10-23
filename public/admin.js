import { esc, fmt, fmtS, api, STATIC } from './common.js';

// In the static (GitHub Pages) build this page is a read-only report; actions are done by
// editing config files in the repository (see README).
const READ_ONLY = STATIC;

const app = document.getElementById('app');
const tabsEl = document.getElementById('tabs');
const TABS = [['runs', 'التشغيل والجدولة'], ['sources', 'المصادر'], ['logs', 'أخطاء الجلب'], ['dedup', 'مراجعة التكرار'], ['excluded', 'المستبعد']];
let tab = 'runs';
let data = null;

const RUN_STATUS = { success: 'نجح', partial: 'نجح جزئيًا', no_news: 'بلا جديد', failed: 'فشل', running: 'قيد التشغيل', skipped_locked: 'تُخطّي (تحديث آخر يعمل)' };
const REL = { same: 'نفس الحدث', update: 'تحديث جوهري', repost: 'إعادة نشر', manual_merge: 'دمج يدوي' };

async function load() {
  const me = await api('/api/admin/me');
  if (!me.enabled) {
    app.innerHTML = '<div class="notice danger">لوحة الإدارة معطلة. اضبط ADMIN_PASSWORD (12 حرفًا على الأقل) وSESSION_SECRET (32 حرفًا على الأقل) في متغيرات البيئة على الخادم.</div>';
    return;
  }
  if (!me.admin && !READ_ONLY) return login();
  data = await api('/api/admin/overview');
  render();
}

function login() {
  tabsEl.innerHTML = '';
  app.innerHTML = `<h1 class="page">تسجيل دخول المشرف</h1><form id="lf" class="search"><label class="f q">كلمة المرور<input type="password" name="password" autocomplete="current-password" required></label><button class="btn">دخول</button><div id="err"></div></form>`;
  document.getElementById('lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
      load();
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="notice danger">${esc(err.message)}</div>`;
    }
  });
}

function render() {
  tabsEl.innerHTML = TABS.map(([k, n]) => `<a href="#" data-tab="${k}" class="${k === tab ? 'active' : ''}">${n}</a>`).join('') + (READ_ONLY ? '' : '<a href="#" id="logout">خروج</a>');
  tabsEl.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); tab = a.dataset.tab; render(); }));
  document.getElementById('logout')?.addEventListener('click', async (e) => { e.preventDefault(); await api('/api/admin/logout', { method: 'POST' }); load(); });
  const v = { runs, sources, logs, dedup, excluded }[tab]();
  app.innerHTML = (READ_ONLY ? staticBanner() : '') + v;
  wire();
}

function staticBanner() {
  const log = data.configLog?.notes?.length ? `<details class="more"><summary>نتيجة تطبيق ملفات الإعداد (${esc(fmtS(data.configLog.at))})</summary><ul>${data.configLog.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '';
  return `<div class="notice info">تقرير للقراءة فقط (نسخة GitHub). الإجراءات تتم بتعديل config/overrides.json في المستودع: split لفصل عنصر، merge لدمج حدثين [الإبقاء, المدمج]، dismiss لإغلاق مراجعة، hide/unhide لإخفاء حدث.${log}</div>`;
}

function runs() {
  const s = data.schedule;
  return `<h1 class="page">التشغيل والجدولة</h1>
    <div class="statusbar">
      <div class="stat"><div class="k">المرجع الزمني للجدولة</div><div class="v">${esc(fmt(s.anchor))}</div><div class="k">فاصل ثابت ${data.config.intervalHours} ساعات من هذا الوقت</div></div>
      <div class="stat"><div class="k">التشغيل القادم</div><div class="v">${data.config.schedulerEnabled ? esc(fmt(s.nextRunAt)) : 'المجدول الداخلي معطل (SCHEDULER_ENABLED=false)'}</div></div>
      <div class="stat"><div class="k">التلخيص</div><div class="v">${data.config.aiMode === 'ai' ? esc(data.config.aiModel) : 'وضع محدود'}</div></div>
      ${READ_ONLY ? '<div class="stat"><div class="k">تشغيل يدوي</div><div class="v">من GitHub: Actions ← update ← Run workflow</div></div>' : '<div class="stat actions"><div class="k">تشغيل يدوي (يحترم القفل)</div><button class="btn" data-act="run">تشغيل الآن</button></div>'}
    </div>
    <h2>آخر عمليات التشغيل</h2><div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>النوع</th><th>المخطط</th><th>البدء</th><th>الانتهاء</th><th>الحالة</th><th>الإحصاءات</th></tr></thead><tbody>
    ${data.runs.map((r) => `<tr><td>${r.id}</td><td>${esc(r.kind)}${r.slot_index !== null ? ` (#${r.slot_index})` : ''}</td><td>${esc(fmtS(r.planned_at))}</td><td>${esc(fmtS(r.started_at))}</td><td>${esc(fmtS(r.finished_at))}</td>
      <td>${esc(RUN_STATUS[r.status] || r.status)}${r.error ? `<div class="sub">${esc(r.error.slice(0, 160))}</div>` : ''}</td>
      <td class="sub">${r.stats ? `مصادر ${r.stats.ingest.sourcesOk}/${r.stats.ingest.sources}، جديد ${r.stats.ingest.new}، أحداث ${r.stats.ingest.newEvents}، مدمج ${r.stats.ingest.merged}، تحديثات ${r.stats.ingest.updates}، مكرر حرفي ${r.stats.ingest.dupExact}، إعادة نشر ${r.stats.ingest.reposts}، رياضة ${r.stats.ingest.excludedSports}، قديم ${r.stats.ingest.stale}؛ تلخيص: ${esc(r.stats.ai.mode)} ${r.stats.ai.done}/${r.stats.ai.attempted}${r.stats.ai.errors?.length ? ' — ' + esc(r.stats.ai.errors[0]) : ''}` : ''}${r.bulletin_id ? ` <a href="./#/bulletin/${r.bulletin_id}">النشرة</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <h2>خانات الجدولة</h2><div class="table-wrap"><table class="data"><thead><tr><th>الخانة</th><th>الوقت المخطط</th><th>الحالة</th><th>المحاولات</th><th>إعادة المحاولة</th></tr></thead><tbody>
    ${data.slots.map((x) => `<tr><td>${x.slot_index}</td><td>${esc(fmt(x.planned_at))}</td><td>${esc(x.status === 'merged' ? 'مدمجة في تشغيل استدراكي' : x.status)}</td><td>${x.attempts}</td><td>${esc(fmtS(x.next_retry_at))}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function sourcesTable() {
  return `<h1 class="page">المصادر</h1><p class="sub">لإضافة مصدر أو تعطيله أو تعديله: عدّل الملف src/sources.js في المستودع، ويُطبَّق في التشغيل التالي.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>المفتاح</th><th>الاسم</th><th>الحالة</th><th>آخر نجاح</th><th>إخفاقات</th><th>آخر خطأ / ملاحظة</th></tr></thead><tbody>
    ${data.sources.map((s) => `<tr><td>${esc(s.key)}</td><td>${esc(s.name)}</td><td>${s.enabled ? 'مفعّل' : 'معطّل'}</td><td>${esc(fmtS(s.last_success_at))}</td><td>${s.consecutive_failures}</td><td class="sub">${esc(s.last_error || s.notes || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

function sources() {
  if (READ_ONLY) return sourcesTable();
  return `<h1 class="page">المصادر</h1><p class="sub">التعديل يقتصر على المضيفين المسموح بهم لكل مصدر. المصادر الجديدة تُضاف معطّلة حتى تتحقق منها.</p>
    ${data.sources.map((s) => `<form class="card" data-source="${s.id}">
      <div class="badges"><span class="badge">${esc(s.key)}</span><span class="badge">${esc(s.type)}</span>${s.last_error ? `<span class="badge ver-conflicting">آخر خطأ: ${esc(s.last_error.slice(0, 80))}</span>` : ''}</div>
      <div class="grid2">
        <label class="f">الاسم<input name="name" value="${esc(s.name)}"></label>
        <label class="f">الرابط<input name="url" value="${esc(s.url)}" dir="ltr"></label>
        <label class="f">المضيفون المسموح بهم (فاصلة)<input name="allowed_hosts" value="${esc(s.allowed_hosts.join(', '))}" dir="ltr"></label>
        <label class="f">النطاق الافتراضي<select name="default_scope">${['auto', 'saudi', 'world'].map((x) => `<option ${x === s.default_scope ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f">تلميح القسم<input name="section_hint" value="${esc(s.section_hint || '')}" dir="ltr"></label>
        <label class="f">نمط روابط المقالات (html_list)<input name="link_pattern" value="${esc(s.link_pattern || '')}" dir="ltr"></label>
        <label class="f">ملاحظات<input name="notes" value="${esc(s.notes || '')}"></label>
        <label class="f"><span><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> مفعّل</span><span><input type="checkbox" name="is_official" ${s.is_official ? 'checked' : ''}> مصدر رسمي</span></label>
      </div>
      <div class="meta"><span>آخر جلب: ${esc(fmtS(s.last_fetch_at))}</span><span>آخر نجاح: ${esc(fmtS(s.last_success_at))}</span><span>إخفاقات متتالية: ${s.consecutive_failures}</span>
      <button class="btn small">حفظ</button></div></form>`).join('')}
    <h2>إضافة مصدر</h2>
    <form class="search" id="addsrc">
      <label class="f">المفتاح<input name="key" dir="ltr" required></label><label class="f">الاسم<input name="name" required></label>
      <label class="f">الرابط<input name="url" dir="ltr" required></label>
      <label class="f">النوع<select name="type"><option>rss</option><option>html_list</option></select></label>
      <label class="f">اللغة<select name="language"><option>ar</option><option>en</option></select></label>
      <label class="f">النطاق<select name="default_scope"><option>auto</option><option>saudi</option><option>world</option></select></label>
      <button class="btn">إضافة (معطّل)</button></form>`;
}

function logs() {
  return `<h1 class="page">سجل الجلب</h1><div class="table-wrap"><table class="data"><thead><tr><th>الوقت</th><th>المصدر</th><th>النتيجة</th><th>HTTP</th><th>عناصر</th><th>جديد</th><th>الخطأ</th></tr></thead><tbody>
    ${data.fetchLogs.map((l) => `<tr><td>${esc(fmtS(l.started_at))}</td><td>${esc(l.name)}</td><td class="${l.ok ? 'health-ok' : 'health-failing'}">${l.ok ? 'نجح' : 'فشل'}</td><td>${l.http_status ?? ''}</td><td>${l.items_found}</td><td>${l.items_new}</td><td class="sub">${esc(l.error || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function dedup() {
  return `<h1 class="page">مراجعة التكرار</h1>
    <h2>أزواج متشابهة جزئيًا (لم تُدمج)</h2><p class="sub">النظام يفضّل إبقاء الأحداث منفصلة عند الشك. ادمج إن كانت الحدث نفسه.</p>
    ${data.reviews.map((r) => `<div class="card"><div class="badges"><span class="badge">تشابه ${r.score}</span><span class="badge">${esc(r.reason || '')}</span></div>
      <div>أ: <a href="./#/event/${r.event_id}" target="_blank">#${r.event_id}</a> <span dir="auto">${esc(r.event_title)}</span></div>
      <div>ب: <a href="./#/event/${r.candidate_event_id}" target="_blank">#${r.candidate_event_id}</a> <span dir="auto">${esc(r.candidate_title)}</span></div>
      <div class="meta">${READ_ONLY ? `<span>للدمج أضف <code>[${r.candidate_event_id}, ${r.event_id}]</code> إلى merge، أو لإغلاقها أضف <code>${r.id}</code> إلى dismiss</span>` : `<button class="btn small" data-merge-into="${r.candidate_event_id}" data-merge-from="${r.event_id}">دمج أ في ب</button><button class="btn secondary small" data-dismiss="${r.id}">ليسا الحدث نفسه</button>`}</div></div>`).join('') || '<p class="sub">لا توجد أزواج للمراجعة.</p>'}
    ${READ_ONLY ? '' : '<h2>دمج يدوي لحدثين</h2><form class="search" id="manualmerge"><label class="f">أبقِ الحدث رقم<input name="intoId" type="number" required></label><label class="f">وادمج فيه الحدث رقم<input name="fromId" type="number" required></label><button class="btn">دمج</button></form>'}
    <h2>آخر عمليات الدمج الآلي</h2><div class="table-wrap"><table class="data"><thead><tr><th>العنصر</th><th>المصدر</th><th>دُمج في الحدث</th><th>العلاقة</th><th>الدرجة (عنوان/نص/كيانات)</th><th>السبب</th><th></th></tr></thead><tbody>
    ${data.merges.map((m) => `<tr><td dir="auto">${esc(m.item_title)}</td><td>${esc(m.source)}</td><td><a href="./#/event/${m.event_id}" target="_blank">#${m.event_id}</a> <span dir="auto" class="sub">${esc(m.event_title)}</span></td>
      <td>${esc(REL[m.relation] || m.relation)}</td><td class="ltr">${m.score ?? ''} (${m.title_sim ?? ''}/${m.text_sim ?? ''}/${m.entity_sim ?? ''})</td><td class="sub">${esc(m.reason || '')}</td>
      <td>${READ_ONLY ? `<span class="sub">للفصل: ${m.item_id} في split</span>` : `<button class="btn secondary small" data-split="${m.item_id}">فصل</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function excluded() {
  return `<h1 class="page">محتوى مستبعد (رياضة)</h1><p class="sub">للتحقق من عدم استبعاد أخبار اقتصادية بالخطأ.</p><div class="table-wrap"><table class="data"><thead><tr><th>العنوان</th><th>المصدر</th><th>السبب</th><th>الوقت</th></tr></thead><tbody>
    ${data.excluded.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(x.title)}</a></td><td>${esc(x.source)}</td><td>${esc(x.exclude_reason)}</td><td>${esc(fmtS(x.fetched_at))}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function act(fn) {
  try {
    await fn();
    data = await api('/api/admin/overview');
    render();
  } catch (e) {
    alert(e.message);
  }
}
const formJson = (form) => Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ''));

function wire() {
  app.querySelector('[data-act="run"]')?.addEventListener('click', () => act(() => api('/api/admin/run', { method: 'POST' })));
  app.querySelectorAll('form[data-source]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f));
    b.enabled = f.enabled.checked;
    b.is_official = f.is_official.checked;
    act(() => api(`/api/admin/sources/${f.dataset.source}`, { method: 'PATCH', body: JSON.stringify(b) }));
  }));
  app.querySelector('#addsrc')?.addEventListener('submit', (e) => { e.preventDefault(); act(() => api('/api/admin/sources', { method: 'POST', body: JSON.stringify(formJson(e.target)) })); });
  app.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', () => confirm('فصل هذا العنصر في حدث مستقل؟') && act(() => api('/api/admin/split', { method: 'POST', body: JSON.stringify({ itemId: +b.dataset.split }) }))));
  app.querySelectorAll('[data-merge-into]').forEach((b) => b.addEventListener('click', () => act(() => api('/api/admin/merge', { method: 'POST', body: JSON.stringify({ intoId: +b.dataset.mergeInto, fromId: +b.dataset.mergeFrom }) }))));
  app.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', () => act(() => api(`/api/admin/reviews/${b.dataset.dismiss}/dismiss`, { method: 'POST' }))));
  app.querySelector('#manualmerge')?.addEventListener('submit', (e) => { e.preventDefault(); act(() => api('/api/admin/merge', { method: 'POST', body: JSON.stringify(formJson(e.target)) })); });
}

load().catch((e) => (app.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`));
