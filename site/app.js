/* Lacombe Deals — this week's flyers turned into suppers, a swipeable flyer and a list.
   Data refreshes every 6 h (GitHub Actions). The list and settings live in this browser. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LB = 2.2046226;
const money = (v) => `$${Number(v).toFixed(2)}`;

// ------------------------------------------------------------ saved settings
const saved = {
  get(k, d) { try { const v = localStorage.getItem("ld2." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ld2." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const S = {
  tab: saved.get("tab", "week"),
  home: saved.get("home", "Sobeys"),
  off: saved.get("off", {}),
  list: saved.get("list", []),
  seen: saved.get("seen", {}),        // flip deck: deal id -> "yes" | "no"
  flipScope: saved.get("flipScope", "home"),
};
const keep = (k) => saved.set(k, S[k]);

// ------------------------------------------------------------ matching words to products
const STOP = new Set(["the", "a", "an", "of", "and", "or", "with", "in", "for", "fresh", "pc", "no", "name"]);
function normalize(t) {
  return (t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[®™]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const tokens = (t) => normalize(t).split(" ").filter((w) => w && !STOP.has(w)).map(stem);
const tokCache = new Map();
function tokSet(name) {
  let v = tokCache.get(name);
  if (!v) { v = new Set(tokens(name)); tokCache.set(name, v); }
  return v;
}
/** every word of the phrase appears in the name; words starting with "!" must not appear */
function has(name, phrase) {
  const set = tokSet(name);
  const parts = phrase.split(" ");
  const want = tokens(parts.filter((w) => !w.startsWith("!")).join(" "));
  const not = tokens(parts.filter((w) => w.startsWith("!")).map((w) => w.slice(1)).join(" "));
  return want.length > 0 && want.every((w) => set.has(w)) && !not.some((w) => set.has(w));
}
const hasAny = (name, phrases) => phrases.some((p) => has(name, p));

// ------------------------------------------------------------ data
const D = { deals: [], flyers: [], meta: {}, rfd: [] };
const now = new Date();

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path} (${r.status})`);
  return r.json();
}
function priceText(it) {
  if (it.price == null) return "";
  if (it.multi) return `${it.multi} for ${money(it.price * it.multi)}`;
  if (it.b === "kg" && /lb/i.test(it.post || "")) return `${money(it.price)}/lb`;
  if (it.b === "kg" && /100\s*g/i.test(it.post || "")) return `${money(it.price)}/100 g`;
  return money(it.price);
}
async function load() {
  const [meta, items, flyers, fitems, rest] = await Promise.all([
    getJSON("data/meta.json"), getJSON("data/items.json"), getJSON("data/flyers.json"),
    getJSON("data/flyer_items.json"), getJSON("data/restaurants.json").catch(() => ({ rfd: [] })),
  ]);
  D.meta = meta;
  D.flyers = flyers.filter((f) => new Date(f.to) > now);
  D.rfd = (rest.rfd || []).filter((p) => p.local);
  const byFlyer = Object.fromEntries(D.flyers.map((f) => [String(f.id), f]));
  const searched = new Map(items.map((i) => [i.id, i]));
  const deals = new Map();
  // full flyer listings first (flyer order), enriched with unit pricing where we have it
  for (const [fid, arr] of Object.entries(fitems)) {
    const f = byFlyer[fid];
    if (!f) continue;
    arr.forEach((x, idx) => {
      const s = searched.get(x.id);
      deals.set(x.id, {
        id: x.id, m: f.merchant, n: x.n, img: x.img, to: f.to, fid: f.id, order: idx,
        price: s ? s.price : x.p, ptxt: s ? priceText(s) : money(x.p),
        b: s ? s.b : "ea", up: s ? s.up : null, sold: s && s.b === "kg" && /lb|100\s*g/i.test(s.post || "") ? s.post : "",
        pct: (s && s.sav) || x.d || null, dept: s ? s.dept : null,
      });
    });
  }
  // searched items that weren't in a listing
  for (const s of items) {
    if (deals.has(s.id) || !byFlyer[String(s.fid)]) continue;
    deals.set(s.id, { id: s.id, m: s.m, n: s.n, img: s.img, to: s.to, fid: s.fid, order: 9999, price: s.price,
      ptxt: priceText(s), b: s.b, up: s.up, sold: s.b === "kg" && /lb|100\s*g/i.test(s.post || "") ? s.post : "", pct: s.sav || null, dept: s.dept });
  }
  D.deals = [...deals.values()].filter((d) => d.price > 0 && new Date(d.to) > now);
  for (const d of D.deals) if (d.pct && (d.pct > 70 || d.pct < 5)) d.pct = null; // flyer data glitches
  D.stores = [...new Set(D.flyers.map((f) => f.merchant))].sort();
}
const ok = (d) => !S.off[d.m];
const isHome = (d) => d.m === S.home;

// ------------------------------------------------------------ the week
function weekRange() {
  const hf = D.flyers.find((f) => f.merchant === S.home) || D.flyers[0];
  if (!hf) return "This week";
  const a = new Date(hf.from), b = new Date(hf.to);
  const mon = (d) => d.toLocaleDateString("en-CA", { month: "short" });
  return mon(a) === mon(b) ? `${mon(a)} ${a.getDate()}–${b.getDate()}` : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
}
function endsIn(iso) {
  const d = new Date(iso);
  const days = Math.floor((d - now) / 86400000);
  if (days < 1) return "ends today";
  return `ends ${d.toLocaleDateString("en-CA", { weekday: "long" })}`;
}
const byDeal = (a, b) => (b.pct || 0) - (a.pct || 0) || a.order - b.order;

// ------------------------------------------------------------ suppers from the flyer
// Each supper needs one main from the flyer; sides come from the flyer when they're on sale,
// otherwise they're listed as "from the cupboard". lb = how much of a by-the-pound main to buy.
const SUPPERS = [
  { name: "Pot roast with potatoes and carrots", main: ["roast"], not: ["deli", "sliced", "chicken", "pork", "turkey", "coffee", "peanut", "nut", "potato", "roasted", "vegetable"], lb: 3, sides: [["potato !chip !salad !mashed"], ["carrot !cake"], ["onion !ring"]] },
  { name: "Steak night", main: ["steak"], not: ["sauce", "spice", "seasoning", "salmon", "cheese", "pie", "tip"], lb: 2, sides: [["potato !chip !salad"], ["mushroom !soup"], ["salad kit", "lettuce"]] },
  { name: "Tacos", main: ["ground beef", "ground turkey"], not: ["patty", "patties", "burger"], lb: 1.5, sides: [["tortilla !chip", "taco shell", "taco kit"], ["shredded cheese", "cheddar !cracker"], ["lettuce"], ["tomato !sauce !paste !soup !juice !ketchup !canned !diced"], ["salsa"], ["sour cream !chip !dip"]] },
  { name: "Spaghetti and meat sauce", main: ["ground beef", "italian sausage"], not: ["patty", "patties", "burger"], lb: 1.5, sides: [["spaghetti !sauce", "pasta !sauce !salad"], ["pasta sauce"], ["parmesan"], ["garlic bread", "baguette"]] },
  { name: "Chili", main: ["ground beef"], not: ["patty", "patties", "burger"], lb: 1.5, sides: [["kidney beans", "beans !green !coffee"], ["canned tomatoes", "diced tomatoes"], ["onion !ring"], ["cheddar !cracker", "shredded cheese"]] },
  { name: "Burgers and chips", main: ["burger", "patties", "ground beef"], not: ["bun", "seasoning", "plant"], lb: 2, sides: [["hamburger buns", "burger buns", "buns !hot !cinnamon"], ["cheese slices", "singles"], ["potato chips", "chips !chocolate !tortilla"], ["coca cola", "pepsi", "pop !corn !tart"]] },
  { name: "Chicken stir-fry", main: ["chicken breast", "chicken thigh"], not: ["breaded", "nugget", "strip", "deli", "sliced", "roasted", "cooked", "stuffed", "burger", "soup", "pie"], lb: 2, sides: [["rice !cake !krispie !crispy"], ["peppers !pepperoni !jalapeno", "pepper !pepperoni !black !jalapeno"], ["broccoli"], ["stir fry sauce", "teriyaki sauce", "soy sauce"]] },
  { name: "Sheet-pan chicken and vegetables", main: ["chicken drumstick", "chicken thigh", "chicken leg", "whole chicken"], not: ["breaded", "nugget", "wing", "cooked", "soup"], lb: 3, sides: [["potato !chip !salad !mashed"], ["carrot !cake"], ["broccoli", "brussels sprouts"]] },
  { name: "Wings night", main: ["wing"], not: ["sauce"], lb: 2, sides: [["celery"], ["carrot !cake"], ["ranch dressing", "ranch dip"], ["coca cola", "pepsi", "pop !corn !tart"]] },
  { name: "Pork chops with applesauce", main: ["pork chop"], lb: 2, sides: [["potato !chip !salad"], ["applesauce", "apple sauce", "apple !juice !pie !cider !crisp"], ["corn !flake !chip !pop", "green beans"]] },
  { name: "Roast pork loin", main: ["pork loin", "pork roast", "pork tenderloin", "pork shoulder"], not: ["chop", "back bacon", "sliced"], lb: 3, sides: [["potato !chip !salad"], ["carrot !cake"], ["apple !juice !pie !cider"]] },
  { name: "Ribs with corn and coleslaw", main: ["ribs"], not: ["prime rib", "rib eye", "ribeye"], lb: 3, sides: [["bbq sauce", "barbecue sauce"], ["corn !flake !chip !pop !beef"], ["coleslaw", "cabbage"]] },
  { name: "Salmon with rice and broccoli", main: ["salmon"], not: ["smoked", "canned", "sockeye salmon 142"], lb: 1.5, sides: [["rice !cake !krispie !crispy"], ["broccoli", "asparagus"], ["lemon !juice !tea !pie"]] },
  { name: "Fish and chips", main: ["fish", "cod", "haddock", "pollock"], not: ["canned", "tuna", "food"], lb: 0, sides: [["fries", "french fries"], ["coleslaw"], ["tartar"]] },
  { name: "Breakfast for supper", main: ["bacon", "breakfast sausage"], not: ["bit", "chip", "dressing", "kit", "caesar", "salad", "burger"], lb: 0, sides: [["eggs !roll !nog !white !chocolate"], ["bread !crumb !breaded !garlic"], ["hash brown", "potato !chip !salad !mashed"], ["orange juice", "juice !box"]] },
  { name: "Perogies and sausage", main: ["perogies", "perogy"], lb: 0, sides: [["kielbasa", "farmer sausage", "smoked sausage", "sausage !breakfast !roll"], ["sour cream !chip !dip"], ["onion !ring"]] },
  { name: "Pizza night", main: ["pizza"], not: ["sauce", "pop", "bites", "rolls", "crust", "pockets", "dough"], lb: 0, sides: [["coca cola", "pepsi", "pop !corn !tart"], ["salad kit", "caesar"], ["ice cream !cone !sandwich"]] },
  { name: "Soup and sandwiches", main: ["deli", "ham", "turkey breast", "sliced turkey"], not: ["ground", "whole", "bacon"], lb: 0, sides: [["bread !crumb !breaded !garlic"], ["soup !mix"], ["cheese slices", "cheddar !cracker"]] },
  { name: "Hot dogs and smokies", main: ["hot dog", "wiener", "smokies"], not: ["bun"], lb: 0, sides: [["hot dog buns", "buns !hamburger !cinnamon"], ["potato chips", "chips !chocolate"], ["coca cola", "pepsi", "pop !corn !tart"]] },
];
const fuzz = (d) => (d.n.match(/,| or /gi) || []).length; // "A, B or C" multi-product listings
function pick(cands) {
  // prefer the usual store, then a single clear product, then the bigger discount, then the lower price
  return cands.sort((a, b) => (isHome(b) - isHome(a)) || (fuzz(a) - fuzz(b)) || ((b.pct || 0) - (a.pct || 0)) || ((a.up ?? a.price) - (b.up ?? b.price)))[0];
}
function planSuppers() {
  const pool = D.deals.filter(ok);
  const plans = [];
  for (const t of SUPPERS) {
    const mains = pool.filter((d) => hasAny(d.n, t.main) && !hasAny(d.n, t.not || []));
    if (!mains.length) continue;
    const main = pick(mains);
    const sides = t.sides.map((alts) => {
      const c = pool.filter((d) => d.id !== main.id && hasAny(d.n, alts));
      return c.length ? { deal: pick(c) } : { need: alts[0] };
    });
    const onSale = sides.filter((s) => s.deal).length;
    const qty = main.sold ? (/100\s*g/i.test(main.sold) ? (t.lb || 1) * 4.536 : t.lb || 1) : 1;
    const cost = main.price * qty + sides.reduce((s, x) => s + (x.deal ? x.deal.price : 0), 0);
    const score = (main.pct || 8) + onSale * 6 + (isHome(main) ? 12 : 0);
    plans.push({ t, main, qty, sides, cost, score });
  }
  // best first, one supper per main ingredient
  plans.sort((a, b) => b.score - a.score);
  const used = new Set();
  return plans.filter((p) => !used.has(p.main.id) && used.add(p.main.id)).slice(0, 5);
}

// ------------------------------------------------------------ cheaper elsewhere (same kind of item, by weight/volume)
const TRIP = ["chicken breast", "ground beef", "butter", "milk", "eggs", "cheddar", "bacon", "coffee", "bananas", "apples",
  "potatoes", "pork chops", "salmon", "steak", "roast", "chicken thighs", "yogurt", "bread", "cream", "mozzarella"];
function worthTheTrip() {
  if (!S.home || S.off[S.home]) return [];
  const out = [];
  for (const q of TRIP) {
    const c = D.deals.filter((d) => ok(d) && d.up && d.b !== "ea" && has(d.n, q));
    const mine = c.filter(isHome).sort((a, b) => a.up - b.up)[0];
    const other = c.filter((d) => !isHome(d) && d.b === (mine ? mine.b : d.b)).sort((a, b) => a.up - b.up)[0];
    if (mine && other && other.up <= mine.up * 0.8) out.push({ q, mine, other, save: Math.round(100 * (1 - other.up / mine.up)) });
  }
  const seen = new Set();
  return out.sort((a, b) => b.save - a.save).filter((t) => !seen.has(t.other.id) && seen.add(t.other.id)).slice(0, 5);
}
const perUnit = (d) => (d.b === "kg" ? `${money(d.up / LB)}/lb` : d.b === "L" ? `${money(d.up)}/L` : money(d.price));

// ------------------------------------------------------------ list
const inList = (id) => S.list.some((x) => x.id === id);
function addToList(d, quiet) {
  if (inList(d.id)) return false;
  S.list.push({ id: d.id, m: d.m, n: d.n, ptxt: d.ptxt, price: d.price, sold: d.sold || "", img: d.img, to: d.to, qty: 1, done: false });
  keep("list"); updateCount();
  if (!quiet) toast(`Added to your ${d.m} list`);
  return true;
}
function removeFromList(id) { S.list = S.list.filter((x) => x.id !== id); keep("list"); updateCount(); }
function updateCount() { $("#listCount").textContent = S.list.filter((x) => !x.done).length || ""; }
const index = new Map();
const reg = (d) => { index.set(String(d.id), d); return String(d.id); };
function addBtn(d) {
  return `<button class="add ${inList(d.id) ? "on" : ""}" data-add="${reg(d)}">${inList(d.id) ? "On list" : "Add"}</button>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  const d = index.get(b.dataset.add);
  if (!d) return;
  if (inList(d.id)) { removeFromList(d.id); toast("Removed from your list"); } else addToList(d);
  $$(`[data-add="${b.dataset.add}"]`).forEach((x) => { const on = inList(d.id); x.classList.toggle("on", on); x.textContent = on ? "On list" : "Add"; });
});

// ------------------------------------------------------------ views
function tagHTML(d, size = "") {
  const m = d.ptxt.match(/^(\$[\d.]+)(.*)$/);
  if (m && !d.ptxt.includes(" for ")) return `<span class="tag ${size}">${esc(m[1])}<small>${esc(m[2])}</small></span>`;
  return `<span class="tag ${size}">${esc(d.ptxt)}</span>`;
}
const img = (d, alt = "") => (d.img ? `<img loading="lazy" src="${esc(d.img)}" alt="${esc(alt)}">` : `<span></span>`);

function viewWeek() {
  const home = S.home && !S.off[S.home] ? S.home : null;
  const mine = D.deals.filter((d) => ok(d) && (!home || isHome(d))).sort(byDeal);
  const hero = mine.find((d) => d.pct) || mine[0];
  const suppers = planSuppers();
  const trips = worthTheTrip();
  const pantryDepts = new Set(["Pantry & snacks", "Frozen", "Drinks", "Bakery & breakfast"]);
  const pantry = D.deals.filter((d) => ok(d) && pantryDepts.has(d.dept) && (d.pct || 0) >= 25).sort((a, b) => (isHome(b) - isHome(a)) || byDeal(a, b)).slice(0, 12);

  let h = `<h1 class="h-week">${esc(weekRange())}</h1>
    <p class="sub">${home ? `${esc(home)} flyer, plus ${D.flyers.length - 1} other Lacombe flyers.` : `${D.flyers.length} Lacombe flyers.`} Updated ${esc(ago(D.meta.groceries?.updated))}.</p>`;

  if (hero) {
    h += `<div class="hero"><div>${tagHTML(hero, "lg")}
      <p class="what">${esc(hero.n)}</p>
      <p class="where">${hero.pct ? `<span class="off">${hero.pct}% off</span> ` : ""}${esc(hero.m)}, ${esc(endsIn(hero.to))}</p>
      <p style="margin:10px 0 0">${addBtn(hero)}</p></div>${img(hero)}</div>`;
  }

  h += `<h2>Biggest deals at ${esc(home || "Lacombe stores")}</h2><p class="sub">Sorted by how much the store says you save.</p>
    <div class="shelf">${mine.filter((d) => d !== hero).slice(0, 14).map((d) => `<article class="tile">
      ${d.pct ? `<span class="off">${d.pct}%</span>` : ""}${img(d)}${tagHTML(d, "sm")}<div class="nm">${esc(d.n)}</div>${addBtn(d)}</article>`).join("")}</div>`;

  h += `<h2>Five suppers from this week's flyer</h2><p class="sub">Built around what's on sale${home ? `, at ${esc(home)} when it can be` : ""}. Add the lot to your list in one tap.</p>`;
  h += suppers.length ? suppers.map((p, i) => {
    const mainQty = p.main.sold ? ` <span class="store">about ${p.t.lb || 1} lb</span>` : "";
    const rows = [`<li>${img(p.main)}<div>${esc(p.main.n)}<span class="store">${esc(p.main.m)}${mainQty}</span></div><span class="p">${esc(p.main.ptxt)}</span></li>`]
      .concat(p.sides.map((s) => s.deal
        ? `<li>${img(s.deal)}<div>${esc(s.deal.n)}<span class="store">${esc(s.deal.m)}</span></div><span class="p">${esc(s.deal.ptxt)}</span></li>`
        : `<li><span></span><span class="have">${esc(s.need[0].toUpperCase() + s.need.slice(1))}, from the cupboard or regular price</span></li>`)).join("");
    return `<article class="supper"><h3>${esc(p.t.name)}</h3>
      <p class="cost">Sale items about <b>${money(p.cost)}</b></p>
      <ul class="ing">${rows}</ul>
      <div class="row-end"><span class="small muted">${esc(endsIn(p.main.to))}</span><button class="btn" data-supper="${i}">Add to list</button></div></article>`;
  }).join("") : `<div class="empty">No meats or mains are on sale at your stores this week.</div>`;

  if (trips.length) {
    h += `<h2>Worth a stop somewhere else</h2><p class="sub">Same kind of item, at least 20% less than ${esc(home)} by the pound or litre.</p>
      <div class="rows">${trips.map((t) => `<div class="r">${img(t.other)}
        <div><div class="nm">${esc(t.other.n)}</div><div class="meta">${esc(t.other.m)}: ${esc(perUnit(t.other))} <span class="vs">${esc(home)} ${esc(perUnit(t.mine))}</span></div></div>
        <div class="side"><span class="off">${t.save}% less</span>${addBtn(t.other)}</div></div>`).join("")}</div>`;
  }

  if (pantry.length) {
    h += `<h2>Stock the pantry</h2><p class="sub">Things that keep, at 25% off or more.</p>
      <div class="shelf">${pantry.map((d) => `<article class="tile"><span class="off">${d.pct}%</span>${img(d)}${tagHTML(d, "sm")}
        <div class="nm">${esc(d.n)}</div><div class="small muted">${esc(d.m)}</div>${addBtn(d)}</article>`).join("")}</div>`;
  }

  h += `<h2>Eating out</h2>`;
  h += D.rfd.length ? `<div class="rows">${D.rfd.slice(0, 8).map((p) => `<a class="r" style="grid-template-columns:1fr;text-decoration:none;color:inherit" href="${esc(p.link)}" target="_blank" rel="noopener">
      <div><div class="nm"><b>${esc(p.chain)}</b> ${esc(p.title.replace(/^\[[^\]]+\]\s*/, ""))}</div><div class="meta">Posted ${esc(ago(p.published))} on RedFlagDeals</div></div></a>`).join("")}</div>`
    : `<div class="empty">No deals have been posted for Lacombe restaurants in the last 30 days. This checks RedFlagDeals every 6 hours.</div>`;

  h += `<p class="foot">Prices come from the stores' flyers through Flipp. Check the flyer for sizes and limits before you go.</p>`;
  $("#view").innerHTML = h;
  $$("[data-supper]").forEach((b) => (b.onclick = () => {
    const p = suppers[Number(b.dataset.supper)];
    const items = [p.main, ...p.sides.filter((s) => s.deal).map((s) => s.deal)];
    const n = items.filter((d) => addToList(d, true)).length;
    toast(n ? `Added ${n} item${n > 1 ? "s" : ""} for ${p.t.name.toLowerCase()}` : "Already on your list");
    render();
  }));
}

// ------------------------------------------------------------ flip deck
let flipUndo = [];
function deckDeals() {
  const scope = S.flipScope === "home" && S.home ? (d) => isHome(d) : () => true;
  return D.deals.filter((d) => ok(d) && scope(d)).sort(byDeal);
}
function viewFlip() {
  const all = deckDeals();
  const left = all.filter((d) => !S.seen[d.id]);
  const done = all.length - left.length;
  const cur = left[0], next = left[1];
  let h = `<div class="deck-head"><h1>Flip the flyer</h1>
    ${S.home ? `<div class="seg"><button data-scope="home" class="${S.flipScope === "home" ? "on" : ""}">${esc(S.home)}</button><button data-scope="all" class="${S.flipScope === "home" ? "" : "on"}">All stores</button></div>` : ""}</div>
    <p class="sub">Swipe right to add it to your list, left to skip. Biggest savings come first.</p>`;
  if (!cur) {
    h += `<div class="empty"><b>You've been through all ${all.length} deals.</b> New flyers arrive every Thursday.<p><button class="btn ghost" id="restart">Start over</button></p></div>`;
  } else {
    const card = (d, cls) => `<div class="card ${cls}" ${cls ? "" : `id="top"`}>
      <span class="stamp yes">ADD</span><span class="stamp no">SKIP</span>
      ${d.img ? `<img src="${esc(d.img)}" alt="">` : `<div style="flex:1"></div>`}
      <div class="store">${esc(d.m)}, ${esc(endsIn(d.to))}</div>
      <div class="nm">${esc(d.n)}</div>
      <div class="bottom">${tagHTML(d)}${d.pct ? `<span class="off">${d.pct}% off</span>` : ""}</div></div>`;
    h += `<div class="deck">${next ? card(next, "under") : ""}${card(cur, "")}</div>
      <div class="deck-btns"><button class="round no" id="no" aria-label="Skip">✕</button>
        <button class="round undo" id="undo" aria-label="Undo" ${flipUndo.length ? "" : "disabled"}>↶</button>
        <button class="round yes" id="yes" aria-label="Add to list">✓</button></div>
      <div class="progress" aria-label="${done} of ${all.length} seen"><span style="width:${(100 * done) / Math.max(1, all.length)}%"></span></div>
      <p class="small muted" style="text-align:center">${done} of ${all.length}</p>`;
  }
  $("#view").innerHTML = h;
  $$("[data-scope]").forEach((b) => (b.onclick = () => { S.flipScope = b.dataset.scope; keep("flipScope"); flipUndo = []; render(); }));
  const rs = $("#restart");
  if (rs) rs.onclick = () => { for (const d of all) delete S.seen[d.id]; keep("seen"); render(); };
  if (!cur) return;
  const top = $("#top");
  const decide = (yes) => {
    S.seen[cur.id] = yes ? "yes" : "no"; keep("seen");
    if (yes) addToList(cur, true);
    flipUndo.push(cur.id);
    top.classList.add("fly");
    top.style.transform = `translateX(${yes ? 140 : -140}%) rotate(${yes ? 18 : -18}deg)`;
    top.style.opacity = "0";
    setTimeout(render, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
  };
  $("#yes").onclick = () => decide(true);
  $("#no").onclick = () => decide(false);
  $("#undo").onclick = () => {
    const id = flipUndo.pop(); if (id == null) return;
    if (S.seen[id] === "yes") removeFromList(id);
    delete S.seen[id]; keep("seen"); render();
  };
  // drag to swipe
  let x0 = null, dx = 0;
  const yes = $(".stamp.yes", top), no = $(".stamp.no", top);
  top.addEventListener("pointerdown", (e) => { x0 = e.clientX; dx = 0; top.classList.remove("back"); top.setPointerCapture(e.pointerId); });
  top.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    top.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    yes.style.opacity = Math.max(0, Math.min(1, dx / 90));
    no.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    if (Math.abs(dx) > 90) decide(dx > 0);
    else { top.classList.add("back"); top.style.transform = ""; yes.style.opacity = no.style.opacity = 0; }
  };
  top.addEventListener("pointerup", end);
  top.addEventListener("pointercancel", end);
}

// ------------------------------------------------------------ list view
function viewList() {
  // drop items whose sale has ended more than a day ago
  if (!S.list.length) {
    $("#view").innerHTML = `<h1 class="h-week" style="font-size:44px">Your list</h1>
      <div class="empty"><b>Nothing on your list yet.</b> Tap <b>Add</b> on any deal, add a whole supper from <b>This week</b>, or swipe right in <b>Flip</b>.</div>`;
    return;
  }
  const by = {};
  for (const x of S.list) (by[x.m] = by[x.m] || []).push(x);
  const stores = Object.keys(by).sort((a, b) => (b === S.home) - (a === S.home) || a.localeCompare(b));
  let total = 0, weighed = 0;
  let h = `<h1 class="h-week" style="font-size:44px">Your list</h1>`;
  for (const m of stores) {
    let sub = 0;
    const rows = by[m].map((x) => {
      if (x.sold) weighed++; else if (x.price) sub += x.price * x.qty;
      const ended = x.to && new Date(x.to) < now;
      return `<div class="r listrow ${x.done ? "done" : ""}">
        <input type="checkbox" class="chk" data-done="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Got ${esc(x.n)}">
        <div><div class="nm">${esc(x.n)}</div><div class="meta">${esc(x.ptxt)}${ended ? ", sale has ended" : ""}</div></div>
        <div class="qty"><button data-q="${esc(x.id)}" data-d="-1" aria-label="One less">−</button>${x.qty}<button data-q="${esc(x.id)}" data-d="1" aria-label="One more">+</button></div></div>`;
    }).join("");
    total += sub;
    h += `<div class="store-h">${esc(m)}<span>${sub ? money(sub) : ""}</span></div><div class="rows">${rows}</div>`;
  }
  h += `<p class="total">About ${money(total)}</p><p class="small muted">${weighed ? `Plus ${weighed} item${weighed > 1 ? "s" : ""} priced by weight.` : ""}</p>
    <div class="actions"><button class="btn" id="share">Send list</button><button class="btn ghost" id="clearDone">Clear checked</button><button class="btn ghost" id="clearAll">Clear all</button></div>`;
  $("#view").innerHTML = h;
  $$("[data-done]").forEach((c) => (c.onchange = () => { const x = S.list.find((y) => String(y.id) === c.dataset.done); x.done = c.checked; keep("list"); updateCount(); viewList(); }));
  $$("[data-q]").forEach((b) => (b.onclick = () => {
    const x = S.list.find((y) => String(y.id) === b.dataset.q); x.qty += Number(b.dataset.d);
    if (x.qty < 1) S.list = S.list.filter((y) => y !== x);
    keep("list"); updateCount(); viewList();
  }));
  $("#clearDone").onclick = () => { S.list = S.list.filter((x) => !x.done); keep("list"); updateCount(); viewList(); };
  $("#clearAll").onclick = () => { if (confirm("Clear the whole list?")) { S.list = []; keep("list"); updateCount(); viewList(); } };
  $("#share").onclick = async () => {
    const text = stores.map((m) => `${m}\n` + by[m].filter((x) => !x.done).map((x) => `- ${x.qty > 1 ? x.qty + " x " : ""}${x.n} (${x.ptxt})`).join("\n")).join("\n\n");
    if (navigator.share) { try { await navigator.share({ title: "Grocery list", text }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(text); toast("List copied, paste it into a text"); } catch { prompt("Copy your list", text); }
  };
}

// ------------------------------------------------------------ search
let q = "";
function viewSearch() {
  $("#view").innerHTML = `<div class="searchbox"><input type="search" id="q" placeholder="Search every Lacombe flyer, e.g. butter" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></div><div id="results"></div>`;
  const input = $("#q");
  input.oninput = () => { q = input.value; clearTimeout(viewSearch.t); viewSearch.t = setTimeout(results, 200); };
  results();
  if (!q) setTimeout(() => input.focus(), 50);
}
function results() {
  const out = $("#results");
  if (q.trim().length < 2) {
    out.innerHTML = `<div class="empty">Type a few letters. Results from every store are listed cheapest first, by the pound or litre when the flyer says.</div>
      <h2>Full flyers</h2><div class="rows">${D.flyers.filter((f) => !S.off[f.merchant]).map((f) => `<a class="r" style="grid-template-columns:1fr auto;text-decoration:none;color:inherit" href="https://flipp.com/en-ca/lacombe-ab/flyer/${f.id}" target="_blank" rel="noopener">
        <div><div class="nm"><b>${esc(f.merchant)}</b></div><div class="meta">${esc(endsIn(f.to))}</div></div><span class="small">Open on Flipp</span></a>`).join("")}</div>`;
    return;
  }
  const hits = D.deals.filter((d) => ok(d) && has(d.n, q));
  hits.sort((a, b) => (a.b === b.b && a.up && b.up ? a.up - b.up : (a.b === "ea") - (b.b === "ea")) || a.price - b.price);
  out.innerHTML = hits.length ? `<div class="rows">${hits.slice(0, 80).map((d) => `<div class="r ${isHome(d) ? "mine" : ""}">${img(d)}
      <div><div class="nm">${esc(d.n)}</div><div class="meta">${esc(d.m)}${d.b !== "ea" && d.up ? `, ${esc(perUnit(d))}` : ""}</div></div>
      <div class="side">${tagHTML(d, "sm")}${addBtn(d)}</div></div>`).join("")}</div>`
    : `<div class="empty">Nothing matching "${esc(q)}" is on sale at your stores this week.</div>`;
}

// ------------------------------------------------------------ settings
function openSettings() {
  $("#sheetBody").innerHTML = `<div class="sheet-h"><h2>Your stores</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="field"><label for="home">Where you usually shop</label>
      <select id="home"><option value="">No favourite</option>${D.stores.map((m) => `<option ${m === S.home ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
      <p class="small muted">This store's deals come first everywhere.</p></div>
    <div class="field checks"><label style="border:0;font-weight:700;padding-top:0">Stores to include</label>
      ${D.stores.map((m) => `<label><input type="checkbox" class="chk" data-store="${esc(m)}" ${S.off[m] ? "" : "checked"}>${esc(m)}</label>`).join("")}</div>
    <p class="small muted">Lacombe stores with an online flyer, food and drinks only.</p>`;
  $("#sheet").showModal();
  $("#home").onchange = (e) => { S.home = e.target.value; keep("home"); render(); };
  $$("[data-store]").forEach((c) => (c.onchange = () => { if (c.checked) delete S.off[c.dataset.store]; else S.off[c.dataset.store] = true; keep("off"); render(); }));
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target.id === "sheet") $("#sheet").close(); });

// ------------------------------------------------------------ shell
function ago(iso) {
  if (!iso) return "recently";
  const m = Math.round((now - new Date(iso)) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} hour${h > 1 ? "s" : ""} ago` : `${Math.round(h / 24)} days ago`;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }
const VIEWS = { week: viewWeek, flip: viewFlip, list: viewList, search: viewSearch };
function render() {
  index.clear();
  $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  (VIEWS[S.tab] || viewWeek)();
  updateCount();
}
$$(".tabbar button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; keep("tab"); render(); window.scrollTo(0, 0); }));
$("#settingsBtn").onclick = openSettings;

(async () => {
  try { await load(); render(); }
  catch (e) { $("#view").innerHTML = `<div class="empty" style="margin-top:20px"><b>The deals didn't load.</b> Check your connection and pull down to refresh. (${esc(e.message)})</div>`; }
})();
