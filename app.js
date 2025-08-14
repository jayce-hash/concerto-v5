(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;
  console.log("Concerto app.js v6.3.1 loaded");

  const byId = (id) => document.getElementById(id);
  const screens = {
    welcome: byId('screen-welcome'),
    form: byId('screen-form'),
    loading: byId('screen-loading'),
    results: byId('screen-results')
  };

  let step = 0;
  const steps = ["concert", "stay", "dining", "activities"];
  const state = window.__concertoState = {
    artist: "", venue: "", venuePlaceId: "", venueLat: null, venueLng: null,
    showTime: "",
    hotel: "", hotelPlaceId:"", hotelLat:null, hotelLng:null, staying:true,
    eatWhen: "both",
    foodStyles: [],
    foodStyleOther: "",
    placeStyle: "sitdown",
    budget: "$$", tone: "balanced",
    interests: { coffee:false, drinks:false, dessert:false, sights:false }
  };

  byId('btn-start').addEventListener('click', () => { show('form'); renderStep(); });
  byId('btn-prev').addEventListener('click', () => { if (step>0){ step--; renderStep(); } });
  byId('btn-next').addEventListener('click', async () => {
    if (steps[step] === "concert") { await ensureVenueResolved(); }
    if (steps[step] === "stay" && state.staying) { await ensureHotelResolved(); }
    if (step < steps.length-1){ step++; renderStep(); }
    else { await generate(); }
  });
  byId('btn-edit').addEventListener('click', () => { show('form'); step = 0; renderStep(); });
  byId('btn-new').addEventListener('click', () => { location.href = location.pathname; });
  byId('btn-share').addEventListener('click', async () => {
    const enc = btoa(encodeURIComponent(JSON.stringify(state)));
    const url = `${location.origin}${location.pathname}?a=${enc}`;
    try{ await navigator.clipboard.writeText(url); alert("Link copied!"); } catch{ prompt("Copy link:", url); }
  });

  try {
    const enc = new URLSearchParams(location.search).get("a");
    if (enc) { Object.assign(state, JSON.parse(decodeURIComponent(atob(enc)))); show('form'); step = steps.length-1; renderStep(); }
  } catch {}

  function show(name){ Object.values(screens).forEach(s => s.classList.remove('active')); screens[name].classList.add('active'); }
  function setProgress(){ byId('progress-bar').style.width = `${(step/steps.length)*100}%`; }

  function renderStep(){
    setProgress();
    const w = byId('step-wrapper');

    if (steps[step] === "concert"){
      w.innerHTML = `
        <h3 class="step-title">Concert Details</h3>
        <p class="step-help">Pick your venue and show start time.</p>
        <div class="form-grid">
          <div>
            <label>Artist (optional)</label>
            <div class="suggest">
              <input id="artist" type="text" placeholder="e.g., Taylor Swift" value="${esc(state.artist)}" autocomplete="off"/>
              <div id="artist-list" class="suggest-list" style="display:none;"></div>
            </div>
          </div>
          <div>
            <label>Venue</label>
            <input id="venue" type="text" placeholder="Type a venue name" value="${esc(state.venue)}" autocomplete="off"/>
            <div class="tiny">Tip: Press Enter to accept the top suggestion.</div>
          </div>
          <div>
            <label>Show start time</label>
            <input id="showTime" type="time" value="${esc(state.showTime)}"/>
          </div>
        </div>
      `;
      bindArtistSuggest();
      bindVenueAutocomplete();
      byId('showTime').onchange = (e)=> state.showTime = e.target.value;
      byId('btn-prev').disabled = true;
      byId('btn-next').textContent = "Next";

    } else if (steps[step] === "stay"){
      w.innerHTML = `
        <h3 class="step-title">Accommodation</h3>
        <p class="step-help">Are you staying overnight?</p>
        <div class="form-grid two">
          <div>
            <label><input id="staying" type="checkbox" ${state.staying?'checked':''}/> I'm staying overnight</label>
          </div>
          <div>
            <label>Hotel (if staying)</label>
            <input id="hotel" type="text" placeholder="Name or address" value="${esc(state.hotel)}" ${state.staying?'':'disabled'}/>
          </div>
        </div>
      `;
      const cb = byId('staying');
      const hotelInput = byId('hotel');
      cb.onchange = ()=>{ state.staying = cb.checked; hotelInput.disabled = !cb.checked; };
      bindHotelAutocomplete();
      byId('btn-prev').disabled = false;
      byId('btn-next').textContent = "Next";

    } else if (steps[step] === "dining"){
      const cuisines = ["American","Italian","Japanese/Sushi","Mexican/Tacos","Steakhouse","Seafood","Mediterranean","Vegan/Vegetarian","Pizza","BBQ"];
      w.innerHTML = `
        <h3 class="step-title">Dining Preferences</h3>
        <p class="step-help">We’ll pick restaurants near your venue.</p>
        <div class="form-grid two">
          <div>
            <label>Eat when?</label>
            <select id="eatWhen">
              <option value="before"${state.eatWhen==="before" ? " selected" : ""}>Before the show</option>
              <option value="after"${state.eatWhen==="after" ? " selected" : ""}>After the show</option>
              <option value="both"${state.eatWhen==="both" ? " selected" : ""}>Both</option>
            </select>
          </div>
          <div>
            <label>Restaurant type</label>
            <select id="placeStyle">
              <option value="sitdown"${state.placeStyle==="sitdown" ? " selected" : ""}>Sit-down</option>
              <option value="fast"${state.placeStyle==="fast" ? " selected" : ""}>Fast-casual / Quick</option>
              <option value="bar"${state.placeStyle==="bar" ? " selected" : ""}>Bar / Lounge</option>
              <option value="dessert"${state.placeStyle==="dessert" ? " selected" : ""}>Dessert / Cafe</option>
            </select>
          </div>
          <div class="full">
            <label>Cuisines (choose any)</label>
            <div class="radio-group" id="cuisine-pills">
              ${cuisines.map(c => `<div class="pill${state.foodStyles.includes(c)?" active":""}" data-val="${c}">${c}</div>`).join("")}
            </div>
          </div>
          <div>
            <label>Other cuisine (optional)</label>
            <input id="foodStyleOther" type="text" placeholder="e.g., ramen, tapas, Ethiopian" value="${esc(state.foodStyleOther)}" />
          </div>
          <div>
            <label>Budget</label>
            <div class="radio-group" id="budget-pills">
              ${["$","$$","$$$","$$$$"].map(b => `<div class="pill${b===state.budget?" active":""}" data-val="${b}">${b}</div>`).join("")}
            </div>
          </div>
          <div>
            <label>Tone</label>
            <select id="tone">
              <option value="balanced"${state.tone==="balanced" ? " selected" : ""}>Balanced</option>
              <option value="luxury"${state.tone==="luxury" ? " selected" : ""}>Luxury</option>
              <option value="indie"${state.tone==="indie" ? " selected" : ""}>Indie</option>
              <option value="family"${state.tone==="family" ? " selected" : ""}>Family</option>
              <option value="foodie"${state.tone==="foodie" ? " selected" : ""}>Foodie</option>
            </select>
          </div>
        </div>
      `;
      byId('eatWhen').onchange = (e)=> state.eatWhen = e.target.value;
      byId('placeStyle').onchange = (e)=> state.placeStyle = e.target.value;
      byId('foodStyleOther').oninput = (e)=> state.foodStyleOther = e.target.value.trim();
      byId('tone').onchange = (e)=> state.tone = e.target.value;

      byId('cuisine-pills').querySelectorAll('.pill').forEach(p=>{
        p.onclick=()=>{
          const v = p.dataset.val;
          const i = state.foodStyles.indexOf(v);
          if (i>=0) state.foodStyles.splice(i,1); else state.foodStyles.push(v);
          p.classList.toggle('active');
        };
      });
      byId('budget-pills').querySelectorAll('.pill').forEach(p=>{
        p.onclick=()=>{ state.budget = p.dataset.val; byId('budget-pills').querySelectorAll('.pill').forEach(x=>x.classList.remove('active')); p.classList.add('active'); };
      });
      byId('btn-prev').disabled = false;
      byId('btn-next').textContent = "Next";

    } else {
      w.innerHTML = `
        <h3 class="step-title">Activities & Interests</h3>
        <p class="step-help">Optional extras to round out your night.</p>
        <div class="form-grid two">
          <div><label><input type="checkbox" id="int-coffee" ${state.interests.coffee?'checked':''}/> Coffee</label></div>
          <div><label><input type="checkbox" id="int-drinks" ${state.interests.drinks?'checked':''}/> Drinks / Lounge</label></div>
          <div><label><input type="checkbox" id="int-dessert" ${state.interests.dessert?'checked':''}/> Dessert</label></div>
          <div><label><input type="checkbox" id="int-sights" ${state.interests.sights?'checked':''}/> Sights / Landmarks</label></div>
        </div>
      `;
      const ids = ["coffee","drinks","dessert","sights"];
      ids.forEach(k=>{
        const el = byId('int-'+k);
        el.onchange = ()=>{ state.interests[k] = el.checked; };
      });
      byId('btn-prev').disabled = false;
      byId('btn-next').textContent = "Generate Itinerary";
    }
  }

  function bindArtistSuggest(){
    const input = byId('artist'), list = byId('artist-list');
    if (!input) return;
    input.addEventListener('input', async ()=>{
      state.artist = input.value.trim();
      const q = input.value.trim();
      if (!q){ list.style.display="none"; return; }
      const res = await fetch(`https://itunes.apple.com/search?entity=musicArtist&limit=6&term=${encodeURIComponent(q)}`);
      const data = await res.json();
      list.innerHTML = "";
      (data.results||[]).forEach((r, idx)=>{
        const d = document.createElement('div');
        d.className = "suggest-item"; d.textContent = r.artistName;
        if (idx===0) d.dataset.first = "1";
        d.onclick = ()=>{ input.value = r.artistName; state.artist = r.artistName; list.style.display="none"; };
        list.appendChild(d);
      });
      list.style.display = (data.results||[]).length ? "block" : "none";
    });
    input.addEventListener('keydown', (e)=>{
      if (e.key === "Enter"){ const first = byId('artist-list')?.querySelector('[data-first="1"]'); if (first){ e.preventDefault(); first.click(); } }
    });
  }

  function bindVenueAutocomplete(){
    waitForPlaces().then(()=>{
      const input = byId('venue');
      const ac = new google.maps.places.Autocomplete(input, { types: ['establishment'] });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace();
        if (!p || !p.geometry) return;
        state.venue = p.name || input.value.trim();
        state.venuePlaceId = p.place_id || "";
        state.venueLat = p.geometry.location.lat();
        state.venueLng = p.geometry.location.lng();
      });
      input.addEventListener('input', ()=>{ state.venue = input.value.trim(); });
      input.addEventListener('keydown', (e)=>{ if (e.key === "Enter"){ e.preventDefault(); ensureVenueResolved(); }});
    }).catch(()=>{});
  }

  function bindHotelAutocomplete(){
    waitForPlaces().then(()=>{
      const input = byId('hotel');
      if (!input) return;
      const ac = new google.maps.places.Autocomplete(input, { types: ['establishment'] });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace();
        if (!p || !p.geometry) return;
        state.hotel = p.name || input.value.trim();
        state.hotelPlaceId = p.place_id || "";
        state.hotelLat = p.geometry.location.lat();
        state.hotelLng = p.geometry.location.lng();
      });
      input.addEventListener('input', ()=>{ state.hotel = input.value.trim(); });
      input.addEventListener('keydown', (e)=>{ if (e.key === "Enter"){ e.preventDefault(); ensureHotelResolved(); }});
    }).catch(()=>{});
  }

  async function ensureVenueResolved(){
    if (state.venueLat && state.venueLng) return;
    await waitForPlaces();
    const query = (state.venue||"").trim();
    if (!query) throw new Error("Please type a venue name.");
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const place = await new Promise((resolve, reject)=>{
      svc.textSearch({ query }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) resolve(results[0]);
        else reject(new Error("Could not resolve that venue. Try a more specific name."));
      });
    });
    state.venue = place.name;
    state.venuePlaceId = place.place_id;
    state.venueLat = place.geometry.location.lat();
    state.venueLng = place.geometry.location.lng();
  }

  async function ensureHotelResolved(){
    if (!state.staying) return;
    if (state.hotelLat && state.hotelLng) return;
    await waitForPlaces();
    const q = (state.hotel||"").trim();
    if (!q) return;
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const place = await new Promise((resolve) =>{
      svc.textSearch({ query:q }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) resolve(results[0]);
        else resolve(null);
      });
    });
    if (place){
      state.hotel = place.name;
      state.hotelPlaceId = place.place_id;
      state.hotelLat = place.geometry.location.lat();
      state.hotelLng = place.geometry.location.lng();
    }
  }

  // ---- Correct Google Maps URL for place IDs ----
  function gmapsUrl(placeId){
    // Official pattern: https://www.google.com/maps/search/?api=1&query_place_id=PLACE_ID
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  }

  async function generate(){
    if (!state.venue) { alert("Please enter a venue."); return; }
    show('loading');
    try{
      await ensureVenueResolved();
      if (state.staying) await ensureHotelResolved();

      const beforeList = (state.eatWhen==="before" || state.eatWhen==="both") ? await pickRestaurants({wantOpenNow:false}) : [];
      const afterList  = (state.eatWhen==="after"  || state.eatWhen==="both") ? await pickRestaurants({wantOpenNow:true}) : [];
      const extras = await pickExtras();

      const basePlan = {
        show: { title: state.artist ? `${state.artist} — Live` : "Your Concert", venue: state.venue, time: state.showTime || "" },
        intro: "",
        diningBefore: beforeList,
        diningAfter: afterList,
        extras
      };

      let plan = basePlan;
      try {
        const curated = await cohereCurate(state, beforeList, afterList, extras);
        plan = {
          ...basePlan,
          intro: curated.intro || basePlan.intro,
          diningBefore: Array.isArray(curated.diningBefore) && curated.diningBefore.length ? curated.diningBefore : basePlan.diningBefore,
          diningAfter:  Array.isArray(curated.diningAfter)  && curated.diningAfter.length  ? curated.diningAfter  : basePlan.diningAfter
        };
      } catch (e) {
        console.warn("Cohere unavailable, using base plan:", e.message);
      }

      renderResults(plan);
      show('results');
    }catch(e){
      console.error(e);
      alert(e.message || "Couldn’t build the plan. Check your Google key and try again.");
      show('form');
    }
  }

  function miles(a, b){
    const toRad = d => d*Math.PI/180, R=3958.8;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
    const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  // --- Time helpers (12-hour formatting) ---
  function parseHM(hhmm){
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h,m] = hhmm.split(':').map(n=>parseInt(n,10));
    return (h*60 + m) % 1440;
  }
  function addMinutes(mins, delta){
    if (mins == null) return null;
    let x = (mins + delta) % 1440;
    if (x < 0) x += 1440;
    return x;
  }
  function format12(mins){
    if (mins == null) return "";
    let h = Math.floor(mins/60), m = mins % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2,'0')} ${ampm}`;
  }

  // Add "from the venue" after ~X mi snippets for narrative text
  function addVenueSuffix(text){
    if (!text) return text;
    return text.replace(/(~\s*\d+(\.\d+)?\s*mi)\b/g, "$1 from the venue");
  }

  // --- Top blurb (short, keeps your original vibe, ensures venue distance phrasing) ---
  function buildTopBlurb(plan){
    const showM = parseHM(state.showTime);
    const venueName = state.venue || "your venue";

    // Optional small “extra” mention to keep it lively but concise
    let extraBit = "";
    if (Array.isArray(plan.extras) && plan.extras.length){
      const e = plan.extras[0];
      if (e){
        extraBit = ` Want a little extra? Consider <strong>${esc(e.name)}</strong> (${esc((e.section||"").toLowerCase())}, ~${e.distance?.toFixed ? e.distance.toFixed(1) : e.distance} mi).`;
      }
    }

    const core = `Your night is centered around <strong>${esc(venueName)}</strong>${state.showTime ? ` with a show at <strong>${format12(showM)}</strong>` : ""}.`;
    const tail = ` Distances below are from the venue. Maps and websites are linked for quick booking and directions.`;
    return addVenueSuffix(core + extraBit + tail);
  }

  // --- Time-based mini-itinerary lines for the “Your Evening Plan” card ---
  function buildEveningLines(plan){
    const lines = [];
    const showM = parseHM(state.showTime);

    const beforePick = Array.isArray(plan.diningBefore) && plan.diningBefore[0] ? plan.diningBefore[0] : null;
    const afterPick  = Array.isArray(plan.diningAfter)  && plan.diningAfter[0]  ? plan.diningAfter[0]  : null;

    if (state.eatWhen !== "after" && showM != null && beforePick){
      const dinnerBeforeM = addMinutes(showM, -90);
      lines.push(`${format12(dinnerBeforeM)} · Pre-show: <strong>${esc(beforePick.name)}</strong> (~${beforePick.distance?.toFixed ? beforePick.distance.toFixed(1) : beforePick.distance} mi)`);
    }

    if (showM != null){
      lines.push(`${format12(showM)} · Show at <strong>${esc(state.venue || "the venue")}</strong>`);
    } else {
      lines.push(`Showtime · <strong>${esc(state.venue || "the venue")}</strong>`);
    }

    if (state.eatWhen !== "before" && showM != null && afterPick){
      const dinnerAfterM = addMinutes(showM, +45);
      lines.push(`${format12(dinnerAfterM)} · Post-show: <strong>${esc(afterPick.name)}</strong> (~${afterPick.distance?.toFixed ? afterPick.distance.toFixed(1) : afterPick.distance} mi)`);
    }

    return lines;
  }

  async function pickRestaurants({ wantOpenNow }){
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const params = buildSearchParams({ wantOpenNow });

    const results = await new Promise((resolve)=>{
      svc.nearbySearch(params, (res, status)=>{
        if (status !== google.maps.places.PlacesServiceStatus.OK || !res) return resolve([]);
        resolve(res);
      });
    });

    const venue = { lat: state.venueLat, lng: state.venueLng };
    const uniq = []; const seen = new Set();
    for (const r of results){
      if (!r.place_id || seen.has(r.place_id)) continue;
      seen.add(r.place_id); uniq.push(r);
      if (uniq.length >= 14) break;
    }

    const enriched = [];
    for (const r of uniq){
      const d = await new Promise((resolve)=>{
        svc.getDetails({ placeId: r.place_id, fields: ["name","formatted_address","website","geometry","place_id","opening_hours","price_level","rating"] },
          (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
      });
      if (!d?.geometry?.location) continue;
      const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });
      enriched.push({
        name: d.name, address: d.formatted_address || r.vicinity || "",
        distance: +dist.toFixed(2),
        mapUrl: gmapsUrl(d.place_id),
        url: d.website || "",
        rating: typeof d.rating === "number" ? d.rating : null,
        price: typeof d.price_level === "number" ? "$".repeat(d.price_level+1) : null,
        openNow: d.opening_hours?.isOpen() ?? null
      });
      if (enriched.length >= 5) break;
    }

    enriched.sort((a,b)=> a.distance - b.distance || (b.rating||0) - (a.rating||0));
    return enriched.slice(0,5);
  }

  function buildSearchParams({ wantOpenNow }){
    const venue = { lat: state.venueLat, lng: state.venueLng };
    const radius = 2400; // ~1.5 miles
    const priceMap = { "$":0, "$$":1, "$$$":2, "$$$$":3 };
    const maxPrice = priceMap[state.budget] ?? 4;

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

  async function pickExtras(){
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
        svc.getDetails({ placeId: r.place_id, fields: ["name","formatted_address","website","geometry","place_id","opening_hours","rating"] },
          (res, status)=> resolve(status === google.maps.places.PlacesServiceStatus.OK ? res : null));
      });
      if (!d?.geometry?.location) return null;
      const dist = miles(venue, { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() });
      return {
        name: d.name, address: d.formatted_address || r.vicinity || "",
        distance: +dist.toFixed(2),
        mapUrl: gmapsUrl(d.place_id),
        url: d.website || "",
        rating: typeof d.rating === "number" ? d.rating : null
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

  async function cohereCurate(state, beforeList, afterList, extras){
    const trim = p => ({
      name: p.name, address: p.address, distance: p.distance,
      url: p.url || "", mapUrl: p.mapUrl || "",
      price: p.price || null, rating: p.rating || null, openNow: p.openNow ?? null
    });
    try{
      const res = await fetch("/.netlify/functions/concerto_cohere", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            artist: state.artist, venue: state.venue, time: state.showTime,
            venueLat: state.venueLat, venueLng: state.venueLng,
            eatWhen: state.eatWhen, foodStyles: state.foodStyles, placeStyle: state.placeStyle,
            budget: state.budget, tone: state.tone
          },
          candidates: {
            before: (beforeList || []).slice(0,10).map(trim),
            after:  (afterList  || []).slice(0,10).map(trim),
            extras: (extras     || []).slice(0,10).map(p => ({section:p.section, ...trim(p)}))
          }
        })
      });
      if (!res.ok) throw new Error("No function");
      return await res.json();
    }catch(e){
      throw e;
    }
  }

  function renderResults(plan){
    // Header context (artist at venue · time, in 12-hour)
    const showM = parseHM(state.showTime);
    const showText = showM != null ? format12(showM) : "";
    byId('results-context').textContent = `${state.artist ? state.artist + " at " : ""}${state.venue}${showText ? " · " + showText : ""}`;

    // Top blurb (short), always mentions distances are from the venue
    const blurb = buildTopBlurb(plan);
    byId('intro-line').innerHTML = blurb;

    // Timeline (visual) with 12-hour stamps
    const tl = byId('timeline'), tlb = byId('timeline-body');
    tl.style.display = state.showTime ? "block" : "none";
    if (showM != null){
      const pre = (state.eatWhen!=="after") ? `Pre-show dinner around ${format12(addMinutes(showM, -90))}` : null;
      const showLine = `Show at ${format12(showM)}`;
      const post = (state.eatWhen!=="before") ? `Post-show picks around ${format12(addMinutes(showM, +45))}` : null;
      tlb.innerHTML = [pre, showLine, post].filter(Boolean).map(x=>`<div>${esc(x)}</div>`).join("");
    } else {
      tlb.innerHTML = "";
    }

    // Cards grid — first card = time-based mini-itinerary (not the paragraph)
    const grid = byId('itinerary');
    const cards = [];
    cards.push(card("Your Evening Plan", null, buildEveningLines(plan).map(line)));

    if (Array.isArray(plan.diningBefore) && plan.diningBefore.length){
      cards.push(card("Eat Before", null, plan.diningBefore.map(placeLine)));
    }
    if (Array.isArray(plan.diningAfter) && plan.diningAfter.length){
      cards.push(card("Eat After", null, plan.diningAfter.map(placeLine)));
    }
    if (Array.isArray(plan.extras) && plan.extras.length){
      const bySec = {};
      plan.extras.forEach(x=>{ bySec[x.section] = bySec[x.section] || []; bySec[x.section].push(x); });
      Object.entries(bySec).forEach(([sec, items])=>{
        cards.push(card(sec, null, items.slice(0,5).map(placeLine)));
      });
    }

    grid.innerHTML = cards.join("");
  }

  function card(title, subtitle, lines){
    const head = `<header><h3>${esc(title)}${subtitle?": "+esc(subtitle):""}</h3></header>`;
    const body = `<div class="body">${lines.map(l=>`<div>${l}</div>`).join("")}</div>`;
    return `<article class="card card-itin">${head}${body}</article>`;
  }

  function placeLine(p){
    const bits = [
      `<strong>${esc(p.name||"")}</strong>`,
      esc(p.address||""),
      badge(`📍 ${(p.distance||0).toFixed ? p.distance.toFixed(1) : p.distance} mi`),
      badge(p.rating ? `★ ${p.rating.toFixed(1)}` : ""),
      badge(p.price || ""),
      link(p.mapUrl,"Map"),
      link(p.url,"Website")
    ].filter(Boolean);
    return bits.join(" · ");
  }

  // Helpers
  function line(t){ return t ? `${t}` : ""; } // (t is already safely assembled)
  function link(u,t){ return u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : ""; }
  function badge(t){ return t ? `<span class="meta">${esc(t)}</span>` : ""; }
  function esc(s) {
    return (s || "").replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }

  // harmless global fallback in case anything else references sel()
  window.sel = window.sel || function sel(cond){ return cond ? " selected" : ""; };

  function waitForPlaces(maxMs=8000){
    const t0 = Date.now();
    return new Promise((resolve, reject)=>{
      (function tick(){
        if (window.google?.maps?.places) return resolve(true);
        if (Date.now()-t0 > maxMs) return reject(new Error("Google Places failed to load"));
        setTimeout(tick, 120);
      })();
    });
  }
})();
