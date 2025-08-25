// quality-filter.js — retail filters + strict section matching + photos (v7.8.1)

/* ----------------- Utilities ----------------- */
function miles(a, b){
  const toRad = d => d*Math.PI/180, R=3958.8;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function gmapsUrl(placeId){ return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`; }
function waitForPlaces(maxMs=10000){
  const t0 = Date.now();
  return new Promise((resolve, reject)=>{
    (function tick(){
      if (window.google?.maps?.places) return resolve(true);
      if (Date.now()-t0 > maxMs) return reject(new Error("Google Places failed to load"));
      setTimeout(tick, 120);
    })();
  });
}

/* ----------------- Timezone + open-at-slot ----------------- */
async function fetchTimeZoneId(lat, lng, timestampSec){
  const key = window.GOOGLE_MAPS_API_KEY || "";
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestampSec}&key=${key}`;
  try{
    const res = await fetch(url);
    const j = await res.json();
    return j.timeZoneId || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }catch{
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
function toVenueLocalDate(targetISO, tzid){
  try{
    return new Date(new Date(targetISO).toLocaleString('en-US', { timeZone: tzid }));
  }catch{
    return new Date(targetISO);
  }
}
function isOpenAt(placeDetails, whenLocal){
  const oh = placeDetails?.opening_hours;
  if (!oh || !Array.isArray(oh.periods)) return null;
  const day = whenLocal.getDay();
  const mins = whenLocal.getHours()*60 + whenLocal.getMinutes();
  const windows = [];
  for (const p of oh.periods){
    if (!p.open || !p.close) continue;
    const oDay = p.open.day, cDay = p.close.day;
    const oMin = (parseInt(p.open.hours||"0",10)*60) + parseInt(p.open.minutes||"0",10);
    const cMin = (parseInt(p.close.hours||"0",10)*60) + parseInt(p.close.minutes||"0",10);
    if (oDay === day && cDay === day){
      windows.push([oMin, cMin]);
    } else if (oDay === day && ((cDay + 7 - oDay) % 7) === 1 && cMin < oMin){
      windows.push([oMin, cMin + 1440]);
    } else if (((oDay + 7 - day) % 7) === 6 && cDay === day && cMin < 300){
      windows.push([0, cMin]);
    }
  }
  const m = mins;
  const inWindow = windows.some(([a,b]) => (m >= a && m <= b) || (m+1440 >= a && m+1440 <= b));
  if (!inWindow) return false;
  const closeIn = Math.min(...windows.map(([a,b]) => (m<=b? b-m : (m+1440<=b? b-(m+1440) : 9e9))));
  return { open:true, minutesUntilClose: isFinite(closeIn) ? closeIn : null };
}

/* ----------------- Photos ----------------- */
function photoFromDetails(d, maxW=900, maxH=600){
  try{
    const ph = Array.isArray(d.photos) ? d.photos[0] : null;
    return ph ? ph.getUrl({ maxWidth: maxW, maxHeight: maxH }) : "";
  }catch{ return ""; }
}

/* ----------------- Retail / junk filters ----------------- */
// Types we never want in rails/extras
const BAD_TYPES = new Set([
  "store","book_store","department_store","clothing_store","home_goods_store","furniture_store","electronics_store",
  "shoe_store","jewelry_store","convenience_store","supermarket","grocery_or_supermarket","shopping_mall","library",
  "hardware_store","bicycle_store","drugstore","pharmacy"
]);
// Names we should exclude (covers the B&N case you saw)
const BAD_NAME_RE = /\b(barnes\s*&\s*noble|barnes|american\s+girl|target|walmart|best\s*buy|ikea)\b/i;

function looksRetail(detailsOrResult){
  const types = (detailsOrResult?.types || []).map(String);
  const hasBadType = types.some(t => BAD_TYPES.has(t));
  const badName = BAD_NAME_RE.test(detailsOrResult?.name || "");
  return hasBadType || badName;
}

/* ----------------- Section match helpers ----------------- */
function isCoffee(detailsOrResult){
  const types = detailsOrResult?.types || [];
  const name = (detailsOrResult?.name || "").toLowerCase();
  // must be a real cafe/bakery; exclude retail & restaurants that are clearly not coffee-forward
  if (looksRetail(detailsOrResult)) return false;
  return types.includes("cafe") || types.includes("bakery") || /coffee|espresso|roastery|caff[eé]/i.test(name);
}

function isDrinks(detailsOrResult){
  const types = detailsOrResult?.types || [];
  if (looksRetail(detailsOrResult)) return false;
  return types.includes("bar") || types.includes("night_club") || /cocktail|wine\s+bar|speakeasy|taproom|lounge/i.test(detailsOrResult?.name || "");
}

function isDessert(detailsOrResult){
  const types = detailsOrResult?.types || [];
  if (looksRetail(detailsOrResult)) return false;
  const name = (detailsOrResult?.name || "").toLowerCase();
  return types.includes("bakery") || types.includes("ice_cream_shop") ||
         /dessert|ice\s*cream|gelato|patisserie|donut|doughnut|macaron|churro|creamery|cupcake|chocolate/i.test(name);
}

/* ================================================================
   Restaurants (pre/post show)
   ================================================================ */
export async function pickRestaurants({ wantOpenNow, state, slot="before", targetISO }){
  await waitForPlaces();
  const svc = new google.maps.places.PlacesService(document.createElement('div'));
  const params = buildSearchParams({ wantOpenNow, state });

  const raw = await new Promise((resolve)=>{
    svc.nearbySearch(params, (res, status)=>{
      if (status !== google.maps.places.PlacesServiceStatus.OK || !res) return resolve([]);
      resolve(res);
    });
  });

  const venue = { lat: state.venueLat, lng: state.venueLng };
  const uniq = []; const seen = new Set();
  for (const r of raw){
    if (!r.place_id || seen.has(r.place_id)) continue;
    seen.add(r.place_id); uniq.push(r);
    if (uniq.length >= 35) break; // larger pool before filtering/scoring
  }

  const whenISO = targetISO || new Date().toISOString();
  const tzid = await fetchTimeZoneId(venue.lat, venue.lng, Math.floor(new Date(whenISO).getTime()/1000));
  const whenLocal = toVenueLocalDate(whenISO, tzid);
  const eatAtLocal = new Date(whenLocal);
  if (slot === "before"){ eatAtLocal.setMinutes(eatAtLocal.getMinutes() - 90); }
  else if (slot === "after"){ eatAtLocal.setMinutes(eatAtLocal.getMinutes() + 45); }

  const enriched = [];
  for (const r of uniq){
    const d = await new Promise((resolve)=>{
      svc.getDetails({
        placeId: r.place_id,
        fields: ["name","formatted_address","website","geometry","place_id","types",
                 "opening_hours","price_level","rating","user_ratings_total","photos"]
      }, (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
    });
    if (!d?.geometry?.location) continue;

    // Extra guard: never keep retail-like entries
    if (looksRetail(d)) continue;

    const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });
    const openCheck = isOpenAt(d, eatAtLocal);

    // Light quality thresholds to avoid low-signal results
    const rating = typeof d.rating === "number" ? d.rating : null;
    const reviews = typeof d.user_ratings_total === "number" ? d.user_ratings_total : null;
    if (rating !== null && reviews !== null){
      if (rating < 3.9 || reviews < 30) continue; // trim weak entries
    }

    enriched.push({
      name: d.name,
      address: d.formatted_address || r.vicinity || "",
      distance: +dist.toFixed(2),
      mapUrl: gmapsUrl(d.place_id),
      url: d.website || "",
      rating, reviews,
      price: typeof d.price_level === "number" ? "$".repeat(d.price_level+1) : null,
      openNow: d.opening_hours?.isOpen() ?? null,
      openAtSlot: openCheck ? true : (openCheck===false ? false : null),
      minutesUntilClose: typeof openCheck==='object' ? openCheck.minutesUntilClose : null,
      lat: d.geometry.location.lat(),
      lng: d.geometry.location.lng(),
      photoUrl: photoFromDetails(d, 900, 600)
    });
  }

  // Scoring
  const priceMap = { "$":1, "$$":2, "$$$":3, "$$$$":4 };
  const targetPrice = priceMap[state.budget] ?? null;
  const isAfter = (slot === "after");

  enriched.forEach(p => {
    let score = 0;
    if (p.rating) score += (p.rating - 4.0) * 1.9;
    if (p.reviews) score += Math.log10(Math.max(1, p.reviews)) * 0.85;
    score += Math.max(0, 1.8 - (p.distance||0)) * 0.45;
    if (targetPrice && p.price) score += -Math.abs((p.price.length) - targetPrice) * 0.4;
    if (state.foodStyles?.length){
      const hit = state.foodStyles.some(c => (p.name||'').toLowerCase().includes(c.toLowerCase()));
      if (hit) score += 0.25;
    }
    if (p.openAtSlot === false) score -= 2.2;
    if (isAfter && p.openAtSlot === true) score += 0.7;
    if (isAfter && typeof p.minutesUntilClose === 'number' && p.minutesUntilClose < 60) score -= 0.5;
    p._score = score;
  });

  enriched.sort((a,b)=> (b._score||0) - (a._score||0));
  return enriched.slice(0, 10);
}

/* ================================================================
   Extras (Coffee, Drinks, Dessert, Sights) near venue — strict types
   ================================================================ */
export async function pickExtras({ state }){
  await waitForPlaces();
  const svc = new google.maps.places.PlacesService(document.createElement('div'));
  const venue = { lat: state.venueLat, lng: state.venueLng };
  const radius = 2200;
  const chosen = [];

  async function search(params){
    return await new Promise((resolve)=>{
      svc.nearbySearch(params, (res, status)=>{
        if (status !== google.maps.places.PlacesServiceStatus.OK || !res) return resolve([]);
        resolve(res);
      });
    });
  }
  async function enrich(r){
    const d = await new Promise((resolve)=>{
      svc.getDetails({
        placeId: r.place_id,
        fields: ["name","formatted_address","website","geometry","place_id","types",
                 "opening_hours","rating","user_ratings_total","photos"]
      }, (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
    });
    if (!d?.geometry?.location) return null;
    if (looksRetail(d)) return null; // extra guard for B&N etc.
    const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });

    return {
      name: d.name,
      address: d.formatted_address || r.vicinity || "",
      distance: +dist.toFixed(2),
      mapUrl: gmapsUrl(d.place_id),
      url: d.website || "",
      rating: typeof d.rating === "number" ? d.rating : null,
      reviews: typeof d.user_ratings_total === "number" ? d.user_ratings_total : null,
      lat: d.geometry.location.lat(),
      lng: d.geometry.location.lng(),
      types: d.types || [],
      photoUrl: photoFromDetails(d, 900, 600)
    };
  }

  // COFFEE — must be cafe/bakery; filter junk; apply quality floor
  if (state.interests.coffee){
    const res = await search({ location: venue, radius, type: "cafe" });
    for (const r of res){
      const e = await enrich(r);
      if (e && isCoffee(e) && (e.rating ?? 4) >= 3.9 && (e.reviews ?? 40) >= 20){
        chosen.push({ section:"Coffee", ...e });
        if (chosen.filter(x=>x.section==="Coffee").length>=6) break;
      }
    }
  }

  // DRINKS — bars & lounges only
  if (state.interests.drinks){
    const res = await search({ location: venue, radius, type: "bar", keyword: "cocktail lounge" });
    for (const r of res){
      const e = await enrich(r);
      if (e && isDrinks(e) && (e.rating ?? 4) >= 3.9){
        chosen.push({ section:"Drinks", ...e });
        if (chosen.filter(x=>x.section==="Drinks").length>=6) break;
      }
    }
  }

  // DESSERT — bakeries/ice cream + name keywords
  if (state.interests.dessert){
    // start with bakeries
    const res1 = await search({ location: venue, radius, type: "bakery" });
    // then a dessert keyword sweep from restaurants
    const res2 = await search({ location: venue, radius, type: "restaurant", keyword: "dessert ice cream gelato patisserie" });
    const pool = [...res1, ...res2];
    const seen = new Set();
    for (const r of pool){
      if (seen.has(r.place_id)) continue; seen.add(r.place_id);
      const e = await enrich(r);
      if (e && isDessert(e) && (e.rating ?? 4) >= 3.9){
        chosen.push({ section:"Dessert", ...e });
        if (chosen.filter(x=>x.section==="Dessert").length>=6) break;
      }
    }
  }

  // SIGHTS — tourist_attraction (no retail)
  if (state.interests.sights){
    const res = await search({ location: venue, radius, type: "tourist_attraction" });
    for (const r of res){
      const e = await enrich(r);
      if (e){ chosen.push({ section:"Sights", ...e }); if (chosen.filter(x=>x.section==="Sights").length>=6) break; }
    }
  }

  // Strip helper-only field
  return chosen.map(({types, ...rest}) => rest);
}

/* ================================================================
   Param builder
   ================================================================ */
function buildSearchParams({ wantOpenNow, state }){
  const venue = { lat: state.venueLat, lng: state.venueLng };
  const radius = 2400;
  const priceMap = { "$":0, "$$":1, "$$$":2, "$$$$":3 };
  const maxPrice = priceMap[state.budget] ?? 3;

  const terms = [...(state.foodStyles||[])];
  if (state.foodStyleOther) terms.push(state.foodStyleOther);

  let type = "restaurant";
  if (state.placeStyle === "bar") type = "bar";
  if (state.placeStyle === "dessert") { type = "restaurant"; terms.push("dessert","ice cream","bakery"); }
  if (state.placeStyle === "fast") { type = "restaurant"; terms.push("fast food","counter service","takeout"); }

  const keyword = terms.filter(Boolean).join(" ");
  const params = { location: venue, radius, type, maxPriceLevel: maxPrice };
  if (keyword) params.keyword = keyword;
  if (wantOpenNow) params.openNow = true;
  return params;
}
