// quality-filter.js — time-aware, open-hours checks (v7.3.0)
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
  const closeIn = Math.min(...windows.map(([a,b]) => (m<=b? b-m : (m+1440<=b? b-(m+1440) : 9999))));
  return { open:true, minutesUntilClose: isFinite(closeIn) ? closeIn : null };
}

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
    if (uniq.length >= 25) break;
  }

  const whenISO = targetISO || new Date().toISOString();
  const tzid = await fetchTimeZoneId(venue.lat, venue.lng, Math.floor(new Date(whenISO).getTime()/1000));
  const whenLocal = toVenueLocalDate(whenISO, tzid);
  const eatAtLocal = new Date(whenLocal);
  if (slot === "before"){
    eatAtLocal.setMinutes(eatAtLocal.getMinutes() - 90);
  } else if (slot === "after"){
    eatAtLocal.setMinutes(eatAtLocal.getMinutes() + 45);
  }

  const enriched = [];
  for (const r of uniq){
    const d = await new Promise((resolve)=>{
      svc.getDetails({ placeId: r.place_id, fields: ["name","formatted_address","website","geometry","place_id","opening_hours","price_level","rating","user_ratings_total"] },
        (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
    });
    if (!d?.geometry?.location) continue;
    const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });
    const openCheck = isOpenAt(d, eatAtLocal);
    enriched.push({
      name: d.name, address: d.formatted_address || r.vicinity || "",
      distance: +dist.toFixed(2),
      mapUrl: gmapsUrl(d.place_id),
      url: d.website || "",
      rating: typeof d.rating === "number" ? d.rating : null,
      reviews: typeof d.user_ratings_total === "number" ? d.user_ratings_total : null,
      price: typeof d.price_level === "number" ? "$".repeat(d.price_level+1) : null,
      openNow: d.opening_hours?.isOpen() ?? null,
      openAtSlot: openCheck ? true : (openCheck===false ? false : null),
      minutesUntilClose: typeof openCheck==='object' ? openCheck.minutesUntilClose : null,
      lat: d.geometry.location.lat(), lng: d.geometry.location.lng()
    });
  }

  const priceMap = { "$":1, "$$":2, "$$$":3, "$$$$":4 };
  const targetPrice = priceMap[state.budget] ?? null;
  const after = (slot === "after");

  enriched.forEach(p => {
    let score = 0;
    if (p.rating) score += (p.rating - 4.0) * 1.8;
    if (p.reviews) score += Math.log10(Math.max(1, p.reviews)) * 0.8;
    if (targetPrice && p.price) score += -Math.abs((p.price.length) - targetPrice) * 0.35;
    if (state.foodStyles?.length){
      const hit = state.foodStyles.some(c => (p.name||'').toLowerCase().includes(c.toLowerCase()));
      if (hit) score += 0.25;
    }
    score += Math.max(0, 1.6 - (p.distance||0)) * 0.4;
    if (p.openAtSlot === false) score -= 2.0;
    if (after && p.openAtSlot === true) score += 0.6;
    if (after && typeof p.minutesUntilClose === 'number' && p.minutesUntilClose < 60) score -= 0.4;
    p._score = score;
  });

  enriched.sort((a,b)=> (b._score||0) - (a._score||0));
  return enriched.slice(0, 8);
}

export async function pickExtras({ state }){
  await waitForPlaces();
  const svc = new google.maps.places.PlacesService(document.createElement('div'));
  const venue = { lat: state.venueLat, lng: state.venueLng };
  const radius = 2000;
  const chosen = [];

  async function searchType(type, keyword){
    const params = { location: venue, radius };
    if (type) params.type = type;
    if (keyword) params.keyword = keyword;
    return await new Promise((resolve)=>{
      svc.nearbySearch(params, (res, status)=>{
        if (status !== google.maps.places.PlacesServiceStatus.OK || !res) return resolve([]);
        resolve(res);
      });
    });
  }
  async function enrich(r){
    const d = await new Promise((resolve)=>{
      svc.getDetails({ placeId: r.place_id, fields: ["name","formatted_address","website","geometry","place_id","opening_hours","rating","user_ratings_total"] },
        (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
    });
    if (!d?.geometry?.location) return null;
    const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });
    return {
      name: d.name, address: d.formatted_address || r.vicinity || "",
      distance: +dist.toFixed(2),
      mapUrl: gmapsUrl(d.place_id),
      url: d.website || "",
      rating: typeof d.rating === "number" ? d.rating : null,
      reviews: typeof d.user_ratings_total === "number" ? d.user_ratings_total : null,
      lat: d.geometry.location.lat(),
      lng: d.geometry.location.lng()
    };
  }

  if (state.interests.coffee){
    const res = await searchType("cafe");
    for (const r of res){ const e = await enrich(r); if (e){ chosen.push({ section:"Coffee", ...e }); if (chosen.filter(x=>x.section==="Coffee").length>=4) break; } }
  }
  if (state.interests.drinks){
    const res = await searchType("bar","cocktail lounge");
    for (const r of res){ const e = await enrich(r); if (e){ chosen.push({ section:"Drinks", ...e }); if (chosen.filter(x=>x.section==="Drinks").length>=4) break; } }
  }
  if (state.interests.dessert){
    const res = await searchType("restaurant","dessert");
    for (const r of res){ const e = await enrich(r); if (e){ chosen.push({ section:"Dessert", ...e }); if (chosen.filter(x=>x.section==="Dessert").length>=4) break; } }
  }
  if (state.interests.sights){
    const res = await searchType("tourist_attraction");
    for (const r of res){ const e = await enrich(r); if (e){ chosen.push({ section:"Sights", ...e }); if (chosen.filter(x=>x.section==="Sights").length>=4) break; } }
  }
  return chosen;
}

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