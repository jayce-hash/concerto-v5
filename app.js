// app.js — Concert step with Ticketmaster + Manual cards, tour card + refined rails (v8.0.5)
import { buildItinerary } from './itinerary-engine.js';
import { pickRestaurants, pickExtras } from './quality-filter.js';
import { shareLinkOrCopy, toICS } from './export-tools.js';

(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;
  console.log("Concerto+ app.js v8.0.5 loaded");

  const $  = (id) => document.getElementById(id);
  const qsa = (sel, el=document)=> Array.from(el.querySelectorAll(sel));
  const esc = (s) => (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));

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
  const steps = ["concert","food","activities"];

const state = window.__concertoState = {
  artist: "", venue: "", venuePlaceId: "", venueLat: null, venueLng: null,
  showDate: "", showTime: "",
  showTz: "",
  hotel: "", hotelPlaceId:"", hotelLat:null, hotelLng:null, staying:true,

  eatWhen: "both",
  foodStyles: [], foodStyleOther: "",
  placeStyle: "sitdown",
  budget: "$$",

  interests: {
    coffee:false, drinks:false, dessert:false, sights:false,
    lateNight:false, nightlife:false, shopping:false, relax:false
  },

  arrivalBufferMin: 45, doorsBeforeMin: 90,
  customStops: [],

  /* Itinerary start time */
  startAt: "09:00",

  /* Lunch prefs */
  lunch: {
    want: true,
    time: "12:30",
    styles: [],
    placeStyle: "fast",  // sitdown | fast | cafe | sandwich
    budget: "$$"
  },

  /* New: dinner toggle */
  wantDinner: true,
};

/* ==================== Nav ==================== */
$('btn-start')?.addEventListener('click', () => { 
  show('form'); 
  renderStep(); 
});
$('btn-prev')?.addEventListener('click', () => { 
  if (step>0){ step--; renderStep(); } 
});
$('btn-next')?.addEventListener('click', async () => {
  if (steps[step] === "concert") {
    await ensureVenueResolved();
    if (state.staying) { await ensureHotelResolved(); }
  }
  if (step < steps.length-1){ 
    step++; 
    renderStep(); 
  } else { 
    await generate(); 
  }
});
$('btn-edit')?.addEventListener('click', () => { 
  show('form'); 
  step = 0; 
  renderStep(); 
});
$('btn-new')?.addEventListener('click', () => { 
  location.href = location.pathname; 
});
$('btn-share')?.addEventListener('click', async () => {
  const enc = btoa(encodeURIComponent(JSON.stringify(state)));
  const url = `${location.origin}${location.pathname}?a=${enc}`;
  await shareLinkOrCopy("Your Concerto+ plan", url);
});

  // deep-link restore
  try {
    const enc = new URLSearchParams(location.search).get("a");
    if (enc) { Object.assign(state, JSON.parse(decodeURIComponent(atob(enc)))); show('form'); step = steps.length-1; renderStep(); }
  } catch {}
    /* ===== Persist/Resume plan (localStorage) ===== */
const STORAGE_KEY = 'concertoPlus:lastState';
function savePlan(){
  try {
    const payload = { state, ts: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}
function loadPlan(maxAgeMs = 1000*60*60*24*14){ // 14 days
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.state || !obj?.ts) return null;
    if (Date.now() - obj.ts > maxAgeMs) return null;
    return obj.state;
  } catch { return null; }
}

// Resume-plan UI on welcome screen (only if no deep link is active)
const resumeBtn = $('btn-resume');
if (resumeBtn) {
  const saved = loadPlan();
  if (saved && !new URLSearchParams(location.search).get("a")) {
    resumeBtn.style.display = 'inline-block';
    resumeBtn.onclick = async () => {
      Object.assign(state, saved);
      show('loading');
      try { await generate(); }
      catch (e) {
        console.warn(e);
        alert("Couldn't resume the last plan.");
        show('welcome');
      }
    };
  }
}

  /* ==================== Steps UI ==================== */
function renderStep(){
  setProgress();
  const w = $('step-wrapper'); if (!w) return;

  if (steps[step] === "concert"){
  w.innerHTML = `
    <h3 class="step-title">Concert & Accommodation</h3>
    <p class="step-help">Find your show, add details if needed, then (optionally) add your hotel.</p>

    <!-- Ticketmaster card -->
    <article class="card" style="padding:16px;">
      <h3 class="step-title" style="margin-bottom:12px;">Find your show (Ticketmaster)</h3>

      <div class="form-grid two plain">
        <div class="full field">
          <label>Artist or Venue</label>
          <input id="tm-q" type="text" placeholder="e.g., Olivia Rodrigo or Madison Square Garden" autocomplete="off"/>
        </div>
        <div class="field">
          <label>City (optional)</label>
          <input id="tm-city" type="text" placeholder="e.g., New York"/>
        </div>
      </div>

      <div class="field">
        <button id="tm-search" class="btn btn-primary" type="button">Search Ticketmaster</button>
      </div>

      <div id="tm-results" class="suggest-list" style="display:none; position:relative;"></div>
    </article>

    <!-- Manual card (collapsed by default) -->
    <article class="card" id="manual-card" style="padding:16px;">
      <button id="manual-toggle" class="btn btn-ghost" type="button"
              style="width:100%; text-align:left; display:flex; align-items:center; justify-content:space-between;">
        <span>Can’t find your show? Enter it manually</span>
        <span id="manual-caret" aria-hidden="true" style="opacity:.8;">▾</span>
      </button>

      <div id="manual-body" style="display:none; margin-top:12px;">
        <div class="form-grid two plain">
          <div class="field">
            <label>Artist (optional)</label>
            <div class="suggest">
              <input id="artist" type="text" placeholder="e.g., Taylor Swift" value="${esc(state.artist)}" autocomplete="off"/>
              <div id="artist-list" class="suggest-list" style="display:none;"></div>
            </div>
          </div>

          <div class="field">
            <label>Venue</label>
            <input id="venue" type="text" placeholder="Type a venue name" value="${esc(state.venue)}" autocomplete="off"/>
          </div>

          <div class="field">
            <label>Show date</label>
            <input id="showDate" type="date" value="${esc(state.showDate)}"/>
          </div>

          <div class="field">
            <label>Show start time</label>
            <input id="showTime" type="time" value="${esc(state.showTime)}"/>
          </div>
        </div>
      </div>
    </article>

    <!-- Hotel card -->
    <article class="card" style="padding:16px;">
      <div class="qrow" style="margin-bottom:12px;">
        <label class="switch"><input id="staying" type="checkbox" ${state.staying?'checked':''}/></label>
        <h3 class="step-title" style="margin:0;">Staying at a hotel?</h3>
      </div>

      <div id="hotel-fields">
        <input id="hotel" type="text" placeholder="Name or address" value="${esc(state.hotel)}"/>
      </div>
    </article>
  `;

  // --- Bindings ---
  bindTmSearch();

  // Manual section bindings
  bindArtistSuggest();
  bindVenueAutocomplete();
  $('showTime').onchange = (e)=> state.showTime = e.target.value;
  $('showDate').onchange = (e)=> state.showDate = e.target.value;

  // Collapse/expand manual card
  const manualToggle = $('manual-toggle');
  const manualBody   = $('manual-body');
  const manualCaret  = $('manual-caret');
  if (manualToggle && manualBody) {
    manualToggle.onclick = () => {
      const open = manualBody.style.display !== 'none';
      manualBody.style.display = open ? 'none' : 'block';
      if (manualCaret) manualCaret.textContent = open ? '▾' : '▴';
    };
  }

  // Hotel toggle
  const cb = $('staying'), fields = $('hotel-fields'), input = $('hotel');
  const setHotelEnabled = (on) => {
    fields.style.opacity = on ? '' : '.5';
    fields.style.pointerEvents = on ? '' : 'none';
    input.disabled = !on;
  };
  setHotelEnabled(!!state.staying);
  cb.onchange = () => { state.staying = cb.checked; setHotelEnabled(cb.checked); };
  bindHotelAutocomplete();

  $('btn-prev').disabled = true;
  $('btn-next').textContent = "Next";
  
  } else if (steps[step] === "food") {
  const lunchCuisines = ["Sandwiches","Burgers","Pizza","Mexican/Tacos","Mediterranean","Japanese/Sushi","Salads","Soup","BBQ","Cafe"];
  const L = state.lunch || (state.lunch = { want:true, time:"12:30", styles:[], placeStyle:"fast", budget:"$$" });

  const dinnerCuisines = ["American","Italian","Japanese/Sushi","Mexican/Tacos","Steakhouse","Seafood","Mediterranean","Vegan/Vegetarian","Pizza","BBQ"];

  // ensure arrays exist
  if (!Array.isArray(L.styles)) L.styles = [];
  if (!Array.isArray(state.foodStyles)) state.foodStyles = [];

  w.innerHTML = `
    <h3 class="step-title">Food</h3>

    <!-- LUNCH CARD -->
    <article class="card" style="padding:16px;">
      <div class="qrow" style="margin-bottom:12px;">
        <label class="switch"><input id="l-want" type="checkbox" ${L.want?'checked':''}/></label>
        <h3 class="step-title" style="margin:0;">Plan lunch?</h3>
      </div>

      <div id="l-fields" style="${L.want ? '' : 'opacity:.5;pointer-events:none'}">
        <!-- Cuisines first -->
        <div class="field" style="margin-bottom:12px;">
          <label>Cuisines (choose any)</label>
          <div class="radio-group" id="l-cuisines">
            ${lunchCuisines.map(c => `<div class="pill${(L.styles||[]).includes(c)?" active":""}" data-val="${c}">${c}</div>`).join("")}
          </div>
        </div>

        <!-- Restaurant type -->
        <div class="field" style="margin-bottom:12px;">
          <label>Restaurant type</label>
          <select id="l-style" ${L.want?'':'disabled'}>
            <option value="sitdown"${L.placeStyle==="sitdown"?" selected":""}>Sit-down</option>
            <option value="fast"${L.placeStyle==="fast"?" selected":""}>Fast-casual / Quick</option>
            <option value="sandwich"${L.placeStyle==="sandwich"?" selected":""}>Sandwich shop</option>
            <option value="cafe"${L.placeStyle==="cafe"?" selected":""}>Cafe</option>
          </select>
        </div>

        <!-- Budget -->
        <div class="field">
          <label>Budget</label>
          <div class="radio-group segmented" id="l-budget">
            ${["$","$$","$$$"].map(b => `<div class="pill${b===L.budget?" active":""}" data-val="${b}">${b}</div>`).join("")}
          </div>
        </div>
      </div>
    </article>

    <!-- DINNER CARD -->
    <article class="card" style="padding:16px;">
      <div class="qrow" style="margin-bottom:12px;">
        <label class="switch"><input id="dinner-on" type="checkbox" ${state.wantDinner?'checked':''}/></label>
        <h3 class="step-title" style="margin:0;">Dinner before the show?</h3>
      </div>

      <div id="dinner-fields" style="${state.wantDinner ? '' : 'opacity:.5;pointer-events:none'}">
        <!-- Cuisines first -->
        <div class="field" style="margin-bottom:12px;">
          <label>Cuisines (choose any)</label>
          <div class="radio-group" id="cuisine-pills">
            ${dinnerCuisines.map(c => `<div class="pill${state.foodStyles.includes(c)?" active":""}" data-val="${c}">${c}</div>`).join("")}
          </div>
        </div>

        <!-- Restaurant type -->
        <div class="field" style="margin-bottom:12px;">
          <label>Restaurant type</label>
          <select id="placeStyle">
            <option value="sitdown"${state.placeStyle==="sitdown" ? " selected" : ""}>Sit-down</option>
            <option value="fast"${state.placeStyle==="fast" ? " selected" : ""}>Fast-casual / Quick</option>
            <option value="bar"${state.placeStyle==="bar" ? " selected" : ""}>Bar / Lounge</option>
            <option value="dessert"${state.placeStyle==="dessert" ? " selected" : ""}>Dessert / Cafe</option>
          </select>
        </div>

        <!-- Budget -->
        <div class="field">
          <label>Budget</label>
          <div class="radio-group segmented" id="budget-pills">
            ${["$","$$","$$$","$$$$"].map(b => `<div class="pill${b===state.budget?" active":""}" data-val="${b}">${b}</div>`).join("")}
          </div>
        </div>
      </div>
    </article>
  `;

  // ------ LUNCH wiring ------
  const lToggle = $('l-want');
  const lFields = $('l-fields');
  const lStyle  = $('l-style');

  const setLunchEnabled = (on) => {
    lFields.style.opacity = on ? '' : '.5';
    lFields.style.pointerEvents = on ? '' : 'none';
    if (lStyle) lStyle.disabled = !on;
  };
  lToggle.onchange = () => { L.want = lToggle.checked; setLunchEnabled(L.want); };
  setLunchEnabled(L.want);

  lStyle.onchange = (e)=>{ L.placeStyle = e.target.value; };

  qsa('#l-cuisines .pill').forEach(p=>{
    p.onclick = () => {
      const v = p.dataset.val;
      const i = (L.styles||[]).indexOf(v);
      if (i>=0){ L.styles.splice(i,1); } else { L.styles.push(v); }
      p.classList.toggle('active');
    };
  });
  qsa('#l-budget .pill').forEach(p=>{
    p.onclick = () => {
      L.budget = p.dataset.val;
      qsa('#l-budget .pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
    };
  });

  // ------ DINNER wiring ------
  const dToggle = $('dinner-on');
  const dFields = $('dinner-fields');
  const setDinner = (on) => {
    dFields.style.opacity = on ? '' : '.5';
    dFields.style.pointerEvents = on ? '' : 'none';
  };
  dToggle.onchange = () => { state.wantDinner = dToggle.checked; setDinner(dToggle.checked); };
  setDinner(state.wantDinner);

  $('placeStyle').onchange = (e)=> state.placeStyle = e.target.value;

  qsa('#cuisine-pills .pill').forEach(p=>{
    p.onclick = () => {
      const v = p.dataset.val;
      const i = state.foodStyles.indexOf(v);
      if (i>=0) state.foodStyles.splice(i,1); else state.foodStyles.push(v);
      p.classList.toggle('active');
    };
  });
  qsa('#budget-pills .pill').forEach(p=>{
    p.onclick = () => {
      state.budget = p.dataset.val;
      qsa('#budget-pills .pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
    };
  });

  $('btn-prev').disabled = false;
  $('btn-next').textContent = "Next";
  
  } else {
    w.innerHTML = `
      <h3 class="step-title">Activities & Interests</h3>
      <p class="step-help">Pick extras to round out your day.</p>

   <article class="card">
  <h3 class="step-title" style="margin-bottom:12px;">Choose activities you want to be a part of your day</h3>
  <div class="checks">
          <label class="check"><input type="checkbox" id="int-coffee"    ${state.interests.coffee?'checked':''}><span>Coffee</span></label>
          <label class="check"><input type="checkbox" id="int-drinks"    ${state.interests.drinks?'checked':''}><span>Drinks &amp; Lounge</span></label>
          <label class="check"><input type="checkbox" id="int-dessert"   ${state.interests.dessert?'checked':''}><span>Dessert</span></label>
          <label class="check"><input type="checkbox" id="int-lateNight" ${state.interests.lateNight?'checked':''}><span>Late-Night Eats</span></label>
          <label class="check"><input type="checkbox" id="int-nightlife" ${state.interests.nightlife?'checked':''}><span>Nightlife &amp; Entertainment</span></label>
          <label class="check"><input type="checkbox" id="int-shopping"  ${state.interests.shopping?'checked':''}><span>Shopping</span></label>
          <label class="check"><input type="checkbox" id="int-sights"    ${state.interests.sights?'checked':''}><span>Sights &amp; Landmarks</span></label>
          <label class="check"><input type="checkbox" id="int-relax"     ${state.interests.relax?'checked':''}><span>Relax &amp; Recover</span></label>
        </div>
      </article>

      <article class="card" style="padding:16px; margin-top:12px;">
  <label>What time should your itinerary begin?</label>
  <input id="start-at" type="time" value="${esc(state.startAt||'09:00')}" />
</article>
    `;

    ["coffee","drinks","dessert","lateNight","nightlife","shopping","sights","relax"].forEach(k=>{
      $('int-'+k)?.addEventListener('change', (e)=>{ state.interests[k] = !!e.target.checked; });
    });
    $('start-at')?.addEventListener('change', e=>{ state.startAt = e.target.value || "09:00"; });

    $('btn-prev').disabled = false;
    $('btn-next').textContent = "Generate Schedule";
  }
}

  /* ==================== Ticketmaster ==================== */
  const TM_KEY = "oMkciJfNTvAuK1N4O1XXe49pdPEeJQuh";
  function tmUrl(path, params){
    const u = new URL(`https://app.ticketmaster.com${path}`);
    Object.entries(params||{}).forEach(([k,v])=>{
      if (v==null || v==="") return; u.searchParams.set(k,String(v));
    });
    u.searchParams.set("apikey", TM_KEY);
    return u.toString();
  }
  async function tmSearch({ keyword, city="", size=10, startDateTime, endDateTime }){
    if (!keyword) return [];
    const url = tmUrl("/discovery/v2/events.json", {
      keyword, city: city || undefined, classificationName: "music",
      size: Math.max(1, Math.min(20, size)), startDateTime, endDateTime
    });
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const list = json?._embedded?.events || [];
    return list.map(ev=>{
      const at = (ev?._embedded?.attractions || [])[0];
      const vn = (ev?._embedded?.venues || [])[0] || {};
      const dtISO = ev?.dates?.start?.dateTime || null;
      const tz = ev?.dates?.timezone || vn?.timezone || null;
      const loc = vn?.location || {};
      return {
        id: ev?.id || "",
        name: ev?.name || "",
        artist: at?.name || (ev?.name || "").replace(/\s+-\s+.*$/, ""),
        venue: vn?.name || "",
        city: [vn?.city?.name, vn?.state?.stateCode].filter(Boolean).join(", "),
        address: [vn?.address?.line1, vn?.city?.name, vn?.state?.stateCode, vn?.postalCode].filter(Boolean).join(", "),
        dateTime: dtISO,
        timezone: tz || "",
        venueLat: loc?.latitude ? Number(loc.latitude) : null,
        venueLng: loc?.longitude ? Number(loc.longitude) : null
      };
    });
  }
  function bindTmSearch(){
    const q = $('tm-q'), city = $('tm-city'), btn = $('tm-search'), list = $('tm-results');
    if (!q || !btn || !list) return;
    async function run(){
      list.style.display = "block";
      list.innerHTML = `<div class="suggest-item muted">Searching Ticketmaster…</div>`;
      try{
        const events = await tmSearch({ keyword: q.value.trim(), city: city.value.trim(), size: 10 });
        if (!events.length){ list.innerHTML = `<div class="suggest-item muted">No events found. Try a different search.</div>`; return; }
        list.innerHTML = events.map(ev=>{
          const dt = ev.dateTime ? new Date(ev.dateTime).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : "TBA";
          return `<div class="suggest-item" data-ev='${esc(JSON.stringify(ev))}'>
            <div style="font-weight:600">${esc(ev.artist || ev.name)}</div>
            <div class="muted" style="font-size:.95rem">${esc(ev.venue)} — ${esc(ev.city)} · ${esc(dt)}</div>
            <button class="btn btn-ghost" style="margin-top:6px">Use this event</button>
          </div>`;
        }).join("");

// inside bindTmSearch()
qsa('.suggest-item', list).forEach(item=>{
  item.querySelector('button')?.addEventListener('click', async (e)=>{
    e.stopPropagation();
    try{
      const ev = JSON.parse(item.dataset.ev || "{}");
      await applyTicketmasterEvent(ev);
      list.style.display = "none";

      // Stay on the Concert step (NO step++ / renderStep here)
      // Make sure hotel is enabled and focus it
      state.staying = true;
      const hotelInput = document.getElementById('hotel');
      if (hotelInput){
        hotelInput.closest('.card')?.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(()=> hotelInput.focus({ preventScroll:true }), 180);
      }
    }catch(err){ console.warn(err); }
  });
});

      }catch{
        list.innerHTML = `<div class="suggest-item muted">Error contacting Ticketmaster.</div>`;
      }
    }
    btn.onclick = run;
    q.addEventListener('keydown', (e)=>{ if (e.key === "Enter") run(); });
    city.addEventListener('keydown', (e)=>{ if (e.key === "Enter") run(); });
  }
  async function applyTicketmasterEvent(ev){
    state.artist = ev.artist || ev.name || state.artist;
    state.venue  = ev.venue  || state.venue;
    if (ev.dateTime){
      const d = new Date(ev.dateTime);
      state.showDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      state.showTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    if (ev.timezone) state.showTz = ev.timezone;

    if (typeof ev.venueLat === 'number' && typeof ev.venueLng === 'number'){
      state.venueLat = ev.venueLat; state.venueLng = ev.venueLng; state.venuePlaceId = "";
      try{ await ensureVenueResolvedByName(`${ev.venue}, ${ev.city}`); }catch{}
    } else {
      await ensureVenueResolvedByName(`${ev.venue}, ${ev.city}`);
    }
  }
  async function ensureVenueResolvedByName(query){
    if (!query) return;
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const place = await new Promise((resolve, reject)=>{
      svc.textSearch({ query }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) resolve(results[0]);
        else reject(new Error("Could not resolve that venue"));
      });
    });
    state.venue = state.venue || place.name;
    state.venuePlaceId = place.place_id;
    state.venueLat = place.geometry.location.lat();
    state.venueLng = place.geometry.location.lng();
  }

  /* ==================== Places helpers ==================== */
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

  /* ---------- Robust place URLs ---------- */
  function googlePlaceLink(placeId){
    if (!placeId) return '';
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }

  function mapUrlFor(p) {
    const obj = (p && typeof p === 'object') ? p : {};

    const placeId =
      obj.placeId || obj.place_id || obj.googlePlaceId || obj.google_place_id ||
      (obj.place && (obj.place.place_id || obj.place.id)) ||
      (obj.google && (obj.google.place_id || obj.google.id)) ||
      "";

    const name =
      obj.name || obj.title ||
      (obj.place && (obj.place.name || obj.place.title)) || "";

    const address =
      obj.address || obj.formatted_address || obj.vicinity ||
      (obj.location && (obj.location.address || obj.location.formatted_address)) || "";

    if (placeId) {
      // Search with query + query_place_id is great for mobile apps
      const q = [name, address].filter(Boolean).join(" ").trim() || "Place";
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${encodeURIComponent(placeId)}`;
    }

    const q = [name, address].filter(Boolean).join(" ").trim();
    if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

    const lat = obj.lat != null ? Number(obj.lat) :
                (obj.location && obj.location.lat != null ? Number(obj.location.lat) : NaN);
    const lng = obj.lng != null ? Number(obj.lng) :
                (obj.location && obj.location.lng != null ? Number(obj.location.lng) : NaN);

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    }
    return '';
  }

  /* Resolve an OpenTable (or fallback) URL for a place, then open it. */
 async function openReserveFor(payload, preopened){
  let target = '';
  try{
    const p = payload || {};

    // 1) If we already have an OpenTable URL
    if (p.opentableUrl && /opentable\.com/i.test(p.opentableUrl)) {
      target = p.opentableUrl;
    }

    // 2) If payload has website that is OpenTable
    if (!target && p.url && /opentable\.com/i.test(p.url)) {
      target = p.url;
    }

    // 3) Try Places Details for website/url
    if (!target) {
      const pid = p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || "";
      if (pid && mapsReady()){
        const svc = new google.maps.places.PlacesService(document.createElement('div'));
        const details = await new Promise((resolve) => {
          svc.getDetails({ placeId: pid, fields: ['website','url'] }, (d, s) => {
            resolve(s === google.maps.places.PlacesServiceStatus.OK ? d : null);
          });
        });
        if (details?.website && /opentable\.com/i.test(details.website)) {
          target = details.website;
        } else if (details?.url) {
          // exact Google Maps place page (Reserve is often available here)
          target = details.url;
        }
      }
    }

    // 4) Fallback: robust Google link (exact place if we have placeId; else search)
    if (!target) {
      const pid = payload?.placeId || payload?.place_id || '';
      target = pid ? googlePlaceLink(pid) : mapUrlFor(payload || {});
    }
  } catch {
    target = mapUrlFor(payload || '');
  }

  if (target) {
    if (preopened) preopened.location.href = target;
    else window.open(target, '_blank', 'noopener');
  } else if (preopened) {
    preopened.close();
  }
}

  /* ===== Venue info helpers ===== */
function hostnameFromUrl(u){
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
}

async function getVenueWebsite(){
  try{
    const pid = state.venuePlaceId || '';
    if (pid && mapsReady()){
      const svc = new google.maps.places.PlacesService(document.createElement('div'));
      const det = await new Promise((resolve)=> {
        svc.getDetails({ placeId: pid, fields: ['website','url','name'] }, (d, s) => {
          resolve(s === google.maps.places.PlacesServiceStatus.OK ? d : null);
        });
      });
      if (det?.website && /^https?:\/\//i.test(det.website)) return det.website;
      // Do NOT fall back to Google Maps URL as "website" – that confused users.
    }
  } catch {}
  return ''; // empty disables the Website button
}

function venueInfoLinks(primaryUrl){
  const siteHost = hostnameFromUrl(primaryUrl);
  const q = (topic) => siteHost
    ? `https://www.google.com/search?q=site:${encodeURIComponent(siteHost)}+${encodeURIComponent(topic)}`
    : `https://www.google.com/search?q=${encodeURIComponent(state.venue+' '+topic)}`;

  return {
    website: primaryUrl || '',
    bagPolicy: q('bag policy'),
    concessions: q('concessions'),
    parking: q('parking')
  };
}

async function venueInfoCtaHtml(){
  const website = await getVenueWebsite().catch(()=> '');
  // fallback: Google search for venue website
  const fallback = `https://www.google.com/search?q=${encodeURIComponent((state.venue||'')+' website')}`;
  const href = website || fallback;

  return `
    <div class="venue-cta"
         style="margin-top:12px;padding-top:10px;
                border-top:1px dashed var(--border-muted,#e6e6e6);
                text-align:center;">
      <span class="muted" style="font-size:.95rem;">
        Looking for information about your venue?
      </span>
      <a href="${esc(href)}"
         target="_blank" rel="noopener noreferrer"
         class="btn"
         style="display:block; margin:12px auto 0 auto;
                max-width:400px; width:90%;
                -webkit-tap-highlight-color: rgba(0,0,0,0);">
         Click here
      </a>
    </div>
  `;
}
  
/* Render a single-wide card rail at the bottom */
async function renderVenueInfoCard(){
  const wrap = ensureRail('row-venue-info', `${state.venue || 'Venue'} · Information`);
  if (!wrap) return;
  const website = await getVenueWebsite();
  const links = venueInfoLinks(website);

  const ven = esc(state.venue || 'Your Venue');
  wrap.innerHTML = `
    <article class="card" style="min-width:280px;max-width:760px;margin:0 auto;">
      <h3 class="step-title" style="margin-bottom:6px;">${ven} — Information</h3>
      <p class="muted" style="margin:2px 0 12px;">Quick links for your night.</p>
      <div class="pc-actions" style="gap:10px;flex-wrap:wrap;">
        ${links.website ? `<a class="btn" href="${esc(links.website)}" target="_blank" rel="noopener">Venue Website</a>` : ''}
        <a class="btn" href="${esc(links.bagPolicy)}" target="_blank" rel="noopener">Bag Policy</a>
        <a class="btn" href="${esc(links.concessions)}" target="_blank" rel="noopener">Concessions</a>
        <a class="btn" href="${esc(links.parking)}" target="_blank" rel="noopener">Parking</a>
      </div>
    </article>
  `;
}

  /* ===== Venue actions (safe links only) ===== */
async function venueActionsHtml(){
  const website = await getVenueWebsite().catch(()=> '');
  const links = venueInfoLinks(website);
  const hasHost = !!hostnameFromUrl(website);
  const btn = (href, label) => href ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
  return `
    <div class="pc-actions" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
      ${btn(website, 'Venue Website')}
      ${hasHost ? btn(links.bagPolicy, 'Bag Policy') : ''}
      ${hasHost ? btn(links.concessions, 'Concessions') : ''}
      ${hasHost ? btn(links.parking, 'Parking') : ''}
    </div>
  `;
}

  /* ===== Day planning helpers ===== */
async function orderActivitiesWithCohere(keys, context){
  try {
    if (window.concertoCohere?.rankDayOrder) {
      const out = await window.concertoCohere.rankDayOrder(keys, context);
      if (Array.isArray(out) && out.length) return out.filter(k=>keys.includes(k));
    }
  } catch {}
  return keys;
}
function dateOnShowWithHM(hhmm){
  const hm = parseHM(hhmm) || {h:10,m:0};
  const d = new Date(parseShowDateTimeISO()); d.setHours(hm.h, hm.m, 0, 0); return d;
}
function categorizeExtras(extras=[]){
  const hay = x => [x.section,x.category,x.name,Array.isArray(x.types)&&x.types.join(' '),Array.isArray(x.tags)&&x.tags.join(' ')].filter(Boolean).join(' ').toLowerCase();
  const rx = {
    dessert:/(dessert|ice.?cream|gelato|bak(?:e|ery)|pastry|donut|cake|choco|cookie|creamery)/i,
    drinks: /(drink|bar|pub|lounge|wine|cocktail|taproom|speakeasy|gastropub|brewery)/i,
    coffee: /(coffee|café|cafe|espresso|roastery|tea\s?house)/i,
    lateNight: /(late.?night|after.?hours|24.?\/?7|diner|fast.?food|pizza|taco|noodle|ramen|burger|shawarma|kebab|wings?)/i,
    nightlife: /(nightlife|night.?club|club|karaoke|live\s?music|entertainment|dj|dance|comedy\s?club)/i,
    shopping: /(shop|shopping|boutique|record\s?store|vintage|market|mall|store|department|thrift|book\s?store|gift\s?shop)/i,
    sights: /(sight|landmark|viewpoint|overlook|park|museum|gallery|statue|monument|bridge|plaza|observatory|tourist)/i,
    relax:  /(relax|spa|recover|wellness|tea\s?house|onsen|soak|bathhouse|massage|sauna|yoga|float)/i
  };
  const bucket = { dessert:[], drinks:[], coffee:[], lateNight:[], nightlife:[], shopping:[], sights:[], relax:[] };
  extras.forEach(x=>{ const h=hay(x); for (const k of Object.keys(rx)) if (rx[k].test(h)) { bucket[k].push(x); break; }});
  return bucket;
}
function pickNearest(fromLat, fromLng, list=[]){
  if (typeof fromLat!=='number'||typeof fromLng!=='number') return list[0]||null;
  let best=null, bestD=Infinity;
  list.forEach(p=>{
    const lat = p.lat ?? p.geometry?.location?.lat?.();
    const lng = p.lng ?? p.geometry?.location?.lng?.();
    if (typeof lat==='number' && typeof lng==='number'){
      const d = milesBetween(fromLat, fromLng, Number(lat), Number(lng)) ?? 999;
      if (d<bestD){ best=p; bestD=d; }
    }
  });
  return best || list[0] || null;
}
function dwellByKey(k){ return k==='coffee'?35 : k==='sights'?75 : k==='shopping'?60 : k==='relax'?45 : 45; }

async function buildDayItineraryParts({ state, extras, dinnerPick }){
  // Pre-concert order: coffee → shopping → sights → relax  (lunch handled separately)
  const bucket   = categorizeExtras(extras || []);
  const preOrder = ['coffee','shopping','sights','relax'];

  // ---- venue filter helpers (exclude venue from daytime chain) ----
  const venueNameLow = String(state.venue || '').toLowerCase();
  const venuePid     = String(state.venuePlaceId || '').toLowerCase();
  function notVenue(p){
    if (!p) return false;
    const name = String(p.name || p.title || '').toLowerCase();
    const pid  = String(p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || '').toLowerCase();
    // exclude if same place_id or very similar name
    if (venuePid && pid && pid === venuePid) return false;
    if (venueNameLow && name && (name === venueNameLow || name.includes(venueNameLow) || venueNameLow.includes(name))) return false;
    return true;
  }

  // Start from hotel if staying; else from venue
  let cur = (state.staying && state.hotelLat!=null && state.hotelLng!=null)
    ? { lat: state.hotelLat, lng: state.hotelLng, name: state.hotel || 'hotel' }
    : { lat: state.venueLat, lng: state.venueLng, name: state.venue || 'venue' };

  let clock = dateOnShowWithHM(state.startAt || "09:00");
  const out = [];
  const pushLeave = (ts, from, to, payload) => {
    out.push({ ts:+ts, time:fmtInTz(ts, state.showTz||'', {round:true}), label:`Leave ${from} for ${to}`, payload });
  };

  for (const key of preOrder){
    // Prefer curated extras; fallback to Places if empty
    let list = (bucket[key] || []).filter(notVenue);
    if (!list.length) {
      try { list = (await placesFallback(key, 3)).filter(notVenue); } catch {}
    }
    if (!list.length) continue;

    const pick = pickNearest(cur.lat, cur.lng, list);
    if (!pick) continue;

    const lat = pick.lat ?? pick.geometry?.location?.lat?.();
    const lng = pick.lng ?? pick.geometry?.location?.lng?.();
    const travel = (typeof lat==='number' && typeof lng==='number')
      ? estimateTravelMin(cur.lat, cur.lng, Number(lat), Number(lng))
      : 12;

    const normPick = normalizePlace(pick);
    pushLeave(clock, cur?.name || 'current stop', pick.name || key, normPick);

    // advance clock by travel + dwell
    clock = new Date(clock.getTime() + (travel + dwellByKey(key)) * 60000);

    // move current point
    cur = { lat:Number(lat)||cur.lat, lng:Number(lng)||cur.lng, name: pick.name||key };
  }

  // Optional: head back to hotel 2h before show
  if (state.staying && state.hotelLat!=null && state.hotelLng!=null && state.showDate && state.showTime) {
    const showStart  = new Date(parseShowDateTimeISO());
    const bufferMs   = 2 * 60 * 60000; // 2 hours
    const hotelLeave = new Date(showStart.getTime() - bufferMs);

    if (clock < hotelLeave) {
      const mins = estimateTravelMin(cur.lat, cur.lng, state.hotelLat, state.hotelLng);
      pushLeave(
        hotelLeave,
        cur.name || 'current stop',
        `head back to ${state.hotel} to get ready`,
        { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng }
      );
      clock = new Date(hotelLeave.getTime() + mins*60000);
      cur   = { lat: state.hotelLat, lng: state.hotelLng, name: state.hotel };
    }
  }

  return out;
}

  
  async function buildAfterShowParts({ state, extras, items }) {
  // Post-concert order: dessert → drinks → nightlife (max 1 each)
  const show = items.find(i => i.type === 'show') || {};
  const post = items.find(i => i.type === 'post') || {};

  let startTs = post?.start ? new Date(post.start)
             : show?.end   ? new Date(show.end)
             : show?.start ? new Date(new Date(show.start).getTime() + 150*60000)
             : null;

  if (!startTs || !(state.venueLat && state.venueLng)) return [];

  const bucket = categorizeExtras(extras || []);
  const wanted = ['dessert','drinks','nightlife'].filter(k => state.interests[k]);

  let cur = { lat: state.venueLat, lng: state.venueLng, name: 'the venue' };
  const out = [];

  for (const key of wanted) {
    let list = bucket[key] || [];
    if (!list.length) {
      try { list = await placesFallback(key, 3); } catch {}
    }
    if (!list.length) continue;

    const pick = pickNearest(cur.lat, cur.lng, list);
    if (!pick) continue;

    const norm = normalizePlace(pick);
    const destName = pick.name || key;

    const lat = pick.lat ?? pick.geometry?.location?.lat?.();
    const lng = pick.lng ?? pick.geometry?.location?.lng?.();
    const mins = (typeof lat === 'number' && typeof lng === 'number')
      ? estimateTravelMin(cur.lat, cur.lng, Number(lat), Number(lng))
      : 12;

    out.push({
      ts: +startTs,
      label: `Leave ${cur.name || 'current stop'} for ${destName}`,
      payload: norm || { name: destName },
      cat: key          // <- keep the category
    });

    startTs = new Date(startTs.getTime() + (mins + dwellByKey(key)) * 60000);
    cur = { lat: Number(lat) || cur.lat, lng: Number(lng) || cur.lng, name: destName };
  }

  return out;
}
  
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

  function roundToNearest5(date){
    const d = new Date(date);
    const mins = d.getMinutes();
    const rounded = Math.round(mins / 5) * 5;
    d.setMinutes(rounded, 0, 0);
    return d;
  }
  function fmtInTz(dLike, tz, { round=false } = {}){
    if (!dLike) return '';
    let d = (dLike instanceof Date) ? new Date(dLike) : new Date(dLike);
    if (round) d = roundToNearest5(d);
    try {
      return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit', ...(tz ? { timeZone: tz } : {}) });
    } catch {
      return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    }
  }

  /* ==================== Generate ==================== */
  async function generate(){
    show('loading');
    try{
      await ensureVenueResolved();
      if (state.staying) await ensureHotelResolved();

      const targetISO = parseShowDateTimeISO();

// LUNCH picks (target the selected lunch time on show date)
const lunchTargetISO = (() => {
  const hm = (state.lunch?.time || "12:30");
  const d  = new Date(parseShowDateTimeISO());
  const [h,m] = (hm || "12:30").split(':').map(n=>parseInt(n,10));
  d.setHours(h||12, m||30, 0, 0);
  return d.toISOString();
})();

let lunchAuto = [];
if (state.lunch?.want) {
  const lunchState = {
    ...state,
    placeStyle: state.lunch.placeStyle,
    budget: state.lunch.budget,
    foodStyles: (state.lunch.styles||[]).length ? state.lunch.styles : state.foodStyles
  };
  lunchAuto = await pickRestaurants({ wantOpenNow:true, state:lunchState, slot:"lunch", targetISO:lunchTargetISO }) || [];
  window.__lastLunch = lunchAuto;
}

// EXTRAS (coffee/drinks/dessert/sights/shopping/relax buckets)
const extras = await pickExtras({ state });

// DINNER picks (before the show, only if enabled)
let dinnerByCuisine = {};
let beforeAuto = [];
let dinnerPick = null;

if (state.wantDinner) {
  const sel = Array.isArray(state.foodStyles) ? state.foodStyles.filter(Boolean) : [];
  if (sel.length > 1) {
    await Promise.all(sel.map(async (c) => {
      const list = await pickRestaurants({
        wantOpenNow: false,
        state: { ...state, foodStyles: [c] },
        slot: "before",
        targetISO
      });
      dinnerByCuisine[c] = list || [];
    }));
  } else {
    beforeAuto = await pickRestaurants({ wantOpenNow:false, state, slot:"before", targetISO }) || [];
  }
  const locks = state.customStops || [];
  const customDinner = locks.find(p => p.when === 'before' && p.type === 'dinner');
  dinnerPick = customDinner || (beforeAuto[0] || null);
}

// normalize so itinerary gets real lat/lng (or null if dinner off)
const dinner = state.wantDinner ? normalizePlace(dinnerPick) : null;

const itin = await buildItinerary({
  show:  { startISO: targetISO, durationMin: 150, doorsBeforeMin: state.doorsBeforeMin, title: state.artist ? `${state.artist} — Live` : "Your Concert" },
  venue: { name: state.venue, lat: state.venueLat, lng: state.venueLng },
  hotel: state.staying && state.hotelLat && state.hotelLng ? { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng } : null,
  prefs: { dine: 'before', arrivalBufferMin: state.arrivalBufferMin },
  picks: { dinner }
});

window.__lastItinerary = itin;

// Header/context UI
const evtTz = state.showTz || '';
const dHeader = new Date(targetISO);
const dateStr = `${String(dHeader.getMonth()+1).padStart(2,'0')}/${String(dHeader.getDate()).padStart(2,'0')}/${dHeader.getFullYear()}`;
const timeStr = fmtInTz(dHeader, evtTz, { round:false });

const ctx = $('results-context');
ctx.style.display = 'flex';
ctx.style.flexDirection = 'column';
ctx.style.alignItems = 'center';
ctx.style.textAlign = 'center';
ctx.style.width = '100%';

const ctxParent = $('results-context')?.parentElement;
if (ctxParent){ ctxParent.style.flex = '1 1 0'; ctxParent.style.textAlign = 'center'; }

ctx.innerHTML = `
  <div>${esc(state.artist || 'Your Concert')}</div>
  <div>${esc(state.venue || '')}</div>
  <div>${esc(dateStr)}${timeStr ? ` • ${esc(timeStr)}` : ''} ${evtTz ? `<span class="muted" style="font-variant:all-small-caps;letter-spacing:.06em;">(${esc(evtTz)})</span>` : ''}</div>
`;

const note = $('intro-line');
note.style.textAlign = 'center';
note.style.fontSize = '0.9rem';
note.textContent = 'Distances are from the venue.';

const city = await venueCityName();
await renderTourCard(city, itin, dinnerPick, extras);

// Rails (lunch first; dinner rails respect the dinner toggle inside renderRails)
const selectedCuisines = Array.isArray(state.foodStyles) ? state.foodStyles.filter(Boolean) : [];
await renderRails({ before: beforeAuto, after: [], extras, dinnerByCuisine, selectedCuisines, lunchList: lunchAuto });

show('results');
savePlan();
} catch (e) {
  console.error(e);
  alert(e.message || "Couldn’t build the schedule. Check your Google key and try again.");
  show('form');
}
} // <- closes async function generate() exactly once
    
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

  function estimateTravelMin(aLat, aLng, bLat, bLng){
    if ([aLat,aLng,bLat,bLng].every(v => typeof v === 'number' && !Number.isNaN(v))) {
      const toRad = x => x * Math.PI/180;
      const R = 3958.8; // miles
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const sa = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
      const miles = R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1-sa));
      return Math.max(8, Math.min(45, 5 + miles * 4));
    }
    return 15;
  }

async function renderTourCard(city, items, dinnerPick, extras){
  const el = $('schedule'); if (!el) return;

  const arrive = items.find(i=>i.type==='arrive');
  const dine   = items.find(i=>i.type==='dine');
  const show   = items.find(i=>i.type==='show');

  // one place to push steps + optional place payload (+ optional suffix)
  const stepsRaw = [];
  const pushAct = (ts, verb, destText, payload, suffix = "") => {
    let mapUrl = '';
    try { mapUrl = payload ? mapUrlFor(payload) : ''; } catch {}
    stepsRaw.push({ ts:+ts, verb, dest: destText, mapUrl, suffix });
  };
  const tz = state.showTz || '';

  // 2) Daytime chain (coffee/sights/shopping/relax)
  const day = await buildDayItineraryParts({ state, extras, dinnerPick }); // [{ts, label:"Leave A for B"}, ...]
  for (const d of (day || [])) {
    // Extract destination from "Leave X for Y"
    let raw = d.label?.replace(/^leave\s.+?\sfor\s(.+)$/i, '$1') || 'next stop';

    // Defaults; we may split into dest + suffix
    let verb = 'visit';
    let dest = raw;
    let suffix = '';

    // Special case: hotel return — "head back to <Hotel> to get ready"
    const m = /^head back to\s+(.+?)(\s+to get ready)?$/i.exec(raw);
    if (m) {
      verb = 'head back to';
      dest = m[1].trim();            // only the place name is linked
      suffix = (m[2] || '').trim();  // e.g., "to get ready"
    } else {
      // Category-based verbs
      if (/coffee/i.test(raw))                                      verb = 'get coffee at';
      else if (/dessert|gelato|ice.?cream/i.test(raw))              verb = 'dessert at';
      else if (/drink|bar|lounge|wine|cocktail/i.test(raw))         verb = 'drinks at';
      else if (/shop/i.test(raw))                                   verb = 'shop at';
      else if (/sight|park|museum|gallery|landmark|view/i.test(raw))verb = 'explore';
      else if (/relax|spa|sauna|wellness|yoga/i.test(raw))          verb = 'relax at';
      else if (/Madison Square Garden|MSG/i.test(raw))              verb = 'arrive at';
      else if (/dinner/i.test(raw))                                 verb = 'dinner at';
      else if (/lunch/i.test(raw))                                  verb = 'eat lunch at';
    }

    pushAct(d.ts, verb, dest, { name: dest }, suffix);
  }

  // 3) Lunch (if enabled)
  const lunchPick = (window.__lastLunch && window.__lastLunch[0]) ? normalizePlace(window.__lastLunch[0]) : null;
  if (state.lunch?.want && lunchPick?.name) {
    const hm = state.lunch.time || "12:30";
    const [h, m] = hm.split(':').map(n=>parseInt(n,10));
    const target = new Date(parseShowDateTimeISO());
    target.setHours(h||12, m||30, 0, 0);
    const leaveForLunch = new Date(target.getTime() - 15*60000);
    pushAct(leaveForLunch, 'eat lunch at', lunchPick.name, lunchPick);
  }

  // 4) Dinner (before-show)
  if (state.wantDinner && dine?.start && dinnerPick?.name) {
    const normDinner = normalizePlace(dinnerPick);
    let leaveForDinner = new Date(dine.start);
    if (state.staying && state.hotelLat!=null && state.hotelLng!=null && normDinner?.lat!=null && normDinner?.lng!=null) {
      const mins = estimateTravelMin(state.hotelLat, state.hotelLng, normDinner.lat, normDinner.lng);
      leaveForDinner = new Date(new Date(dine.start).getTime() - mins*60000);
    } else {
      leaveForDinner = new Date(new Date(dine.start).getTime() - 15*60000);
    }
    pushAct(leaveForDinner, 'dinner at', normDinner?.name || dinnerPick.name, normDinner || dinnerPick);
  }

  // 5) Go to venue (explicit)
  const venuePayload = {
    name: state.venue,
    placeId: state.venuePlaceId,
    lat: state.venueLat,
    lng: state.venueLng
  };
  if (show?.start && state.venue) {
    const arriveBy = new Date(new Date(show.start).getTime() - (state.arrivalBufferMin || 45)*60000);
    const leaveForVenue = new Date(arriveBy.getTime() - 15*60000);
    pushAct(leaveForVenue, 'go to', state.venue, venuePayload);
  } else if (arrive?.start && state.venue) {
    const aStart = new Date(arrive.start);
    const leaveForVenue = new Date(aStart.getTime() - 15*60000);
    pushAct(leaveForVenue, 'go to', state.venue, venuePayload);
  }

  // 6) Concert
  if (show?.start) {
    stepsRaw.push({ ts:+new Date(show.start), verb:'concert starts', dest:'', mapUrl:'', suffix:'' });
  }

  // 7) After-show (dessert/drinks/nightlife) — use explicit category to pick the verb
  const afterSteps = await buildAfterShowParts({ state, extras, items });
  for (const d of (afterSteps || [])) {
    const dest = d.label?.replace(/^leave\s.+?\sfor\s(.+)$/i, '$1') || 'next stop';
    const cat  = String(d.cat || '').toLowerCase();
    const verb = (cat === 'dessert')   ? 'dessert at'
               : (cat === 'drinks')    ? 'drinks at'
               : (cat === 'nightlife') ? 'nightlife at'
               : 'go to';
    const payload = d.payload || { name: dest };
    pushAct(d.ts, verb, dest, payload);
  }

  // ---- DEDUPE (keep earliest coffee, drop duplicate verb+dest) ----
  const steps = (() => {
    stepsRaw.sort((a,b)=> a.ts - b.ts);
    let coffeeAdded = false;
    const seen = new Set();
    const out = [];
    for (const s of stepsRaw){
      const v = (s.verb||'').toLowerCase();
      const d = (s.dest||'').toLowerCase();
      const key = `${v}|${d}`;
      if (seen.has(key)) continue;
      if (/coffee/.test(v)){
        if (coffeeAdded) continue;
        coffeeAdded = true;
      }
      seen.add(key);
      out.push(s);
    }
    return out;
  })();
  
el.innerHTML = `
  <article class="card tour-card" style="margin-bottom:32px;">
    <div class="tour-head">
      <h3 class="tour-title" style="text-align:center">
        Your Night${city ? ` in ${esc(city)}` : ""}
      </h3>
    </div>
<div class="tour-steps"
     style="
       max-height: min(36vh, 360px);   /* shorter on phones */
       overflow-y: auto;
       -webkit-overflow-scrolling: touch;
       scrollbar-gutter: stable;
       padding-right: 4px;
       margin-bottom: 10px;            /* breathing room above the CTA */
       position: relative;             /* prevents overlay on CTA */
     ">
      ${steps.map(s => `
        <div class="tstep">
          <div class="t-time">${fmtInTz(s.ts, tz, { round:true })}</div>
          <div class="t-arrow">→</div>
          <div class="t-label">
            <span class="t-verb">${esc(s.verb || '')}</span>
            ${s.dest ? ` <strong class="t-dest">${
              s.mapUrl
                ? `<a href="${esc(s.mapUrl)}" target="_blank" rel="noopener">${esc(s.dest)}</a>`
                : esc(s.dest)
            }</strong>` : ''}
            ${s.suffix ? ` <span class="t-suffix">${esc(s.suffix)}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    ${await venueInfoCtaHtml()}
  </article>
`;

  // Make venue CTA open externally without ever replacing our app tab
const ctaLinks = el.querySelectorAll('.venue-cta a[data-href]');
ctaLinks.forEach((cta) => {
  cta.addEventListener('click', (e) => {
    e.preventDefault();

    const href = cta.getAttribute('data-href') || cta.getAttribute('href') || '';
    if (!href) return;

    // Pre-open a blank tab during the tap gesture (iOS/FB/IG in-app safe)
    let w = null;
    try { w = window.open('', '_blank', 'noopener'); } catch {}

    if (w) {
      try { w.opener = null; } catch {}
      // Assign URL after the window exists — avoids blocks & preserves our tab
      w.location.href = href;
      // optional: w.focus?.();
    } else {
      // If the browser blocks popups, *do not* navigate away — offer copy as fallback
      alert("Your browser blocked opening a new tab. I’ll copy the link for you.");
      try {
        navigator.clipboard?.writeText(href);
      } catch {}
    }
  }, { passive:false });
});

// Optional: quick “Copy link” helper
el.querySelector('.venue-cta-copy')?.addEventListener('click', async (e) => {
  const href = e.currentTarget.getAttribute('data-copy') || '';
  try {
    await navigator.clipboard.writeText(href);
    e.currentTarget.textContent = 'Copied!';
    setTimeout(() => (e.currentTarget.textContent = 'Copy link'), 1200);
  } catch {
    alert('Copy failed — long-press and choose Copy.');
  }
});
  
  const stepsEl = el.querySelector('.tour-steps');
if (stepsEl) {
  const onScroll = () => {
    if (stepsEl.scrollTop > 2) stepsEl.classList.add('scrolled');
    else stepsEl.classList.remove('scrolled');
  };
  stepsEl.addEventListener('scroll', onScroll, { passive: true });
  // Run once to set initial state (in case it’s pre-scrolled due to content height)
  onScroll();
}
}
  
/* ===== Helper: ensure a rail container exists, show/hide ===== */
function ensureRail(id, title, { prepend = false } = {}){
  let target = document.getElementById(id);
  const wrap = document.querySelector('#screen-results .container.wide');
  if (!wrap) return null;

  // Helper: insert a section in the correct spot
  function placeSection(section){
    const firstRail = wrap.querySelector('.rail');            // first existing rail (after the tour card)
    if (prepend && firstRail) {
      wrap.insertBefore(section, firstRail);                  // put before first rail (but below tour card)
    } else if (!firstRail) {
      // no rails yet → put right after the tour card if present, else append
      const tour = wrap.querySelector('.tour-card');
      if (tour && tour.parentElement === wrap) {
        tour.after(section);
      } else {
        wrap.appendChild(section);
      }
    } else {
      wrap.appendChild(section);
    }
  }

  if (target) {
    const rail = target.closest('.rail');
    if (rail) {
      const head = rail.querySelector('.rail-title');
      if (head && title) head.textContent = title;
      rail.style.display = '';
      if (prepend) {
        const firstRail = wrap.querySelector('.rail');
        if (firstRail && rail !== firstRail) {
          wrap.insertBefore(rail, firstRail);                 // move before first existing rail
        }
      }
    }
    return target;
  }

  // create the section
  const section = document.createElement('section');
  section.className = 'rail';
  section.innerHTML = `
    <header class="rail-head"><h3 class="rail-title">${esc(title || '')}</h3></header>
    <div id="${esc(id)}" class="h-scroll cards-rail"></div>
  `;

  placeSection(section);
  return document.getElementById(id);
}
  function hideRail(id){
    const el = document.getElementById(id);
    if (el) { const s = el.closest('.rail'); if (s) s.style.display = 'none'; }
  }
  function showRail(id){
    const el = document.getElementById(id);
    if (el) { const s = el.closest('.rail'); if (s) s.style.display = ''; }
  }

  /* ==================== Rails (incl. new categories) ==================== */
  function uniqMerge(max, ...lists){
    const out=[]; const seen=new Set();
    for (const list of lists){
      for (const p of (list||[])){
        const k = (p.name||"")+"|"+(p.mapUrl||"")+ '|' + (p.placeId||p.place_id||'');
        if (seen.has(k)) continue;
        seen.add(k); out.push(p);
        if (out.length>=max) return out;
      }
    }
    return out;
  }
  function pickRange(list, min=5, max=10, fallback=[]){
    let out = (list||[]).slice(0, max);
    if (out.length < min){ out = uniqMerge(max, out, fallback); }
    return out.slice(0, Math.max(min, Math.min(max, out.length)));
  }

  function milesBetween(aLat, aLng, bLat, bLng){
    if ([aLat,aLng,bLat,bLng].some(v => typeof v !== 'number' || Number.isNaN(v))) return null;
    const toRad = (x)=> x * Math.PI/180;
    const R = 3958.8; // miles
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const sa = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1-sa));
  }

  // Slug for stable DOM ids per cuisine
function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

/* ---------- CARDS: full-card click to Maps + Reserve button ---------- */
/* ---------- CARDS: full-card link to Google Maps (no reserve pill) ---------- */
function fillRail(id, list, title){
  const isLunch  = id === 'row-lunch';
  const isDinner = id === 'row-dinner' || id.startsWith('row-dinner-');

  // Prepend only lunch so it sits immediately under the tour card
  const row = ensureRail(id, title || '', { prepend: isLunch });
  if (!row) return;

  if (!Array.isArray(list) || !list.length){
    row.innerHTML = `<div class="muted" style="padding:8px 2px;">No options found.</div>`;
    return;
  }

  const cards = list.map(p => {
    const norm = {
      name:    p.name || p.title || '',
      address: p.address || p.formatted_address || p.vicinity || '',
      placeId: p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || '',
      lat:     (typeof p.lat === 'number') ? p.lat : (p.lat ? parseFloat(p.lat) : (p.geometry?.location?.lat?.() ?? null)),
      lng:     (typeof p.lng === 'number') ? p.lng : (p.lng ? parseFloat(p.lng) : (p.geometry?.location?.lng?.() ?? null)),
      rating:  (typeof p.rating === 'number') ? p.rating : null,
      price_level: (typeof p.price_level === 'number') ? p.price_level : null,
      photoUrl: p.photoUrl || (p.photos && p.photos[0] && p.photos[0].getUrl ? p.photos[0].getUrl({ maxWidth: 360, maxHeight: 240 }) : "")
    };

    const mapHref = mapUrlFor({
      placeId: norm.placeId,
      name: norm.name,
      address: norm.address,
      lat: norm.lat,
      lng: norm.lng
    });

    let dist = '';
    const miles = milesBetween(state.venueLat, state.venueLng, Number(norm.lat), Number(norm.lng));
    if (miles != null) dist = miles.toFixed(1);

    const name = esc(norm.name);
    const rating = norm.rating != null ? `★ ${norm.rating.toFixed(1)}` : "";
    const price  = norm.price_level != null ? '$'.repeat(Math.max(1, Math.min(4, norm.price_level))) : "";
    const img    = norm.photoUrl;

    return `
      <a class="place-card"
         href="${esc(mapHref)}"
         target="_blank" rel="noopener"
         title="Open ${name} in Google Maps">
        <div class="pc-img">${img ? `<img src="${esc(img)}" alt="${name}"/>` : `<div class="pc-img ph"></div>`}</div>
        <div class="pc-body">
          <div class="pc-title">${name}</div>
          <div class="pc-meta">
            ${dist ? `<span>${esc(dist)} mi</span>` : ""}
            ${rating ? `<span>${esc(rating)}</span>` : ""}
            ${price ? `<span>${esc(price)}</span>` : ""}
          </div>
        </div>
      </a>
    `;
  }).join("");

  row.innerHTML = cards;
}

/* -------- Normalize a place into lat/lng + url (top-level function) -------- */
function normalizePlace(p){
  if (!p || typeof p !== 'object') return null;

  const name = p.name || p.title || '';
  const address = p.address || p.formatted_address || p.vicinity || '';
  const placeId = p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || '';

  const lat =
    (typeof p.lat === 'number' ? p.lat :
     p.lat ? parseFloat(p.lat) :
     (p.geometry?.location?.lat?.() ?? p.location?.lat ?? null));

  const lng =
    (typeof p.lng === 'number' ? p.lng :
     p.lng ? parseFloat(p.lng) :
     (p.geometry?.location?.lng?.() ?? p.location?.lng ?? null));

  const url = p.url || p.website || '';
  const mapUrl = mapUrlFor({ placeId, name, address, lat, lng });

  if (!(typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng))) {
    return null;
  }
  return { name, lat, lng, url, mapUrl };
}

  /* ---------- Fallback search for empty categories ---------- */
  function fallbackQueryFor(cat){
    switch(cat){
      case 'coffee':    return { type:'cafe', keyword:'coffee' };
      case 'drinks':    return { type:'bar', keyword:'cocktail bar' };
      case 'dessert':   return { type:'bakery', keyword:'dessert' };
      case 'lateNight': return { type:'restaurant', keyword:'late night food' };
      case 'nightlife': return { type:'night_club', keyword:'nightlife' };
      case 'shopping':  return { type:'shopping_mall', keyword:'shopping' };
      case 'sights':    return { type:'tourist_attraction', keyword:'landmark' };
      case 'relax':     return { type:'spa', keyword:'spa' };
      default:          return { type:'restaurant', keyword:'' };
    }
  }
  async function placesFallback(cat, max=10){
    if (!(state.venueLat && state.venueLng)) return [];
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const center = new google.maps.LatLng(state.venueLat, state.venueLng);
    const q = fallbackQueryFor(cat);

    const nearbyParams = {
      location: center,
      rankBy: google.maps.places.RankBy.DISTANCE,
      type: q.type || undefined,
      keyword: q.keyword || undefined
    };

    const res = await new Promise((resolve)=> {
      svc.nearbySearch(nearbyParams, (r, s)=>{
        if (s === google.maps.places.PlacesServiceStatus.OK && Array.isArray(r)) resolve(r.slice(0, max));
        else resolve([]);
      });
    });

    return (res||[]).map(p => ({
      name: p.name,
      address: p.vicinity || p.formatted_address || "",
      placeId: p.place_id,
      lat: p.geometry?.location?.lat?.(),
      lng: p.geometry?.location?.lng?.(),
      rating: p.rating,
      price_level: p.price_level,
      photos: p.photos
    }));
  }

  // --- Build & render all rails in fixed order ---
async function renderRails({
  before,
  after,
  extras,
  dinnerByCuisine = {},
  selectedCuisines = [],
  lunchList = []
}) {
  // ---- LUNCH (always first if enabled) ----
  if (Array.isArray(lunchList) && lunchList.length) {
    fillRail('row-lunch', lunchList.slice(0, 10), 'Lunch near the venue');
  } else {
    hideRail('row-lunch');
  }

  // ---- DINNER (always right after lunch) ----
  document.querySelectorAll('[id^="row-dinner-"]').forEach(el => el.closest('.rail')?.remove());
  if (state.wantDinner) {
    if (Array.isArray(selectedCuisines) && selectedCuisines.length > 1) {
      hideRail('row-dinner');
      selectedCuisines.forEach(c => {
        const id = `row-dinner-${slug(c)}`;
        const picks = pickRange(dinnerByCuisine[c] || [], 5, 10, after);
        if (picks.length) fillRail(id, picks, `Dinner near the venue — ${c}`);
      });
    } else {
      const dinnerRow = pickRange(before, 5, 10, after);
      fillRail('row-dinner', dinnerRow, 'Dinner near the venue');
    }
  } else {
    hideRail('row-dinner');
  }

  // ---- BUCKET EXTRAS ----
  const haystack = (x) => {
    const bits = [];
    if (x.section)   bits.push(String(x.section));
    if (x.category)  bits.push(String(x.category));
    if (x.name)      bits.push(String(x.name));
    if (Array.isArray(x.types)) bits.push(x.types.join(' '));
    if (Array.isArray(x.tags))  bits.push(x.tags.join(' '));
    return bits.join(' ').toLowerCase();
  };

  const bucket = { dessert:[], drinks:[], coffee:[], lateNight:[], nightlife:[], shopping:[], sights:[], relax:[] };
  const rx = {
    dessert:   /(dessert|sweet|ice.?cream|gelato|bak(?:e|ery)|pastry|donut|cake|choco|cookie|creamery)/i,
    drinks:    /(drink|bar|pub|lounge|wine|cocktail|taproom|speakeasy|gastropub|brewery)/i,
    coffee:    /(coffee|café|cafe|espresso|roastery|tea\s?house)/i,
    lateNight: /(late.?night|after.?hours|24.?\/?7|diner|fast.?food|pizza|taco|noodle|ramen|burger|shawarma|kebab|wings?)/i,
    nightlife: /(nightlife|night.?club|club|karaoke|live\s?music|music\s?venue|entertainment|dj|dance|comedy\s?club)/i,
    shopping:  /(shop|shopping|boutique|record\s?store|vintage|market|mall|store|department|thrift|book\s?store|gift\s?shop)/i,
    sights:    /(sight|landmark|viewpoint|overlook|park|museum|gallery|statue|monument|bridge|plaza|observatory|tourist)/i,
    relax:     /(relax|spa|recover|wellness|tea\s?house|onsen|soak|bathhouse|massage|sauna|yoga|float)/i
  };

  (extras || []).forEach(x => {
    const h = haystack(x);
    if (rx.dessert.test(h))        bucket.dessert.push(x);
    else if (rx.drinks.test(h))    bucket.drinks.push(x);
    else if (rx.coffee.test(h))    bucket.coffee.push(x);
    else if (rx.lateNight.test(h)) bucket.lateNight.push(x);
    else if (rx.nightlife.test(h)) bucket.nightlife.push(x);
    else if (rx.shopping.test(h))  bucket.shopping.push(x);
    else if (rx.sights.test(h))    bucket.sights.push(x);
    else if (rx.relax.test(h))     bucket.relax.push(x);
  });

  // ---- CLEAR & RENDER IN FIXED ORDER ----
  const preShowPlan = [
    ['coffee',   'row-coffee',   'Coffee & Cafés'],
    ['shopping', 'row-shopping', 'Shopping'],
    ['sights',   'row-sights',   'Sights & Landmarks'],
    ['relax',    'row-relax',    'Relax & Recover']
  ];
  const postShowPlan = [
    ['dessert',   'row-dessert',   'Dessert'],
    ['drinks',    'row-drinks',    'Drinks & Lounges'],
    ['lateNight', 'row-late',      'Late-Night Eats'],
    ['nightlife', 'row-nightlife', 'Nightlife & Entertainment']
  ];

  const renderPlan = async (plan) => {
    for (const [key, id, title] of plan) {
      if (!state.interests[key]) { hideRail(id); continue; }
      let picks = pickRange(bucket[key], 5, 10);
      if (!picks.length) {
        try {
          const fb = await placesFallback(key, 10);
          picks = pickRange(fb, 5, 10);
        } catch {}
      }
      showRail(id);
      fillRail(id, picks, title);
    }
  };

  await renderPlan(preShowPlan);
  await renderPlan(postShowPlan);
}

  /* ==================== Custom picks (helpers kept) ==================== */
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
      let mapUrl = mapUrlFor({ placeId, lat, lng, name });

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
      mapUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(choice.place_id)}`
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
