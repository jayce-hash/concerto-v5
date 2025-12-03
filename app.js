// app.js — Concerto+ Simple Night Planner (v1.0)
// Cleaned-up version to match the simple, effective "Events Near Me" style.

import { pickRestaurants, pickExtras } from './quality-filter.js';

(() => {
  if (window.__concertoPlusInit) return;
  window.__concertoPlusInit = true;

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) =>
    (s || '').replace(/[&<>\"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));

  /* --------------------------------------------------
   * State
   * -------------------------------------------------- */
  const state = {
    // Event
    artist: '',
    venue: '',
    venuePlaceId: '',
    venueLat: null,
    venueLng: null,
    showDate: '',
    showTime: '',
    showTz: '',

    // Hotel
    staying: true,
    hotel: '',
    hotelPlaceId: '',
    hotelLat: null,
    hotelLng: null,

    // Preferences
    startAt: '10:00',        // itinerary "day" start (for schedule flavor text)
    arrivalBufferMin: 45,    // arrive this many minutes before show

    wantDinner: true,
    dinnerBudget: '$$',
    dinnerCuisine: 'American',

    interests: {
      coffee: true,
      dessert: true,
      drinks: true,
      nightlife: true
    }
  };

  /* --------------------------------------------------
   * Layout / Init
   * -------------------------------------------------- */
  function initLayout() {
    document.body.classList.add('show-form');
    document.body.classList.remove('has-plan');

    const formScreen = $('screen-form');
    const resultsScreen = $('screen-results');

    if (!formScreen || !resultsScreen) {
      console.warn('Concerto+ screens not found');
      return;
    }

    formScreen.innerHTML = `
      <div class="container">
        <h2 class="page-title" style="text-align:center; margin-bottom:12px;">
          Plan Your Concert Night
        </h2>
        <p class="muted" style="text-align:center; margin-bottom:18px;">
          Pick your show, add your hotel, and let Concerto suggest dinner and stops around the venue.
        </p>

        <!-- Event card -->
        <article class="card" style="padding:16px; margin-bottom:14px;">
          <h3 class="step-title" style="margin-bottom:10px;">Find your event</h3>
          <div class="field">
            <label>Artist, Team, or Venue</label>
            <input id="tm-q" type="text" placeholder="e.g., Taylor Swift or Madison Square Garden" autocomplete="off" />
          </div>
          <div class="field">
            <label>City</label>
            <input id="tm-city" type="text" placeholder="e.g., New York or Los Angeles" autocomplete="off" />
          </div>
          <div class="field" style="margin-top:8px;">
            <button id="tm-search" class="btn btn-primary" type="button" style="width:100%;">
              Search Ticketmaster
            </button>
          </div>
          <div id="tm-results" class="suggest-list" style="display:none; margin-top:10px;"></div>

          <div class="divider" style="margin:16px 0;"></div>

          <p class="muted" style="margin-bottom:8px;">Or enter details manually:</p>
          <div class="field">
            <label>Artist or Tour</label>
            <input id="artist" type="text" placeholder="e.g., Olivia Rodrigo" autocomplete="off" />
          </div>
          <div class="field">
            <label>Venue</label>
            <input id="venue" type="text" placeholder="Venue name" autocomplete="off" />
          </div>
          <div class="form-grid two plain" style="margin-top:6px;">
            <div class="field">
              <label>Date</label>
              <input id="showDate" type="date" />
            </div>
            <div class="field">
              <label>Show time</label>
              <input id="showTime" type="time" />
            </div>
          </div>

          <div id="event-summary" class="muted" style="margin-top:10px; font-size:0.9rem;"></div>
        </article>

        <!-- Hotel card -->
        <article class="card" style="padding:16px; margin-bottom:14px;">
          <div class="qrow" style="align-items:center; gap:8px;">
            <label class="switch">
              <input id="staying" type="checkbox" checked />
            </label>
            <h3 class="step-title" style="margin:0;">Staying at a hotel?</h3>
          </div>
          <div id="hotel-fields" style="margin-top:10px;">
            <label class="field">
              <span>Hotel name or address</span>
              <input id="hotel" type="text" placeholder="e.g., Marriott, Hilton, or address" autocomplete="off" />
            </label>
          </div>
        </article>

        <!-- Preferences card -->
        <article class="card" style="padding:16px; margin-bottom:16px;">
          <h3 class="step-title" style="margin-bottom:10px;">Preferences</h3>

          <div class="field">
            <label>When should Concerto start planning your day?</label>
            <select id="pref-start">
              <option value="09:00">9:00 AM</option>
              <option value="10:00" selected>10:00 AM</option>
              <option value="11:00">11:00 AM</option>
              <option value="12:00">12:00 PM</option>
            </select>
          </div>

          <div class="divider" style="margin:12px 0;"></div>

          <div class="qrow" style="align-items:center; gap:8px; margin-bottom:10px;">
            <label class="switch">
              <input id="pref-dinner-on" type="checkbox" checked />
            </label>
            <span>Dinner before the show</span>
          </div>

          <div id="pref-dinner-fields">
            <div class="field">
              <label>Dinner cuisine</label>
              <select id="pref-dinner-cuisine">
                <option>American</option>
                <option>Italian</option>
                <option>Japanese/Sushi</option>
                <option>Mexican/Tacos</option>
                <option>Steakhouse</option>
                <option>Seafood</option>
                <option>Mediterranean</option>
                <option>Vegan/Vegetarian</option>
                <option>Pizza</option>
                <option>BBQ</option>
              </select>
            </div>
            <div class="field">
              <label>Budget</label>
              <div class="radio-group segmented" id="pref-dinner-budget">
                <div class="pill active" data-val="$">$</div>
                <div class="pill" data-val="$$">$$</div>
                <div class="pill" data-val="$$$">$$$</div>
                <div class="pill" data-val="$$$$">$$$$</div>
              </div>
            </div>
          </div>

          <div class="divider" style="margin:12px 0;"></div>

          <div class="field">
            <label>What else do you want suggestions for?</label>
            <div class="checks" id="pref-interests">
              <label class="check">
                <input type="checkbox" data-key="coffee" checked />
                <span>Coffee</span>
              </label>
              <label class="check">
                <input type="checkbox" data-key="dessert" checked />
                <span>Dessert</span>
              </label>
              <label class="check">
                <input type="checkbox" data-key="drinks" checked />
                <span>Drinks &amp; Lounges</span>
              </label>
              <label class="check">
                <input type="checkbox" data-key="nightlife" checked />
                <span>Nightlife</span>
              </label>
            </div>
          </div>
        </article>

        <button id="btn-generate" class="btn btn-primary" type="button" style="width:100%; margin-bottom:12px;">
          Generate My Night
        </button>
      </div>
    `;

    resultsScreen.innerHTML = `
      <div class="container wide">
        <article class="card" style="padding:16px; margin-bottom:16px;">
          <div id="results-context" style="text-align:center; margin-bottom:10px;"></div>
          <div id="intro-line" class="muted" style="text-align:center; font-size:0.9rem; margin-bottom:10px;">
            Your schedule will appear below.
          </div>
          <div id="schedule"></div>
        </article>

        <div id="rails-wrap"></div>
      </div>
    `;

    bindFormControls();
    bindTicketmaster();
    bindPlacesAutocomplete();

    // scroll-friendly
    const btn = $('btn-generate');
    if (btn) {
      btn.addEventListener('click', () => {
        generatePlan().catch((e) => {
          console.error(e);
          alert(e.message || 'Could not build your plan. Please try again.');
        });
      });
    }
  }

  function setLoading(on) {
    const loading = $('screen-loading');
    if (!loading) return;
    loading.classList.toggle('active', !!on);
  }

  /* --------------------------------------------------
   * Form bindings
   * -------------------------------------------------- */
  function bindFormControls() {
    const artist = $('artist');
    const venue = $('venue');
    const showDate = $('showDate');
    const showTime = $('showTime');
    const staying = $('staying');
    const hotel = $('hotel');
    const startSel = $('pref-start');
    const dinnerOn = $('pref-dinner-on');
    const dinnerCuisine = $('pref-dinner-cuisine');
    const dinnerBudgetWrap = $('pref-dinner-budget');
    const interestsWrap = $('pref-interests');

    if (artist) artist.addEventListener('input', (e) => (state.artist = e.target.value.trim()));
    if (venue) venue.addEventListener('input', (e) => (state.venue = e.target.value.trim()));
    if (showDate) showDate.addEventListener('input', (e) => (state.showDate = e.target.value));
    if (showTime) showTime.addEventListener('input', (e) => (state.showTime = e.target.value));

    if (staying) {
      staying.addEventListener('change', () => {
        state.staying = staying.checked;
        const fields = $('hotel-fields');
        if (!fields) return;
        fields.style.opacity = state.staying ? '' : '.5';
        fields.style.pointerEvents = state.staying ? '' : 'none';
      });
    }

    if (hotel) hotel.addEventListener('input', (e) => (state.hotel = e.target.value.trim()));
    if (startSel) startSel.addEventListener('change', (e) => (state.startAt = e.target.value || '10:00'));

    if (dinnerOn) {
      dinnerOn.addEventListener('change', () => {
        state.wantDinner = dinnerOn.checked;
        const wrap = $('pref-dinner-fields');
        if (!wrap) return;
        wrap.style.opacity = state.wantDinner ? '' : '.5';
        wrap.style.pointerEvents = state.wantDinner ? '' : 'none';
      });
    }

    if (dinnerCuisine) {
      dinnerCuisine.addEventListener('change', (e) => {
        state.dinnerCuisine = e.target.value;
      });
    }

    if (dinnerBudgetWrap) {
      qsa('.pill', dinnerBudgetWrap).forEach((pill) => {
        pill.addEventListener('click', () => {
          qsa('.pill', dinnerBudgetWrap).forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          state.dinnerBudget = pill.dataset.val || '$$';
        });
      });
    }

    if (interestsWrap) {
      interestsWrap.addEventListener('change', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        const key = input.dataset.key;
        if (!key) return;
        state.interests[key] = input.checked;
      });
    }
  }

  function updateEventSummary() {
    const el = $('event-summary');
    if (!el) return;
    if (!state.venue && !state.artist && !state.showDate) {
      el.textContent = '';
      return;
    }
    const parts = [];
    if (state.artist) parts.push(state.artist);
    if (state.venue) parts.push(state.venue);
    if (state.showDate) parts.push(state.showDate);
    el.textContent = parts.join(' • ');
  }

  /* --------------------------------------------------
   * Ticketmaster
   * -------------------------------------------------- */
  const TM_KEY = 'oMkciJfNTvAuK1N4O1XXe49pdPEeJQuh';

  function tmUrl(path, params) {
    const u = new URL(`https://app.ticketmaster.com${path}`);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v == null || v === '') return;
      u.searchParams.set(k, String(v));
    });
    u.searchParams.set('apikey', TM_KEY);
    return u.toString();
  }

  async function tmSearch({ keyword, city = '', size = 10 }) {
    if (!keyword) return [];
    const url = tmUrl('/discovery/v2/events.json', {
      keyword,
      city: city || undefined,
      size: Math.max(1, Math.min(20, size))
    });
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const list = json?._embedded?.events || [];
    return list.map((ev) => {
      const at = (ev?._embedded?.attractions || [])[0];
      const vn = (ev?._embedded?.venues || [])[0] || {};
      const dtISO = ev?.dates?.start?.dateTime || null;
      const tz = ev?.dates?.timezone || vn?.timezone || null;
      const loc = vn?.location || {};
      return {
        id: ev?.id || '',
        name: ev?.name || '',
        artist: at?.name || (ev?.name || '').replace(/\s+-\s+.*$/, ''),
        venue: vn?.name || '',
        city: [vn?.city?.name, vn?.state?.stateCode].filter(Boolean).join(', '),
        address: [vn?.address?.line1, vn?.city?.name, vn?.state?.stateCode, vn?.postalCode]
          .filter(Boolean)
          .join(', '),
        dateTime: dtISO,
        timezone: tz || '',
        venueLat: loc?.latitude ? Number(loc.latitude) : null,
        venueLng: loc?.longitude ? Number(loc.longitude) : null
      };
    });
  }

  function bindTicketmaster() {
    const q = $('tm-q');
    const city = $('tm-city');
    const btn = $('tm-search');
    const list = $('tm-results');
    if (!q || !btn || !list) return;

    async function run() {
      list.style.display = 'block';
      list.innerHTML = `<div class="suggest-item muted">Searching Ticketmaster…</div>`;
      try {
        const events = await tmSearch({
          keyword: q.value.trim(),
          city: city.value.trim(),
          size: 10
        });
        if (!events.length) {
          list.innerHTML = `<div class="suggest-item muted">No events found. Try a different search.</div>`;
          return;
        }
        list.innerHTML = events
          .map((ev) => {
            const dt = ev.dateTime
              ? new Date(ev.dateTime).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })
              : 'TBA';
            return `
              <div class="suggest-item" data-ev='${esc(JSON.stringify(ev))}'>
                <div style="font-weight:600">${esc(ev.artist || ev.name)}</div>
                <div class="muted" style="font-size:.9rem;">
                  ${esc(ev.venue)} — ${esc(ev.city || '')} · ${esc(dt)}
                </div>
                <button class="btn btn-ghost" type="button" style="margin-top:6px;">Use this event</button>
              </div>
            `;
          })
          .join('');

        qsa('.suggest-item', list).forEach((item) => {
          const btnUse = item.querySelector('button');
          if (!btnUse) return;
          btnUse.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const ev = JSON.parse(item.dataset.ev || '{}');
              applyTicketmasterEvent(ev);
              list.style.display = 'none';
            } catch (err) {
              console.warn(err);
            }
          });
        });
      } catch (e) {
        console.error(e);
        list.innerHTML = `<div class="suggest-item muted">Error contacting Ticketmaster.</div>`;
      }
    }

    btn.addEventListener('click', run);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });
    city.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });
  }

  function applyTicketmasterEvent(ev) {
    state.artist = ev.artist || ev.name || state.artist;
    state.venue = ev.venue || state.venue;
    state.showTz = ev.timezone || '';

    if (ev.dateTime) {
      const d = new Date(ev.dateTime);
      state.showDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      state.showTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
        2,
        '0'
      )}`;
    }

    if (typeof ev.venueLat === 'number' && typeof ev.venueLng === 'number') {
      state.venueLat = ev.venueLat;
      state.venueLng = ev.venueLng;
    }

    // Reflect into inputs
    if ($('artist')) $('artist').value = state.artist || '';
    if ($('venue')) $('venue').value = state.venue || '';
    if ($('showDate')) $('showDate').value = state.showDate || '';
    if ($('showTime')) $('showTime').value = state.showTime || '';

    updateEventSummary();
  }

  /* --------------------------------------------------
   * Google Places helpers
   * -------------------------------------------------- */
  function mapsReady() {
    return !!(window.google && google.maps && google.maps.places);
  }

  function waitForPlaces(maxMs = 10000) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      (function tick() {
        if (mapsReady()) return resolve(true);
        if (Date.now() - t0 > maxMs) return reject(new Error('Google Places failed to load'));
        setTimeout(tick, 120);
      })();
    });
  }

  function bindPlacesAutocomplete() {
    // Venue
    waitForPlaces()
      .then(() => {
        const vin = $('venue');
        if (vin) {
          const ac = new google.maps.places.Autocomplete(vin, { types: ['establishment'] });
          ac.addListener('place_changed', () => {
            const p = ac.getPlace();
            if (!p || !p.geometry) return;
            state.venue = p.name || vin.value.trim();
            state.venuePlaceId = p.place_id || '';
            state.venueLat = p.geometry.location.lat();
            state.venueLng = p.geometry.location.lng();
            updateEventSummary();
          });
        }

        // Hotel
        const hin = $('hotel');
        if (hin) {
          const acH = new google.maps.places.Autocomplete(hin, { types: ['establishment'] });
          acH.addListener('place_changed', () => {
            const p = acH.getPlace();
            if (!p || !p.geometry) return;
            state.hotel = p.name || hin.value.trim();
            state.hotelPlaceId = p.place_id || '';
            state.hotelLat = p.geometry.location.lat();
            state.hotelLng = p.geometry.location.lng();
          });
        }
      })
      .catch(() => {});
  }

  async function ensureVenueResolved() {
    if (state.venueLat && state.venueLng) return;
    const query = (state.venue || '').trim();
    if (!query) throw new Error('Please enter a venue name or pick an event from Ticketmaster.');
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const place = await new Promise((resolve, reject) => {
      svc.textSearch({ query }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          resolve(results[0]);
        } else {
          reject(new Error('Could not find that venue. Try a more specific name.'));
        }
      });
    });
    state.venue = place.name;
    state.venuePlaceId = place.place_id;
    state.venueLat = place.geometry.location.lat();
    state.venueLng = place.geometry.location.lng();
  }

  async function ensureHotelResolved() {
    if (!state.staying) return;
    if (state.hotelLat && state.hotelLng) return;
    const q = (state.hotel || '').trim();
    if (!q) return;
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const place = await new Promise((resolve) => {
      svc.textSearch({ query: q }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          resolve(results[0]);
        } else {
          resolve(null);
        }
      });
    });
    if (place) {
      state.hotel = place.name;
      state.hotelPlaceId = place.place_id;
      state.hotelLat = place.geometry.location.lat();
      state.hotelLng = place.geometry.location.lng();
    }
  }

  /* --------------------------------------------------
   * Time & Map helpers
   * -------------------------------------------------- */
  function parseHM(hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
    return { h, m };
  }

  function parseShowDateTimeISO() {
    const now = new Date();
    const hm = parseHM(state.showTime) || { h: 19, m: 0 };
    if (state.showDate) {
      const [Y, M, D] = state.showDate.split('-').map((n) => parseInt(n, 10));
      return new Date(Y, M - 1, D, hm.h, hm.m).toISOString();
    }
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hm.h,
      hm.m
    ).toISOString();
  }

  function roundToNearest5(date) {
    const d = new Date(date);
    const mins = d.getMinutes();
    const rounded = Math.round(mins / 5) * 5;
    d.setMinutes(rounded, 0, 0);
    return d;
  }

  function fmtInTz(dLike, tz, { round = false } = {}) {
    if (!dLike) return '';
    let d = dLike instanceof Date ? new Date(dLike) : new Date(dLike);
    if (round) d = roundToNearest5(d);
    try {
      return d.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        ...(tz ? { timeZone: tz } : {})
      });
    } catch {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }

  function milesBetween(aLat, aLng, bLat, bLng) {
    if ([aLat, aLng, bLat, bLng].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
    const toRad = (x) => x * Math.PI / 180;
    const R = 3958.8; // miles
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const sa =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  }

  function mapUrlFor(obj) {
    const p = obj || {};
    const placeId =
      p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || '';
    const name = p.name || p.title || '';
    const address = p.address || p.formatted_address || p.vicinity || '';
    if (placeId) {
      const q = [name, address].filter(Boolean).join(' ').trim() || 'Place';
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        q
      )}&query_place_id=${encodeURIComponent(placeId)}`;
    }
    const q = [name, address].filter(Boolean).join(' ').trim();
    if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    const lat = p.lat != null ? Number(p.lat) : null;
    const lng = p.lng != null ? Number(p.lng) : null;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    }
    return '';
  }

  function normalizePlace(p) {
    if (!p || typeof p !== 'object') return null;
    const name = p.name || p.title || '';
    const address = p.address || p.formatted_address || p.vicinity || '';
    const placeId = p.placeId || p.place_id || p.googlePlaceId || p.google_place_id || '';
    const lat =
      typeof p.lat === 'number'
        ? p.lat
        : p.lat
        ? parseFloat(p.lat)
        : p.geometry?.location?.lat?.() ?? null;
    const lng =
      typeof p.lng === 'number'
        ? p.lng
        : p.lng
        ? parseFloat(p.lng)
        : p.geometry?.location?.lng?.() ?? null;
    const mapUrl = mapUrlFor({ placeId, name, address, lat, lng });

    if (!(typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng))) {
      return null;
    }

    return { name, address, placeId, lat, lng, mapUrl };
  }

  /* --------------------------------------------------
   * Extras + fallback search
   * -------------------------------------------------- */
  function fallbackQueryFor(cat) {
    switch (cat) {
      case 'coffee':
        return { type: 'cafe', keyword: 'coffee' };
      case 'dessert':
        return { type: 'bakery', keyword: 'dessert' };
      case 'drinks':
        return { type: 'bar', keyword: 'cocktail bar' };
      case 'nightlife':
        return { type: 'night_club', keyword: 'nightlife' };
      default:
        return { type: 'restaurant', keyword: '' };
    }
  }

  async function placesFallback(cat, max = 10) {
    if (!(state.venueLat && state.venueLng)) return [];
    await waitForPlaces();
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const center = new google.maps.LatLng(state.venueLat, state.venueLng);
    const q = fallbackQueryFor(cat);

    const params = {
      location: center,
      rankBy: google.maps.places.RankBy.DISTANCE,
      type: q.type || undefined,
      keyword: q.keyword || undefined
    };

    const res = await new Promise((resolve) => {
      svc.nearbySearch(params, (r, s) => {
        if (s === google.maps.places.PlacesServiceStatus.OK && Array.isArray(r)) {
          resolve(r.slice(0, max));
        } else {
          resolve([]);
        }
      });
    });

    return (res || []).map((p) => ({
      name: p.name,
      address: p.vicinity || p.formatted_address || '',
      placeId: p.place_id,
      lat: p.geometry?.location?.lat?.(),
      lng: p.geometry?.location?.lng?.(),
      rating: p.rating,
      price_level: p.price_level,
      photos: p.photos
    }));
  }

  function categorizeExtras(extras = []) {
    const hay = (x) =>
      [
        x.section,
        x.category,
        x.name,
        Array.isArray(x.types) && x.types.join(' '),
        Array.isArray(x.tags) && x.tags.join(' ')
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const rx = {
      coffee: /(coffee|café|cafe|espresso|roastery|tea\s?house)/i,
      dessert: /(dessert|sweet|ice.?cream|gelato|bak(?:e|ery)|pastry|donut|cake|choco|cookie|creamery)/i,
      drinks: /(drink|bar|pub|lounge|wine|cocktail|taproom|speakeasy|gastropub|brewery)/i,
      nightlife: /(nightlife|night.?club|club|karaoke|live\s?music|entertainment|dj|dance|comedy\s?club)/i
    };

    const bucket = { coffee: [], dessert: [], drinks: [], nightlife: [] };
    extras.forEach((x) => {
      const h = hay(x);
      if (rx.coffee.test(h)) bucket.coffee.push(x);
      else if (rx.dessert.test(h)) bucket.dessert.push(x);
      else if (rx.drinks.test(h)) bucket.drinks.push(x);
      else if (rx.nightlife.test(h)) bucket.nightlife.push(x);
    });
    return bucket;
  }

  /* --------------------------------------------------
   * Rails
   * -------------------------------------------------- */
  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function ensureRail(id, title) {
    const wrap = $('rails-wrap');
    if (!wrap) return null;

    let rail = document.getElementById(id)?.closest('.rail');
    if (!rail) {
      rail = document.createElement('section');
      rail.className = 'rail';
      rail.innerHTML = `
        <header class="rail-head">
          <h3 class="rail-title">${esc(title || '')}</h3>
        </header>
        <div id="${esc(id)}" class="h-scroll cards-rail"></div>
      `;
      wrap.appendChild(rail);
    } else {
      const head = rail.querySelector('.rail-title');
      if (head && title) head.textContent = title;
      rail.style.display = '';
    }
    return rail.querySelector(`#${CSS.escape(id)}`);
  }

  function hideRail(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const rail = el.closest('.rail');
    if (rail) rail.style.display = 'none';
  }

  function fillRail(id, title, list) {
    const row = ensureRail(id, title);
    if (!row) return;
    if (!Array.isArray(list) || !list.length) {
      row.innerHTML = `<div class="muted" style="padding:6px 4px;">No suggestions yet.</div>`;
      return;
    }

    row.innerHTML = list
      .map((p) => {
        const norm = normalizePlace(p) || p;
        const name = esc(norm.name || '');
        const addr = esc(norm.address || '');
        const dist =
          typeof norm.lat === 'number' && typeof norm.lng === 'number'
            ? milesBetween(state.venueLat, state.venueLng, norm.lat, norm.lng)
            : null;
        const distLabel = dist != null ? `${dist.toFixed(1)} mi` : '';
        const mapHref = mapUrlFor(norm);
        return `
          <a class="place-card"
             href="${esc(mapHref)}"
             target="_blank" rel="noopener"
             title="Open in Google Maps">
            <div class="pc-body">
              <div class="pc-title">${name}</div>
              <div class="pc-meta">
                ${distLabel ? `<span>${esc(distLabel)}</span>` : ''}
                ${addr ? `<span>${addr}</span>` : ''}
              </div>
            </div>
          </a>
        `;
      })
      .join('');
  }

  async function renderRails(dinnerList, extrasList) {
    const extras = extrasList || [];
    const bucket = categorizeExtras(extras);

    // Dinner rail
    if (state.wantDinner && Array.isArray(dinnerList) && dinnerList.length) {
      fillRail('rail-dinner', 'Dinner near the venue', dinnerList.slice(0, 10));
    } else {
      hideRail('rail-dinner');
    }

    // Coffee / Dessert / Drinks / Nightlife
    const cats = [
      { key: 'coffee', label: 'Coffee & Cafés' },
      { key: 'dessert', label: 'Dessert' },
      { key: 'drinks', label: 'Drinks & Lounges' },
      { key: 'nightlife', label: 'Nightlife & Entertainment' }
    ];

    for (const { key, label } of cats) {
      if (!state.interests[key]) {
        hideRail(`rail-${slug(key)}`);
        continue;
      }
      let list = bucket[key] || [];
      if (!list.length) {
        try {
          list = await placesFallback(key, 10);
        } catch {
          list = [];
        }
      }
      if (list.length) fillRail(`rail-${slug(key)}`, label, list.slice(0, 10));
      else hideRail(`rail-${slug(key)}`);
    }
  }

  /* --------------------------------------------------
   * Schedule card
   * -------------------------------------------------- */
  function renderSchedule(showISO, dinnerPick) {
    const ctx = $('results-context');
    const scheduleEl = $('schedule');
    const intro = $('intro-line');
    if (!ctx || !scheduleEl || !intro) return;

    const d = new Date(showISO);
    const tz = state.showTz || undefined;

    const dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(
      d.getDate()
    ).padStart(2, '0')}/${d.getFullYear()}`;
    const timeStr = fmtInTz(d, tz, { round: false });

    ctx.innerHTML = `
      <div style="font-weight:600;">${esc(state.artist || 'Your Concert')}</div>
      <div>${esc(state.venue || '')}</div>
      <div>
        ${esc(dateStr)}${timeStr ? ` • ${esc(timeStr)}` : ''}
        ${
          tz
            ? `<span class="muted" style="font-variant:all-small-caps; letter-spacing:.06em;"> (${esc(
                tz
              )})</span>`
            : ''
        }
      </div>
    `;
    intro.textContent = 'Here’s a simple timeline for your night.';

    const steps = [];
    const showStart = new Date(showISO);
    const arriveBy = new Date(showStart.getTime() - (state.arrivalBufferMin || 45) * 60000);

    if (state.startAt) {
      const hm = parseHM(state.startAt) || { h: 10, m: 0 };
      const start = new Date(showStart);
      start.setHours(hm.h, hm.m, 0, 0);
      steps.push({
        time: start,
        label: 'Start your day',
        detail: 'Enjoy the city at your own pace.'
      });
    }

    if (state.wantDinner && dinnerPick && dinnerPick.name) {
      const leaveForDinner = new Date(arriveBy.getTime() - 90 * 60000); // ~90 minutes before arrival
      steps.push({
        time: leaveForDinner,
        label: 'Dinner before the show',
        detail: dinnerPick.name,
        mapUrl: dinnerPick.mapUrl || mapUrlFor(dinnerPick)
      });
    }

    if (state.venue) {
      const venuePayload = {
        name: state.venue,
        placeId: state.venuePlaceId,
        lat: state.venueLat,
        lng: state.venueLng
      };
      const leaveForVenue = new Date(arriveBy.getTime() - 15 * 60000);
      steps.push({
        time: leaveForVenue,
        label: 'Head to the venue',
        detail: state.venue,
        mapUrl: mapUrlFor(venuePayload)
      });
    }

    steps.push({
      time: showStart,
      label: 'Show starts',
      detail: state.artist || 'Your concert'
    });

    steps.sort((a, b) => +a.time - +b.time);

    scheduleEl.innerHTML = `
      <div class="tour-steps">
        ${steps
          .map((s) => {
            const t = fmtInTz(s.time, tz, { round: true });
            const label = esc(s.label || '');
            const detail = esc(s.detail || '');
            const link =
              s.mapUrl && s.detail
                ? `<a href="${esc(s.mapUrl)}" target="_blank" rel="noopener">${detail}</a>`
                : detail;
            return `
              <div class="tstep">
                <div class="t-time">${esc(t)}</div>
                <div class="t-arrow">→</div>
                <div class="t-label">
                  <span class="t-verb">${label}</span>
                  ${detail ? ` <strong class="t-dest">${link}</strong>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  /* --------------------------------------------------
   * Generate plan
   * -------------------------------------------------- */
  async function generatePlan() {
    if (!state.showDate || !state.showTime) {
      throw new Error('Please set a show date and time.');
    }

    setLoading(true);
    try {
      await ensureVenueResolved();
      await ensureHotelResolved();

      const showISO = parseShowDateTimeISO();

      // Dinner suggestions
      let dinnerList = [];
      let dinnerPick = null;
      if (state.wantDinner) {
        const dinnerState = {
          ...state,
          foodStyles: [state.dinnerCuisine],
          budget: state.dinnerBudget,
          placeStyle: 'sitdown'
        };
        dinnerList =
          (await pickRestaurants({
            wantOpenNow: false,
            state: dinnerState,
            slot: 'before',
            targetISO: showISO
          })) || [];
        dinnerPick = dinnerList.length ? normalizePlace(dinnerList[0]) : null;
      }

      // Extras
      const extras = (await pickExtras({ state })) || [];

      // Render schedule + rails
      renderSchedule(showISO, dinnerPick);
      await renderRails(dinnerList, extras);

      document.body.classList.add('has-plan');

      // Smooth scroll to results
      const resultsScreen = $('screen-results');
      if (resultsScreen) {
        resultsScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } finally {
      setLoading(false);
    }
  }

  /* --------------------------------------------------
   * Start
   * -------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLayout);
  } else {
    initLayout();
  }
})();
