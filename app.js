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
  const steps = ["show", "prefs"];
  const state = window.__concertoState = {
    artist: "", venue: "", venuePlaceId: "", venueLat: null, venueLng: null,
    eatWhen: "before", foodStyle: "", budget: "$$", hotel: "", tone: "balanced"
  };

  // Navigation
  byId('btn-start').addEventListener('click', () => { show('form'); renderStep(); });
  byId('btn-prev').addEventListener('click', () => { if (step>0){ step--; renderStep(); } });
  byId('btn-next').addEventListener('click', async () => {
    if (steps[step] === "show") { await ensureVenueResolved(); }
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
    if (enc) { Object.assign(state, JSON.parse(decodeURIComponent(atob(enc)))); show('form'); step = 1; renderStep(); }
  } catch {}

  function show(name){ Object.values(screens).forEach(s => s.classList.remove('active')); screens[name].classList.add('active'); }
  function setProgress(){ byId('progress-bar').style.width = `${(step/steps.length)*100}%`; }

  function renderStep(){
    setProgress();
    const wrap = byId('step-wrapper');
    if (steps[step] === "show") {
      wrap.innerHTML = `
        <h3 class="step-title">Your Show</h3>
        <p class="step-help">Pick the artist and venue. Venue suggestions appear as you type.</p>
        <div class="form-grid">
          <div>
            <label>Artist</label>
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
        </div>
      `;
      bindArtistSuggest();
      bindVenueAutocomplete();
      byId('btn-prev').disabled = true;
      byId('btn-next').textContent = "Next";
    } else {
      wrap.innerHTML = `
        <h3 class="step-title">Your Preferences</h3>
        <p class="step-help">We’ll tailor picks around the venue.</p>
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
            <label>Food style (optional)</label>
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
      byId('btn-prev').disabled = false;
      byId('btn-next').textContent = "Generate Itinerary";

      byId('eatWhen').onchange = (e)=> state.eatWhen = e.target.value;
      byId('foodStyle').oninput = (e)=> state.foodStyle = e.target.value.trim();
      byId('tone').onchange = (e)=> state.tone = e.target.value;
      byId('budget-pills').querySelectorAll('.pill').forEach(p=>{
        p.onclick=()=>{ state.budget = p.dataset.val; byId('budget-pills').querySelectorAll('.pill').forEach(x=>x.classList.remove('active')); p.classList.add('active'); };
      });
    }
  }

  // Artist typeahead via iTunes
  function bindArtistSuggest(){
    const input = byId('artist'), list = byId('artist-list');
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

  // Venue autocomplete (Google) + Enter-to-accept + auto-resolve fallback
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

  async function generate(){
    if (!state.artist) { alert("Please enter an artist."); return; }
    if (!state.venue) { alert("Please enter a venue."); return; }
    show('loading');
    try{
      await ensureVenueResolved();
      const beforeList = (state.eatWhen==="before" || state.eatWhen==="both") ? await pickRestaurants(state.foodStyle, false) : [];
      const afterList  = (state.eatWhen==="after"  || state.eatWhen==="both") ? await pickRestaurants(state.foodStyle || "late night", true) : [];

      const basePlan = {
        show: { title: `${state.artist} — Live`, venue: state.venue },
        diningBefore: beforeList,
        diningAfter: afterList
      };

      let plan = basePlan;
      try {
        const curated = await cohereCurate(state, beforeList, afterList);
        plan = {
          show: curated.show || basePlan.show,
          diningBefore: Array.isArray(curated.diningBefore) && curated.diningBefore.length ? curated.diningBefore : basePlan.diningBefore,
          diningAfter:  Array.isArray(curated.diningAfter)  && curated.diningAfter.length  ? curated.diningAfter  : basePlan.diningAfter,
          intro: curated.intro || "",
          tips: Array.isArray(curated.tips) ? curated.tips : []
        };
      } catch (e) {
        console.warn("Cohere unavailable or failed, using base plan:", e.message);
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

  async function cohereCurate(state, beforeList, afterList){
    const trim = p => ({
      name: p.name, address: p.address, distance: p.distance,
      url: p.url || "", mapUrl: p.mapUrl || "",
      price: p.price || null, rating: p.rating || null, openNow: p.openNow ?? null
    });
    const payload = {
      state: {
        artist: state.artist, venue: state.venue,
        venueLat: state.venueLat, venueLng: state.venueLng,
        eatWhen: state.eatWhen, foodStyle: state.foodStyle, budget: state.budget,
        tone: state.tone
      },
      candidates: {
        before: (beforeList || []).slice(0,10).map(trim),
        after:  (afterList  || []).slice(0,10).map(trim)
      }
    };
    const res = await fetch("/.netlify/functions/concerto_cohere", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Cohere function not available");
    return await res.json();
  }

  function renderResults(plan){
    byId('results-context').textContent = `${state.artist} at ${state.venue}`;
    byId('intro-line').textContent = plan.intro || "";
    const grid = byId('itinerary');
    const cards = [];

    if (plan.show){
      cards.push(card("Show", plan.show.title, [line(plan.show.venue)]));
    }
    if (Array.isArray(plan.diningBefore) && plan.diningBefore.length){
      cards.push(card("Eat Before", null, plan.diningBefore.map(placeLine)));
    }
    if (Array.isArray(plan.diningAfter) && plan.diningAfter.length){
      cards.push(card("Eat After", null, plan.diningAfter.map(placeLine)));
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
      p.blurb ? `<em>${esc(p.blurb)}</em>` : "",
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