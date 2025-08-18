(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;
  console.log("Concerto app.js v7.0.0 (Concierge Timeline) loaded");

  // -----------------------------------------------
  // Small utilities
  // -----------------------------------------------
  const byId = (id) => document.getElementById(id);
  const screens = {
    welcome: byId('screen-welcome'),
    form: byId('screen-form'),
    loading: byId('screen-loading'),
    results: byId('screen-results')
  };
  function show(name){ Object.values(screens).forEach(s => s.classList.remove('active')); screens[name].classList.add('active'); }
  function esc(s) { return (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

  // -----------------------------------------------
  // 1) Itinerary Engine (integrated module)
  // -----------------------------------------------
  function minutes(n){ return n*60*1000; }
  function add(t, ms){ return new Date(t.getTime()+ms); }
  function fmtTime(d){
    try{
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
    }catch{ // Safari fallback
      const h = d.getHours();
      const m = d.getMinutes().toString().padStart(2,'0');
      const ampm = h >= 12 ? "PM":"AM";
      const hh = ((h % 12) || 12);
      return `${hh}:${m} ${ampm}`;
    }
  }
  function haversineMinutes(a, b, mph=22){
    const R = 3959, toRad = d=>d*Math.PI/180;
    const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
    const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    const miles = 2*R*Math.asin(Math.sqrt(s));
    const min = (miles/Math.max(3, mph))*60;
    return Math.max(4, Math.round(min));
  }

  // Optional Distance Matrix (if Maps JS loaded); falls back to haversine
  async function travelMinutes({ from, to, mode='driving' }){
    try{
      if (window.google?.maps?.DistanceMatrixService){
        const svc = new google.maps.DistanceMatrixService();
        const res = await new Promise((resolve,reject)=>{
          svc.getDistanceMatrix({
            origins: [new google.maps.LatLng(from.lat, from.lng)],
            destinations: [new google.maps.LatLng(to.lat, to.lng)],
            travelMode: mode === 'walking' ? 'WALKING' : 'DRIVING'
          }, (out, status)=>{
            if (status === 'OK' && out?.rows?.[0]?.elements?.[0]?.duration){
              resolve(out.rows[0].elements[0].duration.value/60);
            } else resolve(null);
          });
        });
        if (typeof res === 'number' && isFinite(res)) return Math.max(4, Math.round(res));
      }
    }catch{}
    return haversineMinutes(from, to, mode === 'walking' ? 3 : 22);
  }

  async function buildItinerary(cfg){
    const travelFn = cfg.travelFn || travelMinutes;
    const showStart = new Date(cfg.show.startISO);
    const showEnd = add(showStart, minutes(cfg.show.durationMin ?? 150));
    const doorsOpen = add(showStart, -minutes(cfg.show.doorsBeforeMin ?? 90));
    const items = [];

    function push(type, title, start, end, details, url){
      items.push({ type, title, start, end, details, url });
    }

    // Anchor/notes helpers
    function noteAt(time, title, details){ items.push({ type:'note', title, start: time, end: time, details }); }

    // Arrival target = showStart - arrivalBuffer
    const arriveBy = add(showStart, -minutes(Math.max(30, cfg.prefs.arrivalBufferMin ?? 45)));

    // Build backwards for pre-show blocks
    const preBlocks = [];
    if (cfg.prefs.dine === 'before' || cfg.prefs.dine === 'both'){
      if (cfg.picks.dinner) preBlocks.push({ label:'Dinner', mins: 75, pick: cfg.picks.dinner });
      if (cfg.picks.drinks) preBlocks.push({ label:'Drinks', mins: 45, pick: cfg.picks.drinks });
      if (cfg.picks.coffee) preBlocks.push({ label:'Coffee', mins: 25, pick: cfg.picks.coffee });
    }

    let cursor = new Date(arriveBy);
    for (let i = preBlocks.length-1; i >= 0; i--){
      const b = preBlocks[i];
      const toVenue = await travelFn({ from:{lat:b.pick.lat,lng:b.pick.lng}, to:{lat:cfg.venue.lat,lng:cfg.venue.lng}, mode:'driving' });
      const total = b.mins + toVenue + 10;
      const startBlock = add(arriveBy, -minutes(total));

      // Origin: hotel -> block (if provided)
      if (cfg.hotel){
        const toBlock = await travelFn({ from: cfg.hotel, to:{lat:b.pick.lat,lng:b.pick.lng}, mode:'driving' });
        const legStart = add(startBlock, -minutes(toBlock+6));
        push('travel', `To ${b.pick.name}`, legStart, add(legStart, minutes(toBlock+6)), `~${toBlock} min`, b.pick.url || b.pick.mapUrl);
      }

      // Block
      push('activity', `${b.label} at ${b.pick.name}`, startBlock, add(startBlock, minutes(b.mins)), b.pick.note || '', b.pick.url || b.pick.mapUrl);

      // Block -> venue
      const legStart2 = add(startBlock, minutes(b.mins));
      push('travel', `To ${cfg.venue.name}`, legStart2, add(legStart2, minutes(toVenue+6)), `~${toVenue} min`, cfg.venue.url || '');
    }

    // If no pre-blocks, go hotel -> venue
    if (!preBlocks.length && cfg.hotel){
      const toVenue = await travelFn({ from: cfg.hotel, to: cfg.venue, mode:'driving' });
      const legStart = add(arriveBy, -minutes(toVenue+8));
      push('travel', `To ${cfg.venue.name}`, legStart, add(legStart, minutes(toVenue+8)), `~${toVenue} min`, cfg.venue.url || '');
    }

    // Venue pre-show notes/blocks
    noteAt(doorsOpen, 'Doors Open', fmtTime(doorsOpen));
    if (cfg.prefs.merch)  push('activity','Merch Hunt', add(doorsOpen, 0), add(doorsOpen, minutes(20)), 'Main lobby stand recommended');
    if (cfg.prefs.concessions) push('activity','Concessions', add(doorsOpen, minutes(20)), add(doorsOpen, minutes(35)), 'Grab a drink/snack');
    if (cfg.prefs.water) push('activity','Hydration', add(doorsOpen, minutes(35)), add(doorsOpen, minutes(40)), 'Refill water bottle');

    // Showtime
    push('anchor','Showtime', showStart, showEnd, `Enjoy the show at ${cfg.venue.name}`);

    // Post show
    if (cfg.prefs.dine === 'after' || cfg.prefs.dine === 'both'){
      const target = cfg.picks.dinner || cfg.picks.drinks || cfg.picks.coffee;
      if (target){
        const toSpot = await travelFn({ from: cfg.venue, to: target, mode:'driving' });
        const outStart = add(showEnd, minutes(8));
        push('travel', `To ${target.name}`, outStart, add(outStart, minutes(toSpot+6)), `~${toSpot} min`, target.url || target.mapUrl);
        push('activity', `Post-Show at ${target.name}`, add(outStart, minutes(toSpot+6)), add(outStart, minutes(toSpot+6 + (cfg.picks.dinner?70:(cfg.picks.drinks?45:25)))), target.note || '', target.url || target.mapUrl);
      }
    }

    // Return to hotel
    if (cfg.hotel){
      const last = items.slice().reverse().find(i => i.type !== 'note');
      const origin = last?.end || showEnd;
      const toHotel = await travelFn({ from: cfg.venue, to: cfg.hotel, mode:'driving' });
      const leave = add(showEnd, minutes(6));
      push('travel','Return to Hotel', leave, add(leave, minutes(toHotel+6)), `~${toHotel} min`);
    }

    return items.sort((a,b)=>a.start-b.start);
  }

  // -----------------------------------------------
  // 2) Timeline Renderer (integrated)
  // -----------------------------------------------
  function renderTimeline(items, container){
    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';

    items.forEach(it => {
      const li = document.createElement('li');
      li.style.borderLeft = '2px solid var(--navy)';
      li.style.padding = '12px 16px 12px 18px';
      li.style.position = 'relative';
      li.style.marginLeft = '10px';

      const dot = document.createElement('span');
      dot.style.position = 'absolute';
      dot.style.left = '-7px';
      dot.style.top = '20px';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.background = 'var(--snow)';
      dot.style.opacity = (it.type==='anchor') ? '1' : '.9';
      li.appendChild(dot);

      const time = document.createElement('div');
      time.textContent = `${fmtTime(it.start)}${it.type==='note' ? '' : ' – ' + fmtTime(it.end)}`;
      time.style.opacity = '.8';
      time.style.fontVariantNumeric = 'tabular-nums';

      const h = document.createElement('div');
      h.textContent = it.title;
      h.style.fontFamily = "'Cormorant Garamond', serif";
      h.style.textTransform = 'uppercase';
      h.style.letterSpacing = '.04em';
      h.style.margin = '4px 0 2px';

      const p = document.createElement('div');
      p.textContent = it.details || '';

      li.append(time, h, p);
      ul.appendChild(li);
    });

    container.appendChild(ul);
  }

  // -----------------------------------------------
  // 3) Export tools
  // -----------------------------------------------
  function toICS(items, title='Concert Day'){
    const dt = d => d.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
    const start = items[0]?.start || new Date();
    const end = items[items.length-1]?.end || new Date();
    const desc = items.map(i=>`${i.title} ${fmtTime(i.start)}${i.type==='note'?'':('-'+fmtTime(i.end))}`).join('\\n');
    const body = [
      'BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN','METHOD:PUBLISH',
      'BEGIN:VEVENT',`DTSTART:${dt(start)}`,`DTEND:${dt(end)}`,
      `SUMMARY:${title}`,`DESCRIPTION:${desc}`,'END:VEVENT','END:VCALENDAR'
    ].join('\\r\\n');
    return new Blob([body], {type:'text/calendar'});
  }
  async function shareLinkOrCopy(text, url){
    try{
      if (navigator.share) await navigator.share({ text, url });
      else { await navigator.clipboard.writeText(url); alert('Link copied!'); }
    }catch(e){
      try{ await navigator.clipboard.writeText(url); alert('Link copied!'); }
      catch{ prompt("Copy link:", url); }
    }
  }

  // -----------------------------------------------
  // App state and steps (from user's v6.3.1 with enhancements)
  // -----------------------------------------------
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
    interests: { coffee:false, drinks:false, dessert:false, sights:false },
    // extra prefs for engine
    arrivalBufferMin: 45,
    doorsBeforeMin: 90
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
    await shareLinkOrCopy("Your Concerto+ plan", url);
  });

  // Hydrate from shared link
  try {
    const enc = new URLSearchParams(location.search).get("a");
    if (enc) { Object.assign(state, JSON.parse(decodeURIComponent(atob(enc)))); show('form'); step = steps.length-1; renderStep(); }
  } catch {}

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
      ["coffee","drinks","dessert","sights"].forEach(k=>{
        const el = byId('int-'+k);
        el.onchange = ()=>{ state.interests[k] = el.checked; };
      });
      byId('btn-prev').disabled = false;
      byId('btn-next').textContent = "Generate Itinerary";
    }
  }

  // Artist suggest (iTunes)
  function bindArtistSuggest(){
    const input = byId('artist'), list = byId('artist-list');
    if (!input) return;
    input.addEventListener('input', async ()=>{
      state.artist = input.value.trim();
      const q = input.value.trim();
      if (!q){ list.style.display="none"; return; }
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
      if (e.key === "Enter"){ const first = byId('artist-list')?.querySelector('[data-first="1"]'); if (first){ e.preventDefault(); first.click(); } }
    });
  }

  // Places autocomplete
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
      const input = byId('hotel'); if (!input) return;
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
  function gmapsUrl(placeId){ return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`; }

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

  // Parsing helpers for user's existing timeline hints
  function parseHM(hhmm){
    if (!hhmm || !/^\\d{1,2}:\\d{2}$/.test(hhmm)) return null;
    const [h,m] = hhmm.split(':').map(n=>parseInt(n,10));
    return { h, m };
  }
  function miles(a, b){
    const toRad = d => d*Math.PI/180, R=3958.8;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
    const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  // Places search with quality ranking
  async function pickRestaurants({ wantOpenNow }){
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const params = buildSearchParams({ wantOpenNow });

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
      if (uniq.length >= 20) break;
    }

    const enriched = [];
    for (const r of uniq){
      const d = await new Promise((resolve)=>{
        svc.getDetails({ placeId: r.place_id, fields: ["name","formatted_address","website","geometry","place_id","opening_hours","price_level","rating","user_ratings_total"] },
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
        reviews: typeof d.user_ratings_total === "number" ? d.user_ratings_total : null,
        price: typeof d.price_level === "number" ? "$".repeat(d.price_level+1) : null,
        openNow: d.opening_hours?.isOpen() ?? null,
        lat: d.geometry.location.lat(),
        lng: d.geometry.location.lng()
      });
    }

    // Rank: quality first, then proximity
    const priceMap = { "$":1, "$$":2, "$$$":3, "$$$$":4 };
    const targetPrice = priceMap[state.budget] ?? null;
    enriched.forEach(p => {
      let score = 0;
      if (p.rating) score += (p.rating - 4.0) * 1.8;
      if (p.reviews) score += Math.log10(Math.max(1, p.reviews)) * 0.8;
      if (targetPrice && p.price) score += -Math.abs((p.price.length) - targetPrice) * 0.3;
      if (state.foodStyles?.length){
        const hit = state.foodStyles.some(c => (p.name||'').toLowerCase().includes(c.toLowerCase()));
        if (hit) score += 0.25;
      }
      score += Math.max(0, 1.6 - (p.distance||0)) * 0.4; // gentle proximity boost under ~1.6 mi
      p._score = score;
    });
    enriched.sort((a,b)=> (b._score||0) - (a._score||0));
    return enriched.slice(0, 8);
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

  async function cohereCurate(stateSnapshot, beforeList, afterList, extras){
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
      if (!res.ok) throw new Error("No function");
      return await res.json();
    }catch(e){
      throw e;
    }
  }

  function addVenueSuffix(text){
    if (!text) return text;
    return text.replace(/(~\\s*\\d+(\\.\\d+)?\\s*mi)\\b/g, "$1 from the venue");
  }
  function buildTopBlurb(plan){
    const HM = parseHM(state.showTime);
    const venueName = state.venue || "your venue";
    let extraBit = "";
    if (Array.isArray(plan.extras) && plan.extras.length){
      const e = plan.extras[0];
      if (e){
        extraBit = ` Want a little extra? Consider <strong>${esc(e.name)}</strong> (${esc((e.section||"").toLowerCase())}, ~${e.distance?.toFixed ? e.distance.toFixed(1) : e.distance} mi).`;
      }
    }
    const core = `Your night is centered around <strong>${esc(venueName)}</strong>${state.showTime ? ` with a show at <strong>${esc(state.showTime)}</strong>` : ""}.`;
    const tail = ` Distances below are from the venue. Maps and websites are linked for quick booking and directions.`;
    return addVenueSuffix(core + extraBit + tail);
  }

  function card(title, subtitle, lines){
    const head = `<header><h3>${esc(title)}${subtitle?": "+esc(subtitle):""}</h3></header>`;
    const body = `<div class="body">${lines.map(l=>`<div>${l}</div>`).join("")}</div>`;
    return `<article class="card card-itin">${head}${body}</article>`;
  }
  function link(u,t){ return u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : ""; }
  function badge(t){ return t ? `<span class="meta">${esc(t)}</span>` : ""; }
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

  function parseShowDateTimeISO(){
    // We only collect a time. Use today's date in the user's locale.
    const hm = parseHM(state.showTime);
    const now = new Date();
    if (!hm) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0).toISOString(); // default 7pm
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm.h, hm.m).toISOString();
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

      // --- Build concierge-grade timeline ---
      const picks = {
        dinner: (state.eatWhen!=='after' ? plan.diningBefore?.[0] : null) || null,
        drinks: null, // could derive from extras if you want
        coffee: null
      };
      // enrich picks with lat/lng if available
      const mapPick = (p)=> p ? ({
        name: p.name, lat: p.lat, lng: p.lng, url: p.url, mapUrl: p.mapUrl, note: ''
      }) : null;

      const itin = await buildItinerary({
        show: {
          startISO: parseShowDateTimeISO(),
          durationMin: 150,
          doorsBeforeMin: state.doorsBeforeMin
        },
        venue: { name: state.venue, lat: state.venueLat, lng: state.venueLng },
        hotel: state.staying && state.hotelLat && state.hotelLng ? { name: state.hotel, lat: state.hotelLat, lng: state.hotelLng } : null,
        prefs: {
          dine: state.eatWhen,
          arrivalBufferMin: state.arrivalBufferMin,
          merch: true,
          concessions: true,
          water: true
        },
        picks: {
          dinner: mapPick(picks.dinner)
        }
      });

      // --- Render ---
      const showTimeText = state.showTime ? state.showTime : "";
      byId('results-context').textContent = `${state.artist ? state.artist + " at " : ""}${state.venue}${showTimeText ? " · " + showTimeText : ""}`;
      byId('intro-line').innerHTML = plan.intro || buildTopBlurb(plan);

      // Visual timeline
      const tl = byId('timeline'), tlb = byId('timeline-body');
      tl.style.display = "block";
      renderTimeline(itin, tlb);

      // Cards grid
      const grid = byId('itinerary');
      const cards = [];
      // Build quick “Your Evening Plan” from itinerary anchor points
      const lines = itin.map(it => {
        const time = `${fmtTime(it.start)}${it.type==='note'?'':` – ${fmtTime(it.end)}`}`;
        return `<strong>${esc(time)}</strong> · ${esc(it.title)}${it.details?` — ${esc(it.details)}`:''}`;
      });
      cards.push(card("Your Evening Plan", null, lines));

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

      // Attach export actions (replace Share Link to also offer ICS)
      const shareBtn = byId('btn-share');
      shareBtn.onclick = async () => {
        const enc = btoa(encodeURIComponent(JSON.stringify(state)));
        const url = `${location.origin}${location.pathname}?a=${enc}`;
        await shareLinkOrCopy("Your Concerto+ plan", url);
      };

      show('results');
    }catch(e){
      console.error(e);
      alert(e.message || "Couldn’t build the plan. Check your Google key and try again.");
      show('form');
    }
  }

  // Wait for Places
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

  // harmless global fallback in case anything else references sel()
  window.sel = window.sel || function sel(cond){ return cond ? " selected" : ""; };

})();