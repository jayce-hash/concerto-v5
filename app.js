(() => {
  if (window.__concertoInit) { console.warn("Concerto already initialized"); return; }
  window.__concertoInit = true;

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
    showTime: "", // e.g., "19:30"
    hotel: "", hotelPlaceId:"", hotelLat:null, hotelLng:null, staying:true,
    eatWhen: "both", foodStyle: "", budget: "$$", tone: "balanced",
    interests: { coffee:false, drinks:false, dessert:false, sights:false }
  };

  // Navigation
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

  // Restore from ?a=
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
      w.innerHTML = `
        <h3 class="step-title">Dining Preferences</h3>
        <p class="step-help">We’ll pick restaurants near your venue.</p>
        <div class="form-grid two">
          <div>
            <label>Eat before or after?</label>
            <select id="eatWhen">
              <option value="before"${sel(state.eatWhen==="before")}>Before</option>
              <option value="after"${sel(state.eatWhen==="after")}>After</option>
              <option value="both"${sel(state.eatWhen==="both")}>Both</option>
            </select>
          </div>
          <div>
            <label>Cuisine (optional)</label>
            <input id="foodStyle" type="text" placeholder="sushi, tacos, steak, vegan" value="${esc(state.foodStyle)}" />
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
              <option value="balanced"${sel(state.tone==="balanced")}>Balanced</option>
              <option value="luxury"${sel(state.tone==="luxury")}>Luxury</option>
              <option value="indie"${sel(state.tone==="indie")}>Indie</option>
              <option value="family"${sel(state.tone==="family")}>Family</option>
              <option value="foodie"${sel(state.tone==="foodie")}>Foodie</option>
            </select>
          </div>
        </div>
      `;
      byId('eatWhen').onchange = (e)=> state.eatWhen = e.target.value;
      byId('foodStyle').oninput = (e)=> state.foodStyle = e.target.value.trim();
      byId('tone').onchange = (e)=> state.tone = e.target.value;
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

  // Artist typeahead via iTunes
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

  // Venue autocomplete
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

  // Hotel autocomplete
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
    const place = await new Promise((resolve, reject)=>{
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

  async function generate(){
    if (!state.venue) { alert("Please enter a venue."); return; }
    show('loading');
    try{
      await ensureVenueResolved();
      if (state.staying) await ensureHotelResolved();

      const beforeList = (state.eatWhen==="before" || state.eatWhen==="both") ? await pickRestaurants(state.foodStyle, false) : [];
      const afterList  = (state.eatWhen==="after"  || state.eatWhen==="both") ? await pickRestaurants(state.foodStyle || "late night", true) : [];
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

  async function pickRestaurants(keyword, wantOpenNow){
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const venue = { lat: state.venueLat, lng: state.venueLng };
    const radius = 2400; // ~1.5 miles
    const priceMap = { "$":0, "$$":1, "$$$":2, "$$$$":3 };
    const maxPrice = priceMap[state.budget] ?? 4;

    const params = { location: venue, radius, type:"restaurant", maxPriceLevel: maxPrice };
    if (keyword) params.keyword = keyword;
    if (wantOpenNow) params.openNow = true;

    const results = await new Promise((resolve)=>{
      svc.nearbySearch(params, (res, status)=>{
        if (status !== google.maps.places.PlacesServiceStatus.OK || !res) return resolve([]);
        resolve(res);
      });
    });

    const uniq = []; const seen = new Set();
    for (const r of results){
      if (!r.place_id || seen.has(r.place_id)) continue;
      seen.add(r.place_id); uniq.push(r);
      if (uniq.length >= 12) break;
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
        mapUrl: `https://www.google.com/maps/place/?q=place_id:${d.place_id}`,
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
        mapUrl: `https://www.google.com/maps/place/?q=place_id:${d.place_id}`,
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
    // Optional: only works if you later add a Netlify Function at /.netlify/functions/concerto_cohere
    const trim = p => ({
      name: p.name, address: p.address, distance: p.distance,
      url: p.url || "", mapUrl: p.mapUrl || "",
      price: p.price || null, rating: p.rating || null, openNow: p.openNow ?? null
    });
    const payload = {
      state: {
        artist: state.artist, venue: state.venue, time: state.showTime,
        venueLat: state.venueLat, venueLng: state.venueLng,
        eatWhen: state.eatWhen, foodStyle: state.foodStyle, budget: state.budget,
        tone: state.tone
      },
      candidates: {
        before: (beforeList || []).slice(0,10).map(trim),
        after:  (afterList  || []).slice(0,10).map(trim),
        extras: (extras     || []).slice(0,10).map(p => ({section:p.section, ...trim(p)}))
      }
    };
    try{
      const res = await fetch("/.netlify/functions/concerto_cohere", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("No function");
      return await res.json();
    }catch(e){
      throw e;
    }
  }

  function renderResults(plan){
    byId('results-context').textContent = `${state.artist ? state.artist + " at " : ""}${state.venue}${state.showTime ? " · " + state.showTime : ""}`;
    byId('intro-line').textContent = plan.intro || "";

    // Simple timeline (if time provided)
    const tl = byId('timeline'), tlb = byId('timeline-body');
    tl.style.display = state.showTime ? "block" : "none";
    if (state.showTime){
      const t = state.showTime;
      const pre = (state.eatWhen!=="after") ? `Pre-show dinner around ${(t||"").slice(0,5)}` : null;
      const post = (state.eatWhen!=="before") ? `Post-show picks after the concert` : null;
      tlb.innerHTML = [pre, `Show at ${t}`, post].filter(Boolean).map(x=>`<div>${esc(x)}</div>`).join("");
    }

    const grid = byId('itinerary');
    const cards = [];

    if (plan.show){
      cards.push(card("Show", plan.show.title, [line(plan.show.venue + (plan.show.time? " · " + plan.show.time : ""))]));
    }
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

  function line(t){ return t ? `${esc(t)}` : ""; }
  function link(u,t){ return u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : ""; }
  function badge(t){ return t ? `<span class="meta">${esc(t)}</span>` : ""; }
  function esc(s){ return (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

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