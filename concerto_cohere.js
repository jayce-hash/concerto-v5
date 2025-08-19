// netlify/functions/concerto_cohere.js
// Concerto+ Cohere curator — robust, latency-aware, hallucination-safe, with user "locks"

const MODEL = "command-r-plus-08-2024";           // Good JSON reliability
const TEMP = 0.3;
const TIMEOUT_MS = 12000;                         // End-to-end safety timeout
const MAX_RETRIES = 2;                            // Retries for 429/5xx
const MAX_PLACES_PER_SECTION = 5;                 // Keep it tight for UX

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    // ---- Parse & validate request ----
    const { state, candidates, locks = [] } = JSON.parse(event.body || "{}");
    const problems = validate(state, candidates);
    if (problems.length) {
      // Degrade gracefully with deterministic fallback that still respects locks.
      return okJSON(fallbackCurate(state, candidates, locks, problems));
    }

    // ---- Build prompt (tight, JSON-only, grounded to candidates + locks) ----
    const system = [
      "You are Concerto, a concert-night concierge.",
      "Return JSON ONLY with keys:",
      "intro: string,",
      "show: { title, venue, time? },",
      "diningBefore: Place[],",
      "diningAfter: Place[],",
      "tips: string[]",
      "Where Place = { name, address, distance, url?, mapUrl?, price?, rating?, openNow?, blurb }",
      "",
      "Rules:",
      "- Select ONLY from the provided candidates or locks; never invent places.",
      `- Rank up to ${MAX_PLACES_PER_SECTION} options for each requested section.`,
      "- **Locks go first** in their section (keep input order).",
      "- Base ranking on distance, rating, open-late fit (after-show), tone, and budget.",
      "- Prefer open-late for after-show when eatWhen != 'before'.",
      "- Blurbs: 1 short, concrete sentence (no fluff, no emojis).",
      "- Keep JSON compact. No markdown, no extra keys."
    ].join("\n");

    // Slim payload for the model
    const slim = {
      state: {
        artist: safeStr(state?.artist),
        venue: safeStr(state?.venue),
        time: safeStr(state?.time || state?.showTime || ""),
        venueLat: numOrNull(state?.venueLat),
        venueLng: numOrNull(state?.venueLng),
        eatWhen: oneOf(state?.eatWhen, ["before", "after", "both"]) || "both",
        foodStyles: Array.isArray(state?.foodStyles) ? state.foodStyles.slice(0, 8) : [],
        placeStyle: safeStr(state?.placeStyle || ""),
        budget: safeStr(state?.budget || ""),
        tone: safeStr(state?.tone || "balanced")
      },
      candidates: {
        before: asPlaces(candidates?.before),
        after:  asPlaces(candidates?.after),
        // extras not used by the model in this function's schema, keep local
      },
      // Keep locks minimal but sufficient
      locks: normalizeLocks(locks)
    };

    // ---- Call Cohere with timeout + retries ----
    const co = await callCohereJSON(system, slim);

    // ---- Post-process: enforce schema, grounding, and LOCKS FIRST ----
    const safe = sanitizeGroundAndLock(co, slim, state);

    return okJSON(safe);
  } catch (e) {
    // Last-resort deterministic fallback (still respects locks)
    try {
      const { state, candidates, locks = [] } = JSON.parse(event.body || "{}");
      return okJSON(fallbackCurate(state, candidates, locks, [e.message || "cohere_error"]));
    } catch {
      return okJSON(fallbackCurate({}, {}, [], ["parse_error"]));
    }
  }
}

/* ============================ Helpers ============================ */

function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type,Authorization"
};}

function okJSON(obj){
  return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function safeStr(x){ return (typeof x === "string" ? x : "") }
function numOrNull(x){ const n = Number(x); return Number.isFinite(n) ? n : null; }
function oneOf(x, list){ return list.includes(x) ? x : null; }

function asPlaces(arr){
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 20).map(pickPlace);
}
function pickPlace(p){
  return {
    name: safeStr(p?.name),
    address: safeStr(p?.address),
    distance: Number.isFinite(p?.distance) ? p.distance : null,
    url: safeStr(p?.url || ""),
    mapUrl: safeStr(p?.mapUrl || ""),
    price: safeStr(p?.price || ""),
    rating: Number.isFinite(p?.rating) ? p.rating : null,
    openNow: typeof p?.openNow === "boolean" ? p.openNow : null
  };
}

function validate(state, candidates){
  const errs = [];
  if (!safeStr(state?.venue)) errs.push("missing_venue");
  if (!Number.isFinite(state?.venueLat) || !Number.isFinite(state?.venueLng)) errs.push("missing_venue_latlng");
  if (!candidates || ( !Array.isArray(candidates.before) && !Array.isArray(candidates.after) )) errs.push("missing_candidates");
  return errs;
}

/* ---------- Locks ---------- */
function normalizeLocks(locks){
  // Keep order; allow sparse info; compute mapUrl from placeId if needed.
  return (Array.isArray(locks) ? locks : []).map(l => ({
    name: safeStr(l?.name),
    address: safeStr(l?.address || ""),
    distance: numOrNull(l?.distance),
    url: safeStr(l?.url || ""),
    mapUrl: safeStr(l?.mapUrl || (l?.placeId ? gmapsUrl(l.placeId) : "")),
    price: "", rating: null, openNow: null,
    when: oneOf(l?.when, ["before","after"]) || "before",
    blurb: "User-locked pick."
  })).filter(x => x.name);
}
function gmapsUrl(placeId){
  return placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}` : "";
}

/* ---------- Cohere call with retry/timeout ---------- */
async function callCohereJSON(system, userObj){
  const controller = new AbortController();
  const timeout = setTimeout(()=> controller.abort(), TIMEOUT_MS);
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++){
    try{
      const res = await fetch("https://api.cohere.ai/v2/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMP,
          seed: 7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(userObj) }
          ]
        })
      });

      if (res.ok){
        const data = await res.json();
        const text = data?.message?.content?.[0]?.text || "{}";
        clearTimeout(timeout);
        return JSON.parse(safeJSON(text));
      }

      // Retry on 429 / 5xx
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)){
        await wait(backoffMs(attempt));
        lastErr = new Error(`Cohere ${res.status}`);
        continue;
      }

      // Non-retryable
      const body = await res.text().catch(()=> "");
      throw new Error(`Cohere ${res.status}: ${body}`);
    }catch(e){
      if (e.name === "AbortError") throw new Error("timeout");
      lastErr = e;
      // simple retry on network errors
      await wait(backoffMs(attempt));
    }
  }

  clearTimeout(timeout);
  throw (lastErr || new Error("cohere_unknown_error"));
}

function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
function backoffMs(attempt){ return 400 * Math.pow(2, attempt); }

function safeJSON(s){
  // best-effort strip leading/trailing non-JSON if the model accidentally adds text
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return (start >= 0 && end >= 0) ? s.slice(start, end+1) : "{}";
}

/* ---------- Post-processing: schema enforcement + grounding + LOCKS FIRST ---------- */
function sanitizeGroundAndLock(raw, slim, state){
  // Base structure
  const out = {
    intro: safeStr(raw?.intro) || defaultIntro(state),
    show: {
      title: safeStr(raw?.show?.title) || defaultShowTitle(state),
      venue: safeStr(raw?.show?.venue) || safeStr(state?.venue),
      time: safeStr(raw?.show?.time || state?.time || state?.showTime || "")
    },
    diningBefore: [],
    diningAfter: [],
    tips: Array.isArray(raw?.tips) ? raw.tips.slice(0, 5).map(safeStr) : defaultTips(state)
  };

  // Lookups for grounding (by exact name)
  const beforeByName = new Map(slim.candidates.before.map(p => [p.name, p]));
  const afterByName  = new Map(slim.candidates.after.map(p => [p.name, p]));

  // Normalize locks into sections, keep order
  const lockBefore = slim.locks.filter(l => l.when === "before");
  const lockAfter  = slim.locks.filter(l => l.when === "after");

  // Helper: accept only grounded places and limit fields
  const takeGrounded = (arr, map, max) => {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (const x of arr){
      const name = safeStr(x?.name);
      if (!name || !map.has(name)) continue; // reject hallucinations
      const base = map.get(name);
      out.push({
        name: base.name,
        address: base.address,
        distance: base.distance,
        url: base.url || "",
        mapUrl: base.mapUrl || "",
        price: base.price || "",
        rating: base.rating,
        openNow: base.openNow,
        blurb: oneLine(safeStr(x?.blurb)) || ""
      });
      if (out.length >= max) break;
    }
    return out;
  };

  const wantBefore = state?.eatWhen !== "after";
  const wantAfter  = state?.eatWhen !== "before";

  // Model selections (grounded)
  const modelBefore = takeGrounded(raw?.diningBefore, beforeByName, MAX_PLACES_PER_SECTION);
  const modelAfter  = takeGrounded(raw?.diningAfter,  afterByName,  MAX_PLACES_PER_SECTION);

  // Merge: LOCKS FIRST → then model → then deterministic fallback, all de-duped, capped
  out.diningBefore = mergeWithLocks(lockBefore, wantBefore ? modelBefore : [], rankFallback(slim.candidates.before, "before", state));
  out.diningAfter  = mergeWithLocks(lockAfter,  wantAfter  ? modelAfter  : [], rankFallback(slim.candidates.after,  "after",  state));

  return out;
}

function mergeWithLocks(locks, model, fallbackList){
  const key = p => (safeStr(p?.name) + "|" + safeStr(p?.mapUrl));
  const seen = new Set();
  const out = [];

  // 1) Locks first (kept as-is)
  for (const l of locks){
    if (!l?.name) continue;
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      name: l.name,
      address: l.address || "",
      distance: l.distance ?? null,
      url: l.url || "",
      mapUrl: l.mapUrl || "",
      price: l.price || "",
      rating: l.rating ?? null,
      openNow: l.openNow ?? null,
      blurb: oneLine(safeStr(l.blurb)) || "User-locked pick."
    });
    if (out.length >= MAX_PLACES_PER_SECTION) return out;
  }

  // 2) Model picks (grounded already)
  for (const p of (model || [])){
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= MAX_PLACES_PER_SECTION) return out;
  }

  // 3) Fallback ranked candidates (deterministic)
  for (const p of (fallbackList || [])){
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= MAX_PLACES_PER_SECTION) return out;
  }

  return out;
}

function oneLine(s){ return s.replace(/\s+/g, " ").trim(); }
function defaultIntro(state){
  const when = safeStr(state?.time || state?.showTime) ? ` at ${state.time || state.showTime}` : "";
  return `Here’s a clean, time-aware plan centered on ${safeStr(state?.venue)}${when}.`;
}
function defaultShowTitle(state){
  return safeStr(state?.artist) ? `${state.artist} — Live` : "Your Show";
}
function defaultTips(state){
  const tips = ["Arrive early for merch.", "Check the bag policy.", "Hydrate and plan your ride home."];
  if (safeStr(state?.eatWhen) !== "before") tips.unshift("Pick a kitchen that serves late.");
  return tips.slice(0,5);
}

/* ---------- Deterministic fallback ranking (no LLM) ---------- */
function rankFallback(list, section, state){
  if (!Array.isArray(list)) return [];
  // score: rating + proximity + budget alignment + openNow for after
  const priceToN = p => (p && typeof p === "string") ? p.length : null;
  const targetPrice = priceToN(state?.budget);
  const after = (section === "after");

  const scored = list.map(p => {
    let s = 0;
    if (typeof p.rating === "number") s += (p.rating - 4.0) * 1.8;
    if (typeof p.distance === "number") s += Math.max(0, 1.6 - p.distance) * 0.5; // proximity boost under ~1.6 mi
    const pp = priceToN(p.price);
    if (targetPrice != null && pp != null) s += -Math.abs(pp - targetPrice) * 0.4;
    if (after && p.openNow === true) s += 0.3;
    if (!after && p.openNow === false) s -= 0.2;
    return { p, s };
  });

  scored.sort((a,b)=> b.s - a.s);
  return scored.map(x => ({
    name: x.p.name,
    address: x.p.address,
    distance: x.p.distance,
    url: x.p.url || "",
    mapUrl: x.p.mapUrl || "",
    price: x.p.price || "",
    rating: x.p.rating || null,
    openNow: typeof x.p.openNow === "boolean" ? x.p.openNow : null,
    blurb: "" // no LLM here
  }));
}

/* ---------- Fallback whole-response (used on hard errors/invalid input) ---------- */
function fallbackCurate(state, candidates, locks = [], reasons=[]){
  const beforeCand = asPlaces(candidates?.before);
  const afterCand  = asPlaces(candidates?.after);

  const beforeRanked = rankFallback(beforeCand, "before", state);
  const afterRanked  = rankFallback(afterCand,  "after",  state);

  const lockNorm = normalizeLocks(locks);
  const beforeLocks = lockNorm.filter(l=>l.when==="before");
  const afterLocks  = lockNorm.filter(l=>l.when==="after");

  return {
    intro: defaultIntro(state) + (reasons.length ? " (curated without AI due to: " + reasons.join(", ") + ")" : ""),
    show: { title: defaultShowTitle(state), venue: safeStr(state?.venue), time: safeStr(state?.time || state?.showTime || "") },
    diningBefore: mergeWithLocks(beforeLocks, [], beforeRanked),
    diningAfter:  mergeWithLocks(afterLocks,  [], afterRanked),
    tips: defaultTips(state)
  };
}
