// Site Expenses — web app (static, talks to Supabase directly; RLS decides what each user sees).
{
const SB_URL = "https://hmqceajdhnvkzceifewb.supabase.co";
const SB_KEY = "sb_publishable_nKl4FjaxFzCG4WH89Y0i5g_k-EfUWQZ"; // publishable: safe in the browser, RLS protects data
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const short = (n) => {
  const v = Number(n || 0);
  return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + "K" : money(v);
};
const day = (d) => (d ? String(d).slice(0, 10) : "—");
const view = $("#view");

// ---------- icons (stroke, 24px grid) ----------
const P = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l1 8v6H4v-6z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z"/><path d="M4 7V5h12v2"/><circle cx="16" cy="13.5" r="1.3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  down: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-4M17 21v-2"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
};
const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

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
const AV_COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0f766e", "#4f46e5"];

let me = null;
let cats = [];
let projects = [];
let current = "";
let queueCount = 0;

const pill = (st) => `<span class="pill st-${esc(st)}"><i></i>${esc(STATUS[st] ?? st)}</span>`;
const flagChips = (flags) => (flags || []).map((f) => `<span class="flag ${HARD.has(f) ? "hard" : ""}">${esc(FLAGS[f] ?? f)}</span>`).join("");
const initials = (name) => esc((String(name || "?").trim().split(/\s+/).filter((w) => !/^م\.?$/.test(w))[0] || "?").charAt(0));
const avatar = (name, sm = true) => {
  const n = String(name || "?");
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="av ${sm ? "sm" : ""}" style="background:${AV_COLORS[h % AV_COLORS.length]}">${initials(n)}</span>`;
};
const kpi = (icon, tone, value, label, sub = "") =>
  `<div class="card kpi"><span class="ic t-${tone}">${ic(icon, 22)}</span><div><div class="n">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div></div>`;
const empty = (icon, text) => `<div class="empty"><div class="ic">${ic(icon, 26)}</div>${text}</div>`;

function head(title, sub = "", actions = "") {
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;
  $("#pageActs").innerHTML = actions;
}

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
    try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
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
  $("#toggleSetup").textContent = setupMode ? "رجوع لتسجيل الدخول" : "أول تشغيل؟";
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

[$("#logout"), $("#logout2")].forEach((b) => b.addEventListener("click", () => sb.auth.signOut()));

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
    $("#meAv").outerHTML = avatar(me.full_name || me.email, false).replace('class="av ', 'id="meAv" class="av ');
    $("#meName").textContent = me.full_name || me.email;
    $("#meRole").textContent = ROLES[me.role];
    $("#login").classList.add("hide");
    $("#shell").classList.remove("hide");
    if (isStaff()) refreshBadge();
    buildNav();
  } catch (e) {
    fail(e);
  }
}
const isStaff = () => me && (me.role === "accountant" || me.role === "admin");

async function refreshBadge() {
  try {
    const { count } = await sb.from("expenses").select("id", { count: "exact", head: true }).in("status", ["submitted", "auto_ok", "needs_review"]);
    queueCount = count || 0;
    $$("[data-badge=review]").forEach((b) => { b.textContent = queueCount; b.classList.toggle("hide", !queueCount); });
  } catch { /* badge is optional */ }
}

// ---------------- Navigation ----------------
const TABS = {
  engineer: [["new", "فاتورة جديدة", "camera"], ["mine", "فواتيري", "receipt"], ["account", "حسابي", "user"]],
  accountant: [["review", "المراجعة", "inbox"], ["all", "كل الفواتير", "list"], ["custody", "العُهد", "wallet"], ["spend", "التقارير", "chart"], ["account", "حسابي", "user"]],
  admin: [["review", "المراجعة", "inbox"], ["all", "كل الفواتير", "list"], ["custody", "العُهد", "wallet"], ["spend", "التقارير", "chart"], ["settings", "الإعدادات", "gear"], ["account", "حسابي", "user"]],
};

function buildNav() {
  const list = TABS[me.role];
  const item = ([id, t, icon]) => `<button data-tab="${id}">${ic(icon)}<span>${t}</span>${id === "review" ? `<span class="badge ${queueCount ? "" : "hide"}" data-badge="review">${queueCount}</span>` : ""}</button>`;
  $("#nav").innerHTML = list.map(item).join("");
  $("#bottom").innerHTML = list.map(item).join("");
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    if (location.hash === "#" + b.dataset.tab) route();
    else location.hash = b.dataset.tab;
  }));
  route();
}

window.addEventListener("hashchange", () => me && route());

function route() {
  const list = TABS[me.role].map(([id]) => id);
  const h = location.hash.slice(1);
  const tab = list.includes(h) ? h : list[0];
  current = tab;
  $$("[data-tab]").forEach((b) => (b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  head(TABS[me.role].find(([id]) => id === tab)[1]);
  view.innerHTML = '<p class="mute">بيحمّل…</p>';
  ({ new: renderNew, mine: renderMine, review: renderReview, all: renderAll, custody: renderCustody, spend: renderSpend, settings: renderSettings, account: renderAccount })[tab]().catch(fail);
}

const projectOptions = (sel, list = projects.filter((p) => p.status === "active")) =>
  list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.code)} — ${esc(p.name)}</option>`).join("");
const catOptions = (sel) => cats.filter((c) => c.active).map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? "selected" : ""}>${esc(c.name_ar)}</option>`).join("");
const catIdOptions = (sel) => cats.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.name_ar)}</option>`).join("");

// ---------------- Engineer: new invoice ----------------
let draft = null;

async function prepareImage(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { blob: file, preview: null, qr: null, mime: file.type || "image/jpeg" };
  }
  let qr = null;
  for (const [w, top] of [[1400, 0], [900, 0], [1400, 0.4], [1400, 0.55]]) {
    const scale = Math.min(1, w / bmp.width);
    const sy = Math.floor(bmp.height * top);
    const sh = bmp.height - sy;
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

const shootEmpty = (t = "صوّر الفاتورة") => `<span class="big">${ic("camera", 42).replace('stroke="currentColor"', 'stroke="#fff"')}</span><b>${t}</b><span class="mute">خلّي الـ QR واضح لو موجود · أو اختار صورة من المعرض</span>`;

async function renderNew() {
  head("فاتورة جديدة", "صوّرها وابعتها وانت في الموقع — بتاخد أقل من دقيقة");
  const mine = projects.filter((p) => p.status === "active");
  view.innerHTML = `
    <div class="steps" id="steps"><span class="on"><b>1</b>صوّر</span><span><b>2</b>اختار المشروع</span><span><b>3</b>ابعت</span></div>
    <div class="grid g2">
      <section>
        <label class="shoot" for="photo" id="shoot" style="margin:0">${shootEmpty()}</label>
        <input id="photo" type="file" accept="image/*" capture="environment" class="hide">
        <div id="qrState"></div>
      </section>
      <section class="card">
        <h3>${ic("folder", 18)} تفاصيل المشترى</h3>
        <label for="proj">المشروع</label>
        <select id="proj">${mine.length ? projectOptions(localStorage.getItem("lastProject"), mine) : '<option value="">مفيش مشاريع متعيّن عليها</option>'}</select>
        <label for="cat">البند</label>
        <select id="cat"><option value="">— اختار —</option>${catOptions(localStorage.getItem("lastCat"))}</select>
        <label for="note">ملاحظة (اختياري)</label>
        <textarea id="note" placeholder="مثلاً: حديد للسقف الدور التاني"></textarea>
        <button class="btn primary block" id="send" disabled style="margin-top:18px">${ic("check", 18)} إرسال الفاتورة</button>
        <div id="result" style="margin-top:16px"></div>
      </section>
    </div>`;
  if (draft?.blob) showDraft();
  $("#photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $("#qrState").innerHTML = '<div class="qr t-mute">بيجهّز الصورة…</div>';
    try {
      draft = { clientRef: crypto.randomUUID(), ...(await prepareImage(f)) };
      showDraft();
    } catch (err) { fail(err); }
  });
  $("#send").addEventListener("click", sendDraft);
}

function showDraft() {
  $("#shoot").innerHTML = draft.preview ? `<img src="${draft.preview}" alt="صورة الفاتورة"><span class="mute">اضغط لتغيير الصورة</span>` : "<b>الصورة جاهزة</b>";
  $("#qrState").innerHTML = draft.qr
    ? `<div class="qr t-ok">${ic("qr", 18)} اتقرا الـ QR — الأرقام هتطلع مظبوطة</div>`
    : `<div class="qr t-warn">${ic("alert", 18)} مفيش QR مقروء — المحاسب هيراجع الأرقام</div>`;
  $$("#steps span").forEach((s, i) => s.classList.toggle("on", i <= 1));
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
    $("#result").innerHTML = `<div class="slip"><div class="row">${pill(x.status)}<span class="sp"></span><span class="amt">${money(x.total)}</span></div>
      <div>${esc(x.vendor_name || "مورد غير معروف")} · ${day(x.invoice_date)}</div><div>${flagChips(x.flags)}</div></div>`;
    $$("#steps span").forEach((s) => s.classList.add("on"));
    toast(x.status === "auto_ok" ? "اتسجلت ✓" : "اتسجلت — هتتراجع من المحاسب");
    draft = null;
    $("#note").value = "";
    $("#photo").value = "";
    $("#shoot").innerHTML = shootEmpty("صوّر فاتورة تانية");
    $("#qrState").innerHTML = "";
    btn.innerHTML = `${ic("check", 18)} إرسال الفاتورة`;
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
  head("فواتيري", `${rows.length} فاتورة`, `<a class="btn primary" href="#new">${ic("camera", 18)} فاتورة جديدة</a>`);
  const rejected = rows.filter((r) => r.status === "rejected").length;
  view.innerHTML = `
    <div class="kpis">
      ${kpi("wallet", avail !== null && avail < 0 ? "bad" : "pri", avail === null ? "—" : money(avail), "المتاح معاك", "من العهدة بعد المصروف")}
      ${kpi("cash", "mute", money(bal?.received ?? 0), "العهدة المستلمة")}
      ${kpi("check", "ok", money(bal?.spent ?? 0), "المعتمد")}
      ${kpi("clock", "warn", money(bal?.pending_review ?? 0), "تحت المراجعة", rejected ? `${rejected} مرفوضة محتاجة تتعاد` : "")}
    </div>
    <div class="seg" id="mineSeg" style="margin-bottom:14px">
      <button aria-pressed="true" data-f="">الكل</button><button aria-pressed="false" data-f="open">مفتوحة</button>
      <button aria-pressed="false" data-f="rejected">مرفوضة</button><button aria-pressed="false" data-f="done">معتمدة</button>
    </div>
    <div class="slips" id="slips"></div>`;
  const draw = (f) => {
    const keep = (r) => !f || (f === "open" && ["submitted", "auto_ok", "needs_review"].includes(r.status)) || (f === "rejected" && r.status === "rejected") || (f === "done" && ["approved", "settled"].includes(r.status));
    const list = rows.filter(keep);
    $("#slips").innerHTML = list.length ? list.map((x) => `
      <div class="slip">
        <div class="row">${pill(x.status)}<span class="sp"></span><span class="amt">${money(x.total)}</span></div>
        <div><b>${esc(x.vendor_name || "مورد غير معروف")}</b></div>
        <div class="meta">${day(x.invoice_date || x.created_at)} · ${esc(x.projects?.code || "بدون مشروع")} · ${esc(x.expense_categories?.name_ar || "بدون بند")}${x.note ? " · " + esc(x.note) : ""}</div>
        ${x.flags?.length ? `<div>${flagChips(x.flags)}</div>` : ""}
        ${x.status === "rejected" ? `<div class="qr t-bad" style="margin:0">${ic("x", 16)} ${esc(x.reject_reason)}</div>` : ""}
        <div class="row">${x.status === "rejected" ? `<button class="btn sm primary" data-resubmit="${esc(x.id)}">إعادة تقديم</button>` : ""}
          <button class="btn sm" data-img="${esc(x.image_path)}">${ic("receipt", 16)} الصورة</button></div>
        <div class="imgbox"></div>
      </div>`).join("") : `<div class="card" style="grid-column:1/-1">${empty("receipt", "مفيش فواتير هنا.")}</div>`;
    bindImageButtons();
    $$("[data-resubmit]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await must(sb.from("expenses").update({ status: "needs_review" }).eq("id", b.dataset.resubmit));
        toast("اتبعتت للمراجعة تاني");
        renderMine().catch(fail);
      } catch (e) { fail(e); }
    }));
  };
  $$("#mineSeg button").forEach((b) => b.addEventListener("click", () => {
    $$("#mineSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw(b.dataset.f);
  }));
  draw("");
}

function bindImageButtons() {
  $$("[data-img]").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest(".slip").querySelector(".imgbox");
    if (box.innerHTML) { box.innerHTML = ""; return; }
    try {
      const { signedUrl } = await must(sb.storage.from("receipts").createSignedUrl(b.dataset.img, 3600));
      box.innerHTML = `<img src="${esc(signedUrl)}" alt="صورة الفاتورة" style="width:100%;border-radius:12px">`;
    } catch (e) { fail(e); }
  }));
}

// ---------------- Staff: review queue ----------------
async function renderReview() {
  const rows = await must(sb.from("v_review_queue").select("*"));
  const ready = rows.filter((r) => r.status === "auto_ok");
  const review = rows.filter((r) => r.status !== "auto_ok");
  const oldest = rows.length ? Math.max(...rows.map((r) => r.age_days)) : 0;
  const sum = (l) => l.reduce((a, r) => a + Number(r.total || 0), 0);
  queueCount = rows.length;
  $$("[data-badge=review]").forEach((b) => { b.textContent = queueCount; b.classList.toggle("hide", !queueCount); });
  head("المراجعة", rows.length ? `${rows.length} فاتورة مستنية قرار` : "مفيش حاجة مستنية",
    `<button class="btn good" id="approveAll" ${ready.length ? "" : "disabled"}>${ic("check", 18)} اعتماد الجاهزة (${ready.length})</button>`);
  view.innerHTML = `
    <div class="kpis">
      ${kpi("alert", "warn", review.length, "محتاجة مراجعة", money(sum(review)) + " ر.س")}
      ${kpi("qr", "pri", ready.length, "جاهزة — QR سليم", money(sum(ready)) + " ر.س")}
      ${kpi("clock", oldest > 3 ? "bad" : "mute", oldest + " يوم", "أقدم فاتورة مستنية")}
    </div>
    <div class="seg" id="revSeg" style="margin-bottom:14px">
      <button aria-pressed="true" data-f="">الكل (${rows.length})</button><button aria-pressed="false" data-f="needs">محتاجة مراجعة (${review.length})</button><button aria-pressed="false" data-f="ready">جاهزة (${ready.length})</button>
    </div>
    <div class="card scroll" id="revTable"></div>`;
  const draw = (f) => {
    const list = f === "needs" ? review : f === "ready" ? ready : rows;
    $("#revTable").innerHTML = queueTable(list);
    bindRows();
  };
  $$("#revSeg button").forEach((b) => b.addEventListener("click", () => {
    $$("#revSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw(b.dataset.f);
  }));
  draw("");
  $("#approveAll").addEventListener("click", async () => {
    try {
      await must(sb.from("expenses").update({ status: "approved" }).eq("status", "auto_ok"));
      toast(`اتعتمد ${ready.length} فاتورة`);
      renderReview().catch(fail);
    } catch (e) { fail(e); }
  });
}

function queueTable(rows) {
  if (!rows.length) return empty("check", "كله تمام — مفيش فواتير مستنية.");
  return `<table class="stack"><thead><tr><th>المهندس</th><th>المشروع</th><th>المورد</th><th>التاريخ</th><th class="num">الإجمالي</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-open="${esc(r.id)}"><td><span class="who">${avatar(r.engineer_name)}${esc(r.engineer_name)}</span></td><td>${esc(r.project_code || "—")}</td>
      <td>${esc(r.vendor_name || "—")}</td><td>${day(r.invoice_date || r.created_at)}</td><td class="num"><b>${money(r.total)}</b></td><td>${pill(r.status)}</td><td>${flagChips(r.flags)}</td></tr>`).join("")}
    </tbody></table>`;
}

function bindRows() {
  $$("[data-open]").forEach((tr) => tr.addEventListener("click", () => openDetail(tr.dataset.open).catch(fail)));
}

// ---------------- Staff: expense detail ----------------
async function openDetail(id) {
  const x = await must(sb.from("expenses").select("*, engineer:profiles!expenses_engineer_id_fkey(full_name)").eq("id", id).single());
  const [events, signed] = await Promise.all([
    must(sb.from("expense_events").select("action, created_at, actor_id").eq("expense_id", id).order("created_at", { ascending: false }).limit(20)),
    sb.storage.from("receipts").createSignedUrl(x.image_path, 3600),
  ]);
  const editable = ["submitted", "auto_ok", "needs_review", "rejected"].includes(x.status);
  const dis = editable ? "" : "disabled";
  const f = (k, label, type = "text", extra = "") => `<div><label for="d-${k}">${label}</label><input id="d-${k}" type="${type}" value="${esc(x[k] ?? "")}" ${dis} ${extra}></div>`;
  head(x.vendor_name || "فاتورة بدون مورد", `${x.engineer?.full_name ?? ""} · اترفعت ${day(x.created_at)} · المصدر: ${{ qr: "QR", ocr: "قراءة آلية", manual: "إدخال يدوي" }[x.source] || "—"}`,
    `<button class="btn" id="back">${ic("back", 18)} رجوع</button>`);
  view.innerHTML = `
    <div class="row" style="margin-bottom:14px">${pill(x.status)}<span class="sp"></span><span style="font-size:26px;font-weight:700">${money(x.total)} <span class="mute">ر.س</span></span></div>
    ${x.flags?.length ? `<div style="margin-bottom:12px">${flagChips(x.flags)}</div>` : ""}
    ${x.processing_error ? `<div class="qr t-bad" style="margin-bottom:12px">${ic("alert", 18)} خطأ معالجة: ${esc(x.processing_error)}</div>` : ""}
    <div class="detail">
      <div class="card imgcard">${signed.data?.signedUrl ? `<a href="${esc(signed.data.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(signed.data.signedUrl)}" alt="صورة الفاتورة"></a><p class="mute" style="margin:8px 0 0">اضغط على الصورة لتكبيرها</p>` : empty("receipt", "الصورة مش متاحة")}</div>
      <div class="grid">
        <div class="card">
          <h3>${ic("receipt", 18)} بيانات الفاتورة</h3>
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
          ${x.reject_reason ? `<div class="qr t-bad">${ic("x", 16)} سبب الرفض: ${esc(x.reject_reason)}</div>` : ""}
          <div class="row" style="margin-top:16px" id="actions"></div>
          <div id="rejectBox" class="hide" style="margin-top:12px">
            <label for="rej">سبب الرفض</label>
            <select id="rej">${REJECT_REASONS.map((r) => `<option>${r}</option>`).join("")}<option value="">سبب تاني…</option></select>
            <input id="rejOther" class="hide" placeholder="اكتب السبب" style="margin-top:8px">
            <div class="row" style="margin-top:10px"><button class="btn bad" id="rejGo">تأكيد الرفض</button></div>
          </div>
        </div>
        <div class="card"><h3>${ic("clock", 18)} السجل</h3>
          <ul class="timeline">${events.map((e) => `<li>${esc(eventLabel(e.action))}<div class="mute">${esc(new Date(e.created_at).toLocaleString("en-GB"))}</div></li>`).join("")}</ul></div>
      </div>
    </div>`;

  $("#back").addEventListener("click", () => route());
  const acts = $("#actions");
  const btn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = "btn " + cls;
    b.innerHTML = label;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(b); } catch (e) { fail(e); b.disabled = false; }
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
  const done = (msg) => { toast(msg); refreshBadge(); openDetail(id).catch(fail); };

  if (editable) {
    btn(`${ic("check", 18)} اعتماد`, "good", async () => {
      const v = collect();
      if (v.total === null) throw new Error("لازم الإجمالي قبل الاعتماد");
      if (x.status === "rejected" || x.status === "submitted") await must(sb.from("expenses").update({ ...v, status: "needs_review" }).eq("id", id));
      await must(sb.from("expenses").update({ ...v, status: "approved" }).eq("id", id));
      done("اتعتمدت ✓");
    });
    btn("حفظ وإعادة الفحص", "", async () => {
      await must(sb.from("expenses").update(collect()).eq("id", id));
      if (["submitted", "auto_ok", "needs_review"].includes(x.status)) await invoke("ingest", { action: "reprocess", expense_id: id });
      done("اتحفظت");
    });
    if (x.status !== "rejected") btn(`${ic("x", 18)} رفض`, "bad", async (b) => { $("#rejectBox").classList.remove("hide"); b.disabled = false; });
    if ((x.flags || []).some((fl) => fl === "duplicate" || fl === "possible_duplicate")) {
      btn("مش مكررة", "sm", async () => {
        await must(sb.from("expenses").update({ flags: x.flags.filter((fl) => fl !== "duplicate" && fl !== "possible_duplicate") }).eq("id", id));
        done("اتشالت علامة التكرار");
      });
    }
  }
  if (x.status === "approved") {
    btn(`${ic("wallet", 18)} تسوية (اتخصمت من العهدة)`, "primary", async () => {
      await must(sb.from("expenses").update({ status: "settled" }).eq("id", id));
      done("اتسوّت");
    });
    if (me.role === "admin") btn("إعادة فتح", "", async () => {
      await must(sb.from("expenses").update({ status: "needs_review" }).eq("id", id));
      done("اتفتحت تاني");
    });
  }
  $("#rej").addEventListener("change", () => $("#rejOther").classList.toggle("hide", $("#rej").value !== ""));
  $("#rejGo").addEventListener("click", async () => {
    const reason = $("#rej").value || $("#rejOther").value.trim();
    if (!reason) return toast("اكتب سبب الرفض");
    try {
      await must(sb.from("expenses").update({ status: "rejected", reject_reason: reason, review_note: $("#d-review_note").value.trim() || null }).eq("id", id));
      done("اترفضت");
    } catch (e) { fail(e); }
  });
  window.scrollTo({ top: 0 });
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
  head("كل الفواتير", "دوّر وفلتر وصدّر لـ Excel", `<button class="btn" id="csv">${ic("down", 18)} تصدير Excel</button>`);
  view.innerHTML = `
    <div class="card filters">
      <div><label for="fMonth">الشهر</label><input id="fMonth" type="month" value="${esc(ym)}"></div>
      <div><label for="fStatus">الحالة</label><select id="fStatus"><option value="">الكل</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="fProj">المشروع</label><select id="fProj"><option value="">الكل</option>${projectOptions(null, projects)}</select></div>
      <div><label for="fQ">بحث</label><input id="fQ" placeholder="مورد أو مهندس"></div>
    </div>
    <div id="allBody"><p class="mute">بيحمّل…</p></div>`;
  let rows = [];
  const drawTable = () => {
    const q = $("#fQ").value.trim();
    const list = q ? rows.filter((r) => (r.vendor_name || "").includes(q) || (r.engineer?.full_name || "").includes(q)) : rows;
    const ok = list.filter((r) => ["approved", "settled"].includes(r.status));
    const sum = (k) => ok.reduce((a, r) => a + Number(r[k] || 0), 0);
    $("#allBody").innerHTML = `
      <div class="kpis">
        ${kpi("receipt", "pri", list.length, "فاتورة")}
        ${kpi("check", "ok", money(sum("total")), "المعتمد (شامل الضريبة)")}
        ${kpi("cash", "mute", money(sum("vat")), "ضريبة المدخلات")}
      </div>
      <div class="card scroll">${list.length ? `<table class="stack"><thead><tr><th>التاريخ</th><th>المهندس</th><th>المشروع</th><th>البند</th><th>المورد</th><th class="num">الإجمالي</th><th>الحالة</th></tr></thead><tbody>
      ${list.map((r) => `<tr class="click" data-open="${esc(r.id)}"><td>${day(r.invoice_date || r.created_at)}</td><td><span class="who">${avatar(r.engineer?.full_name)}${esc(r.engineer?.full_name)}</span></td>
        <td>${esc(r.projects?.code || "—")}</td><td>${esc(r.expense_categories?.name_ar || "—")}</td><td>${esc(r.vendor_name || "—")}</td><td class="num"><b>${money(r.total)}</b></td><td>${pill(r.status)}</td></tr>`).join("")}
      </tbody></table>` : empty("list", "مفيش فواتير بالفلاتر دي.")}</div>`;
    bindRows();
  };
  const load = async () => {
    const m = $("#fMonth").value;
    sessionStorage.setItem("allMonth", m);
    let q = sb.from("expenses").select("id, created_at, status, flags, invoice_no, invoice_date, vendor_name, vendor_vat, subtotal, vat, total, source, image_path, engineer:profiles!expenses_engineer_id_fkey(full_name), projects(code), expense_categories(name_ar, gl_code)")
      .order("created_at", { ascending: false }).limit(1000);
    if (m) {
      const [y, mo] = m.split("-").map(Number);
      q = q.gte("created_at", `${m}-01`).lt("created_at", new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10));
    }
    if ($("#fStatus").value) q = q.eq("status", $("#fStatus").value);
    if ($("#fProj").value) q = q.eq("project_id", $("#fProj").value);
    rows = await must(q);
    drawTable();
  };
  ["fMonth", "fStatus", "fProj"].forEach((i) => $("#" + i).addEventListener("change", () => load().catch(fail)));
  $("#fQ").addEventListener("input", drawTable);
  $("#csv").addEventListener("click", () => {
    const cols = ["التاريخ", "رقم الفاتورة", "المورد", "الرقم الضريبي", "المشروع", "المهندس", "البند", "GL", "قبل الضريبة", "الضريبة", "الإجمالي", "الحالة", "المصدر"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [day(r.invoice_date || r.created_at), r.invoice_no, r.vendor_name, r.vendor_vat, r.projects?.code, r.engineer?.full_name,
      r.expense_categories?.name_ar, r.expense_categories?.gl_code, r.subtotal, r.vat, r.total, STATUS[r.status], r.source].map(q).join(","));
    const blob = new Blob(["﻿" + [cols.map(q).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
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
  const tot = (k) => bal.reduce((a, b) => a + Number(b[k] || 0), 0);
  const negative = avail.filter((v) => v !== null && v < 0).length;
  head("العُهد", "مين معاه كام من فلوس الشركة دلوقتي");
  view.innerHTML = `
    <div class="kpis">
      ${kpi("cash", "pri", money(tot("received")), "إجمالي العُهد المصروفة")}
      ${kpi("check", "ok", money(tot("spent")), "اتصرف ومعتمد")}
      ${kpi("clock", "warn", money(tot("pending_review")), "فواتير تحت المراجعة")}
      ${kpi("alert", negative ? "bad" : "mute", negative, "رصيدهم بالسالب", negative ? "الشركة مدينة لهم" : "")}
    </div>
    <div class="grid g-main">
      <div class="card scroll"><h3>${ic("wallet", 18)} الأرصدة</h3>
        ${bal.length ? `<table class="stack"><thead><tr><th>المهندس</th><th class="num">المستلم</th><th class="num">المعتمد</th><th class="num">تحت المراجعة</th><th class="num">المتاح</th></tr></thead><tbody>
        ${bal.map((b, i) => `<tr><td><span class="who">${avatar(b.full_name)}${esc(b.full_name)}</span></td><td class="num">${money(b.received)}</td><td class="num">${money(b.spent)}</td><td class="num">${money(b.pending_review)}</td>
        <td class="num"><b style="color:${avail[i] !== null && avail[i] < 0 ? "var(--bad)" : "inherit"}">${avail[i] === null ? "—" : money(avail[i])}</b></td></tr>`).join("")}
        </tbody></table>` : empty("user", "مفيش مهندسين لسه")}
      </div>
      <form class="card" id="cForm">
        <h3>${ic("cash", 18)} حركة عهدة جديدة</h3>
        <label for="cEng">المهندس</label><select id="cEng" required>${engineers.map((e) => `<option value="${esc(e.id)}">${esc(e.full_name)}</option>`).join("")}</select>
        <label for="cKind">النوع</label><select id="cKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <label for="cAmt">المبلغ (ر.س)</label><input id="cAmt" type="number" step="0.01" required dir="ltr">
        <p class="mute" style="margin:6px 0 0">رد النقدية بيتسجل بالسالب أوتوماتيك. التسوية تقبل موجب أو سالب.</p>
        <label for="cProj">المشروع (اختياري)</label><select id="cProj"><option value="">عامة</option>${projectOptions(null, projects)}</select>
        <label for="cNote">ملاحظة</label><input id="cNote">
        <button class="btn primary block" type="submit" style="margin-top:16px">تسجيل الحركة</button>
      </form>
    </div>
    <div class="card scroll" style="margin-top:16px"><h3>${ic("clock", 18)} آخر الحركات</h3>
      ${recent.length ? `<table class="stack"><thead><tr><th>التاريخ</th><th>المهندس</th><th>النوع</th><th>المشروع</th><th class="num">المبلغ</th><th>ملاحظة</th></tr></thead><tbody>
      ${recent.map((c) => `<tr><td>${day(c.created_at)}</td><td>${esc(c.engineer?.full_name)}</td><td>${esc(KINDS[c.kind])}</td><td>${esc(c.projects?.code || "عامة")}</td><td class="num" style="color:${c.amount < 0 ? "var(--bad)" : "var(--ok)"}"><b>${money(c.amount)}</b></td><td>${esc(c.note || "")}</td></tr>`).join("")}
      </tbody></table>` : empty("cash", "مفيش حركات لسه")}</div>`;
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
      renderCustody().catch(fail);
    } catch (e) { fail(e); }
  });
}

// ---------------- Staff: reports ----------------
async function renderSpend() {
  const rows = await must(sb.from("v_project_spend").select("*").order("month", { ascending: false }));
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const sel = sessionStorage.getItem("spendMonth") ?? (months.at(-1) || "");
  const shown = sel ? rows.filter((r) => r.month === sel) : rows;
  const byProj = {};
  const byCat = {};
  shown.forEach((r) => {
    const p = (byProj[r.project_code] ??= { name: r.project_name, total: 0, vat: 0, n: 0 });
    p.total += Number(r.total); p.vat += Number(r.vat || 0); p.n += r.invoices;
    const c = r.category_name || "بدون بند";
    byCat[c] = (byCat[c] || 0) + Number(r.total);
  });
  const list = Object.entries(byProj).sort((a, b) => b[1].total - a[1].total);
  const max = Math.max(1, ...list.map(([, p]) => p.total));
  const grand = list.reduce((a, [, p]) => a + p.total, 0);
  const monthly = months.slice(-6).map((m) => ({ m, v: rows.filter((r) => r.month === m).reduce((a, r) => a + Number(r.total), 0) }));
  const idx = monthly.findIndex((x) => x.m === sel);
  const prev = idx > 0 ? monthly[idx - 1] : null;
  const delta = prev && prev.v ? ((grand - prev.v) / prev.v) * 100 : null;
  const catList = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  head("التقارير", "المصروف المعتمد حسب المشروع والبند",
    `<select id="sMonth" style="width:auto;min-width:160px"><option value="">كل الشهور</option>${months.slice().reverse().map((m) => `<option value="${esc(m)}" ${m === sel ? "selected" : ""}>${esc(m.slice(0, 7))}</option>`).join("")}</select>`);
  view.innerHTML = `
    <div class="kpis">
      ${kpi("chart", "pri", money(grand), "إجمالي المعتمد", delta === null ? "" : `<span style="color:${delta > 0 ? "var(--bad)" : "var(--ok)"}">${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%</span> عن الشهر اللي قبله`)}
      ${kpi("cash", "ok", money(list.reduce((a, [, p]) => a + p.vat, 0)), "ضريبة المدخلات", "قابلة للاسترداد")}
      ${kpi("receipt", "mute", list.reduce((a, [, p]) => a + p.n, 0), "فاتورة معتمدة")}
      ${kpi("folder", "warn", list.length, "مشروع فيه مصروف")}
    </div>
    <div class="grid g-main">
      <div class="card"><h3>${ic("chart", 18)} المصروف الشهري — آخر 6 شهور</h3><div class="fig" id="trend"></div></div>
      <div class="card"><h3>${ic("list", 18)} حسب البند</h3>
        ${catList.length ? `<div class="bars">${catList.map(([n, v]) => `<div class="b"><div class="row"><span>${esc(n)}</span><span class="sp"></span><b class="num">${short(v)}</b></div><div class="track"><div class="fill" style="width:${(v / Math.max(1, catList[0][1])) * 100}%"></div></div></div>`).join("")}</div>` : empty("list", "مفيش بيانات")}
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h3>${ic("folder", 18)} حسب المشروع</h3>
      ${list.length ? `<div class="bars">${list.map(([code, p]) => `
        <div class="b"><div class="row"><b>${esc(code)}</b><span class="mute">${esc(p.name)} · ${p.n} فاتورة</span><span class="sp"></span><b class="num">${money(p.total)}</b></div>
        <div class="track"><div class="fill" style="width:${(p.total / max) * 100}%"></div></div>
        <div class="mute">${grand ? ((p.total / grand) * 100).toFixed(0) : 0}% من الإجمالي</div></div>`).join("")}</div>` : empty("chart", "مفيش مصروفات معتمدة لسه.")}
    </div>`;
  $("#sMonth").addEventListener("change", (e) => { sessionStorage.setItem("spendMonth", e.target.value); renderSpend().catch(fail); });
  drawTrend($("#trend"), monthly, sel);
}

function drawTrend(box, data, sel) {
  if (!data.length) { box.innerHTML = empty("chart", "مفيش بيانات لسه"); return; }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  box.append(svg);
  const draw = () => {
    const W = box.clientWidth, H = box.clientHeight, pt = 26, pb = 28, px = 8;
    if (!W) return;
    const max = Math.max(1, ...data.map((d) => d.v));
    const step = (W - px * 2) / data.length;
    const bw = Math.min(56, step - 16);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    svg.innerHTML = [0, 0.5, 1].map((g) => `<line x1="0" x2="${W}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="var(--line)" ${g ? 'stroke-dasharray="4 4"' : ""}/>`).join("") +
      data.map((d, i) => {
        const h = Math.max(2, H - pb - y(d.v));
        const x = W - px - step * (i + 0.5) - bw / 2; // RTL: oldest month on the right
        const on = d.m === sel || (!sel && i === data.length - 1);
        return `<rect x="${x}" y="${H - pb - h}" width="${bw}" height="${h}" rx="6" fill="#2563eb" fill-opacity="${on ? 1 : 0.35}"/>
          <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="var(--mute)">${esc(d.m.slice(5, 7))}/${esc(d.m.slice(2, 4))}</text>
          ${W > 420 || on ? `<text x="${x + bw / 2}" y="${H - pb - h - 7}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">${esc(short(d.v))}</text>` : ""}`;
      }).join("");
  };
  const ro = new ResizeObserver(draw);
  ro.observe(box);
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
  head("الإعدادات", `${users.length} مستخدم · ${projects.length} مشروع`);
  view.innerHTML = `
    <div class="grid g2">
      <form class="card" id="uForm">
        <h3>${ic("user", 18)} مستخدم جديد</h3>
        <div class="f2">
          <div><label for="uName">الاسم</label><input id="uName" required></div>
          <div><label for="uRole">الدور</label><select id="uRole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
          <div><label for="uEmail">الإيميل</label><input id="uEmail" type="email" required dir="ltr"></div>
          <div><label for="uPhone">الموبايل (للواتساب بعدين)</label><input id="uPhone" dir="ltr" placeholder="+9665XXXXXXXX"></div>
        </div>
        <label for="uPass">كلمة مرور مؤقتة</label><input id="uPass" required minlength="8" dir="ltr">
        <p class="mute" style="margin:6px 0 0">ابعتها للموظف، ويقدر يغيّرها من "حسابي".</p>
        <button class="btn primary block" type="submit" style="margin-top:16px">إنشاء الحساب</button>
      </form>
      <div class="card">
        <h3>${ic("folder", 18)} المشاريع</h3>
        <form class="row" id="pForm"><input id="pCode" placeholder="الكود" required style="width:100px" dir="ltr"><input id="pName" placeholder="اسم المشروع" required style="flex:1"><button class="btn primary" type="submit">إضافة</button></form>
        <div class="scroll" style="margin-top:12px"><table><tbody>
        ${projects.map((p) => `<tr><td><b>${esc(p.code)}</b><div class="mute">${esc(p.name)}</div></td>
          <td><select data-pstatus="${esc(p.id)}" style="min-height:36px;width:auto">${["active", "on_hold", "closed"].map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${{ active: "شغال", on_hold: "متوقف", closed: "مقفول" }[s]}</option>`).join("")}</select></td>
          <td>${members.filter((m) => m.project_id === p.id).map((m) => `<span class="pill st-settled" style="margin:2px">${esc(nameOf[m.user_id] || "?")}<button class="btn ghost sm" style="min-height:20px;padding:0 4px" data-unassign="${esc(p.id)}|${esc(m.user_id)}" aria-label="شيل">×</button></span>`).join("") || '<span class="mute">مفيش مهندسين</span>'}</td></tr>`).join("") || `<tr><td>${empty("folder", "ضيف أول مشروع")}</td></tr>`}
        </tbody></table></div>
        <form class="row" id="mForm" style="margin-top:12px">
          <select id="mProj" style="flex:1">${projectOptions(null, projects)}</select>
          <select id="mUser" style="flex:1">${engineers.map((u) => `<option value="${esc(u.id)}">${esc(u.full_name)}</option>`).join("")}</select>
          <button class="btn" type="submit">تعيين</button>
        </form>
      </div>
    </div>
    <div class="card scroll" style="margin-top:16px"><h3>${ic("user", 18)} المستخدمين</h3>
      <table class="stack"><thead><tr><th>الاسم</th><th>الموبايل</th><th>الدور</th><th>مفعّل</th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><span class="who">${avatar(u.full_name)}${esc(u.full_name)}</span></td><td dir="ltr">${esc(u.phone || "—")}</td>
        <td><select data-role="${esc(u.id)}" style="min-height:36px;width:auto" ${u.id === me.id ? "disabled" : ""}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><input type="checkbox" data-active="${esc(u.id)}" ${u.active ? "checked" : ""} ${u.id === me.id ? "disabled" : ""} style="width:22px;min-height:22px"></td></tr>`).join("")}
      </tbody></table></div>
    <div class="card scroll" style="margin-top:16px"><h3>${ic("list", 18)} البنود وأكواد الحسابات (GL)</h3>
      <table><thead><tr><th>البند</th><th>كود GL</th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td>${esc(c.name_ar)}</td><td><input data-gl="${esc(c.id)}" value="${esc(c.gl_code || "")}" placeholder="مثلاً 5110" dir="ltr" style="max-width:160px;min-height:36px"></td></tr>`).join("")}
      </tbody></table></div>`;

  const act = (sel, ev, fn) => $$(sel).forEach((el) => el.addEventListener(ev, async (e) => { try { await fn(el, e); } catch (err) { fail(err); } }));
  act("#uForm", "submit", async (_, e) => {
    e.preventDefault();
    await invoke("admin-users", { action: "create", full_name: $("#uName").value.trim(), email: $("#uEmail").value.trim(),
      phone: $("#uPhone").value.trim() || null, role: $("#uRole").value, password: $("#uPass").value });
    toast("اتعمل الحساب ✓");
    renderSettings().catch(fail);
  });
  act("#pForm", "submit", async (_, e) => {
    e.preventDefault();
    await must(sb.from("projects").insert({ code: $("#pCode").value.trim().toUpperCase(), name: $("#pName").value.trim() }));
    toast("اتضاف المشروع");
    renderSettings().catch(fail);
  });
  act("#mForm", "submit", async (_, e) => {
    e.preventDefault();
    if (!$("#mProj").value || !$("#mUser").value) return toast("اختار مشروع ومهندس");
    await must(sb.from("project_members").insert({ project_id: $("#mProj").value, user_id: $("#mUser").value }));
    toast("اتعيّن");
    renderSettings().catch(fail);
  });
  act("[data-unassign]", "click", async (el) => {
    const [p, u] = el.dataset.unassign.split("|");
    await must(sb.from("project_members").delete().eq("project_id", p).eq("user_id", u));
    renderSettings().catch(fail);
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
  head("حسابي");
  view.innerHTML = `
    <div class="grid g2" style="max-width:820px">
      <div class="card"><div class="row">${avatar(me.full_name || me.email, false)}<div><b>${esc(me.full_name)}</b><div class="mute" dir="ltr" style="text-align:right">${esc(me.email)}</div></div></div>
        <p style="margin-bottom:0"><span class="pill st-auto_ok"><i></i>${ROLES[me.role]}</span></p></div>
      <form class="card" id="pwForm">
        <h3>تغيير كلمة المرور</h3>
        <label for="pw1">كلمة مرور جديدة</label><input id="pw1" type="password" minlength="8" required dir="ltr" autocomplete="new-password">
        <button class="btn primary block" type="submit" style="margin-top:16px">حفظ</button>
      </form>
    </div>`;
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#pw1").value });
    if (error) return fail(error);
    toast("اتغيرت ✓");
    $("#pw1").value = "";
  });
}

// Ripple on every button press.
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn");
  if (!b || b.disabled || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement("span");
  s.className = "ripple";
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.append(s);
  setTimeout(() => s.remove(), 650);
});

sb.auth.getSession().then(({ data }) => {
  if (!data.session) $("#login").classList.remove("hide");
});
}
