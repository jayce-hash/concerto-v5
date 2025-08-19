// app.js — Concerto+ continuous schedule (v7.3.2, light theme ready, safe bindings)
import { buildItinerary } from './itinerary-engine.js';
import { pickRestaurants, pickExtras } from './quality-filter.js';
import { renderSchedule } from './timeline-renderer.js';
import { shareLinkOrCopy, toICS } from './export-tools.js';

(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;
  console.log("Concerto+ app.js v7.3.2 loaded");

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); return !!el; };

  const screens = {
    welcome: $('screen-welcome'),
    form: $('screen-form'),
    loading: $('screen-loading'),
    results: $('screen-results')
  };

  function show(name){
    Object.values(screens).forEach(s => s && s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
    document.body.classList.add('page-transition');
    setTimeout(()=>document.body.classList.remove('page-transition'), 350);
  }
  function setProgress(){
    const bar = $('progress-bar');
    if (!bar) return;
    const pct = Math.max(0, Math.min(100, Math.round((step / (steps.length - 1)) * 100)));
    bar.style.width = pct + '%';
  }

  // ---------- state ----------
  let step = 0;
  const steps = ["concert","stay","dining","activities"];
  const state = window.__concertoState = {
    artist: "", venue: "", venuePlaceId: "", venueLat: null, venueLng: null,
    showDate: "", showTime: "",
    hotel: "", hotelPlaceId:"", hotelLat:null, hotelLng:null, staying:true,
    eatWhen: "both",
    foodStyles: [], foodStyleOther: "", placeStyle: "sitdown",
    budget: "$$", tone: "balanced",
    interests: { coffee:false, drinks:false, dessert:false, sights:false },
    arrivalBufferMin: 45, doorsBeforeMin: 90
  };

  // ---------- bindings (null-safe) ----------
  on('btn-start','click', () => { show('form'); renderStep(); });
  on('btn-prev','click', () => { if (step>0){ step--; renderStep(); } });
  on('btn-next','click', async () => {
    if (steps[step] === "concert") { await ensureVenueResolved(); }
    if (steps[step] === "stay" && state.staying) { await ensureHotelResolved(); }
    if (step < steps.length-1){ step++; renderStep(); }
    else { await generate(); }
  });
  on('btn-edit','click', () => { show('form'); step = 0; renderStep(); });
  on('btn-new','click', () => { location.href = location.pathname; });
  on('btn-share','click', async () => {
    const enc = btoa(encodeURIComponent(JSON.stringify(state)));
    const url = `${location.origin}${location.pathname}?a=${enc}`;
    await shareLinkOrCopy("Your Concerto+ plan", url);
  });
  on('btn-ics','click', () => {
    const items = window.__lastItinerary || [];
    const blob = toICS(items, 'Concerto+ — Concert Day');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'concerto-itinerary.ics';
    document.body.appendChild(a); a.click(); a.remove();
  });

  // deep-link restore
  try {
    const enc = new URLSearchParams(location.search).get("a");
    if (enc) { Object.assign(state, JSON.parse(decodeURIComponent(atob(enc)))); show('form'); step = steps.length-1; renderStep(); }
  } catch {}

  // ---------- step renderer ----------
  function renderStep(){
    setProgress();
    const w = $('step-wrapper');
    if (!w) return;

    if (steps[step] === "concert"){
      w.innerHTML = `
        <h3 class="step-title">Concert Details</h3>
        <p class="step-help">Choose your venue, date, and showtime.</p>
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
            <label>Show date</label>
            <input id="showDate" type="date" value="${esc(state.showDate)}"/>
          </div>
          <div>
            <label>Show start time</label>
            <input id="showTime" type="time" value="${esc(state.showTime)}"/>
          </div>
        </div>
      `;
      bindArtistSuggest(); bindVenueAutocomplete();
      const st = $('showTime'), sd = $('showDate');
      if (st) st.onchange = (e)=> state.showTime = e.target.value;
      if (sd) sd.onchange = (e)=> state.showDate = e.target.value;
      const prev = $('btn-prev'); if (prev) prev.disabled = true;
      const next = $('btn-next'); if (next) next.textContent = "Next";

    } else if (steps[step] === "stay"){
      w.innerHTML = `
        <h3 class="step-title">Accommodation</h3>
        <p class="step-help">Let us plan around your hotel.</p>
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
      const cb = $('staying'); const hotelInput = $('hotel');
      if (cb) cb.onchange = ()=>{ state.staying = cb.checked; if (hotelInput) hotelInput.disabled = !cb.checked; };
      bindHotelAutocomplete();
      const prev = $('btn-prev'); if (prev) prev.disabled = false;
      const next = $('btn-next'); if (next) next.textContent = "Next";

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
      const ew = $('eatWhen'), ps = $('placeStyle'), fso = $('foodStyleOther'), tone = $('tone');
      if (ew) ew.onchange = (e)=> state.eatWhen = e.target.value;
      if (ps) ps.onchange = (e)=> state.placeStyle = e.target.value;
      if (fso) fso.oninput = (e)=> state.foodStyleOther = e.target.value.trim();
      if (tone) tone.onchange = (e)=> state.tone = e.target.value;
      qsa('#cuisine-pills .pill').forEach(p=>{
        p.onclick=()=>{
          const v = p.dataset.val;
          const i = state.foodStyles.indexOf(v);
          if (i>=0) state.foodStyles.splice(i,1); else state.foodStyles.push(v);
          p.classList.toggle('active');
        };
      });
      qsa('#budget-pills .pill').forEach(p=>{
        p.onclick=()=>{ state.budget = p.dataset.val; qsa('#budget-pills .pill').forEach(x=>x.classList.remove('active')); p.classList.add('active'); };
      });
      const prev = $('btn-prev'); if (prev) prev.disabled = false;
      const next = $('btn-next'); if (next) next.textContent = "Next";

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
      ["coffee","drinks","dessert","sights"].forEach(k=>{
        const el = $('int-'+k);
        if (el) el.onchange = ()=>{ state.interests[k] = el.checked; };
      });
      const prev = $('btn-prev'); if (prev) prev.disabled = false;
      const next = $('btn-next'); if (next) next.textContent = "Generate Schedule";
    }
  }

  // ---------- artist suggest ----------
  function bindArtistSuggest(){
    const input = $('artist'), list = $('artist-list');
    if (!input || !list) return;
    input.addEventListener('input', async ()=>{
      state.artist = input.value.trim();
      const q = input.value.trim();
      if (!q){ list.style.display="none"; list.innerHTML=""; return; }
      try{
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
      }catch{ list.style.display="none"; }
    });
    input.addEventListener('keydown', (e)=>{
      if (e.key === "Enter"){ const first = $('artist-list')?.querySelector('[data-first="1"]'); if (first){ e.preventDefault(); first.click(); } }
    });
  }

  // ---------- Places autocomplete ----------
  function bindVenueAutocomplete(){
    waitForPlaces().then(()=>{
      const input = $('venue'); if (!input) return;
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
      const input = $('hotel'); if (!input) return;
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
  function mapsAvailable(){ return !!(window.google && google.maps && google.maps.places); }
  function waitForPlaces(maxMs=10000){
    const t0 = Date.now();
    return new Promise((resolve, reject)=>{
      (function tick(){
        if (mapsAvailable()) return resolve(true);
        if (Date.now()-t0 > maxMs) return reject(new Error("Google Places failed to load"));
        setTimeout(tick, 120);
      })();
    });
  }

  // ---------- resolvers ----------
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

  // ---------- time helpers ----------
  function parseHM(hhmm){
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h,m] = hhmm.split(':').map(n=>parseInt(n,10));
    return { h, m };
  }
  function parseShowDateTimeISO(){
    const now = new Date();
    const hm = parseHM(state.showTime) || {h:19,m:0};
    if (state.showDate){
      const [Y,M,D] = state.showDate.split('-').map(n=>parseInt(n,10));
      return new Date(Y, M-1, D, hm.h, hm.m).toISOString();
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm.h, hm.m).toISOString();
  }

  // ---------- generate ----------
  async function generate(){
    show('loading');
    try{
      await ensureVenueResolved();
      if (state.staying) await ensureHotelResolved();

      const targetISO = parseShowDateTimeISO();
      const beforeList = (state.eatWhen==="before" || state.eatWhen==="both")
        ? await pickRestaurants({ wantOpenNow:false, state, slot:"before", targetISO }) : [];
      const afterList  = (state.eatWhen==="after"  || state.eatWhen==="both")
        ? await pickRestaurants({ wantOpenNow:true, state, slot:"after", targetISO }) : [];
      const extras = await pickExtras({ state });

      // Cohere curate (best-effort)
      let curated = null;
      try {
        curated = await cohereCurate(state, beforeList, afterList, extras);
      } catch (e) {
        console.warn("Cohere unavailable, using base picks only:", e.message);
      }

      const diningBefore = (curated?.diningBefore && curated.diningBefore.length) ? curated.diningBefore : beforeList;
      const diningAfter  = (curated?.diningAfter  && curated.diningAfter.length)  ? curated.diningAfter  : afterList;
      const showTitle = state.artist ? `${state.artist} — Live` : "Your Concert";
      const intro = curated?.intro || `Your schedule is centered on <strong>${esc(state.venue)}</strong>. Distances are from the venue.`;

      const dinnerPick = (state.eatWhen!=='after' ? diningBefore?.[0] : null) || null;
      const itin = await buildItinerary({
        show: { startISO: targetISO, durationMin: 150, doorsBeforeMin: state.doorsBeforeMin, title: showTitle },
        venue: { name: state.venue, lat: state.venueLat, lng: state.venueLng },
        hotel: state.staying && state.hotelLat && state.hotelLng ? { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng } : null,
        prefs: { dine: state.eatWhen, arrivalBufferMin: state.arrivalBufferMin, merch: true, concessions: true, water: true },
        picks: { dinner: dinnerPick ? { name:dinnerPick.name, lat:dinnerPick.lat, lng:dinnerPick.lng, url:dinnerPick.url, mapUrl:dinnerPick.mapUrl } : null }
      });
      window.__lastItinerary = itin;

      // Header
      const showText = [state.showDate, state.showTime].filter(Boolean).join(" ");
      const ctx = $('results-context'); if (ctx) ctx.textContent = `${state.artist ? state.artist + " at " : ""}${state.venue}${showText ? " · " + showText : ""}`;
      const introEl = $('intro-line'); if (introEl) introEl.innerHTML = intro;

      // Render continuous schedule
      const scheduleEl = $('schedule');
      if (scheduleEl) renderSchedule(itin, scheduleEl, { before: diningBefore, after: diningAfter });

      show('results');
    }catch(e){
      console.error(e);
      alert(e.message || "Couldn’t build the schedule. Check your Google key and try again.");
      show('form');
    }
  }

  // ---------- cohere ----------
  async function cohereCurate(stateSnapshot, beforeList, afterList, extras){
    const trim = p => ({
      name: p.name, address: p.address, distance: p.distance,
      url: p.url || "", mapUrl: p.mapUrl || "",
      price: p.price || null, rating: p.rating || null, openNow: p.openNow ?? null
    });
    const res = await fetch("/.netlify/functions/concerto_cohere", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          artist: stateSnapshot.artist, venue: stateSnapshot.venue, time: stateSnapshot.showTime,
          venueLat: stateSnapshot.venueLat, venueLng: stateSnapshot.venueLng,
          eatWhen: stateSnapshot.eatWhen, foodStyles: stateSnapshot.foodStyles, placeStyle: stateSnapshot.placeStyle,
          budget: stateSnapshot.budget, tone: stateSnapshot.tone
        },
        candidates: {
          before: (beforeList || []).slice(0,10).map(trim),
          after:  (afterList  || []).slice(0,10).map(trim),
          extras: (extras     || []).slice(0,10).map(p => ({section:p.section, ...trim(p)}))
        }
      })
    });
    if (!res.ok) throw new Error("Cohere error");
    return await res.json();
  }

})();