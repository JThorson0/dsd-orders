// js/app.js — DSD Order App UI. Vanilla DOM, no framework.
// Data: Firestore (live) or bundled catalog.json (local preview).

import { isFirebaseConfigured } from "./config.js";
import { parseQuickEntry, searchProducts } from "./search.js";
import { getNextCutoff, describeCutoff } from "./cutoffs.js";

let DB = null;
const live = () => !!DB;
const $ = (sel) => document.querySelector(sel);

// Register the service worker immediately and independently of Firebase:
// installability ("Install app") and offline caching must not depend on
// the data layer finishing first.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const state = {
  products: [],
  stores: [],
  quantities: new Map(), // "storeId___productId" -> {currentQty, lastQty}
  submissions: new Map(), // cycleKey -> submittedAt
  recents: new Map(), // storeId -> [productIds]
  useCounts: {}, // productId -> n
  view: "stores",
  storeIdx: 0,
  collapsed: new Set(),
  entryIdx: 0,
  entryRows: [],
  rolloverArmed: false,
  rolloverTimer: null,
  undo: null,
  setupFilter: "",
  editingProduct: undefined, // undefined = not editing, null = new, object = edit
  editingStore: undefined,
  cutoff: null,
};

try {
  state.collapsed = new Set(
    JSON.parse(localStorage.getItem("dsd-collapsed") || "[]")
  );
} catch {
  state.collapsed = new Set();
}
try {
  const lastStore = localStorage.getItem("dsd-store");
  if (lastStore) state._lastStoreId = lastStore;
} catch {}

// ---------------- data helpers ----------------
const prod = (id) => state.products.find((p) => p.id === id);
const activeProducts = () =>
  state.products.filter((p) => !p.archived).sort((a, b) => a.sortOrder - b.sortOrder);
const activeStores = () =>
  state.stores.filter((s) => !s.archived).sort((a, b) => a.sortOrder - b.sortOrder);

function currentStore() {
  const stores = activeStores();
  if (!stores.length) return null;
  if (state._lastStoreId) {
    const i = stores.findIndex((s) => s.id === state._lastStoreId);
    if (i >= 0) state.storeIdx = i;
  }
  state.storeIdx = Math.min(state.storeIdx, stores.length - 1);
  return stores[state.storeIdx];
}

const qKey = (storeId, productId) => `${storeId}___${productId}`;
function qtyOf(storeId, productId) {
  return (
    state.quantities.get(qKey(storeId, productId)) || { currentQty: 0, lastQty: 0 }
  );
}

async function setQty(storeId, productId, currentQty, lastQty) {
  currentQty = Math.max(0, currentQty);
  if (live()) {
    await DB.setQuantity(storeId, productId, currentQty, lastQty);
  } else {
    state.quantities.set(qKey(storeId, productId), { currentQty, lastQty });
    render();
  }
}

function masterRows() {
  const stores = activeStores();
  const rows = [];
  for (const p of activeProducts()) {
    let total = 0;
    const lines = [];
    for (const s of stores) {
      const q = qtyOf(s.id, p.id).currentQty;
      if (q > 0) {
        total += q;
        lines.push({ store: s, qty: q });
      }
    }
    if (total > 0) rows.push({ product: p, total, lines });
  }
  rows.sort((a, b) => a.product.sortOrder - b.product.sortOrder);
  return rows;
}

// ---------------- toast + clipboard ----------------
let toastTimer = null;
function showToast(html, withUndo) {
  const t = $("#toast");
  t.innerHTML =
    `<span>${html}</span>` +
    (withUndo ? ` <button class="toast-btn" data-action="undo">Undo</button>` : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}

// ---------------- header / countdown ----------------
function tick() {
  const info = getNextCutoff(new Date());
  state.cutoff = info;
  const chip = $("#cutoff-chip");
  if (chip && info) {
    const submitted = state.submissions.has(info.key);
    chip.textContent =
      (submitted ? "✓ " : "⏳ ") +
      describeCutoff(info) +
      (submitted ? " — submitted" : "");
    chip.classList.toggle("submitted", submitted);
  }
  const mb = $("#master-banner");
  if (mb && info) {
    const submitted = state.submissions.has(info.key);
    mb.innerHTML =
      `<strong>Next OTS cutoff:</strong> ${esc(describeCutoff(info))}` +
      (submitted ? ` <span class="tag">✓ submitted</span>` : "");
  }
  const ob = $("#ots-banner");
  if (ob && info) ob.innerHTML = `<strong>Next OTS cutoff:</strong> ${esc(describeCutoff(info))}`;
  renderOtsControls();
}

// ---------------- stores view ----------------
function renderStores() {
  const s = currentStore();
  if (!s) {
    $("#store-name").textContent = "No stores";
    $("#store-sheet").innerHTML = `<p class="empty">All stores are archived. Unarchive one in Setup.</p>`;
    return;
  }
  $("#store-name").textContent = s.name;
  $("#store-sub").textContent = `${s.chain || ""} · swipe or use ‹ › to change store`;

  // category sections
  const byCat = new Map();
  const order = [];
  for (const p of activeProducts()) {
    const c = p.category || "Uncategorized";
    if (!byCat.has(c)) {
      byCat.set(c, []);
      order.push(c);
    }
    byCat.get(c).push(p);
  }
  order.sort(
    (a, b) =>
      Math.min(...byCat.get(a).map((p) => p.sortOrder)) -
      Math.min(...byCat.get(b).map((p) => p.sortOrder))
  );
  $("#store-sheet").innerHTML = order
    .map((c) => {
      const collapsed = state.collapsed.has(c);
      const rows = byCat
        .get(c)
        .map((p) => productRow(s, p))
        .join("");
      return `<section class="cat">
        <button class="cat-head" data-action="toggle-cat" data-cat="${esc(c)}">
          <span>${esc(c)}</span><span class="chev">${collapsed ? "▸" : "▾"}</span>
        </button>
        <div class="cat-body"${collapsed ? " hidden" : ""}>${rows}</div>
      </section>`;
    })
    .join("");
  renderRecents();
}

function productRow(s, p) {
  const q = qtyOf(s.id, p.id);
  const num = p.itemNumber
    ? `<div class="pnum">OTS #${esc(p.itemNumber)}</div>`
    : `<div class="pnum none">no item # on file</div>`;
  return `<div class="prow" id="row-${esc(p.id)}">
    <div class="pinfo">
      <div class="pname">${esc(p.name)}</div>
      ${num}
    </div>
    <div class="pqtys">
      <div class="pq"><b>${q.lastQty}</b><span>Last</span></div>
      <div class="stepper">
        <button data-action="step" data-pid="${esc(p.id)}" data-d="-1" aria-label="one less">−</button>
        <span class="cur">${q.currentQty}</span>
        <button data-action="step" data-pid="${esc(p.id)}" data-d="1" aria-label="one more">+</button>
      </div>
    </div>
  </div>`;
}

function renderRecents() {
  const s = currentStore();
  const box = $("#qa-recents");
  if (!s) {
    box.innerHTML = "";
    return;
  }
  const ids = state.recents.get(s.id) || [];
  const items = ids.map(prod).filter((p) => p && !p.archived);
  box.innerHTML = items.length
    ? `<span class="rec-label">Recent:</span>` +
      items
        .map(
          (p) =>
            `<button class="chip" data-action="goto-pid" data-pid="${esc(p.id)}">${esc(p.name)}</button>`
        )
        .join("")
    : `<span class="rec-empty">Type above to add — e.g. <b>ccc 4</b></span>`;
}

function renderSuggestions(results, didYouMean, qty) {
  const s = currentStore();
  const box = $("#qa-suggestions");
  const row = (r) => {
    const q = qtyOf(s.id, r.product.id);
    const thisTxt =
      q.currentQty > 0
        ? `This order: <b>${q.currentQty}</b>`
        : `<span class="zero">Not on this order</span>`;
    const lastTxt =
      q.lastQty > 0
        ? `Last order: <b>${q.lastQty}</b>`
        : `<span class="zero">Not on last order</span>`;
    return `<button class="sug" data-action="qa-add" data-pid="${esc(r.product.id)}">
      <span class="sug-main">
        <span class="sug-name">${esc(r.product.name)}</span>
        <span class="sug-q">${thisTxt} · ${lastTxt}</span>
      </span>
      ${qty > 1 ? `<span class="sug-add">+${qty}</span>` : `<span class="sug-add">+</span>`}
    </button>`;
  };
  if (results.length) box.innerHTML = results.map(row).join("");
  else if (didYouMean.length)
    box.innerHTML =
      `<div class="dym-label">Did you mean…</div>` + didYouMean.map(row).join("");
  else box.innerHTML = "";
}

function onQuickInput() {
  const input = $("#qa-input");
  const { query, qty } = parseQuickEntry(input.value);
  state._pendingQty = qty;
  if (!query) {
    $("#qa-suggestions").innerHTML = "";
    return;
  }
  const { results, didYouMean } = searchProducts(
    query,
    activeProducts(),
    state.useCounts
  );
  renderSuggestions(results, didYouMean, qty);
}

async function quickAdd(pid, qty) {
  const s = currentStore();
  if (!s) return;
  const q = qtyOf(s.id, pid);
  const prev = q.currentQty;
  await setQty(s.id, pid, prev + qty, q.lastQty);
  if (live()) {
    DB.recordRecent(s.id, pid).catch(() => {});
    DB.bumpUseCount(pid).catch(() => {});
  } else {
    const ids = [pid, ...(state.recents.get(s.id) || []).filter((x) => x !== pid)].slice(0, 8);
    state.recents.set(s.id, ids);
    state.useCounts[pid] = (state.useCounts[pid] || 0) + 1;
    renderRecents();
  }
  state.undo = { storeId: s.id, productId: pid, prev };
  const p = prod(pid);
  showToast(
    `Added ${esc(p ? p.name : "item")} — now <b>${prev + qty}</b> on this order.`,
    true
  );
  const input = $("#qa-input");
  input.value = "";
  $("#qa-suggestions").innerHTML = "";
  input.focus();
}

async function undoLast() {
  const u = state.undo;
  if (!u) return;
  const q = qtyOf(u.storeId, u.productId);
  await setQty(u.storeId, u.productId, u.prev, q.lastQty);
  state.undo = null;
  $("#toast").hidden = true;
}

function gotoProduct(pid) {
  const el = document.getElementById("row-" + pid);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
}

// ---------------- master list ----------------
function renderMaster() {
  const rows = masterRows();
  const totalCases = rows.reduce((a, r) => a + r.total, 0);
  $("#master-summary").innerHTML = rows.length
    ? `<b>${rows.length}</b> products · <b>${totalCases}</b> cases total`
    : `Nothing on the current order yet.`;
  $("#copy-all-btn").disabled = !rows.length;
  $("#master-list").innerHTML = rows
    .map((r, i) => {
      const num = r.product.itemNumber
        ? `OTS #${esc(r.product.itemNumber)}`
        : `<span class="none">no item # on file</span>`;
      const breakdown = r.lines
        .map((l) => `${esc(l.store.shortName || l.store.name)} ×${l.qty}`)
        .join(" · ");
      return `<div class="mrow" data-i="${i}">
        <button class="mrow-main" data-action="mrow-toggle" data-i="${i}">
          <span class="minfo">
            <span class="mname">${esc(r.product.name)}</span>
            <span class="mnum">${num}</span>
            <span class="mbreakdown"${state._openMaster === i ? "" : " hidden"}>${breakdown}</span>
          </span>
          <span class="mqty">×${r.total}</span>
        </button>
        <button class="mcopy" data-action="copy-line" data-i="${i}">Copy</button>
      </div>`;
    })
    .join("");
  state._masterCache = rows;
}

function masterLineText(r) {
  const num = r.product.itemNumber || "no item #";
  return `${num}  x${r.total}  ${r.product.name}`;
}

async function copyAll() {
  const rows = state._masterCache || masterRows();
  if (!rows.length) return;
  const ok = await copyText(rows.map(masterLineText).join("\n"));
  showToast(ok ? `Copied ${rows.length} lines.` : `Copy failed — long-press to select.`);
}

// ---------------- OTS view + entry overlay ----------------
function renderOtsControls() {
  const info = state.cutoff;
  const btn = $("#mark-submitted-btn");
  if (!btn || !info) return;
  const submittedAt = state.submissions.get(info.key);
  if (submittedAt) {
    btn.disabled = true;
    btn.innerHTML = `✓ Submitted for ${esc(info.weekday)} cutoff`;
    const line = $("#ots-submitted-line");
    if (line) line.textContent = `Marked submitted ${submittedAt}.`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `Mark as submitted <small>(${esc(info.weekday)} 7:30 AM ET cutoff)</small>`;
    const line = $("#ots-submitted-line");
    if (line) line.textContent = "Not submitted yet for this cycle.";
  }
  const rb = $("#rollover-btn");
  if (rb) {
    rb.innerHTML = state.rolloverArmed
      ? `⚠️ Tap again to confirm — roll over ALL stores`
      : `Order placed — roll over all stores`;
    rb.classList.toggle("armed", state.rolloverArmed);
  }
  const se = $("#start-entry-btn");
  if (se) se.disabled = !masterRows().length;
}

async function markSubmitted() {
  const info = state.cutoff;
  if (!info || state.submissions.has(info.key)) return;
  const stamp = new Date().toLocaleString();
  if (live()) await DB.markSubmitted(info.key);
  else state.submissions.set(info.key, stamp);
  // watcher will re-render in live mode; in local mode update directly
  if (!live()) {
    state.submissions.set(info.key, stamp);
    renderOtsControls();
    tick();
  }
  showToast(`Marked submitted for the ${info.weekday} cutoff.`);
}

function openEntry() {
  const rows = masterRows();
  if (!rows.length) return;
  state.entryRows = rows;
  state.entryIdx = 0;
  $("#ots-overlay").hidden = false;
  renderEntry();
  document.body.style.overflow = "hidden";
}
function closeEntry() {
  $("#ots-overlay").hidden = true;
  document.body.style.overflow = "";
}
function renderEntry() {
  const rows = state.entryRows;
  const r = rows[state.entryIdx];
  if (!r) return closeEntry();
  $("#ots-count").textContent = `Item ${state.entryIdx + 1} of ${rows.length}`;
  $("#ots-name").textContent = r.product.name;
  const hasNum = !!r.product.itemNumber;
  const nb = $("#ots-num-block");
  nb.disabled = !hasNum;
  nb.innerHTML = hasNum
    ? `<span class="ots-big">${esc(r.product.itemNumber)}</span><span class="ots-sub">tap to copy item #</span>`
    : `<span class="ots-big dim">No item #</span><span class="ots-sub">skip — none on file</span>`;
  $("#ots-qty-block").innerHTML =
    `<span class="ots-big">${r.total}</span><span class="ots-sub">tap to copy cases</span>`;
  $("#ots-prev").disabled = state.entryIdx === 0;
  $("#ots-next").textContent =
    state.entryIdx === rows.length - 1 ? "Done ✓" : "Next ›";
}

// ---------------- rollover ----------------
function onRolloverClick() {
  if (!state.rolloverArmed) {
    state.rolloverArmed = true;
    renderOtsControls();
    clearTimeout(state.rolloverTimer);
    state.rolloverTimer = setTimeout(() => {
      state.rolloverArmed = false;
      renderOtsControls();
    }, 6000);
    return;
  }
  clearTimeout(state.rolloverTimer);
  state.rolloverArmed = false;
  doRollover();
}

async function doRollover() {
  // currentQty → lastQty, today → zero. Only touches rows with currentQty > 0.
  // NEVER automatic — only from this button.
  const list = [];
  for (const [key, q] of state.quantities) {
    if (q.currentQty > 0) {
      const [storeId, productId] = key.split("___");
      list.push({ storeId, productId, currentQty: 0, lastQty: q.currentQty });
    }
  }
  if (!list.length) {
    showToast("Nothing to roll over.");
    renderOtsControls();
    return;
  }
  if (live()) {
    await DB.setQuantities(list);
  } else {
    for (const q of list)
      state.quantities.set(qKey(q.storeId, q.productId), {
        currentQty: 0,
        lastQty: q.lastQty,
      });
    render();
  }
  showToast(`Rolled over ${list.length} items — last order updated.`);
}

async function copyLastToCurrent() {
  const s = currentStore();
  if (!s) return;
  let n = 0;
  const list = [];
  for (const p of activeProducts()) {
    const q = qtyOf(s.id, p.id);
    if (q.lastQty > 0 && q.currentQty === 0) {
      n++;
      list.push({ storeId: s.id, productId: p.id, currentQty: q.lastQty, lastQty: q.lastQty });
    }
  }
  if (!n) {
    showToast("Nothing to copy — today is already started or last order is empty.");
    return;
  }
  if (live()) await DB.setQuantities(list);
  else {
    for (const it of list)
      state.quantities.set(qKey(it.storeId, it.productId), {
        currentQty: it.currentQty,
        lastQty: it.lastQty,
      });
    render();
  }
  showToast(`Started today from last order — ${n} items.`);
}

// ---------------- setup ----------------
function renderSetup() {
  renderProductList();
  renderStoreList();
  renderProductForm();
  renderStoreForm();
}

function renderProductList() {
  const f = state.setupFilter.trim().toLowerCase();
  const list = activeProducts()
    .concat(state.products.filter((p) => p.archived))
    .filter((p) => !f || (p.name + " " + (p.itemNumber || "")).toLowerCase().includes(f))
    .slice(0, 120);
  $("#product-list").innerHTML =
    list
      .map(
        (p) => `<div class="setup-row${p.archived ? " archived" : ""}">
      <span class="sr-main"><b>${esc(p.name)}</b>
      <small>${p.itemNumber ? "OTS #" + esc(p.itemNumber) + " · " : ""}${esc(p.category || "")}${p.aliases ? ` · <i>aliases: ${esc(p.aliases)}</i>` : ""}</small></span>
      <button data-action="edit-product" data-pid="${esc(p.id)}">Edit</button>
      <button data-action="archive-product" data-pid="${esc(p.id)}">${p.archived ? "Unarchive" : "Archive"}</button>
    </div>`
      )
      .join("") ||
    `<p class="empty">No products match.</p>`;
}

function renderProductForm() {
  const ep = state.editingProduct;
  const form = $("#product-form");
  if (ep === undefined) {
    form.hidden = true;
    return;
  }
  form.hidden = false;
  const isNew = ep === null;
  const p = isNew ? { name: "", itemNumber: "", category: "", aliases: "" } : ep;
  $("#pf-title").textContent = isNew ? "Add product" : "Edit product";
  $("#pf-name").value = p.name || "";
  $("#pf-item").value = p.itemNumber || "";
  $("#pf-cat").value = p.category || "";
  $("#pf-aliases").value = p.aliases || "";
  const cats = [...new Set(state.products.map((x) => x.category).filter(Boolean))].sort();
  $("#cat-list").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
}

async function saveProductForm() {
  const ep = state.editingProduct;
  const data = {
    name: $("#pf-name").value.trim(),
    itemNumber: $("#pf-item").value.trim(),
    category: $("#pf-cat").value.trim() || "Uncategorized",
    aliases: $("#pf-aliases").value.trim(),
  };
  if (!data.name) {
    showToast("Product needs a name.");
    return;
  }
  if (live()) {
    await DB.saveProduct(ep && ep.id ? { ...data, id: ep.id, archived: ep.archived, sortOrder: ep.sortOrder } : data);
  } else {
    if (ep && ep.id) {
      const p = prod(ep.id);
      Object.assign(p, data);
    } else {
      state.products.push({ id: "user-" + Date.now().toString(36), archived: false, sortOrder: 9999, ...data });
    }
    render();
  }
  state.editingProduct = undefined;
  renderSetup();
  showToast("Product saved.");
}

function renderStoreList() {
  $("#store-list").innerHTML = state.stores
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (s) => `<div class="setup-row${s.archived ? " archived" : ""}">
      <span class="sr-main"><b>${esc(s.name)}</b><small>${esc(s.chain || "")}${s.archived ? " · archived" : ""}</small></span>
      <button data-action="edit-store" data-pid="${esc(s.id)}">Edit</button>
      <button data-action="archive-store" data-pid="${esc(s.id)}">${s.archived ? "Unarchive" : "Archive"}</button>
    </div>`
    )
    .join("");
}

function renderStoreForm() {
  const es = state.editingStore;
  const form = $("#store-form");
  if (es === undefined) {
    form.hidden = true;
    return;
  }
  form.hidden = false;
  const isNew = es === null;
  const s = isNew ? { name: "", shortName: "", chain: "" } : es;
  $("#sf-title").textContent = isNew ? "Add store" : "Edit store";
  $("#sf-name").value = s.name || "";
  $("#sf-short").value = s.shortName || "";
  $("#sf-chain").value = s.chain || "";
}

async function saveStoreForm() {
  const es = state.editingStore;
  const data = {
    name: $("#sf-name").value.trim(),
    shortName: $("#sf-short").value.trim(),
    chain: $("#sf-chain").value.trim(),
  };
  if (!data.name) {
    showToast("Store needs a name.");
    return;
  }
  if (live()) {
    await DB.saveStore(es && es.id ? { ...data, id: es.id, archived: es.archived, sortOrder: es.sortOrder } : data);
  } else {
    if (es && es.id) Object.assign(state.stores.find((x) => x.id === es.id), data);
    else state.stores.push({ id: "store-" + Date.now().toString(36), archived: false, sortOrder: 99, lastOrderLabel: "", ...data });
    render();
  }
  state.editingStore = undefined;
  renderSetup();
  showToast("Store saved.");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  let data;
  if (live()) {
    data = await DB.exportAll();
  } else {
    data = {
      products: state.products,
      stores: state.stores,
      orderQuantities: [...state.quantities.entries()].map(([k, v]) => {
        const [storeId, productId] = k.split("___");
        return { storeId, productId, ...v };
      }),
      otsSubmissions: [...state.submissions.entries()].map(([id, submittedAt]) => ({ id, submittedAt })),
      exportedAt: new Date().toISOString(),
      mode: "local-preview",
    };
  }
  download(`dsd-backup-${stamp}.json`, JSON.stringify(data, null, 2));
  showToast("Backup downloaded.");
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast("That file isn't valid JSON.");
    return;
  }
  if (!Array.isArray(data.products) || !Array.isArray(data.stores)) {
    showToast("Backup must contain products and stores.");
    return;
  }
  if (!confirm(`Import backup? This adds/updates ${data.products.length} products and ${data.stores.length} stores.`))
    return;
  if (live()) {
    await DB.importAll(data);
  } else {
    state.products = data.products;
    state.stores = data.stores;
    state.quantities = new Map(
      (data.orderQuantities || []).map((q) => [qKey(q.storeId, q.productId), { currentQty: q.currentQty || 0, lastQty: q.lastQty || 0 }])
    );
    render();
  }
  showToast("Backup imported.");
}

// ---------------- view switching / render ----------------
function setView(v) {
  state.view = v;
  for (const s of ["stores", "master", "ots", "setup"]) {
    $("#view-" + s).hidden = s !== v;
  }
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === v)
  );
  render();
}

function render() {
  if (state.view === "stores") renderStores();
  else if (state.view === "master") renderMaster();
  else if (state.view === "ots") {
    renderOtsControls();
  } else if (state.view === "setup") renderSetup();
  tick();
}

// ---------------- events ----------------
function bindEvents() {
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.addEventListener("click", () => setView(b.dataset.view))
  );

  $("#store-prev").addEventListener("click", () => stepStore(-1));
  $("#store-next").addEventListener("click", () => stepStore(1));

  const qa = $("#qa-input");
  qa.addEventListener("input", onQuickInput);
  qa.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const { query, qty } = parseQuickEntry(qa.value);
      if (!query) return;
      const { results, didYouMean } = searchProducts(query, activeProducts(), state.useCounts);
      const pick = results[0] || didYouMean[0];
      if (pick) quickAdd(pick.product.id, qty);
    }
  });

  $("#copy-last-btn").addEventListener("click", copyLastToCurrent);
  $("#copy-all-btn").addEventListener("click", copyAll);
  $("#mark-submitted-btn").addEventListener("click", markSubmitted);
  $("#start-entry-btn").addEventListener("click", openEntry);
  $("#rollover-btn").addEventListener("click", onRolloverClick);

  $("#ots-close").addEventListener("click", closeEntry);
  $("#ots-prev").addEventListener("click", () => {
    if (state.entryIdx > 0) {
      state.entryIdx--;
      renderEntry();
    }
  });
  $("#ots-next").addEventListener("click", () => {
    if (state.entryIdx < state.entryRows.length - 1) {
      state.entryIdx++;
      renderEntry();
    } else closeEntry();
  });
  $("#ots-num-block").addEventListener("click", async () => {
    const r = state.entryRows[state.entryIdx];
    if (r && r.product.itemNumber) {
      const ok = await copyText(r.product.itemNumber);
      showToast(ok ? "Item # copied." : "Copy failed.");
    }
  });
  $("#ots-qty-block").addEventListener("click", async () => {
    const r = state.entryRows[state.entryIdx];
    if (r) {
      const ok = await copyText(String(r.total));
      showToast(ok ? "Quantity copied." : "Copy failed.");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#ots-overlay").hidden) closeEntry();
  });

  // swipe between stores
  let tx = null;
  const sv = $("#view-stores");
  sv.addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
  sv.addEventListener("touchend", (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    if (Math.abs(dx) > 70) stepStore(dx < 0 ? 1 : -1);
  }, { passive: true });

  // setup
  $("#setup-filter").addEventListener("input", (e) => {
    state.setupFilter = e.target.value;
    renderProductList();
  });
  $("#add-product-btn").addEventListener("click", () => {
    state.editingProduct = null;
    renderProductForm();
    $("#pf-name").focus();
  });
  $("#pf-save").addEventListener("click", saveProductForm);
  $("#pf-cancel").addEventListener("click", () => {
    state.editingProduct = undefined;
    renderProductForm();
  });
  $("#add-store-btn").addEventListener("click", () => {
    state.editingStore = null;
    renderStoreForm();
    $("#sf-name").focus();
  });
  $("#sf-save").addEventListener("click", saveStoreForm);
  $("#sf-cancel").addEventListener("click", () => {
    state.editingStore = undefined;
    renderStoreForm();
  });
  $("#export-btn").addEventListener("click", exportBackup);
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });

  // delegated clicks
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const pid = el.dataset.pid;
    if (a === "step") {
      const s = currentStore();
      const q = qtyOf(s.id, pid);
      setQty(s.id, pid, q.currentQty + parseInt(el.dataset.d, 10), q.lastQty);
    } else if (a === "qa-add") {
      quickAdd(pid, state._pendingQty || 1);
    } else if (a === "goto-pid") {
      gotoProduct(pid);
    } else if (a === "toggle-cat") {
      const c = el.dataset.cat;
      if (state.collapsed.has(c)) state.collapsed.delete(c);
      else state.collapsed.add(c);
      try {
        localStorage.setItem("dsd-collapsed", JSON.stringify([...state.collapsed]));
      } catch {}
      renderStores();
    } else if (a === "mrow-toggle") {
      const i = parseInt(el.dataset.i, 10);
      state._openMaster = state._openMaster === i ? null : i;
      renderMaster();
    } else if (a === "copy-line") {
      const r = (state._masterCache || [])[parseInt(el.dataset.i, 10)];
      if (r) copyText(masterLineText(r)).then((ok) => showToast(ok ? "Line copied." : "Copy failed."));
    } else if (a === "undo") {
      undoLast();
    } else if (a === "edit-product") {
      state.editingProduct = prod(pid);
      renderProductForm();
      $("#pf-name").focus();
    } else if (a === "archive-product") {
      const p = prod(pid);
      const arch = !p.archived;
      if (live()) DB.setProductArchived(pid, arch);
      else {
        p.archived = arch;
        render();
      }
    } else if (a === "edit-store") {
      state.editingStore = state.stores.find((s) => s.id === pid);
      renderStoreForm();
      $("#sf-name").focus();
    } else if (a === "archive-store") {
      const s = state.stores.find((x) => x.id === pid);
      const arch = !s.archived;
      if (live()) DB.setStoreArchived(pid, arch);
      else {
        s.archived = arch;
        render();
      }
    }
  });
}

function stepStore(d) {
  const n = activeStores().length;
  if (!n) return;
  state.storeIdx = (state.storeIdx + d + n) % n;
  const s = currentStore();
  try {
    localStorage.setItem("dsd-store", s.id);
  } catch {}
  state._lastStoreId = s.id;
  const qa = $("#qa-input");
  qa.value = "";
  $("#qa-suggestions").innerHTML = "";
  renderStores();
}

// ---------------- boot ----------------
function showBanner(msg) {
  const b = $("#cfg-banner");
  b.hidden = false;
  $("#cfg-banner-text").textContent =
    msg ||
    "Preview mode: paste your Firebase web config into js/config.js (see FIREBASE_SETUP.md) to save & sync between devices.";
}

function loadLocal(catalog) {
  state.products = catalog.products;
  state.stores = catalog.stores;
  for (const q of catalog.orderQuantities || [])
    state.quantities.set(qKey(q.storeId, q.productId), {
      currentQty: q.currentQty || 0,
      lastQty: q.lastQty || 0,
    });
}

async function boot() {
  bindEvents();
  let catalog;
  try {
    catalog = await (await fetch("./catalog.json")).json();
  } catch (e) {
    document.body.innerHTML = "<p style='padding:2rem'>Could not load catalog.json — serve this folder over HTTP.</p>";
    return;
  }

  if (isFirebaseConfigured()) {
    try {
      DB = await import("./db.js");
      await DB.init();
      await DB.seedIfEmpty(catalog);
      DB.watch("products", (rows) => {
        state.products = rows;
        render();
      });
      DB.watch("stores", (rows) => {
        state.stores = rows;
        render();
      });
      DB.watch("orderQuantities", (rows) => {
        state.quantities = new Map(
          rows.map((q) => [
            qKey(q.storeId, q.productId),
            { currentQty: q.currentQty || 0, lastQty: q.lastQty || 0 },
          ])
        );
        render();
      });
      DB.watch("otsSubmissions", (rows) => {
        state.submissions = new Map(rows.map((r) => [r.id, r.submittedAt ? String(r.submittedAt) : ""]));
        render();
      });
      DB.watch("quickRecents", (rows) => {
        state.recents = new Map(rows.map((r) => [r.storeId || r.id, r.productIds || []]));
        if (state.view === "stores") renderRecents();
      });
      DB.watch("productUseCounts", (rows) => {
        state.useCounts = Object.fromEntries(rows.map((r) => [r.productId || r.id, r.count || 0]));
      });
    } catch (e) {
      console.error("[dsd] Firebase init failed, falling back to preview:", e);
      DB = null;
      loadLocal(catalog);
      showBanner("Firebase couldn't connect (" + (e.message || e) + "). Showing preview — check js/config.js and FIREBASE_SETUP.md.");
    }
  } else {
    loadLocal(catalog);
    showBanner();
  }

  render();
  tick();
  setInterval(tick, 30000);
}

document.addEventListener("DOMContentLoaded", boot);
