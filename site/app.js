/* Lacombe Deals — static front end. Data is refreshed every 6 h by GitHub Actions.
   Your watchlist, shopping list, store choices and notes are saved in this browser
   (use "Share" to copy them to another phone or computer). */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LB = 2.2046226;
const TIER_ORDER = ["unknown", "above", "regular", "good", "great", "stockup"];
const LABEL = { stockup: "Stock up", great: "Great deal", good: "Good deal", regular: "Regular price",
  above: "Pricier than usual", unknown: "No price history yet" };
const FLIPP_CITY = "https://flipp.com/en-ca/lacombe-ab";

// ------------------------------------------------------------------ storage
const store = {
  get(k, d) { try { const v = localStorage.getItem("ld." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ld." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const S = {
  watch: store.get("watch", null),
  list: store.get("list", []),
  off: store.get("off", {}),            // merchant -> true when hidden
  localOnly: store.get("localOnly", false),
  notes: store.get("notes", []),
  view: store.get("view", "watch"),
  tab: store.get("tab", "groceries"),
  dept: store.get("dept", ""),
  home: store.get("home", "Sobeys"),        // usual store, shown first everywhere
  topScope: store.get("topScope", "home"),
};
if (S.watch == null) S.watch = []; // first visit: empty with suggestions
const save = (k) => store.set(k, S[k]);

// ------------------------------------------------------------------ text matching (mirrors collector/match.py)
const STOP = new Set(["the", "a", "an", "of", "and", "or", "with", "in", "for", "fresh", "pc", "no", "name"]);
function normalize(t) {
  if (!t) return "";
  t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[®™]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9%.]+/g, " ")
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, " ");
  return t.replace(/\s+/g, " ").trim();
}
function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const tokens = (t) => normalize(t).split(" ").filter((w) => w && !STOP.has(w)).map(stem);
const tokCache = new Map();
function nameTok(name) {
  let v = tokCache.get(name);
  if (!v) {
    const tk = tokens(name);
    v = { set: new Set(tk), joined: tk.join(""), nn: " " + normalize(name) + " ", nst: " " + tk.join(" ") + " " };
    if (tokCache.size > 60000) tokCache.clear();
    tokCache.set(name, v);
  }
  return v;
}
function matches(query, name, exclude = []) {
  const qt = tokens(query);
  if (!qt.length) return false;
  const n = nameTok(name);
  for (const w of qt) {
    if (n.set.has(w)) continue;
    // tolerate tiny suffixes only (e.g. "yogurt" ~ "yoghurts" no, "bagel" ~ "bagels" yes); never "butter" ~ "butternut"
    let ok = false;
    if (w.length >= 4) for (const x of n.set) if (x.startsWith(w) && x.length - w.length <= 2) { ok = true; break; }
    if (!ok) return false;
  }
  for (let ex of exclude) {
    ex = (ex || "").trim();
    if (!ex) continue;
    if (n.nn.includes(" " + normalize(ex) + " ") || n.nst.includes(" " + tokens(ex).join(" ") + " ")) return false;
  }
  return true;
}

// ------------------------------------------------------------------ rating (mirrors collector/rating.py)
function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function fmtUnit(v, b) {
  if (v == null) return "";
  if (b === "kg") return `$${(v / LB).toFixed(2)}/lb`;
  if (b === "L") return `$${v.toFixed(2)}/L`;
  return `$${v.toFixed(2)}`;
}
function bump(cur, t) { return TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(cur) ? t : cur; }
function rate(up, basis, past, others, sav, target, tbasis) {
  const out = { tier: "unknown", pct: null, ref: null, why: [] };
  if (!(up > 0)) {
    if (sav) { out.tier = sav >= 40 ? "great" : sav >= 20 ? "good" : "regular"; out.why.push(`store says ${sav}% off`); }
    return out;
  }
  past = past.filter((p) => p > 0); others = others.filter((p) => p > 0);
  let tier = "regular", ref = null, src = "";
  const fromHist = past.length >= 4;
  if (fromHist) { ref = median(past); src = `usual ${fmtUnit(ref, basis)}`; }
  else if ((basis === "kg" || basis === "L") && others.length >= 2) { ref = median([...others, up]); src = `typical ${fmtUnit(ref, basis)} at other stores this week`; }
  if (ref) {
    let pct = Math.round(100 * (1 - up / ref));
    if (!fromHist && Math.abs(pct) > 45) { ref = null; }
  }
  if (ref) {
    const pct = Math.round(100 * (1 - up / ref));
    out.pct = pct; out.ref = ref;
    if (fromHist) tier = pct >= 30 ? "stockup" : pct >= 18 ? "great" : pct >= 7 ? "good" : pct <= -12 ? "above" : "regular";
    else if (pct >= 15) tier = "good";
    if (pct >= 3) out.why.push(`${pct}% below ${src}`);
    else if (pct <= -3 && fromHist) out.why.push(`${-pct}% above ${src}`);
    else if (fromHist) out.why.push(`about the ${src}`);
    if (past.length >= 6 && up <= Math.min(...past) * 1.001) {
      out.why.push("lowest price we've seen");
      if (past.length >= 10) tier = bump(tier, "great");
    }
  }
  if ((basis === "kg" || basis === "L") && others.length >= 2 && up <= Math.min(...others) * 1.001) out.why.push("cheapest store this week");
  if (sav) {
    const t = sav >= 40 ? "great" : sav >= 20 ? "good" : null;
    if (t && tier !== "above") tier = bump(tier, t);
    out.why.push(`store says ${sav}% off`);
  }
  if (target && (!tbasis || tbasis === basis) && up <= target * 1.001) {
    tier = "stockup"; out.why.unshift(`at or under your target ${fmtUnit(target, basis)}`);
  }
  if (ref == null && !sav && tier === "regular") tier = "unknown";
  out.tier = tier;
  return out;
}

// ------------------------------------------------------------------ data
const D = { meta: {}, items: [], flyers: [], flyerItems: {}, hist: { h: {}, merchants: [] }, rest: { restaurants: [], rfd: [] } };
const now = new Date();
const todayISO = now.toISOString().slice(0, 10);
const active = (to) => !to || new Date(to) > now;

async function getJSON(path) {
  // always check with the server for newer data (the browser may otherwise reuse a copy for 10 min)
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadAll() {
  const res = await Promise.allSettled([
    getJSON("data/meta.json"), getJSON("data/items.json"), getJSON("data/flyers.json"),
    getJSON("data/history.json"), getJSON("data/restaurants.json"), getJSON("data/flyer_items.json"),
  ]);
  const v = (i, d) => (res[i].status === "fulfilled" ? res[i].value : d);
  D.meta = v(0, {}); D.items = v(1, []).filter((i) => active(i.to)); D.flyers = v(2, []).filter((f) => active(f.to));
  D.hist = v(3, { h: {}, merchants: [] }); D.rest = v(4, D.rest); D.flyerItems = v(5, {});
  D.flyerById = Object.fromEntries(D.flyers.map((f) => [String(f.id), f]));
  D.local = new Set(); // every store shown is in Lacombe, so no badge needed
  D.allFlyerItems = [];
  for (const [fid, arr] of Object.entries(D.flyerItems)) {
    const f = D.flyerById[fid];
    if (!f) continue;
    for (const it of arr) D.allFlyerItems.push({ ...it, fid: Number(fid), m: f.merchant, to: f.to });
  }
  D.searchedIds = new Set(D.items.map((i) => i.id));
}

const okStore = (m) => !S.off[m];

// ------------------------------------------------------------------ helpers
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso)) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
function until(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((d - now) / 86400000);
  const wd = d.toLocaleDateString("en-CA", { weekday: "short" });
  if (days < 1) return "ends today";
  if (days < 7) return `until ${wd}`;
  return `until ${d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
}
function priceText(it) {
  if (it.price == null) return it.story || "See flyer";
  const p = `$${Number(it.price).toFixed(2)}`;
  if (it.multi) return `${it.multi} for $${(it.price * it.multi).toFixed(2)}`;
  if (it.b === "kg" && /lb/i.test(it.post || "")) return `${p}/lb`;
  if (it.b === "kg" && /100\s*g/i.test(it.post || "")) return `${p}/100 g`;
  return p;
}
function unitText(it) {
  if (it.b === "ea" || !it.ud) return "";
  const pt = priceText(it);
  return it.ud.split(" · ").filter((u) => u !== pt).join(" · ");
}
const badge = (tier) => `<span class="badge t-${tier}">${esc(LABEL[tier])}</span>`;
const flyerUrl = (fid) => `${FLIPP_CITY}/flyer/${fid}`;
const itemUrl = (id) => `${FLIPP_CITY}/item/${id}`;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }
const uid = () => Math.random().toString(36).slice(2, 10);
function openSheet(html, onMount) {
  const d = $("#sheet"); $("#sheetBody").innerHTML = html;
  if (!d.open) d.showModal();
  onMount && onMount($("#sheetBody"));
}
function closeSheet() { $("#sheet").close(); }
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

// ------------------------------------------------------------------ watchlist analysis
function histFor(q, ex, hide = []) {
  // history point: [startDay, unitPrice, basis, merchantIdx, price, endDay]
  const out = [];
  for (const [norm, pts] of Object.entries(D.hist.h || {})) {
    if (hide.includes(norm) || !matches(q, norm, ex)) continue;
    for (const p of pts) out.push([...p, norm]);
  }
  return out;
}
const isPast = (p) => (p[5] || p[0]) < todayISO;

// Is this item really the thing, or the word used in another product? ("butter" vs
// "butter chicken ravioli" or "peanut butter"). Used to pick the headline deal.
const BEFORE = new Set(["peanut", "almond", "apple", "cocoa", "shea", "body", "cookie", "nut", "cashew", "hazelnut", "garlic", "buffalo", "honey", "chocolate", "coconut", "condensed", "evaporated"]);
const AFTER = new Set(["chicken", "cookie", "tart", "cup", "sauce", "bar", "cracker", "chip", "squash", "popcorn", "cake", "candy", "croissant", "ravioli", "tart", "pecan", "flavour", "flavor", "seasoning", "dip", "spread", "wrap", "pie", "lettuce", "bean", "milk", "noodle", "soup", "rice", "pasta", "roll", "bun", "sandwich", "pizza", "burger", "stick", "nugget", "strip", "finger", "kiev", "cordon", "bites", "bite", "pop", "pod", "mix", "drink", "beverage"]);
function relevant(q, name) {
  const qt = tokens(q), nt = tokens(name);
  const qs = new Set(qt);
  for (let i = 0; i < nt.length; i++) {
    if (nt[i] !== qt[0] && !(qt[0].length >= 4 && nt[i].startsWith(qt[0]))) continue;
    const prev = nt[i - 1], next = nt[i + qt.length];
    if (prev && BEFORE.has(prev) && !qs.has(prev)) return false;
    if (next && AFTER.has(next) && !qs.has(next)) return false;
    return true;
  }
  return true;
}

function analyseWatch(w) {
  const ex = w.ex || [], hide = w.hide || [];
  const cur = D.items.filter((i) => okStore(i.m) && matches(w.q, i.n, ex) && !hide.includes(i.norm));
  const counts = {};
  for (const i of cur) if (i.up && relevant(w.q, i.n)) counts[i.b] = (counts[i.b] || 0) + 1;
  const basis = Object.keys(counts).sort((a, b) => (counts[b] - counts[a]) || (a === "ea" ? 1 : -1))[0] || "ea";
  const hist = histFor(w.q, ex, hide);
  const rated = cur.map((i) => {
    const others = cur.filter((o) => o.m !== i.m && o.b === i.b && o.up).map((o) => o.up);
    // per-item prices only compare against the exact same product; weight/volume prices compare across the whole item
    const past = hist.filter((p) => p[2] === i.b && isPast(p) && (i.b !== "ea" || p[6] === i.norm)).map((p) => p[1]);
    return { ...i, rel: relevant(w.q, i.n), r: rate(i.up, i.b, past, others, i.sav, w.target, w.tb) };
  });
  rated.sort((a, b) => (b.rel - a.rel) || (a.b === basis ? 0 : 1) - (b.b === basis ? 0 : 1) || (a.up ?? 1e9) - (b.up ?? 1e9));
  const curIds = new Set(cur.map((i) => i.id));
  const flyerOnly = D.allFlyerItems.filter((i) => okStore(i.m) && !curIds.has(i.id) && matches(w.q, i.n, ex));
  return { cur: rated, basis, hist: hist.filter((p) => p[2] === basis), flyerOnly };
}

function sparkline(points, basis, curBest) {
  // weekly lowest price over the last ~6 months
  const byWeek = {};
  for (const p of points) {
    const d = new Date(p[0]); const wk = Math.floor(d / (7 * 86400000));
    byWeek[wk] = Math.min(byWeek[wk] ?? 1e9, p[1]);
  }
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b).slice(-26);
  if (weeks.length < 3) return "";
  const vals = weeks.map((w) => byWeek[w]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 300, H = 34, n = vals.length - 1;
  const pts = vals.map((v, i) => `${(i / n) * (W - 4) + 2},${H - 4 - ((v - lo) / span) * (H - 10)}`).join(" ");
  const last = pts.split(" ").pop().split(",");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Lowest weekly price, last ${vals.length} weeks: ${fmtUnit(lo, basis)} to ${fmtUnit(hi, basis)}">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--accent)"/></svg>
    <div class="unit">Weekly low, last ${vals.length} weeks: ${fmtUnit(lo, basis)} – ${fmtUnit(hi, basis)}</div>`;
}

// ------------------------------------------------------------------ list helpers
const inList = (id) => S.list.some((x) => x.id === id);
function toggleList(it) {
  if (inList(it.id)) { S.list = S.list.filter((x) => x.id !== it.id); toast("Removed from list"); }
  else {
    S.list.push({ id: it.id, m: it.m, n: it.n, price: it.price ?? it.p ?? null, ptxt: it.ptxt || priceText(it),
      img: it.img, to: it.to, qty: 1, done: false });
    toast(`Added to list · ${it.m}`);
  }
  save("list"); updateCount();
}
function updateCount() { $("#listCount").textContent = S.list.filter((x) => !x.done).length || ""; }
const itemIndex = new Map();
function reg(it) { itemIndex.set(String(it.id), it); return String(it.id); }

function addBtn(id, it) {
  return `<button class="addbtn ${inList(it.id) ? "on" : ""}" data-add="${id}" aria-label="Add to shopping list">${inList(it.id) ? "✓" : "+"}</button>`;
}
function dealRow(it, opts = {}) {
  const id = reg(it);
  const r = it.r || { tier: it.tier || "unknown", why: it.why ? [it.why] : [] };
  const loc = D.local.has(it.m) ? ` <span class="badge b-local">Lacombe</span>` : "";
  return `<div class="row ${it.m === S.home ? "home" : ""}">
    ${it.img ? `<img loading="lazy" src="${esc(it.img)}" alt="">` : ""}
    <div class="info">
      <div class="store">${esc(it.m)}${loc}</div>
      <a class="nm" href="${itemUrl(it.id)}" target="_blank" rel="noopener">${esc(it.n)}</a>
      <div class="pline"><span class="price">${esc(priceText(it))}</span> <span class="unit">${esc([unitText(it), until(it.to)].filter(Boolean).join(" · "))}</span></div>
      ${opts.noBadge ? "" : `<div class="tline">${badge(r.tier)} <span class="why">${esc(r.why.join(" · "))}</span></div>`}
      ${opts.extra || ""}
    </div>
    ${addBtn(id, it)}
  </div>`;
}
function flyerRow(it) {
  const id = reg({ ...it, price: it.p, ptxt: `$${it.p.toFixed(2)}` });
  const loc = D.local.has(it.m) ? ` <span class="badge b-local">Lacombe</span>` : "";
  return `<div class="row ${it.m === S.home ? "home" : ""}">
    ${it.img ? `<img loading="lazy" src="${esc(it.img)}" alt="">` : ""}
    <div class="info"><div class="store">${esc(it.m)}${loc}</div>
      <a class="nm" href="${itemUrl(it.id)}" target="_blank" rel="noopener">${esc(it.n)}</a>
      <div class="pline"><span class="price">$${it.p.toFixed(2)}</span> <span class="unit">${esc(until(it.to))}</span> ${it.d ? `<span class="badge t-good">${it.d}% off</span>` : ""}</div></div>
    ${addBtn(id, it)}
  </div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  const it = itemIndex.get(b.dataset.add);
  if (!it) return;
  toggleList(it);
  const on = inList(it.id);
  $$(`[data-add="${b.dataset.add}"]`).forEach((x) => { x.classList.toggle("on", on); x.textContent = on ? "✓" : "+"; });
});

// ------------------------------------------------------------------ views: groceries
const SUGGEST = ["chicken breast", "ground beef", "milk", "eggs", "butter", "cheddar", "bread", "bacon",
  "coffee", "bananas", "apples", "pork chops", "yogurt", "cheese", "pasta", "chips", "ice cream"];

function viewWatch() {
  const el = $("#gview");
  const sugg = SUGGEST.filter((s) => !S.watch.some((w) => w.q === s));
  let html = `<form class="addrow" id="addWatch">
      <input type="text" id="watchInput" placeholder="Add something you buy, e.g. chicken breast" autocomplete="off" enterkeyhint="done">
      <button class="btn">Add</button></form>`;
  if (!S.watch.length) {
    html += `<div class="card empty"><p><strong>Add the groceries you buy often.</strong><br>
      Each one is checked against the Sobeys, No Frills, Co-op, M&amp;M, Shoppers and Rexall flyers every 6 hours and rated from
      <em>Regular price</em> up to <em>Stock up</em>, based on its price history.</p></div>`;
  }
  if (sugg.length) html += `<div class="suggest">${sugg.slice(0, 12).map((s) => `<button class="chip sm" data-sugg="${esc(s)}">+ ${esc(s)}</button>`).join("")}</div>`;

  const analysed = S.watch.map((w) => ({ w, a: analyseWatch(w) }));
  // best deals first
  const rank = (x) => { const b = x.a.cur[0]; return b ? TIER_ORDER.indexOf(bestTier(x.a)) : -1; };
  analysed.sort((x, y) => rank(y) - rank(x));
  html += `<div class="stack">${analysed.map(({ w, a }) => watchCard(w, a)).join("")}</div>`;
  if (S.watch.length) html += `<p class="small muted" style="margin-top:14px">Your items are saved on this device.
    <button class="link small" id="shareBtn">Share them to another phone</button></p>`;
  el.innerHTML = html;

  $("#addWatch").onsubmit = (e) => { e.preventDefault(); addWatch($("#watchInput").value); };
  $$("[data-sugg]", el).forEach((b) => (b.onclick = () => addWatch(b.dataset.sugg)));
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => editWatch(b.dataset.edit)));
  $$("[data-hide]", el).forEach((b) => (b.onclick = () => hideMatch(b.dataset.w, b.dataset.hide)));
  const sb = $("#shareBtn", el); if (sb) sb.onclick = shareData;
}
function bestTier(a) {
  let t = "unknown";
  for (const i of a.cur) if (TIER_ORDER.indexOf(i.r.tier) > TIER_ORDER.indexOf(t) && i.r.tier !== "above") t = i.r.tier;
  return t;
}
function watchCard(w, a) {
  const best = a.cur.find((i) => i.rel && i.b === a.basis) || a.cur.find((i) => i.rel) || a.cur[0];
  let body;
  if (!best && a.flyerOnly.length) {
    const fo = a.flyerOnly.slice().sort((x, y) => x.p - y.p)[0];
    const id = reg({ ...fo, price: fo.p, ptxt: `$${fo.p.toFixed(2)}` });
    body = `<div class="best">${fo.img ? `<img loading="lazy" src="${esc(fo.img)}" alt="">` : ""}
      <div class="info"><div>${fo.d ? `<span class="badge t-good">${fo.d}% off</span> ` : ""}<span class="store">${esc(fo.m)}</span>${D.local.has(fo.m) ? ` <span class="badge b-local">Lacombe</span>` : ""}</div>
      <div class="nm small">${esc(fo.n)}</div><div><span class="price">$${fo.p.toFixed(2)}</span> <span class="unit">${esc(until(fo.to))}</span></div>
      <div class="why">Lowest flyer price · no price history for this one yet</div></div>
      <button class="addbtn ${inList(fo.id) ? "on" : ""}" data-add="${id}" aria-label="Add to shopping list">${inList(fo.id) ? "✓" : "+"}</button></div>`;
  } else if (!best) {
    body = `<p class="muted small" style="margin:8px 0 0">Not in any flyer this week — checked every 6 hours.</p>`;
  } else {
    const relCur = a.cur.filter((i) => i.rel === best.rel);
    const homeItems = relCur.filter((i) => i.m === S.home && okStore(i.m))
      .sort((x, y) => (TIER_ORDER.indexOf(y.r.tier) - TIER_ORDER.indexOf(x.r.tier)) || ((x.up ?? 1e9) - (y.up ?? 1e9)));
    let show, note = "";
    if (homeItems.length) {
      show = homeItems[0];
      const alt = relCur.filter((i) => i.m !== S.home && i.b === show.b && i.up && show.up && i.up <= show.up * 0.9)
        .sort((x, y) => x.up - y.up)[0];
      if (alt) note = `<div class="tip">Cheaper at ${esc(alt.m)}: ${esc(priceText(alt))}${alt.b !== "ea" ? " (" + esc(fmtUnit(alt.up, alt.b)) + ")" : ""} · ${Math.round(100 * (1 - alt.up / show.up))}% less</div>`;
    } else {
      const pool = a.cur.filter((i) => i.b === best.b && i.rel === best.rel && i.r.tier !== "above");
      const top = pool.reduce((acc, i) => (TIER_ORDER.indexOf(i.r.tier) > TIER_ORDER.indexOf(acc.r.tier) ? i : acc), best);
      show = TIER_ORDER.indexOf(top.r.tier) > TIER_ORDER.indexOf(best.r.tier) ? top : best;
      if (S.home && okStore(S.home)) note = `<div class="tip muted-tip">Not on sale at ${esc(S.home)} this week</div>`;
    }
    const id = reg(show);
    body = `<div class="best">
      ${show.img ? `<img loading="lazy" src="${esc(show.img)}" alt="">` : ""}
      <div class="info">
        <div>${badge(show.r.tier)} <span class="store">${esc(show.m)}</span>${show.m === S.home ? ` <span class="badge b-local">Your store</span>` : ""}${D.local.has(show.m) ? ` <span class="badge b-local">Lacombe</span>` : ""}</div>
        <div class="nm small">${esc(show.n)}</div>
        <div><span class="price">${esc(priceText(show))}</span> <span class="unit">${esc([unitText(show), until(show.to)].filter(Boolean).join(" · "))}</span></div>
        <div class="why">${esc(show.r.why.join(" · ") || (show === best ? "lowest price this week" : ""))}</div>
        ${note}
      </div>
      <button class="addbtn ${inList(show.id) ? "on" : ""}" data-add="${id}" aria-label="Add to shopping list">${inList(show.id) ? "✓" : "+"}</button>
    </div>`;
  }
  const n = a.cur.length + a.flyerOnly.length;
  const others = a.cur.map((i) => dealRowWatch(i, w)).join("") + a.flyerOnly.slice(0, 15).map(flyerRow).join("");
  return `<article class="card watch">
    <div class="watch-head"><div class="title"><h3>${esc(w.q)}</h3>
      <div class="small muted">${(() => { const all = [...a.cur, ...a.flyerOnly]; return all.length ? (() => { const n = new Set(all.map((i) => i.m)).size; return `${all.length} in flyers at ${n} store${n === 1 ? "" : "s"}`; })() : ""; })()}${w.target ? ` · target ${fmtUnit(w.target, w.tb)}` : ""}</div></div>
      <button class="iconbtn" data-edit="${w.id}" aria-label="Edit ${esc(w.q)}">⋯</button></div>
    ${body}
    ${sparkline(a.hist, a.basis)}
    ${n > 1 || a.flyerOnly.length ? `<details class="more"><summary>Compare all ${n} matches</summary><div class="rows">${others}</div>
      <p class="small muted">Wrong item showing up? Tap <strong>Not this</strong> to hide it, or add “exclude” words with ⋯.</p></details>` : ""}
  </article>`;
}
function dealRowWatch(i, w) {
  return dealRow(i, { extra: `<button class="link small" data-hide="${esc(i.norm)}" data-w="${w.id}">Not this</button>` });
}
function addWatch(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return;
  if (S.watch.some((w) => w.q === q)) { toast("Already on your list"); return; }
  S.watch.push({ id: uid(), q, ex: [], hide: [] });
  save("watch"); render(); toast(`Watching “${q}”`);
}
function hideMatch(wid, norm) {
  const w = S.watch.find((x) => x.id === wid); if (!w) return;
  w.hide = [...new Set([...(w.hide || []), norm])]; save("watch"); render(); toast("Hidden from this item");
}
function editWatch(wid) {
  const w = S.watch.find((x) => x.id === wid); if (!w) return;
  const tb = w.tb || "kg";
  const tval = w.target ? (w.tb === "kg" ? (w.target / LB).toFixed(2) : w.target.toFixed(2)) : "";
  openSheet(`<div class="sheet-head"><h2 style="margin:0">Edit item</h2><button class="iconbtn" data-close>✕</button></div>
    <div class="field"><label for="eq">Search words</label><input type="text" id="eq" value="${esc(w.q)}">
      <div class="small muted">Every word must appear in the flyer item (plurals are fine).</div></div>
    <div class="field"><label for="eex">Exclude words (comma separated)</label><input type="text" id="eex" value="${esc((w.ex || []).join(", "))}" placeholder="e.g. breaded, nuggets, deli">
      </div>
    <div class="field"><label>Alert me when it's at or under</label><div class="inline">
      <input type="number" id="et" inputmode="decimal" step="0.01" min="0" placeholder="Target price" value="${tval}">
      <select id="etb"><option value="kg" ${tb === "kg" ? "selected" : ""}>per lb</option><option value="L" ${tb === "L" ? "selected" : ""}>per litre</option><option value="ea" ${tb === "ea" ? "selected" : ""}>each</option></select></div>
      <div class="small muted">Anything at or under this shows as <strong>Stock up</strong>.</div></div>
    ${(w.hide || []).length ? `<div class="field"><label>Hidden matches</label><div class="small muted">${w.hide.length} hidden · <button class="link small" id="unhide">Show them again</button></div></div>` : ""}
    <div class="inline" style="justify-content:space-between;margin-top:16px"><button class="btn danger" id="edel">Remove item</button><button class="btn" id="esave">Save</button></div>`,
  (el) => {
    $("[data-close]", el).onclick = closeSheet;
    const uh = $("#unhide", el); if (uh) uh.onclick = () => { w.hide = []; save("watch"); closeSheet(); render(); };
    $("#edel", el).onclick = () => { S.watch = S.watch.filter((x) => x !== w); save("watch"); closeSheet(); render(); toast("Removed"); };
    $("#esave", el).onclick = () => {
      w.q = $("#eq", el).value.trim().toLowerCase() || w.q;
      w.ex = $("#eex", el).value.split(",").map((s) => s.trim()).filter(Boolean);
      const t = parseFloat($("#et", el).value); w.tb = $("#etb", el).value;
      w.target = t > 0 ? (w.tb === "kg" ? t * LB : t) : null;
      save("watch"); closeSheet(); render(); toast("Saved");
    };
  });
}

function viewTop() {
  const el = $("#gview");
  const depts = [...new Set(D.items.map((i) => i.dept).filter(Boolean))];
  const order = ["Meat & seafood", "Dairy & eggs", "Produce", "Bakery & breakfast", "Pantry & snacks", "Frozen", "Drinks", "Household & personal"];
  depts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const homeOnly = S.topScope === "home" && S.home;
  let list = D.items.filter((i) => okStore(i.m) && (!homeOnly || i.m === S.home) && (!S.dept || i.dept === S.dept) &&
    (["stockup", "great", "good"].includes(i.tier)));
  const seen = new Set();
  list = list.filter((i) => { const k = i.m + "|" + i.norm; if (seen.has(k)) return false; seen.add(k); return true; });
  list.sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier) || ((b.pct ?? b.sav ?? 0) - (a.pct ?? a.sav ?? 0)));
  const since = D.hist.since;
  const weeks = since ? Math.max(0, Math.floor((now - new Date(since)) / (7 * 86400000))) : 0;
  el.innerHTML = `${S.home ? `<div class="subnav" style="padding-top:0"><button class="chip sm ${homeOnly ? "active" : ""}" data-scope="home">${esc(S.home)}</button><button class="chip sm ${homeOnly ? "" : "active"}" data-scope="all">All stores</button></div>` : ""}
    <div class="filters"><select id="dept" aria-label="Department"><option value="">All departments</option>
      ${depts.map((d) => `<option ${S.dept === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
    ${weeks < 4 ? `<div class="warn">Price history started ${esc(since || "today")}. Until a few weeks are collected, ratings lean on store “% off” claims and other stores' prices, so expect fewer <strong>Stock up</strong> tags at first.</div>` : ""}
    <div class="legend">${["stockup", "great", "good"].map(badge).join("")}</div>
    ${list.length ? `<div class="card rows">${list.slice(0, 150).map((i) => dealRow({ ...i, r: { tier: i.tier, why: i.why ? [i.why] : [] } })).join("")}</div>`
      : `<div class="card empty">No standout deals ${homeOnly ? "at " + esc(S.home) : "for these stores"} right now.</div>`}`;
  $$("[data-scope]", el).forEach((b) => (b.onclick = () => { S.topScope = b.dataset.scope; save("topScope"); render(); }));
  $("#dept").onchange = (e) => { S.dept = e.target.value; save("dept"); render(); };
}

let compareQ = "";
function viewCompare() {
  const el = $("#gview");
  el.innerHTML = `<form class="addrow" id="cmp"><input type="search" id="cq" placeholder="Compare prices, e.g. butter" value="${esc(compareQ)}" enterkeyhint="search"><button class="btn">Go</button></form><div id="cres"></div>`;
  $("#cmp").onsubmit = (e) => { e.preventDefault(); compareQ = $("#cq").value.trim(); showCompare(); };
  $("#cq").oninput = () => { compareQ = $("#cq").value.trim(); clearTimeout(viewCompare._t); viewCompare._t = setTimeout(showCompare, 250); };
  showCompare();
}
function showCompare() {
  const out = $("#cres"); if (!out) return;
  if (compareQ.length < 2) { out.innerHTML = `<div class="card empty">Type anything — it searches every Lacombe grocery flyer and sorts by price per lb, litre or item.</div>`; return; }
  const cur = D.items.filter((i) => okStore(i.m) && matches(compareQ, i.n));
  const ids = new Set(cur.map((i) => i.id));
  const fo = D.allFlyerItems.filter((i) => okStore(i.m) && !ids.has(i.id) && matches(compareQ, i.n));
  const groups = { kg: [], L: [], ea: [] };
  for (const i of cur) (groups[i.b] || groups.ea).push(i);
  const names = { kg: "Priced by weight (per lb)", L: "Priced by volume (per litre)", ea: "Priced per item" };
  let html = "";
  for (const b of ["kg", "L", "ea"]) {
    const g = groups[b]; if (!g.length) continue;
    g.sort((x, y) => (x.up ?? 1e9) - (y.up ?? 1e9));
    html += `<h2>${names[b]}</h2><div class="card rows">${g.map((i) => {
      const others = g.filter((o) => o.m !== i.m && o.up).map((o) => o.up);
      const past = (D.hist.h[i.norm] || []).filter((p) => p[2] === i.b && isPast(p)).map((p) => p[1]);
      return dealRow({ ...i, r: rate(i.up, i.b, past, others, i.sav) });
    }).join("")}</div>`;
  }
  if (fo.length) html += `<h2>Also in flyers</h2><div class="card rows">${fo.sort((a, b) => a.p - b.p).slice(0, 60).map(flyerRow).join("")}</div>`;
  out.innerHTML = html || `<div class="card empty">Nothing matching “${esc(compareQ)}” in this week's flyers.</div>`;
}

function viewFlyers() {
  const el = $("#gview");
  const fl = D.flyers.filter((f) => okStore(f.merchant)).sort((a, b) => (b.local - a.local) || a.merchant.localeCompare(b.merchant));
  el.innerHTML = fl.length ? `<div class="grid">${fl.map((f) => `<button class="flyer" data-fly="${f.id}">
      <div class="thumb" style="background-image:url('${esc(f.thumb)}')"></div>
      <div class="meta"><div class="merchant">${esc(f.merchant)}</div>
      <div class="small muted">${esc(f.name.length > 28 ? "Weekly flyer" : f.name)}</div>
      <div class="small">${f.local ? `<span class="badge b-local">Lacombe</span> ` : ""}${esc(until(f.to))}</div></div></button>`).join("")}</div>`
    : `<div class="card empty">No flyers for the selected stores.</div>`;
  $$("[data-fly]", el).forEach((b) => (b.onclick = () => openFlyer(b.dataset.fly)));
}
function openFlyer(fid) {
  const f = D.flyerById[fid];
  const items = (D.flyerItems[fid] || []).map((i) => ({ ...i, fid: Number(fid), m: f.merchant, to: f.to }));
  const draw = (q, sort) => {
    let l = q ? items.filter((i) => matches(q, i.n)) : items.slice();
    if (sort === "disc") l.sort((a, b) => (b.d || 0) - (a.d || 0));
    if (sort === "price") l.sort((a, b) => a.p - b.p);
    $("#flist").innerHTML = l.length ? l.slice(0, 300).map(flyerRow).join("") : `<div class="empty">No items</div>`;
  };
  openSheet(`<div class="sheet-head"><div><h2 style="margin:0">${esc(f.merchant)}</h2><div class="small muted">${esc(f.name)} · ${esc(until(f.to))}</div></div><button class="iconbtn" data-close>✕</button></div>
    <p class="small"><a href="${flyerUrl(f.id)}" target="_blank" rel="noopener">Open the full flyer on Flipp ↗</a></p>
    <div class="filters"><input type="search" id="fq" placeholder="Search this flyer"><select id="fs" style="flex:0 0 130px"><option value="">Flyer order</option><option value="disc">Biggest % off</option><option value="price">Lowest price</option></select></div>
    <div class="card rows" id="flist"></div>`, (el) => {
    $("[data-close]", el).onclick = closeSheet;
    const up = () => draw($("#fq", el).value.trim(), $("#fs", el).value);
    $("#fq", el).oninput = up; $("#fs", el).onchange = up; up();
  });
}

function viewList() {
  const el = $("#gview");
  if (!S.list.length) { el.innerHTML = `<div class="card empty">Tap <strong>+</strong> on any deal to add it here. Your list is grouped by store.</div>`; return; }
  const by = {};
  for (const x of S.list) (by[x.m] = by[x.m] || []).push(x);
  let total = 0;
  const html = Object.entries(by).sort().map(([m, xs]) => {
    let sub = 0;
    const rows = xs.map((x) => {
      if (x.price && !/lb|100 g/.test(x.ptxt || "")) sub += x.price * x.qty;
      const exp = x.to && !active(x.to);
      return `<div class="row ${x.done ? "done" : ""}">
        <input type="checkbox" class="check" data-done="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Got it">
        <div class="info"><div class="nm">${esc(x.n)}</div><div class="small muted">${esc(x.ptxt || "")}${exp ? " · <strong>sale ended</strong>" : x.to ? " · " + esc(until(x.to)) : ""}</div></div>
        <div class="qty"><button data-q="${esc(x.id)}" data-d="-1" aria-label="Less">−</button><span>${x.qty}</span><button data-q="${esc(x.id)}" data-d="1" aria-label="More">+</button></div>
      </div>`;
    }).join("");
    total += sub;
    return `<div class="card listgroup"><h3><span>${esc(m)}</span><span class="muted small">${sub ? "≈ $" + sub.toFixed(2) : ""}</span></h3><div class="rows">${rows}</div></div>`;
  }).join("");
  el.innerHTML = `<div class="stack">${html}</div>
    <p class="small muted">Estimated total ≈ $${total.toFixed(2)} (items sold by weight not included)</p>
    <div class="inline"><button class="btn ghost" id="copyList">Copy list</button><button class="btn ghost" id="clearDone">Clear checked</button><button class="btn danger" id="clearAll">Clear all</button></div>`;
  $$("[data-done]", el).forEach((c) => (c.onchange = () => { const x = S.list.find((y) => String(y.id) === c.dataset.done); x.done = c.checked; save("list"); updateCount(); viewList(); }));
  $$("[data-q]", el).forEach((b) => (b.onclick = () => {
    const x = S.list.find((y) => String(y.id) === b.dataset.q); x.qty += Number(b.dataset.d);
    if (x.qty < 1) S.list = S.list.filter((y) => y !== x);
    save("list"); updateCount(); viewList();
  }));
  $("#clearDone").onclick = () => { S.list = S.list.filter((x) => !x.done); save("list"); updateCount(); viewList(); };
  $("#clearAll").onclick = () => { if (confirm("Clear the whole list?")) { S.list = []; save("list"); updateCount(); viewList(); } };
  $("#copyList").onclick = async () => {
    const txt = Object.entries(by).sort().map(([m, xs]) => `${m}\n` + xs.filter((x) => !x.done).map((x) => `- ${x.qty > 1 ? x.qty + " × " : ""}${x.n} (${x.ptxt})`).join("\n")).join("\n\n");
    try { await navigator.clipboard.writeText(txt); toast("List copied — paste it in a text"); }
    catch { openSheet(`<div class="sheet-head"><h2 style="margin:0">Your list</h2><button class="iconbtn" data-close>✕</button></div><textarea rows="14">${esc(txt)}</textarea>`, (e) => ($("[data-close]", e).onclick = closeSheet)); }
  };
}

// ------------------------------------------------------------------ view: restaurants
function viewRestaurants() {
  const el = $("#rview");
  const rfd = D.rest.rfd || [];
  const local = rfd.filter((p) => p.local);
  const other = rfd.filter((p) => !p.local);
  const rfdList = (arr, empty) => arr.length ? `<div class="card">${arr.slice(0, 40).map((p) => `<a class="rfd" href="${esc(p.link)}" target="_blank" rel="noopener">
      <div class="t">${esc(p.title)}</div><div class="small muted">${esc(p.chain ? p.chain + " · " : "")}posted ${esc(ago(p.published))}</div></a>`).join("")}</div>`
    : `<div class="card empty small">${empty}</div>`;
  const rests = (D.rest.restaurants || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const gsearch = (n) => `https://www.google.com/search?tbs=qdr:m&q=${encodeURIComponent(`"${n}" deal OR special OR promo Alberta`)}`;
  const dealCount = (n) => local.filter((p) => normalize(p.chain).replace(/ /g, "") === normalize(n).replace(/ /g, "")).length;

  el.innerHTML = `
    <h2 style="margin-top:4px">Deals at Lacombe restaurants</h2>
    ${rfdList(local, "No deals posted for Lacombe restaurants in the last 30 days — checked every 6 hours.")}
    <p class="small muted">Deals spotted on RedFlagDeals for chains with a Lacombe location (delivery-app offers are left out). Some are app-only or “participating locations” — check before you go.</p>

    <h2>My restaurant notes</h2>
    <form class="addrow" id="noteForm"><input type="text" id="noteText" placeholder="e.g. Boston Pizza – Tuesday kids eat free"><button class="btn">Add</button></form>
    ${S.notes.length ? `<div class="card">${S.notes.map((n) => `<div class="note"><div style="flex:1">${esc(n.text)}</div><button class="iconbtn" data-dnote="${n.id}" aria-label="Delete note">✕</button></div>`).join("")}</div>`
      : `<p class="small muted">Keep track of weekly specials you know about (wing night, kids eat free…).</p>`}

    <h2>Lacombe restaurants</h2>
    <div class="card rows">${rests.map((r) => {
      const n = dealCount(r.name);
      return `<div class="row"><div class="info"><div class="store">${esc(r.name)} ${n ? `<span class="badge t-great">${n} deal${n > 1 ? "s" : ""}</span>` : ""}</div>
        <div class="small muted">${esc(r.type || "")}${r.app ? " · best deals are in their app" : ""}</div></div>
        <div class="side small"><a href="${gsearch(r.name)}" target="_blank" rel="noopener">Find deals ↗</a></div></div>`;
    }).join("")}</div>

    <details class="more"><summary>Other restaurant deals in Canada (${other.length})</summary>${rfdList(other, "Nothing in the last 30 days.")}</details>`;
  $("#noteForm").onsubmit = (e) => { e.preventDefault(); const t = $("#noteText").value.trim(); if (!t) return; S.notes.push({ id: uid(), text: t }); save("notes"); viewRestaurants(); };
  $$("[data-dnote]", el).forEach((b) => (b.onclick = () => { S.notes = S.notes.filter((n) => n.id !== b.dataset.dnote); save("notes"); viewRestaurants(); }));
}

// ------------------------------------------------------------------ stores sheet
function storesSheet() {
  const ms = [...new Set(D.flyers.map((f) => f.merchant))].sort((a, b) => (D.local.has(b) - D.local.has(a)) || a.localeCompare(b));
  openSheet(`<div class="sheet-head"><h2 style="margin:0">Stores</h2><button class="iconbtn" data-close>✕</button></div>
    <div class="field"><label for="homeSel">Your usual store (shown first everywhere)</label>
      <select id="homeSel"><option value="">None</option>${ms.map((m) => `<option ${S.home === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
    <p class="small muted">Lacombe stores with a weekly flyer (food and drinks only). Untick any you don't shop at.</p>
    <div class="card rows">${ms.map((m) => `<label class="row" style="cursor:pointer"><input type="checkbox" class="check" data-store="${esc(m)}" ${S.off[m] ? "" : "checked"}>
      <div class="info"><span class="store">${esc(m)}</span></div></label>`).join("")}</div>`,
  (el) => {
    $("[data-close]", el).onclick = closeSheet;
    $("#homeSel", el).onchange = (e) => { S.home = e.target.value; save("home"); storebar(); render(); };
    $$("[data-store]", el).forEach((c) => (c.onchange = () => { if (c.checked) delete S.off[c.dataset.store]; else S.off[c.dataset.store] = true; save("off"); render(); }));
  });
}

// ------------------------------------------------------------------ sharing between devices
function shareData() {
  const payload = { watch: S.watch, off: S.off, notes: S.notes, home: S.home };
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = `${location.origin}${location.pathname}#import=${code}`;
  openSheet(`<div class="sheet-head"><h2 style="margin:0">Share your items</h2><button class="iconbtn" data-close>✕</button></div>
    <p class="small">Open this link on the other phone or computer to copy your watched items, store choices and notes there.</p>
    <textarea rows="4" readonly>${esc(url)}</textarea>
    <div class="inline" style="margin-top:10px"><button class="btn" id="cp">Copy link</button>${navigator.share ? `<button class="btn ghost" id="sh">Share…</button>` : ""}</div>`,
  (el) => {
    $("[data-close]", el).onclick = closeSheet;
    $("#cp", el).onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { $("textarea", el).select(); } };
    const sh = $("#sh", el); if (sh) sh.onclick = () => navigator.share({ title: "Lacombe Deals – my items", url }).catch(() => {});
  });
}
function checkImport() {
  const m = location.hash.match(/#import=([^&]+)/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    const n = (p.watch || []).filter((w) => !S.watch.some((x) => x.q === w.q)).length;
    if (!confirm(`Add ${n} watched item${n === 1 ? "" : "s"} and the shared store choices to this device?`)) return;
    for (const w of p.watch || []) if (!S.watch.some((x) => x.q === w.q)) S.watch.push({ ...w, id: uid() });
    for (const nt of p.notes || []) if (!S.notes.some((x) => x.text === nt.text)) S.notes.push({ ...nt, id: uid() });
    S.off = { ...S.off, ...(p.off || {}) };
    if (p.home !== undefined) S.home = p.home;
    ["watch", "notes", "off", "home"].forEach(save);
    toast("Imported");
  } catch { toast("That share link didn't work"); }
}

// ------------------------------------------------------------------ shell
const VIEWS = { watch: viewWatch, top: viewTop, compare: viewCompare, flyers: viewFlyers, list: viewList };
function render() {
  itemIndex.clear();
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === S.tab));
  if (S.tab === "groceries") {
    $$(".subnav .chip").forEach((c) => c.classList.toggle("active", c.dataset.view === S.view));
    (VIEWS[S.view] || viewWatch)();
  } else viewRestaurants();
  updateCount();
}
function storebar() {
  const t = $(".storebar .muted");
  if (t) t.innerHTML = S.home ? `Your store: <strong>${esc(S.home)}</strong>` : "Lacombe grocery &amp; drug stores";
}
function header() {
  const g = D.meta.groceries || {}, r = D.meta.restaurants || {};
  const last = [g.updated, r.updated].filter(Boolean).sort().pop();
  const next = last ? new Date(new Date(last).getTime() + 6 * 3600000) : null;
  $("#updated").textContent = last
    ? `Updated ${ago(last)}${next && next > now ? ` · next in ~${Math.max(1, Math.round((next - now) / 3600000))} h` : ""}`
    : "Waiting for the first update…";
  const bits = [];
  if (g.ok === false) bits.push(`Grocery update failed ${ago(g.failed_at)} (showing the previous data).`);
  if (r.ok === false) bits.push(`Restaurant deals update failed ${ago(r.failed_at)}.`);
  if (g.stats) bits.push(`${g.stats.flyers} flyers · ${g.stats.items} tracked prices · ${g.stats.history_points} price points since ${g.stats.history_since}.`);
  $("#sources").textContent = bits.join(" ");
}

$$(".tab").forEach((t) => (t.onclick = () => { S.tab = t.dataset.tab; save("tab"); render(); window.scrollTo(0, 0); }));
$$(".subnav .chip").forEach((c) => (c.onclick = () => { S.view = c.dataset.view; save("view"); render(); }));
const sb = $("#storesBtn"); if (sb) sb.onclick = storesSheet;
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });

(async function init() {
  try { await loadAll(); }
  catch (e) { $("#gview").innerHTML = `<div class="card empty">Couldn't load deals (${esc(e.message)}). Try again in a minute.</div>`; }
  checkImport();
  header();
  storebar();
  render();
})();
