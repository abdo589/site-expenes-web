// Site Expenses — web app (static, talks to Supabase directly; RLS decides what each user sees).
{
const SB_URL = "https://hmqceajdhnvkzceifewb.supabase.co";
const SB_KEY = "sb_publishable_nKl4FjaxFzCG4WH89Y0i5g_k-EfUWQZ"; // publishable: safe in the browser, RLS protects data
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d) => (d ? String(d).slice(0, 10) : "—");
const view = $("#view");

const STATUS = { submitted: "قيد المعالجة", auto_ok: "جاهزة للاعتماد", needs_review: "محتاجة مراجعة", approved: "معتمدة", rejected: "مرفوضة", settled: "مسوّاة" };
const FLAGS = {
  duplicate: "فاتورة مكررة", possible_duplicate: "ممكن تكون مكررة", no_qr: "مفيش QR — محتاجة إدخال يدوي",
  missing_total: "الإجمالي مش معروف", math_mismatch: "الحساب مش راكب", vat_rate: "نسبة الضريبة مش 15%",
  no_vat_number: "ضريبة من غير رقم ضريبي", invalid_vat_number: "رقم ضريبي غير صحيح", future_date: "تاريخ في المستقبل",
  old_invoice: "فاتورة قديمة", low_confidence: "القراءة مش أكيدة", large_amount: "مبلغ كبير", project_missing: "مفيش مشروع",
  project_mismatch: "المهندس مش على المشروع", over_custody: "أكبر من رصيد العهدة", processing_failed: "المعالجة فشلت — محتاجة إدخال يدوي",
};
const HARD = new Set(["duplicate", "processing_failed", "math_mismatch"]);
const KINDS = { issue: "صرف عهدة", return: "رد نقدية من المهندس", reimburse: "تعويض المهندس", adjust: "تسوية" };
const ROLES = { engineer: "مهندس", accountant: "محاسب", admin: "أدمن" };
const REJECT_REASONS = ["الصورة مش واضحة", "فاتورة مكررة", "مش مصروف شغل", "مشروع غلط", "ناقصها بيانات"];

let me = null;
let cats = [];
let projects = [];
let current = "";

const chip = (st) => `<span class="chip st-${esc(st)}">${esc(STATUS[st] ?? st)}</span>`;
const flagChips = (flags) => (flags || []).map((f) => `<span class="chip flag ${HARD.has(f) ? "hard" : ""}">${esc(FLAGS[f] ?? f)}</span>`).join("");
const isStaff = () => me && (me.role === "accountant" || me.role === "admin");

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3500);
}

function fail(e) {
  console.error(e);
  toast("حصل خطأ: " + (e?.message || e));
}

async function must(p) {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

async function invoke(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  return data;
}

// ---------------- Auth ----------------
let setupMode = false;
$("#toggleSetup").addEventListener("click", () => {
  setupMode = !setupMode;
  $("#setupExtra").classList.toggle("hide", !setupMode);
  $("#loginBtn").textContent = setupMode ? "إنشاء حساب الأدمن" : "دخول";
  $("#loginMsg").textContent = setupMode ? "للمرة الأولى بس: هيتعمل أول حساب أدمن بالكود اللي اتبعتلك." : "";
});

$("#loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("#loginBtn");
  const email = $("#email").value.trim();
  const password = $("#password").value;
  btn.disabled = true;
  $("#loginMsg").textContent = "";
  try {
    if (setupMode) {
      if (password.length < 8) throw new Error("كلمة المرور لازم 8 حروف على الأقل");
      const r = await fetch(`${SB_URL}/functions/v1/admin-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ action: "bootstrap", email, password, full_name: $("#fullName").value.trim(), setup_code: $("#setupCode").value.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "مقدرناش نعمل الحساب");
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "الإيميل أو كلمة المرور غلط" : error.message);
  } catch (e) {
    $("#loginMsg").innerHTML = `<span class="err">${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
});

$("#logout").addEventListener("click", () => sb.auth.signOut());

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    if (!me || me.id !== session.user.id) setTimeout(() => start(session.user), 0);
  } else {
    me = null;
    $("#shell").classList.add("hide");
    $("#login").classList.remove("hide");
  }
});

async function start(user) {
  try {
    const p = await must(sb.from("profiles").select("id, full_name, role, active, phone").eq("id", user.id).maybeSingle());
    if (!p || !p.active) {
      $("#loginMsg").innerHTML = '<span class="err">الحساب ده مش مفعّل. كلّم الأدمن.</span>';
      await sb.auth.signOut();
      return;
    }
    me = { ...p, email: user.email };
    [cats, projects] = await Promise.all([
      must(sb.from("expense_categories").select("id, code, name_ar, gl_code, active, sort_order").order("sort_order")),
      must(sb.from("projects").select("id, code, name, status").order("code")),
    ]);
    $("#who").textContent = `${me.full_name || me.email} · ${ROLES[me.role]}`;
    $("#login").classList.add("hide");
    $("#shell").classList.remove("hide");
    buildTabs();
  } catch (e) {
    fail(e);
  }
}

// ---------------- Tabs ----------------
const TABS = {
  engineer: [["new", "فاتورة جديدة"], ["mine", "فواتيري"], ["account", "حسابي"]],
  accountant: [["review", "المراجعة"], ["all", "كل الفواتير"], ["custody", "العُهد"], ["spend", "المصروفات"], ["account", "حسابي"]],
  admin: [["review", "المراجعة"], ["all", "كل الفواتير"], ["custody", "العُهد"], ["spend", "المصروفات"], ["settings", "الإعدادات"], ["account", "حسابي"]],
};

function buildTabs() {
  const list = TABS[me.role];
  $("#tabs").innerHTML = list.map(([id, t]) => `<button role="tab" data-tab="${id}" id="tab-${id}">${t}</button>`).join("");
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
  route();
}

window.addEventListener("hashchange", () => me && route());

function route() {
  const list = TABS[me.role].map(([id]) => id);
  const h = location.hash.slice(1);
  const tab = list.includes(h) ? h : list[0];
  current = tab;
  $$("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  view.innerHTML = '<p class="mute">بيحمّل…</p>';
  ({ new: renderNew, mine: renderMine, review: renderReview, all: renderAll, custody: renderCustody, spend: renderSpend, settings: renderSettings, account: renderAccount })[tab]().catch(fail);
}

const projectOptions = (sel, list = projects.filter((p) => p.status === "active")) =>
  list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.code)} — ${esc(p.name)}</option>`).join("");
const catOptions = (sel) => cats.filter((c) => c.active).map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? "selected" : ""}>${esc(c.name_ar)}</option>`).join("");
const catIdOptions = (sel) => cats.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.name_ar)}</option>`).join("");

// ---------------- Engineer: new invoice ----------------
let draft = null; // { clientRef, blob, preview, qr, mime }

async function prepareImage(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { blob: file, preview: null, qr: null, mime: file.type || "image/jpeg" }; // e.g. HEIC on some browsers: upload as is
  }
  // QR: try several sizes and the lower half (where receipts usually print it).
  let qr = null;
  const tries = [[1400, 0, 1], [900, 0, 1], [1400, 0.4, 1], [1400, 0.55, 1]];
  for (const [w, top, h] of tries) {
    const scale = Math.min(1, w / bmp.width);
    const sy = Math.floor(bmp.height * top);
    const sh = Math.floor(bmp.height * h) - sy;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, sy, bmp.width, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" }) : null;
    if (r?.data) { qr = r.data; break; }
  }
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  return { blob, preview: URL.createObjectURL(blob), qr, mime: "image/jpeg" };
}

async function renderNew() {
  const mine = projects.filter((p) => p.status === "active");
  view.innerHTML = `
    <div class="grid g2">
      <section>
        <h1>فاتورة جديدة</h1>
        <label class="shoot" for="photo" id="shoot">
          <span class="big" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg></span>
          <b>صوّر الفاتورة</b><span class="mute">خلّي الـ QR واضح لو موجود</span>
        </label>
        <input id="photo" type="file" accept="image/*" capture="environment" class="hide">
        <p id="qrState" class="mute"></p>
      </section>
      <section class="card">
        <label for="proj">المشروع</label>
        <select id="proj">${mine.length ? projectOptions(localStorage.getItem("lastProject"), mine) : '<option value="">مفيش مشاريع متعيّن عليها</option>'}</select>
        <label for="cat">البند</label>
        <select id="cat"><option value="">— اختار —</option>${catOptions(localStorage.getItem("lastCat"))}</select>
        <label for="note">ملاحظة (اختياري)</label>
        <textarea id="note" placeholder="مثلاً: حديد للسقف الدور التاني"></textarea>
        <p></p>
        <button class="btn primary" id="send" disabled>إرسال الفاتورة</button>
        <div id="result" style="margin-top:16px"></div>
      </section>
    </div>`;
  if (draft?.preview) showDraft();
  $("#photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $("#qrState").textContent = "بيجهّز الصورة…";
    try {
      draft = { clientRef: crypto.randomUUID(), ...(await prepareImage(f)) };
      showDraft();
    } catch (err) { fail(err); }
  });
  $("#send").addEventListener("click", sendDraft);
}

function showDraft() {
  $("#shoot").innerHTML = draft.preview ? `<img src="${draft.preview}" alt="صورة الفاتورة"><span class="mute">اضغط لتغيير الصورة</span>` : "<b>الصورة جاهزة</b>";
  $("#qrState").innerHTML = draft.qr ? '<span class="okt">✓ اتقرا الـ QR — الأرقام هتطلع مظبوطة</span>' : "مفيش QR مقروء — المحاسب هيراجع الأرقام";
  $("#send").disabled = false;
}

async function sendDraft() {
  const btn = $("#send");
  btn.disabled = true;
  btn.textContent = "بيرفع…";
  try {
    const ym = new Date().toISOString().slice(0, 7);
    const ext = draft.mime === "image/jpeg" ? "jpg" : (draft.mime.split("/")[1] || "jpg");
    const path = `${me.id}/${ym}/${draft.clientRef}.${ext}`;
    const up = await sb.storage.from("receipts").upload(path, draft.blob, { contentType: draft.mime });
    if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
    const project_id = $("#proj").value || undefined;
    const category_code = $("#cat").value || undefined;
    if (project_id) localStorage.setItem("lastProject", project_id);
    if (category_code) localStorage.setItem("lastCat", category_code);
    const r = await invoke("ingest", {
      client_ref: draft.clientRef, image_path: path, project_id, category_code,
      note: $("#note").value.trim() || undefined, qr_raw: draft.qr || undefined,
    });
    const x = r.expense;
    $("#result").innerHTML = `<div class="slip"><div class="row">${chip(x.status)}<span class="sp"></span><span class="amt">${money(x.total)}</span></div>
      <div>${esc(x.vendor_name || "مورد غير معروف")} · ${day(x.invoice_date)}</div><div>${flagChips(x.flags)}</div></div>`;
    toast(x.status === "auto_ok" ? "اتسجلت ✓" : "اتسجلت — هتتراجع من المحاسب");
    draft = null;
    $("#note").value = "";
    $("#photo").value = "";
    $("#shoot").innerHTML = '<span class="big" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg></span><b>صوّر فاتورة تانية</b>';
    $("#qrState").textContent = "";
    btn.textContent = "إرسال الفاتورة";
  } catch (e) {
    fail(e);
    btn.disabled = false;
    btn.textContent = "حاول تاني";
  }
}

// ---------------- Engineer: my invoices ----------------
async function renderMine() {
  const [rows, bal, avail] = await Promise.all([
    must(sb.from("expenses").select("id, created_at, status, flags, total, vendor_name, invoice_date, note, reject_reason, image_path, projects(code), expense_categories(name_ar)").order("created_at", { ascending: false }).limit(200)),
    must(sb.from("v_custody_balance").select("*").eq("engineer_id", me.id).maybeSingle()),
    must(sb.rpc("available_custody", { p_engineer: me.id })),
  ]);
  view.innerHTML = `
    <h1>فواتيري</h1>
    <div class="kpis">
      <div class="card kpi"><div class="n">${money(bal?.received ?? 0)}</div><div class="l">العهدة المستلمة</div></div>
      <div class="card kpi"><div class="n">${money(bal?.spent ?? 0)}</div><div class="l">المعتمد</div></div>
      <div class="card kpi"><div class="n">${money(bal?.pending_review ?? 0)}</div><div class="l">تحت المراجعة</div></div>
      <div class="card kpi"><div class="n" style="color:${avail !== null && avail < 0 ? "var(--bad)" : "inherit"}">${avail === null ? "—" : money(avail)}</div><div class="l">المتاح معاك</div></div>
    </div>
    <div class="grid g2" id="slips">${rows.length ? "" : '<p class="mute">لسه مفيش فواتير.</p>'}</div>`;
  $("#slips").insertAdjacentHTML("beforeend", rows.map((x) => `
    <div class="slip" data-id="${esc(x.id)}">
      <div class="row">${chip(x.status)}<span class="sp"></span><span class="amt">${money(x.total)}</span></div>
      <div>${esc(x.vendor_name || "مورد غير معروف")} · ${day(x.invoice_date || x.created_at)}</div>
      <div class="mute">${esc(x.projects?.code || "بدون مشروع")} · ${esc(x.expense_categories?.name_ar || "بدون بند")}${x.note ? " · " + esc(x.note) : ""}</div>
      <div>${flagChips(x.flags)}</div>
      ${x.status === "rejected" ? `<div class="err">سبب الرفض: ${esc(x.reject_reason)}</div><button class="btn sm" data-resubmit="${esc(x.id)}">إعادة تقديم</button>` : ""}
      <button class="btn sm" data-img="${esc(x.image_path)}">الصورة</button><div class="imgbox"></div>
    </div>`).join(""));
  bindImageButtons();
  $$("[data-resubmit]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await must(sb.from("expenses").update({ status: "needs_review" }).eq("id", b.dataset.resubmit));
      toast("اتبعتت للمراجعة تاني");
      renderMine();
    } catch (e) { fail(e); }
  }));
}

function bindImageButtons() {
  $$("[data-img]").forEach((b) => b.addEventListener("click", async () => {
    const box = b.nextElementSibling;
    if (box.innerHTML) { box.innerHTML = ""; return; }
    try {
      const { signedUrl } = await must(sb.storage.from("receipts").createSignedUrl(b.dataset.img, 3600));
      box.innerHTML = `<img src="${esc(signedUrl)}" alt="صورة الفاتورة" style="width:100%;border-radius:10px;margin-top:8px">`;
    } catch (e) { fail(e); }
  }));
}

// ---------------- Staff: review queue ----------------
async function renderReview() {
  const rows = await must(sb.from("v_review_queue").select("*"));
  const ready = rows.filter((r) => r.status === "auto_ok");
  const review = rows.filter((r) => r.status !== "auto_ok");
  view.innerHTML = `
    <div class="row"><h1 class="sp">المراجعة</h1>
      <button class="btn good" id="approveAll" ${ready.length ? "" : "disabled"}>اعتماد الجاهزة (${ready.length})</button></div>
    <div class="kpis">
      <div class="card kpi"><div class="n">${review.length}</div><div class="l">محتاجة مراجعة</div></div>
      <div class="card kpi"><div class="n">${ready.length}</div><div class="l">جاهزة (QR سليم)</div></div>
      <div class="card kpi"><div class="n">${rows.length ? Math.max(...rows.map((r) => r.age_days)) : 0}</div><div class="l">أقدم فاتورة (يوم)</div></div>
    </div>
    <div class="card scroll">${queueTable(rows)}</div>`;
  bindRows();
  $("#approveAll").addEventListener("click", async () => {
    try {
      await must(sb.from("expenses").update({ status: "approved" }).eq("status", "auto_ok"));
      toast(`اتعتمد ${ready.length} فاتورة`);
      renderReview();
    } catch (e) { fail(e); }
  });
}

function queueTable(rows) {
  if (!rows.length) return '<p class="mute">مفيش فواتير مستنية.</p>';
  return `<table class="stack"><thead><tr><th>الحالة</th><th>المهندس</th><th>المشروع</th><th>المورد</th><th>التاريخ</th><th class="num">الإجمالي</th><th>ملاحظات</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-open="${esc(r.id)}"><td>${chip(r.status)}</td><td>${esc(r.engineer_name)}</td><td>${esc(r.project_code || "—")}</td>
      <td>${esc(r.vendor_name || "—")}</td><td>${day(r.invoice_date || r.created_at)}</td><td class="num">${money(r.total)}</td><td>${flagChips(r.flags)}</td></tr>`).join("")}
    </tbody></table>`;
}

function bindRows() {
  $$("[data-open]").forEach((tr) => tr.addEventListener("click", () => openDetail(tr.dataset.open).catch(fail)));
}

// ---------------- Staff: expense detail ----------------
async function openDetail(id) {
  const back = current;
  const x = await must(sb.from("expenses").select("*, engineer:profiles!expenses_engineer_id_fkey(full_name)").eq("id", id).single());
  const [events, signed] = await Promise.all([
    must(sb.from("expense_events").select("action, created_at, actor_id").eq("expense_id", id).order("created_at", { ascending: false }).limit(20)),
    sb.storage.from("receipts").createSignedUrl(x.image_path, 3600),
  ]);
  const editable = ["submitted", "auto_ok", "needs_review", "rejected"].includes(x.status);
  const dis = editable ? "" : "disabled";
  const f = (k, label, type = "text", extra = "") => `<div><label for="d-${k}">${label}</label><input id="d-${k}" type="${type}" value="${esc(x[k] ?? "")}" ${dis} ${extra}></div>`;
  view.innerHTML = `
    <div class="row"><button class="btn sm" id="back">→ رجوع</button><span class="sp"></span>${chip(x.status)}</div>
    <h2 style="margin-top:12px">${esc(x.vendor_name || "فاتورة بدون مورد")} · ${money(x.total)} ر.س</h2>
    <p class="mute">${esc(x.engineer?.full_name)} · اترفعت ${day(x.created_at)} · المصدر: ${esc({ qr: "QR", ocr: "قراءة آلية", manual: "إدخال يدوي" }[x.source] || "—")}</p>
    <div>${flagChips(x.flags)}</div>
    ${x.processing_error ? `<p class="err">خطأ معالجة: ${esc(x.processing_error)}</p>` : ""}
    <div class="detail" style="margin-top:12px">
      <div>${signed.data?.signedUrl ? `<a href="${esc(signed.data.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(signed.data.signedUrl)}" alt="صورة الفاتورة"></a>` : '<p class="mute">الصورة مش متاحة</p>'}</div>
      <div class="card">
        <div class="f2">
          ${f("vendor_name", "المورد")}${f("vendor_vat", "الرقم الضريبي", "text", 'dir="ltr" inputmode="numeric"')}
          ${f("invoice_no", "رقم الفاتورة", "text", 'dir="ltr"')}${f("invoice_date", "التاريخ", "date")}
          ${f("subtotal", "قبل الضريبة", "number", 'step="0.01" dir="ltr"')}${f("vat", "الضريبة", "number", 'step="0.01" dir="ltr"')}
          ${f("total", "الإجمالي", "number", 'step="0.01" dir="ltr"')}
          <div><label for="d-project_id">المشروع</label><select id="d-project_id" ${dis}><option value="">—</option>${projectOptions(x.project_id, projects)}</select></div>
          <div><label for="d-category_id">البند</label><select id="d-category_id" ${dis}><option value="">—</option>${catIdOptions(x.category_id)}</select></div>
        </div>
        <label for="d-review_note">ملاحظة المراجعة</label><textarea id="d-review_note">${esc(x.review_note ?? "")}</textarea>
        ${x.note ? `<p class="mute">ملاحظة المهندس: ${esc(x.note)}</p>` : ""}
        ${x.reject_reason ? `<p class="err">سبب الرفض: ${esc(x.reject_reason)}</p>` : ""}
        <div class="row" style="margin-top:14px" id="actions"></div>
        <div id="rejectBox" class="hide" style="margin-top:10px">
          <label for="rej">سبب الرفض</label>
          <select id="rej">${REJECT_REASONS.map((r) => `<option>${r}</option>`).join("")}<option value="">سبب تاني…</option></select>
          <input id="rejOther" class="hide" placeholder="اكتب السبب" style="margin-top:8px">
          <div class="row" style="margin-top:8px"><button class="btn bad" id="rejGo">تأكيد الرفض</button></div>
        </div>
      </div>
    </div>
    <h3 style="margin-top:24px">السجل</h3>
    <div class="card"><table><tbody>${events.map((e) => `<tr><td>${esc(eventLabel(e.action))}</td><td class="num mute">${esc(new Date(e.created_at).toLocaleString("en-GB"))}</td></tr>`).join("")}</tbody></table></div>`;

  $("#back").addEventListener("click", () => { location.hash = back; route(); });
  const acts = $("#actions");
  const btn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = "btn " + cls;
    b.textContent = label;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { fail(e); b.disabled = false; }
    });
    acts.append(b);
  };

  const collect = () => {
    const num = (k) => { const v = $("#d-" + k).value; return v === "" ? null : Number(v); };
    const txt = (k) => $("#d-" + k).value.trim() || null;
    return {
      vendor_name: txt("vendor_name"), vendor_vat: txt("vendor_vat"), invoice_no: txt("invoice_no"), invoice_date: txt("invoice_date"),
      subtotal: num("subtotal"), vat: num("vat"), total: num("total"),
      project_id: $("#d-project_id").value || null, category_id: $("#d-category_id").value || null,
      review_note: $("#d-review_note").value.trim() || null,
    };
  };

  if (editable) {
    btn("اعتماد", "good", async () => {
      const v = collect();
      if (v.total === null) throw new Error("لازم الإجمالي قبل الاعتماد");
      if (x.status === "rejected" || x.status === "submitted") await must(sb.from("expenses").update({ ...v, status: "needs_review" }).eq("id", id));
      await must(sb.from("expenses").update({ ...v, status: "approved" }).eq("id", id));
      toast("اتعتمدت ✓");
      openDetail(id);
    });
    btn("حفظ وإعادة الفحص", "", async () => {
      await must(sb.from("expenses").update(collect()).eq("id", id));
      if (["submitted", "auto_ok", "needs_review"].includes(x.status)) await invoke("ingest", { action: "reprocess", expense_id: id });
      toast("اتحفظت");
      openDetail(id);
    });
    if (x.status !== "rejected") btn("رفض", "bad", async () => { $("#rejectBox").classList.remove("hide"); acts.lastChild.disabled = false; });
    if ((x.flags || []).some((fl) => fl === "duplicate" || fl === "possible_duplicate")) {
      btn("مش مكررة", "sm", async () => {
        await must(sb.from("expenses").update({ flags: x.flags.filter((fl) => fl !== "duplicate" && fl !== "possible_duplicate") }).eq("id", id));
        toast("اتشالت علامة التكرار");
        openDetail(id);
      });
    }
  }
  if (x.status === "approved") {
    btn("تسوية (اتخصمت من العهدة)", "primary", async () => {
      await must(sb.from("expenses").update({ status: "settled" }).eq("id", id));
      toast("اتسوّت");
      openDetail(id);
    });
    if (me.role === "admin") btn("إعادة فتح", "", async () => {
      await must(sb.from("expenses").update({ status: "needs_review" }).eq("id", id));
      openDetail(id);
    });
  }
  $("#rej").addEventListener("change", () => $("#rejOther").classList.toggle("hide", $("#rej").value !== ""));
  $("#rejGo").addEventListener("click", async () => {
    const reason = $("#rej").value || $("#rejOther").value.trim();
    if (!reason) return toast("اكتب سبب الرفض");
    try {
      await must(sb.from("expenses").update({ status: "rejected", reject_reason: reason, review_note: $("#d-review_note").value.trim() || null }).eq("id", id));
      toast("اترفضت");
      openDetail(id);
    } catch (e) { fail(e); }
  });
}

function eventLabel(a) {
  if (a === "created") return "اترفعت";
  if (a === "updated") return "تعديل بيانات";
  const m = a.match(/^status:(\w+)->(\w+)$/);
  return m ? `بقت ${STATUS[m[2]] ?? m[2]} (كانت ${STATUS[m[1]] ?? m[1]})` : a;
}

// ---------------- Staff: all invoices ----------------
async function renderAll() {
  const ym = sessionStorage.getItem("allMonth") || new Date().toISOString().slice(0, 7);
  view.innerHTML = `
    <div class="row"><h1 class="sp">كل الفواتير</h1><button class="btn" id="csv">تصدير Excel (CSV)</button></div>
    <div class="row card" style="margin-bottom:16px">
      <div class="sp"><label for="fMonth">الشهر</label><input id="fMonth" type="month" value="${esc(ym)}"></div>
      <div class="sp"><label for="fStatus">الحالة</label><select id="fStatus"><option value="">الكل</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div class="sp"><label for="fProj">المشروع</label><select id="fProj"><option value="">الكل</option>${projectOptions(null, projects)}</select></div>
    </div>
    <div id="allBody"><p class="mute">بيحمّل…</p></div>`;
  let rows = [];
  const load = async () => {
    const m = $("#fMonth").value;
    sessionStorage.setItem("allMonth", m);
    let q = sb.from("expenses").select("id, created_at, status, flags, invoice_no, invoice_date, vendor_name, vendor_vat, subtotal, vat, total, source, image_path, engineer:profiles!expenses_engineer_id_fkey(full_name), projects(code), expense_categories(name_ar, gl_code)")
      .order("created_at", { ascending: false }).limit(1000);
    if (m) {
      const [y, mo] = m.split("-").map(Number);
      const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
      q = q.gte("created_at", `${m}-01`).lt("created_at", next);
    }
    if ($("#fStatus").value) q = q.eq("status", $("#fStatus").value);
    if ($("#fProj").value) q = q.eq("project_id", $("#fProj").value);
    rows = await must(q);
    const sum = (k) => rows.filter((r) => ["approved", "settled"].includes(r.status)).reduce((a, r) => a + Number(r[k] || 0), 0);
    $("#allBody").innerHTML = `
      <div class="kpis"><div class="card kpi"><div class="n">${rows.length}</div><div class="l">فاتورة</div></div>
        <div class="card kpi"><div class="n">${money(sum("total"))}</div><div class="l">المعتمد (شامل الضريبة)</div></div>
        <div class="card kpi"><div class="n">${money(sum("vat"))}</div><div class="l">ضريبة المدخلات</div></div></div>
      <div class="card scroll">${rows.length ? `<table class="stack"><thead><tr><th>الحالة</th><th>التاريخ</th><th>المهندس</th><th>المشروع</th><th>البند</th><th>المورد</th><th class="num">الإجمالي</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" data-open="${esc(r.id)}"><td>${chip(r.status)}</td><td>${day(r.invoice_date || r.created_at)}</td><td>${esc(r.engineer?.full_name)}</td>
        <td>${esc(r.projects?.code || "—")}</td><td>${esc(r.expense_categories?.name_ar || "—")}</td><td>${esc(r.vendor_name || "—")}</td><td class="num">${money(r.total)}</td></tr>`).join("")}
      </tbody></table>` : '<p class="mute">مفيش فواتير بالفلاتر دي.</p>'}</div>`;
    bindRows();
  };
  ["fMonth", "fStatus", "fProj"].forEach((i) => $("#" + i).addEventListener("change", () => load().catch(fail)));
  $("#csv").addEventListener("click", () => {
    const head = ["التاريخ", "رقم الفاتورة", "المورد", "الرقم الضريبي", "المشروع", "المهندس", "البند", "GL", "قبل الضريبة", "الضريبة", "الإجمالي", "الحالة", "المصدر"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [day(r.invoice_date || r.created_at), r.invoice_no, r.vendor_name, r.vendor_vat, r.projects?.code, r.engineer?.full_name,
      r.expense_categories?.name_ar, r.expense_categories?.gl_code, r.subtotal, r.vat, r.total, STATUS[r.status], r.source].map(q).join(","));
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${$("#fMonth").value || "all"}.csv`;
    a.click();
  });
  await load();
}

// ---------------- Staff: custody ----------------
async function renderCustody() {
  const [bal, engineers, recent] = await Promise.all([
    must(sb.from("v_custody_balance").select("*").order("full_name")),
    must(sb.from("profiles").select("id, full_name").eq("role", "engineer").eq("active", true).order("full_name")),
    must(sb.from("custodies").select("created_at, kind, amount, note, engineer:profiles!custodies_engineer_id_fkey(full_name), projects(code)").order("created_at", { ascending: false }).limit(30)),
  ]);
  const avail = await Promise.all(bal.map((b) => must(sb.rpc("available_custody", { p_engineer: b.engineer_id }))));
  view.innerHTML = `
    <h1>العُهد</h1>
    <div class="grid g2">
      <div class="card scroll"><table class="stack"><thead><tr><th>المهندس</th><th class="num">المستلم</th><th class="num">المعتمد</th><th class="num">تحت المراجعة</th><th class="num">المتاح</th></tr></thead><tbody>
        ${bal.map((b, i) => `<tr><td>${esc(b.full_name)}</td><td class="num">${money(b.received)}</td><td class="num">${money(b.spent)}</td><td class="num">${money(b.pending_review)}</td>
        <td class="num" style="color:${avail[i] !== null && avail[i] < 0 ? "var(--bad)" : "inherit"}">${avail[i] === null ? "—" : money(avail[i])}</td></tr>`).join("") || '<tr><td colspan="5" class="mute">مفيش مهندسين لسه</td></tr>'}
      </tbody></table></div>
      <form class="card" id="cForm">
        <h3>حركة عهدة جديدة</h3>
        <label for="cEng">المهندس</label><select id="cEng" required>${engineers.map((e) => `<option value="${esc(e.id)}">${esc(e.full_name)}</option>`).join("")}</select>
        <label for="cKind">النوع</label><select id="cKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <label for="cAmt">المبلغ (ر.س)</label><input id="cAmt" type="number" step="0.01" required dir="ltr">
        <p class="mute" id="cHint">رد النقدية بيتسجل بالسالب أوتوماتيك. التسوية تقبل موجب أو سالب.</p>
        <label for="cProj">المشروع (اختياري)</label><select id="cProj"><option value="">عامة</option>${projectOptions(null, projects)}</select>
        <label for="cNote">ملاحظة</label><input id="cNote">
        <p></p><button class="btn primary" type="submit">تسجيل</button>
      </form>
    </div>
    <h3 style="margin-top:24px">آخر الحركات</h3>
    <div class="card scroll"><table class="stack"><thead><tr><th>التاريخ</th><th>المهندس</th><th>النوع</th><th>المشروع</th><th class="num">المبلغ</th><th>ملاحظة</th></tr></thead><tbody>
      ${recent.map((c) => `<tr><td>${day(c.created_at)}</td><td>${esc(c.engineer?.full_name)}</td><td>${esc(KINDS[c.kind])}</td><td>${esc(c.projects?.code || "عامة")}</td><td class="num">${money(c.amount)}</td><td>${esc(c.note || "")}</td></tr>`).join("") || '<tr><td colspan="6" class="mute">مفيش حركات</td></tr>'}
    </tbody></table></div>`;
  $("#cForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const kind = $("#cKind").value;
    let amount = Number($("#cAmt").value);
    if (!amount) return toast("اكتب المبلغ");
    if (kind === "return") amount = -Math.abs(amount);
    if (kind === "issue" || kind === "reimburse") amount = Math.abs(amount);
    try {
      await must(sb.from("custodies").insert({ engineer_id: $("#cEng").value, kind, amount, project_id: $("#cProj").value || null, note: $("#cNote").value.trim() || null }));
      toast("اتسجلت");
      renderCustody();
    } catch (e) { fail(e); }
  });
}

// ---------------- Staff: spend by project ----------------
async function renderSpend() {
  const rows = await must(sb.from("v_project_spend").select("*").order("month", { ascending: false }));
  const months = [...new Set(rows.map((r) => r.month))];
  const sel = sessionStorage.getItem("spendMonth") ?? (months[0] || "");
  const shown = sel ? rows.filter((r) => r.month === sel) : rows;
  const byProj = {};
  shown.forEach((r) => {
    const p = (byProj[r.project_code] ??= { name: r.project_name, total: 0, vat: 0, n: 0, cats: [] });
    p.total += Number(r.total); p.vat += Number(r.vat || 0); p.n += r.invoices; p.cats.push(r);
  });
  const list = Object.entries(byProj).sort((a, b) => b[1].total - a[1].total);
  const max = Math.max(1, ...list.map(([, p]) => p.total));
  const grand = list.reduce((a, [, p]) => a + p.total, 0);
  view.innerHTML = `
    <div class="row"><h1 class="sp">المصروفات حسب المشروع</h1>
      <select id="sMonth" style="width:auto"><option value="">كل الشهور</option>${months.map((m) => `<option value="${esc(m)}" ${m === sel ? "selected" : ""}>${esc(m.slice(0, 7))}</option>`).join("")}</select></div>
    <div class="kpis"><div class="card kpi"><div class="n">${money(grand)}</div><div class="l">إجمالي المعتمد</div></div>
      <div class="card kpi"><div class="n">${money(list.reduce((a, [, p]) => a + p.vat, 0))}</div><div class="l">ضريبة المدخلات</div></div>
      <div class="card kpi"><div class="n">${list.reduce((a, [, p]) => a + p.n, 0)}</div><div class="l">فاتورة معتمدة</div></div></div>
    <div class="card">${list.length ? list.map(([code, p]) => `
      <div style="margin-bottom:18px"><div class="row"><b>${esc(code)}</b><span class="mute">${esc(p.name)}</span><span class="sp"></span><b class="num">${money(p.total)}</b></div>
        <div style="height:10px;border-radius:5px;background:var(--chip);margin:6px 0"><div style="height:100%;width:${(p.total / max) * 100}%;background:var(--acc);border-radius:5px"></div></div>
        <div class="mute">${p.cats.map((c) => `${esc(c.category_name || "بدون بند")}: ${money(c.total)}`).join(" · ")}</div></div>`).join("") : '<p class="mute">مفيش مصروفات معتمدة لسه.</p>'}</div>`;
  $("#sMonth").addEventListener("change", (e) => { sessionStorage.setItem("spendMonth", e.target.value); renderSpend().catch(fail); });
}

// ---------------- Admin: settings ----------------
async function renderSettings() {
  const [users, members] = await Promise.all([
    must(sb.from("profiles").select("id, full_name, phone, role, active").order("full_name")),
    must(sb.from("project_members").select("project_id, user_id")),
  ]);
  projects = await must(sb.from("projects").select("id, code, name, status").order("code"));
  const engineers = users.filter((u) => u.role === "engineer");
  const nameOf = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
  view.innerHTML = `
    <h1>الإعدادات</h1>
    <div class="grid g2">
      <form class="card" id="uForm">
        <h3>مستخدم جديد</h3>
        <label for="uName">الاسم</label><input id="uName" required>
        <label for="uEmail">الإيميل</label><input id="uEmail" type="email" required dir="ltr">
        <label for="uPhone">الموبايل (للواتساب بعدين)</label><input id="uPhone" dir="ltr" placeholder="+9665XXXXXXXX">
        <label for="uRole">الدور</label><select id="uRole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <label for="uPass">كلمة مرور مؤقتة</label><input id="uPass" required minlength="8" dir="ltr">
        <p class="mute">ابعتها للموظف، ويقدر يغيّرها من "حسابي".</p>
        <button class="btn primary" type="submit">إنشاء</button>
      </form>
      <div class="card">
        <h3>المشاريع</h3>
        <form class="row" id="pForm"><input id="pCode" placeholder="الكود (P12)" required style="width:110px" dir="ltr"><input id="pName" placeholder="اسم المشروع" required class="sp"><button class="btn primary" type="submit">إضافة</button></form>
        <div class="scroll" style="margin-top:12px"><table><tbody>
        ${projects.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${esc(p.name)}</td>
          <td><select data-pstatus="${esc(p.id)}" style="min-height:36px">${["active", "on_hold", "closed"].map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${{ active: "شغال", on_hold: "متوقف", closed: "مقفول" }[s]}</option>`).join("")}</select></td>
          <td class="mute">${members.filter((m) => m.project_id === p.id).map((m) => `${esc(nameOf[m.user_id] || "?")} <button class="btn sm" data-unassign="${esc(p.id)}|${esc(m.user_id)}" aria-label="شيل">×</button>`).join(" ") || "مفيش مهندسين"}</td></tr>`).join("")}
        </tbody></table></div>
        <form class="row" id="mForm" style="margin-top:12px">
          <select id="mProj" class="sp">${projectOptions(null, projects)}</select>
          <select id="mUser" class="sp">${engineers.map((u) => `<option value="${esc(u.id)}">${esc(u.full_name)}</option>`).join("")}</select>
          <button class="btn" type="submit">تعيين على المشروع</button>
        </form>
      </div>
    </div>
    <h3 style="margin-top:24px">المستخدمين</h3>
    <div class="card scroll"><table class="stack"><thead><tr><th>الاسم</th><th>الموبايل</th><th>الدور</th><th>مفعّل</th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.full_name)}</td><td dir="ltr">${esc(u.phone || "—")}</td>
        <td><select data-role="${esc(u.id)}" style="min-height:36px" ${u.id === me.id ? "disabled" : ""}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><input type="checkbox" data-active="${esc(u.id)}" ${u.active ? "checked" : ""} ${u.id === me.id ? "disabled" : ""} style="width:22px;min-height:22px"></td></tr>`).join("")}
    </tbody></table></div>
    <h3 style="margin-top:24px">البنود وأكواد الحسابات (GL)</h3>
    <div class="card scroll"><table><thead><tr><th>البند</th><th>كود GL</th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td>${esc(c.name_ar)}</td><td><input data-gl="${esc(c.id)}" value="${esc(c.gl_code || "")}" placeholder="مثلاً 5110" dir="ltr" style="max-width:160px;min-height:36px"></td></tr>`).join("")}
    </tbody></table></div>`;

  const act = (sel, ev, fn) => $$(sel).forEach((el) => el.addEventListener(ev, async (e) => { try { await fn(el, e); } catch (err) { fail(err); } }));
  act("#uForm", "submit", async (_, e) => {
    e.preventDefault();
    await invoke("admin-users", { action: "create", full_name: $("#uName").value.trim(), email: $("#uEmail").value.trim(),
      phone: $("#uPhone").value.trim() || null, role: $("#uRole").value, password: $("#uPass").value });
    toast("اتعمل الحساب ✓");
    renderSettings();
  });
  act("#pForm", "submit", async (_, e) => {
    e.preventDefault();
    await must(sb.from("projects").insert({ code: $("#pCode").value.trim().toUpperCase(), name: $("#pName").value.trim() }));
    toast("اتضاف المشروع");
    renderSettings();
  });
  act("#mForm", "submit", async (_, e) => {
    e.preventDefault();
    if (!$("#mProj").value || !$("#mUser").value) return toast("اختار مشروع ومهندس");
    await must(sb.from("project_members").insert({ project_id: $("#mProj").value, user_id: $("#mUser").value }));
    toast("اتعيّن");
    renderSettings();
  });
  act("[data-unassign]", "click", async (el) => {
    const [p, u] = el.dataset.unassign.split("|");
    await must(sb.from("project_members").delete().eq("project_id", p).eq("user_id", u));
    renderSettings();
  });
  act("[data-pstatus]", "change", async (el) => { await must(sb.from("projects").update({ status: el.value }).eq("id", el.dataset.pstatus)); toast("اتحفظ"); });
  act("[data-role]", "change", async (el) => { await must(sb.from("profiles").update({ role: el.value }).eq("id", el.dataset.role)); toast("اتحفظ"); });
  act("[data-active]", "change", async (el) => { await must(sb.from("profiles").update({ active: el.checked }).eq("id", el.dataset.active)); toast("اتحفظ"); });
  act("[data-gl]", "change", async (el) => {
    await must(sb.from("expense_categories").update({ gl_code: el.value.trim() || null }).eq("id", el.dataset.gl));
    cats = await must(sb.from("expense_categories").select("id, code, name_ar, gl_code, active, sort_order").order("sort_order"));
    toast("اتحفظ");
  });
}

// ---------------- Account ----------------
async function renderAccount() {
  view.innerHTML = `
    <h1>حسابي</h1>
    <form class="card" id="pwForm" style="max-width:420px">
      <p><b>${esc(me.full_name)}</b><br><span class="mute" dir="ltr">${esc(me.email)}</span><br><span class="mute">${ROLES[me.role]}</span></p>
      <label for="pw1">كلمة مرور جديدة</label><input id="pw1" type="password" minlength="8" required dir="ltr" autocomplete="new-password">
      <p></p><button class="btn primary" type="submit">تغيير كلمة المرور</button>
    </form>`;
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#pw1").value });
    if (error) return fail(error);
    toast("اتغيرت ✓");
    $("#pw1").value = "";
  });
}

// Show the login form if there is no session after load.
sb.auth.getSession().then(({ data }) => {
  if (!data.session) {
    $("#login").classList.remove("hide");
  }
});
}
