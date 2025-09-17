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
  const steps = ["concert","travel","stay","dining","activities"];

  const state = window.__concertoState = {
    artist: "", venue: "", venuePlaceId: "", venueLat: null, venueLng: null,
    showDate: "", showTime: "",
    showTz: "",
    hotel: "", hotelPlaceId:"", hotelLat:null, hotelLng:null, staying:true,
    eatWhen: "both",
    foodStyles: [], foodStyleOther: "", placeStyle: "sitdown",
    budget: "$$", tone: "balanced",
    interests: {
      coffee:false, drinks:false, dessert:false, sights:false,
      lateNight:false, nightlife:false, shopping:false, relax:false
    },
    arrivalBufferMin: 45, doorsBeforeMin: 90,
    customStops: []
    planDay: true,
dayStart: "10:00",
    travel: {
  inbound:  { airline:"", flightNo:"", date:"", arrISO:"", arrIATA:"", arrLat:null, arrLng:null },
  outbound: { airline:"", flightNo:"", date:"", depISO:"", depIATA:"", depLat:null, depLng:null, taking:false }
},
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
        <h3 class="step-title">Concert Details</h3>
        <p class="step-help">Choose your event via Ticketmaster or add details manually.</p>

        <!-- Ticketmaster card -->
        <article class="card" style="margin-bottom:12px;">
          <h3 class="step-title" style="margin-bottom:6px;">Find your show (Ticketmaster)</h3>
          <div class="form-grid two">
            <div class="full">
              <label>Artist or Venue</label>
              <input id="tm-q" type="text" placeholder="e.g., Olivia Rodrigo or Madison Square Garden" autocomplete="off"/>
            </div>
            <div>
              <label>City (optional)</label>
              <input id="tm-city" type="text" placeholder="e.g., New York"/>
            </div>
            <div>
              <label>&nbsp;</label>
              <button id="tm-search" class="btn btn-primary" type="button">Search Ticketmaster</button>
            </div>
          </div>
          <div id="tm-results" class="suggest-list" style="display:none; position:relative; margin-top:12px;"></div>
        </article>

        <!-- Manual card -->
        <article class="card">
          <h3 class="step-title" style="margin-bottom:6px;">Or enter it manually</h3>
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
        </article>
      `;

      bindTmSearch();
      bindArtistSuggest();
      bindVenueAutocomplete();
      $('showTime').onchange = (e)=> state.showTime = e.target.value;
      $('showDate').onchange = (e)=> state.showDate = e.target.value;

      $('btn-prev').disabled = true;
      $('btn-next').textContent = "Next";

    } else if (steps[step] === "travel"){
  w.innerHTML = `
    <h3 class="step-title">Travel</h3>
    <p class="step-help">Optionally add your flight(s) so we can plan the whole day around them.</p>

    <article class="card" style="margin-bottom:12px;">
      <h3 class="step-title" style="margin-bottom:6px;">Flying in?</h3>
      <div class="form-grid two">
        <div>
          <label>Airline & Flight #</label>
          <input id="inb-fn" type="text" placeholder="e.g., Delta 123" value="${esc([state.travel?.inbound?.airline, state.travel?.inbound?.flightNo].filter(Boolean).join(' '))}">
        </div>
        <div>
          <label>Flight date</label>
          <input id="inb-date" type="date" value="${esc(state.travel?.inbound?.date || state.showDate || '')}">
        </div>
        <div>
          <label>&nbsp;</label>
          <button id="inb-search" class="btn btn-primary" type="button">Search flights</button>
        </div>
        <div class="full">
          <div id="inb-results" class="suggest-list" style="display:none;"></div>
        </div>
      </div>
      <div class="tiny">Or add manually if needed.</div>
    </article>

    <article class="card">
      <h3 class="step-title" style="margin-bottom:6px;">Flying out after the show?</h3>
      <div class="form-grid two">
        <div>
          <label><input id="outb-taking" type="checkbox" ${state.travel?.outbound?.taking?'checked':''}/> I’m taking a flight home after the show</label>
        </div>
        <div>
          <label>Airline & Flight #</label>
          <input id="out-fn" type="text" placeholder="e.g., JetBlue 890" value="${esc([state.travel?.outbound?.airline, state.travel?.outbound?.flightNo].filter(Boolean).join(' '))}">
        </div>
        <div>
          <label>Flight date</label>
          <input id="out-date" type="date" value="${esc(state.travel?.outbound?.date || state.showDate || '')}">
        </div>
        <div>
          <label>&nbsp;</label>
          <button id="out-search" class="btn" type="button">Search flights</button>
        </div>
        <div class="full">
          <div id="out-results" class="suggest-list" style="display:none;"></div>
        </div>
      </div>
    </article>
  `;

  // bindings for the travel step
  $('outb-taking')?.addEventListener('change', e => {
    state.travel = state.travel || {};
    state.travel.outbound = state.travel.outbound || {};
    state.travel.outbound.taking = !!e.target.checked;
  });

  bindFlightSearch('inbound');
  bindFlightSearch('outbound');

  $('btn-prev').disabled = false;
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
      // ACTIVITIES
w.innerHTML = `
  <h3 class="step-title">Activities & Interests</h3>
  <p class="step-help">Pick any extras to round out your night. You can also plan your whole day.</p>

  <div class="form-grid two">
    <div><label><input type="checkbox" id="int-coffee" ${state.interests.coffee?'checked':''}/> Coffee</label></div>
    <div><label><input type="checkbox" id="int-drinks" ${state.interests.drinks?'checked':''}/> Drinks &amp; Lounge</label></div>
    <div><label><input type="checkbox" id="int-dessert" ${state.interests.dessert?'checked':''}/> Dessert</label></div>
    <div><label><input type="checkbox" id="int-lateNight" ${state.interests.lateNight?'checked':''}/> Late-Night Eats</label></div>
    <div><label><input type="checkbox" id="int-nightlife" ${state.interests.nightlife?'checked':''}/> Nightlife &amp; Entertainment</label></div>
    <div><label><input type="checkbox" id="int-shopping" ${state.interests.shopping?'checked':''}/> Shopping</label></div>
    <div><label><input type="checkbox" id="int-sights" ${state.interests.sights?'checked':''}/> Sights &amp; Landmarks</label></div>
    <div><label><input type="checkbox" id="int-relax" ${state.interests.relax?'checked':''}/> Relax &amp; Recover</label></div>
  </div>

  <div class="form-grid two" style="margin-top:12px;">
    <div>
      <label><input type="checkbox" id="plan-day" ${state.planDay?'checked':''}/> Plan my whole day</label>
      <div class="tiny">We’ll map daytime stops before dinner.</div>
    </div>
    <div>
      <label>Day starts at</label>
      <input id="day-start" type="time" value="${esc(state.dayStart||'10:00')}" ${state.planDay?'':'disabled'} />
    </div>
  </div>
`;
["coffee","drinks","dessert","lateNight","nightlife","shopping","sights","relax"].forEach(k=>{
  const el = $('int-'+k); if (el) el.onchange = ()=>{ state.interests[k] = el.checked; };
});
const pd = $('plan-day'); const ds = $('day-start');
pd?.addEventListener('change', ()=>{ state.planDay = !!pd.checked; if (ds) ds.disabled = !state.planDay; });
ds?.addEventListener('change', e=>{ state.dayStart = e.target.value || "10:00"; });

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

        qsa('.suggest-item', list).forEach(item=>{
          item.querySelector('button')?.addEventListener('click', async (e)=>{
            e.stopPropagation();
            try{
              const ev = JSON.parse(item.dataset.ev || "{}");
              await applyTicketmasterEvent(ev);
              list.style.display = "none";
              step = 1; renderStep();
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

/* ===== Flights search (provider-agnostic scaffolding) =====
   Implement fetchFlights() to call your provider (AeroAPI/FlightStats/aviationstack/Amadeus)
   and return normalized results: [{ airline, flightNo, arrISO, depISO, arrIATA, depIATA, arrLat, arrLng, depLat, depLng, summary }]
*/
async function fetchFlights(query){
  // TODO: wire to your backend proxy that calls a flight API.
  console.warn('fetchFlights() not wired to a live API yet', query);
  return [];
}

function renderFlightResults(kind, list){
  const box = $(kind === 'inbound' ? 'inb-results' : 'out-results');
  if (!box) return;
  if (!list.length){
    box.style.display = 'block';
    box.innerHTML = `<div class="suggest-item muted">No flights found. Try manual or different search.</div>`;
    return;
  }
  box.style.display = 'block';
  box.innerHTML = list.map((f,i)=>`
    <div class="suggest-item" data-idx="${i}">
      <div style="font-weight:600">${esc(f.summary || `${(f.airline||'').trim()} ${(f.flightNo||'').trim()}`)}</div>
      <div class="muted" style="font-size:.95rem">
        Arr: ${esc(f.arrIATA||'')} · ${esc(f.arrISO ? new Date(f.arrISO).toLocaleString([], {hour:'numeric', minute:'2-digit', month:'short', day:'numeric'}) : 'TBA')}
        &nbsp; | &nbsp; Dep: ${esc(f.depIATA||'')} · ${esc(f.depISO ? new Date(f.depISO).toLocaleString([], {hour:'numeric', minute:'2-digit', month:'short', day:'numeric'}) : 'TBA')}
      </div>
      <button class="btn btn-ghost" style="margin-top:6px">Use this flight</button>
    </div>
  `).join('');
  qsa('.suggest-item', box).forEach((row)=>{
    row.querySelector('button')?.addEventListener('click', ()=>{
      const idx = parseInt(row.dataset.idx,10);
      const f = list[idx];
      if (!f) return;
      if (kind === 'inbound'){
        state.travel = state.travel || {};
        state.travel.inbound = {
          airline: f.airline||'', flightNo: f.flightNo||'', date: state.travel.inbound?.date || state.showDate || '',
          arrISO: f.arrISO||'', arrIATA: f.arrIATA||'', arrLat: f.arrLat??null, arrLng: f.arrLng??null
        };
      } else {
        state.travel = state.travel || {};
        state.travel.outbound = {
          ...(state.travel.outbound || {}),
          airline: f.airline||'', flightNo: f.flightNo||'', date: state.travel.outbound?.date || state.showDate || '',
          depISO: f.depISO||'', depIATA: f.depIATA||'', depLat: f.depLat??null, depLng: f.depLng??null
        };
      }
      box.style.display = 'none';
    });
  });
}

function bindFlightSearch(kind){
  const fn = $(kind==='inbound'?'inb-fn':'out-fn');
  const dt = $(kind==='inbound'?'inb-date':'out-date');
  const btn = $(kind==='inbound'?'inb-search':'out-search');
  const box = $(kind==='inbound'?'inb-results':'out-results');
  if (!fn || !dt || !btn || !box) return;

  btn.onclick = async ()=>{
    box.style.display = 'block';
    box.innerHTML = `<div class="suggest-item muted">Searching flights…</div>`;
    const raw = fn.value.trim();
    const date = dt.value || state.showDate || '';
    const m = raw.match(/^\s*([A-Za-z]+)\s*0*([0-9]+)\s*$/);
    const airline = m ? m[1] : '';
    const flightNo = m ? m[2] : raw;
    try{
      const res = await fetchFlights({ kind, airline, flightNo, date });
      renderFlightResults(kind, res||[]);
    }catch{
      renderFlightResults(kind, []);
    }
  };
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
      if (det?.website) return det.website;
      if (det?.url)     return det.url;  // exact Google Maps place page
    }
  } catch {}
  return mapUrlFor({ name: state.venue, lat: state.venueLat, lng: state.venueLng });
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
  if (!state.planDay) return [];
  const bucket = categorizeExtras(extras||[]);
  const selected = ['coffee','sights','shopping','relax'].filter(k=>state.interests[k]);
  const order = await orderActivitiesWithCohere(selected, { tone:state.tone, budget:state.budget, venue:state.venue });

  // Start from hotel if staying; else from venue
  let cur = (state.staying && state.hotelLat!=null && state.hotelLng!=null)
    ? { lat:state.hotelLat, lng:state.hotelLng, name:state.hotel||'hotel' }
    : { lat:state.venueLat, lng:state.venueLng, name:state.venue||'venue' };

  let clock = dateOnShowWithHM(state.dayStart || "10:00");
  const out = [];

  for (const key of order){
    const list = bucket[key]||[]; if (!list.length) continue;
    const pick = pickNearest(cur.lat, cur.lng, list); if (!pick) continue;

    const lat = pick.lat ?? pick.geometry?.location?.lat?.();
    const lng = pick.lng ?? pick.geometry?.location?.lng?.();
    const travel = (typeof lat==='number' && typeof lng==='number')
      ? estimateTravelMin(cur.lat, cur.lng, Number(lat), Number(lng)) : 12;

    // travel
    if (cur?.name){
      const leaveTs = new Date(clock.getTime());
      out.push({ ts:+leaveTs, time:fmtInTz(leaveTs, state.showTz||'', {round:true}), label:`Uber/Taxi to ${pick.name || key}` });
      clock = new Date(clock.getTime() + travel*60000);
    }
    // arrive
    out.push({ ts:+clock, time:fmtInTz(clock, state.showTz||'', {round:false}), label:`Arrive at ${pick.name || key}` });
    // dwell
    clock = new Date(clock.getTime() + dwellByKey(key)*60000);
    // move current point
    cur = { lat:Number(lat)||cur.lat, lng:Number(lng)||cur.lng, name: pick.name||key };
  }

  // Optional hop back to hotel before dinner
  if (out.length && state.staying && state.hotelLat!=null && state.hotelLng!=null){
    const mins = estimateTravelMin(cur.lat, cur.lng, state.hotelLat, state.hotelLng);
    out.push({ ts:+clock, time:fmtInTz(clock, state.showTz||'', {round:true}), label:`Uber/Taxi back to hotel (optional)` });
    clock = new Date(clock.getTime() + mins*60000);
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

      // Selected cuisines
const selectedCuisines = Array.isArray(state.foodStyles) ? state.foodStyles.filter(Boolean) : [];

// AFTER and EXTRAS (unchanged)
const afterP  = (state.eatWhen==="after"  || state.eatWhen==="both")
  ? pickRestaurants({ wantOpenNow:true, state, slot:"after", targetISO })
  : Promise.resolve([]);
const extrasP = pickExtras({ state });

// BEFORE (split by cuisine when multiple are chosen)
let dinnerByCuisine = {};   // { "Italian": [...], "Japanese/Sushi": [...] }
let beforeAuto = [];        // legacy single list when 0 or 1 cuisine selected

if (state.eatWhen === "before" || state.eatWhen === "both") {
  if (selectedCuisines.length > 1) {
    await Promise.all(selectedCuisines.map(async (c) => {
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
}

const [afterAuto, extras] = await Promise.all([afterP, extrasP]);

      const locks = state.customStops || [];
const customDinner = locks.find(p => p.when === 'before' && p.type === 'dinner');
const dinnerPick = customDinner || (beforeAuto[0] || null);

// normalize so itinerary gets real lat/lng (normalizePlace is defined below)
const dinner = normalizePlace(dinnerPick);

const itin = await buildItinerary({
  show: { startISO: targetISO, durationMin: 150, doorsBeforeMin: state.doorsBeforeMin, title: state.artist ? `${state.artist} — Live` : "Your Concert" },
  venue: { name: state.venue, lat: state.venueLat, lng: state.venueLng },
  hotel: state.staying && state.hotelLat && state.hotelLng ? { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng } : null,
  prefs: { dine: state.eatWhen, arrivalBufferMin: state.arrivalBufferMin },
  picks: { dinner } // may be null if no valid pick; buildItinerary should handle that
});

      window.__lastItinerary = itin;

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

      await renderRails({ before: beforeAuto, after: afterAuto, extras, dinnerByCuisine, selectedCuisines });
      show('results');
      savePlan();
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
  const post   = items.find(i=>i.type==='post');

  const tz = state.showTz || '';
  const parts = [];

  // Daytime (Coffee / Sights / Shopping / Relax)
  const dayParts = await buildDayItineraryParts({ state, extras, dinnerPick });
  parts.push(...dayParts);

  // Dinner sequence (hotel → dinner → venue)
  if (dine?.start) {
    let leaveForDinner = new Date(dine.start);
    if (state.staying && state.hotelLat!=null && state.hotelLng!=null && dinnerPick?.lat!=null && dinnerPick?.lng!=null){
      const mins = estimateTravelMin(state.hotelLat, state.hotelLng, dinnerPick.lat, dinnerPick.lng);
      leaveForDinner = new Date(new Date(dine.start).getTime() - mins*60000);
    } else {
      leaveForDinner = new Date(new Date(dine.start).getTime() - 15*60000);
    }
    if (state.staying){
      parts.push({ ts:+leaveForDinner, time:fmtInTz(leaveForDinner, tz, { round:true }), label:`Take an Uber/Lyft from the hotel to dinner` });
    }
    parts.push({ ts:+new Date(dine.start), time:fmtInTz(dine.start, tz, { round:false }), label:`Arrive at ${esc(dinnerPick?.name || 'dinner')}` });
    if (dine.end){
      parts.push({ ts:+new Date(dine.end), time:fmtInTz(dine.end, tz, { round:true }), label:`Head to ${esc(state.venue)}` });
    }
  }

  if (arrive){
    parts.push({ ts:+new Date(arrive.start), time:fmtInTz(arrive.start, tz, { round:true }), label:`Arrive at ${esc(state.venue)}`, note:`No less than ${Math.max(45, state.arrivalBufferMin||45)} min before concert start` });
  }
  if (show){
    parts.push({ ts:+new Date(show.start), time:fmtInTz(show.start, tz, { round:false }), label:`Concert starts` });
  }
  if (post){
    parts.push({ ts:+new Date(post.start), time:fmtInTz(post.start, tz, { round:true }), label:`Leave the venue for dessert/drinks` });
  }

  parts.sort((a,b)=> a.ts - b.ts);

  // Venue quick links
  const website = await getVenueWebsite().catch(()=> '');
  const links = venueInfoLinks(website);
  const actionsHtml = `
    <div class="pc-actions" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
      ${links.website ? `<a class="btn" href="${esc(links.website)}" target="_blank" rel="noopener">Venue Website</a>` : ''}
      <a class="btn" href="${esc(links.bagPolicy)}" target="_blank" rel="noopener">Bag Policy</a>
      <a class="btn" href="${esc(links.concessions)}" target="_blank" rel="noopener">Concessions</a>
      <a class="btn" href="${esc(links.parking)}" target="_blank" rel="noopener">Parking</a>
    </div>
  `;

  el.innerHTML = `
    <article class="card tour-card">
      <div class="tour-head">
        <h3 class="tour-title">Your Night${city ? ` in ${esc(city)}` : ""}</h3>
      </div>
      <div class="tour-steps">
        ${parts.map(p => `
          <div class="tstep">
            <div class="t-time">${esc(p.time || '')}</div>
            <div class="t-label">${p.label}</div>
            ${p.note ? `<div class="t-note">· ${esc(p.note)}</div>` : ""}
          </div>
        `).join("")}
      </div>
      ${actionsHtml}
    </article>
  `;
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
  const isDinner = id === 'row-dinner' || id.startsWith('row-dinner-');
  const row = ensureRail(id, title || '', { prepend: isDinner }); // dinner rails appear as the first rails (but below the tour card)
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

  // NEW: builds rails per selected interest (broad matching + fallback)
  async function renderRails({ before, after, extras, dinnerByCuisine = {}, selectedCuisines = [] }) {
    const haystack = (x) => {
      const bits = [];
      if (x.section)   bits.push(String(x.section));
      if (x.category)  bits.push(String(x.category));
      if (x.name)      bits.push(String(x.name));
      if (Array.isArray(x.types)) bits.push(x.types.join(' '));
      if (Array.isArray(x.tags))  bits.push(x.tags.join(' '));
      return bits.join(' ').toLowerCase();
    };

    const bucket = {
      dessert:   [],
      drinks:    [],
      coffee:    [],
      lateNight: [],
      nightlife: [],
      shopping:  [],
      sights:    [],
      relax:     []
    };

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

    // Clear any previously-added multi dinner rails
document.querySelectorAll('[id^="row-dinner-"]').forEach(el => el.closest('.rail')?.remove());

if (Array.isArray(selectedCuisines) && selectedCuisines.length > 1) {
  // Multiple cuisines: hide the legacy single rail and render one per cuisine
  hideRail('row-dinner');
  [...selectedCuisines].reverse().forEach((c) => {
  const id = `row-dinner-${slug(c)}`;
  const picks = pickRange(dinnerByCuisine[c] || [], 5, 10, after);
  if (picks.length) fillRail(id, picks, `Dinner near the venue — ${c}`);
});
} else {
  // Original single dinner rail
  const dinnerRow = pickRange(before, 5, 10, after);
  fillRail('row-dinner', dinnerRow, 'Dinner near the venue');
}

    const allRails = ['row-dessert','row-drinks','row-sights','row-coffee','row-nightlife','row-shopping','row-late','row-relax'];
    allRails.forEach(hideRail);

    const plan = [
      ['coffee',    'row-coffee',    'Coffee & Cafés'],
      ['drinks',    'row-drinks',    'Drinks & Lounges'],
      ['dessert',   'row-dessert',   'Dessert'],
      ['lateNight', 'row-late',      'Late-Night Eats'],
      ['nightlife', 'row-nightlife', 'Nightlife & Entertainment'],
      ['shopping',  'row-shopping',  'Shopping'],
      ['sights',    'row-sights',    'Sights & Landmarks'],
      ['relax',     'row-relax',     'Relax & Recover']
    ];

    for (const [key, id, title] of plan){
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
    // Always show the venue info card at the bottom
await renderVenueInfoCard();
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
