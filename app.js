// app.js — Tour Card only + refined rails (v7.9.1)
import { buildItinerary } from './itinerary-engine.js';
import { pickRestaurants, pickExtras } from './quality-filter.js';
// ⬇️ removed timeline-renderer import
import { shareLinkOrCopy, toICS } from './export-tools.js';

(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;
  console.log("Concerto+ app.js v7.9.1 loaded");

  const $  = (id) => document.getElementById(id);
  const qsa = (sel, el=document)=> Array.from(el.querySelectorAll(sel));
  const esc = (s) => (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;","&gt;":">&gt;","\"":"&quot;","'":"&#39;" }[m]));
  const show = (name)=>{
    ["welcome","form","loading","results"].forEach(k=>$("screen-"+k)?.classList.remove('active'));
    $("screen-"+name)?.classList.add('active');
    document.body.classList.add('page-transition'); setTimeout(()=>document.body.classList.remove('page-transition'), 350);
  };
  const setProgress = ()=>{
    const bar=$('progress-bar'); if(!bar) return;
    const pct = Math.max(0, Math.min(100, Math.round((step/(steps.length-1))*100)));
    bar.style.width = pct+"%";
  };

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
    arrivalBufferMin: 45, doorsBeforeMin: 90,
    customStops: []
  };

  /* ==================== Nav ==================== */
  $('btn-start')?.addEventListener('click', () => { show('form'); renderStep(); });
  $('btn-prev')?.addEventListener('click', () => { if (step>0){ step--; renderStep(); } });
  $('btn-next')?.addEventListener('click', async () => {
    if (steps[step] === "concert") { await ensureVenueResolved(); }
    if (steps[step] === "stay" && state.staying) { await ensureHotelResolved(); }
    if (step < steps.length-1){ step++; renderStep(); }
    else { await generate(); }
  });
  $('btn-edit')?.addEventListener('click', () => { show('form'); step = 0; renderStep(); });
  $('btn-new')?.addEventListener('click', () => { location.href = location.pathname; });
  $('btn-share')?.addEventListener('click', async () => {
    const enc = btoa(encodeURIComponent(JSON.stringify(state)));
    const url = `${location.origin}${location.pathname}?a=${enc}`;
    await shareLinkOrCopy("Your Concerto+ plan", url);
  });
  $('btn-ics')?.addEventListener('click', () => {
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

  /* ==================== Step UI (unchanged) ==================== */
  function renderStep(){
    setProgress();
    const w = $('step-wrapper'); if (!w) return;

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
      $('showTime').onchange = (e)=> state.showTime = e.target.value;
      $('showDate').onchange = (e)=> state.showDate = e.target.value;
      $('btn-prev').disabled = true;
      $('btn-next').textContent = "Next";

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
      cb.onchange = ()=>{ state.staying = cb.checked; hotelInput.disabled = !cb.checked; };
      bindHotelAutocomplete();
      $('btn-prev').disabled = false;
      $('btn-next').textContent = "Next";

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
            <div class="radio-group segmented" id="budget-pills">
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
      $('eatWhen').onchange = (e)=> state.eatWhen = e.target.value;
      $('placeStyle').onchange = (e)=> state.placeStyle = e.target.value;
      $('foodStyleOther').oninput = (e)=> state.foodStyleOther = e.target.value.trim();
      $('tone').onchange = (e)=> state.tone = e.target.value;
      qsa('#cuisine-pills .pill').forEach(p=>{
        p.onclick=()=>{ const v = p.dataset.val; const i = state.foodStyles.indexOf(v); if (i>=0) state.foodStyles.splice(i,1); else state.foodStyles.push(v); p.classList.toggle('active'); };
      });
      qsa('#budget-pills .pill').forEach(p=>{
        p.onclick=()=>{ state.budget = p.dataset.val; qsa('#budget-pills .pill').forEach(x=>x.classList.remove('active')); p.classList.add('active'); };
      });
      $('btn-prev').disabled = false;
      $('btn-next').textContent = "Next";

    } else {
      // ACTIVITIES + YOUR PICKS
      w.innerHTML = `
        <h3 class="step-title">Activities & Interests</h3>
        <p class="step-help">Optional extras to round out your night — and lock in any places you already know you want.</p>
        <div class="form-grid two">
          <div><label><input type="checkbox" id="int-coffee" ${state.interests.coffee?'checked':''}/> Coffee</label></div>
          <div><label><input type="checkbox" id="int-drinks" ${state.interests.drinks?'checked':''}/> Drinks / Lounge</label></div>
          <div><label><input type="checkbox" id="int-dessert" ${state.interests.dessert?'checked':''}/> Dessert</label></div>
          <div><label><input type="checkbox" id="int-sights" ${state.interests.sights?'checked':''}/> Sights / Landmarks</label></div>
        </div>

        <article class="card" id="custom-card" style="margin-top:12px;">
          <h3 class="step-title" style="margin-bottom:6px;">Your picks (optional)</h3>
          <p class="step-help">We’ll lock these into your schedule.</p>
          <div class="form-grid two">
            <div class="full">
              <label>Place</label>
              <input id="custom-place" type="text" placeholder="e.g., Starbucks Reserve Roastery" autocomplete="off" />
            </div>
            <div>
              <label>When</label>
              <select id="custom-when">
                <option value="before">Before the show</option>
                <option value="after">After the show</option>
              </select>
            </div>
            <div>
              <label>Type</label>
              <select id="custom-type">
                <option value="coffee">Coffee</option>
                <option value="drinks">Drinks</option>
                <option value="dessert">Dessert</option>
                <option value="sight">Sights</option>
                <option value="dinner">Dinner</option>
              </select>
            </div>
            <div>
              <label>Duration (min)</label>
              <input id="custom-duration" type="number" min="10" max="240" value="45" />
            </div>
            <div class="full">
              <label>Note (optional)</label>
              <input id="custom-note" type="text" placeholder="e.g., mobile order ahead" />
            </div>
          </div>
          <div class="sticky-actions">
            <button id="custom-add" class="btn">+ Add to my picks</button>
          </div>
          <div id="custom-pills" class="radio-group" style="margin-top:10px;"></div>
        </article>
      `;
      ["coffee","drinks","dessert","sights"].forEach(k=>{
        const el = $('int-'+k);
        if (el) el.onchange = ()=>{ state.interests[k] = el.checked; };
      });
      bindCustomAutocomplete(); bindCustomAdd(); renderCustomPills();
      $('btn-prev').disabled = false;
      $('btn-next').textContent = "Generate Schedule";
    }
  }

  /* ==================== Places helpers (unchanged) ==================== */
  function bindArtistSuggest(){
    const input = $('artist'), list = $('artist-list'); if (!input || !list) return;
    input.addEventListener('input', async ()=>{
      state.artist = input.value.trim();
      const q = input.value.trim(); if (!q){ list.style.display="none"; list.innerHTML=""; return; }
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

  function mapsReady(){ return !!(window.google && google.maps && google.maps.places); }
  function waitForPlaces(maxMs=10000){
    const t0 = Date.now();
    return new Promise((resolve, reject)=>{
      (function tick(){
        if (mapsReady()) return resolve(true);
        if (Date.now()-t0 > maxMs) return reject(new Error("Google Places failed to load"));
        setTimeout(tick, 120);
      })();
    });
  }
  function bindVenueAutocomplete(){
    waitForPlaces().then(()=>{
      const input = $('venue'); if (!input) return;
      const ac = new google.maps.places.Autocomplete(input, { types: ['establishment'] });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace(); if (!p || !p.geometry) return;
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
        const p = ac.getPlace(); if (!p || !p.geometry) return;
        state.hotel = p.name || input.value.trim();
        state.hotelPlaceId = p.place_id || "";
        state.hotelLat = p.geometry.location.lat();
        state.hotelLng = p.geometry.location.lng();
      });
      input.addEventListener('input', ()=>{ state.hotel = input.value.trim(); });
      input.addEventListener('keydown', (e)=>{ if (e.key === "Enter"){ e.preventDefault(); ensureHotelResolved(); }});
    }).catch(()=>{});
  }
  function bindCustomAutocomplete(){
    waitForPlaces().then(()=>{
      const input = $('custom-place'); if (!input) return;
      const ac = new google.maps.places.Autocomplete(input, { types: ['establishment'] });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace(); if (!p || !p.geometry) return;
        input.dataset.name = p.name || input.value.trim();
        input.dataset.placeId = p.place_id || "";
        input.dataset.lat = p.geometry.location.lat();
        input.dataset.lng = p.geometry.location.lng();
        const svc = new google.maps.places.PlacesService(document.createElement('div'));
        svc.getDetails({ placeId: p.place_id, fields: ["website"] }, (d)=> {
          if (d && d.website) input.dataset.url = d.website;
        });
      });
    }).catch(()=>{});
  }

  /* ==================== Resolvers ==================== */
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

  /* ==================== Custom picks UI ==================== */
  function renderCustomPills(){
    const wrap = $('custom-pills'); if (!wrap) return;
    wrap.innerHTML = state.customStops.map((p, idx)=> `
      <div class="pill" data-idx="${idx}">
        ${esc(p.name)} <span class="meta">· ${p.when} · ${p.durationMin || defaultDurationByType(p.type)} min</span>
        <button class="btn-ghost" data-remove="${idx}" style="margin-left:6px;border:none;background:transparent;">×</button>
      </div>
    `).join("");
    qsa('[data-remove]').forEach(btn=>{
      btn.onclick = ()=>{
        const i = parseInt(btn.dataset.remove,10);
        if (!Number.isNaN(i)) { state.customStops.splice(i,1); renderCustomPills(); }
      };
    });
  }
  function bindCustomAdd(){
    const add = $('custom-add'); if (!add) return;
    add.onclick = async ()=>{
      const input = $('custom-place');
      const when = $('custom-when')?.value || 'before';
      const type = $('custom-type')?.value || 'coffee';
      const durationMin = Math.max(10, parseInt(($('custom-duration')?.value || "45"),10) || 45);
      const note = $('custom-note')?.value?.trim() || "";

      let name = input?.dataset.name || input?.value?.trim() || "";
      let placeId = input?.dataset.placeId || "";
      let lat = input?.dataset.lat ? +input.dataset.lat : null;
      let lng = input?.dataset.lng ? +input.dataset.lng : null;
      let url = input?.dataset.url || "";
      let mapUrl = placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}` : "";

      if ((!lat || !lng) && name){
        try{
          const resolved = await resolveGenericCustomPlace({ name, when, type, state });
          if (resolved){
            name    = resolved.name   || name;
            placeId = resolved.placeId || placeId;
            lat     = resolved.lat     ?? lat;
            lng     = resolved.lng     ?? lng;
            url     = resolved.url     || url;
            mapUrl  = resolved.mapUrl  || mapUrl;
          }
        }catch(e){
          console.warn("Generic resolver failed:", e.message);
        }
      }
      if (!name){ alert("Please enter a place name."); return; }

      state.customStops.push({ name, placeId, lat, lng, url, mapUrl, when, type, durationMin, note });

      if (input){
        input.value = "";
        delete input.dataset.name; delete input.dataset.placeId;
        delete input.dataset.lat;  delete input.dataset.lng; delete input.dataset.url;
      }
      $('custom-duration').value = "45"; $('custom-note').value = "";
      renderCustomPills();
    };
  }
  function defaultDurationByType(t){
    return (t==="coffee")?30 : (t==="dessert")?40 : (t==="drinks")?60 : (t==="dinner")?90 : (t==="sight")?45 : 45;
  }

  /* ==================== Time helpers ==================== */
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

  /* ==================== Generate ==================== */
  async function generate(){
    show('loading');
    try{
      await ensureVenueResolved();
      if (state.staying) await ensureHotelResolved();

      const targetISO = parseShowDateTimeISO();
      const beforeAuto = (state.eatWhen==="before" || state.eatWhen==="both") ? await pickRestaurants({wantOpenNow:false, state, slot:"before", targetISO}) : [];
      const afterAuto  = (state.eatWhen==="after"  || state.eatWhen==="both") ? await pickRestaurants({wantOpenNow:true, state, slot:"after", targetISO}) : [];
      const extras = await pickExtras({ state });

      const locks = state.customStops || [];
      const customDinner = locks.find(p => p.when==='before' && p.type==='dinner');
      const dinnerPick = customDinner || beforeAuto[0] || null;

      const itin = await buildItinerary({
        show: { startISO: targetISO, durationMin: 150, doorsBeforeMin: state.doorsBeforeMin, title: state.artist ? `${state.artist} — Live` : "Your Concert" },
        venue: { name: state.venue, lat: state.venueLat, lng: state.venueLng },
        hotel: state.staying && state.hotelLat && state.hotelLng ? { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng } : null,
        prefs: { dine: state.eatWhen, arrivalBufferMin: state.arrivalBufferMin },
        picks: { dinner: dinnerPick ? { name:dinnerPick.name, lat:dinnerPick.lat, lng:dinnerPick.lng, url:dinnerPick.url, mapUrl:dinnerPick.mapUrl } : null }
      });

      window.__lastItinerary = itin;

      const showText = [state.showDate, state.showTime].filter(Boolean).join(" ");
      $('results-context').textContent = `${state.artist ? state.artist + " at " : ""}${state.venue}${showText ? " · " + showText : ""}`;
      $('intro-line').innerHTML = `Your schedule is centered on <strong>${esc(state.venue)}</strong>. Distances are from the venue.`;

      // ⬇️ Single Tour Card (replaces any vertical schedule)
      const city = await venueCityName();
      renderTourCard(city, itin, dinnerPick);

      // Rails with min 5 / max 10 cards each, deduped
      await renderRails({ before: beforeAuto, after: afterAuto, extras });

      show('results');
    }catch(e){
      console.error(e);
      alert(e.message || "Couldn’t build the schedule. Check your Google key and try again.");
      show('form');
    }
  }

  /* ==================== Tour Card ==================== */
  async function venueCityName(){
    try{
      await waitForPlaces();
      if (!(state.venueLat && state.venueLng)) return "";
      const geocoder = new google.maps.Geocoder();
      const res = await new Promise((resolve)=> geocoder.geocode(
        { location: { lat: state.venueLat, lng: state.venueLng } },
        (r, s)=> resolve(s===google.maps.GeocoderStatus.OK ? r : [])
      ));
      const comp = (res?.[0]?.address_components || []);
      const city = comp.find(c=>c.types.includes("locality"))?.long_name
                || comp.find(c=>c.types.includes("postal_town"))?.long_name
                || comp.find(c=>c.types.includes("administrative_area_level_2"))?.long_name
                || "";
      return city;
    }catch{ return ""; }
  }

  // robust formatter (fixes 12:NaN)
  function fmtLocal(when){
    const d = (when instanceof Date) ? when : new Date(when);
    try{ return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); }catch{ return ''; }
  }

  function renderTourCard(city, items, dinnerPick){
    const el = $('schedule'); if (!el) return;
    const head = `
      <article class="card tour-card">
        <div class="tour-head">
          <h3 class="tour-title">Your Night${city ? ` in ${esc(city)}` : ""}</h3>
        </div>
        <div class="tour-steps">
          ${items.map(it => {
            const time = fmtLocal(it.start);
            let label = "";
            if (it.type === "hotel-depart"){
              if (!state.staying) return "";
              label = \`Leave ${esc(state.hotel || 'hotel')}\`;
            } else if (it.type === "dine-arrive"){
              label = \`Arrive at ${esc(dinnerPick?.name || 'restaurant')}\`;
            } else if (it.type === "dine-leave"){
              label = \`Leave ${esc(dinnerPick?.name || 'restaurant')} for ${esc(state.venue)}\`;
            } else if (it.type === "arrive-venue"){
              label = \`Arrive at ${esc(state.venue)}\`;
            } else if (it.type === "show"){
              label = "Show starts";
            } else if (it.type === "post-leave"){
              label = "Leave the venue for dessert/drinks";
            } else { return ""; }
            const note = (it.type === "arrive-venue") ? \`No less than ${Math.max(45, state.arrivalBufferMin||45)} min before concert start time\` : "";
            return \`
              <div class="tstep">
                <div class="t-time">\${esc(time)}</div>
                <div class="t-label">\${label}</div>
                \${note ? \`<div class="t-note">· \${esc(note)}</div>\` : ""}
              </div>\`;
          }).join("")}
        </div>
      </article>
    `;
    el.innerHTML = head; // tour card only
  }

  /* ==================== Rails ==================== */
  function samePlace(a,b){ return ((a?.name||"")+"|"+(a?.mapUrl||"")) === ((b?.name||"")+"|"+(b?.mapUrl||"")); }
  function uniqMerge(max, ...lists){
    const out=[]; const seen=new Set();
    for (const list of lists){
      for (const p of (list||[])){
        const k = (p.name||"")+"|"+(p.mapUrl||"");
        if (seen.has(k)) continue;
        seen.add(k); out.push(p);
        if (out.length>=max) return out;
      }
    }
    return out;
  }
  function pickRange(list, min=5, max=10, fallback=[]){
    let out = (list||[]).slice(0, max);
    if (out.length < min){
      out = uniqMerge(max, out, fallback);
    }
    return out.slice(0, Math.max(min, Math.min(max, out.length)));
  }

  function fillRail(id, list){
    const row = $(id); if (!row) return;
    if (!Array.isArray(list) || !list.length){ row.innerHTML = `<div class="muted" style="padding:8px 2px;">No options found.</div>`; return; }
    const cards = list.map(p => {
      const name = esc(p.name || "");
      const dist = (p.distance && p.distance.toFixed) ? p.distance.toFixed(1) : (p.distance || "");
      const rating = typeof p.rating === "number" ? `★ ${p.rating.toFixed(1)}` : "";
      const price = p.price || "";
      const map = p.mapUrl || "";
      const img = p.photoUrl || "";
      const site = p.url || "";
      return `
        <article class="place-card" data-map-open="${esc(map)}" title="Open on Google Maps">
          <div class="pc-img">${img ? `<img src="${esc(img)}" alt="${name}"/>` : `<div class="pc-img ph"></div>`}</div>
          <div class="pc-body">
            <div class="pc-title">${name}</div>
            <div class="pc-meta">
              ${dist ? `<span>${esc(dist)} mi</span>` : ""}
              ${rating ? `<span>${esc(rating)}</span>` : ""}
              ${price ? `<span>${esc(price)}</span>` : ""}
            </div>
            <div class="pc-actions">
              ${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">Map</a>` : ""}
              ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener" data-link="site">Website</a>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
    row.innerHTML = cards;

    qsa('[data-map-open]', row).forEach(el=>{
      el.onclick = (e)=>{
        if ((e.target.closest('a') && e.target.closest('a').dataset.link === 'site') || (e.target.dataset.link === 'site')) return;
        const url = el.dataset.mapOpen;
        if (url) window.open(url, '_blank', 'noopener');
      };
    });
  }

  async function renderRails({ before, after, extras }){
    const dessert = (extras||[]).filter(x=>/dessert/i.test(x.section||""));
    const drinks  = (extras||[]).filter(x=>/drinks?/i.test(x.section||""));
    const coffee  = (extras||[]).filter(x=>/coffee/i.test(x.section||""));

    const dinnerRow  = pickRange(before, 5, 10, after);
    const dessertRow = pickRange(uniqMerge(10, dessert, after), 5, 10, before);
    const drinksRow  = pickRange(uniqMerge(10, drinks, after), 5, 10, before);
    const coffeeRow  = pickRange(coffee, 5, 10);

    fillRail('row-dinner', dinnerRow);
    fillRail('row-dessert', dessertRow);
    fillRail('row-drinks', drinksRow);
    fillRail('row-coffee', coffeeRow);
  }

  /* ==================== Generic brand resolver ==================== */
  async function resolveGenericCustomPlace({ name, when, type, state }){
    if (!(state?.venueLat && state?.venueLng)) return null;
    await waitForPlaces();
    const center = new google.maps.LatLng(state.venueLat, state.venueLng);
    const svc = new google.maps.places.PlacesService(document.createElement('div'));

    const { placesType, keyword } = placeTypeFor(type, name);
    const nearbyParams = { location: center, rankBy: google.maps.places.RankBy.DISTANCE, type: placesType || undefined, keyword: keyword || undefined };

    const results = await new Promise((resolve) => {
      svc.nearbySearch(nearbyParams, (res, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(res) && res.length){
          resolve(res);
        } else { resolve([]); }
      });
    });

    let choice = results[0] || null;
    if (!choice){
      const textParams = { location: center, radius: 2000, query: name };
      choice = await new Promise((resolve) => {
        svc.textSearch(textParams, (res, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(res) && res.length){
            resolve(res[0]);
          } else { resolve(null); }
        });
      });
    }
    if (!choice || !choice.place_id || !choice.geometry) return null;

    const details = await new Promise((resolve) => {
      svc.getDetails({ placeId: choice.place_id, fields: ["website", "name"] }, (d, s) => {
        resolve(s === google.maps.places.PlacesServiceStatus.OK ? d : null);
      });
    });

    return {
      name: (details?.name || choice.name || name),
      placeId: choice.place_id,
      lat: choice.geometry.location.lat(),
      lng: choice.geometry.location.lng(),
      url: details?.website || "",
      mapUrl: `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(choice.place_id)}`
    };
  }
  function placeTypeFor(type, rawName){
    const low = (rawName || "").toLowerCase().trim();
    const brandy = /\b(starbucks|dunkin|peet|philz|blue bottle|tim hortons|pret)\b/i.test(low);
    switch (type){
      case 'coffee':  return { placesType: 'cafe',               keyword: brandy ? rawName : (low || 'coffee') };
      case 'dessert': return { placesType: 'bakery',             keyword: low || 'dessert' };
      case 'drinks':  return { placesType: 'bar',                keyword: low || 'cocktail bar' };
      case 'sight':   return { placesType: 'tourist_attraction', keyword: low || 'landmark' };
      case 'dinner':
      default:        return { placesType: 'restaurant',         keyword: low || 'restaurant' };
    }
  }
})();
