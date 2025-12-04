// app.js — Concerto+ Day Planner (simple v1)
// Uses Ticketmaster Discovery API + Google Places Nearby Search

(function () {
  const TM_KEY = "oMkciJfNTvAuK1N4O1XXe49pdPEeJQuh"; // <- your Ticketmaster key

  const $ = (id) => document.getElementById(id);

  const eventKeywordInput = $("eventKeyword");
  const eventCityInput = $("eventCity");
  const searchEventsBtn = $("searchEventsBtn");
  const eventStatusEl = $("eventStatus");
  const eventResultsEl = $("eventResults");

  const selectedEventSummary = $("selectedEventSummary");
  const preVibePills = $("preVibePills");
  const postVibePills = $("postVibePills");
  const paceControl = $("paceControl");
  const generatePlanBtn = $("generatePlanBtn");
  const planStatusEl = $("planStatus");

  const cardPlan = $("card-plan");
  const timelineEl = $("timeline");
  const placeRailsEl = $("placeRails");
  const editChoicesBtn = $("editChoicesBtn");
  const sharePlanBtn = $("sharePlanBtn");

  let selectedEvent = null;           // Ticketmaster event (normalized)
  let selectedPace = "balanced";      // chill | balanced | packed
  let selectedPreVibes = [];          // ['coffee', 'dinner', ...]
  let selectedPostVibes = [];         // ['dessert', 'drinks', ...]
  let placesService = null;

  // Map vibe -> Places configuration + labels
  const VIBE_CONFIG = {
    coffee: {
      label: "Coffee",
      pre: true,
      places: { type: "cafe", keyword: "coffee" },
    },
    lunch: {
      label: "Lunch",
      pre: true,
      places: { type: "restaurant", keyword: "lunch" },
    },
    dinner: {
      label: "Dinner",
      pre: true,
      places: { type: "restaurant", keyword: "dinner" },
    },
    shopping: {
      label: "Shopping",
      pre: true,
      places: { type: "shopping_mall", keyword: "shopping" },
    },
    sightseeing: {
      label: "Sightseeing",
      pre: true,
      places: { type: "tourist_attraction", keyword: "landmark" },
    },
    dessert: {
      label: "Dessert",
      post: true,
      places: { type: "bakery", keyword: "dessert" },
    },
    drinks: {
      label: "Drinks",
      post: true,
      places: { type: "bar", keyword: "cocktail bar" },
    },
    nightlife: {
      label: "Nightlife",
      post: true,
      places: { type: "night_club", keyword: "nightlife" },
    },
    latenight: {
      label: "Late-night eats",
      post: true,
      places: { type: "restaurant", keyword: "late night food" },
    },
  };

  /* ------------ Helpers ------------ */

  function setStatus(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
  }

  function toDateSafe(iso) {
    try {
      return iso ? new Date(iso) : null;
    } catch {
      return null;
    }
  }

  function formatTime(date) {
    if (!date) return "";
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function milesBetween(aLat, aLng, bLat, bLng) {
    if (
      [aLat, aLng, bLat, bLng].some(
        (v) => typeof v !== "number" || Number.isNaN(v)
      )
    ) {
      return null;
    }
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 3958.8; // miles
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const sa =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) *
        Math.cos(toRad(bLat)) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  }

  function googleMapsUrlForPlace(place) {
    const pid = place.placeId || place.place_id || "";
    const lat = place.lat;
    const lng = place.lng;
    if (pid) {
      return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(
        pid
      )}`;
    }
    if (typeof lat === "number" && typeof lng === "number") {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${lat},${lng}`
      )}`;
    }
    const q = place.name || "";
    if (q) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        q
      )}`;
    }
    return "";
  }

  function initPlacesService() {
    if (placesService) return;
    if (!(window.google && google.maps && google.maps.places)) return;
    placesService = new google.maps.places.PlacesService(
      document.createElement("div")
    );
  }

  /* ------------ Ticketmaster ------------ */

  function buildTMUrl({ keyword, city, size = 15 }) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    if (keyword) url.searchParams.set("keyword", keyword);
    if (city) url.searchParams.set("city", city);
    url.searchParams.set("size", String(size));
    url.searchParams.set("locale", "*");
    url.searchParams.set("apikey", TM_KEY);
    return url.toString();
  }

  // De-duplicate events so you only see one listing per show
  function dedupeEvents(events) {
    const map = new Map();

    for (const ev of events) {
      const baseName = (ev.artist || ev.name || "").toLowerCase();
      const venue = (ev.venueName || "").toLowerCase();
      const day = ev.dateTime ? ev.dateTime.slice(0, 10) : "";
      const key = `${baseName}|${venue}|${day}`;

      const isSuiteLike = /suite|box|club|parking|hospitality/i.test(ev.name || "");

      const existing = map.get(key);
      if (!existing) {
        map.set(key, ev);
        continue;
      }

      // Prefer non-suite / main event over suite/parking/club-style listings
      const existingIsSuite = /suite|box|club|parking|hospitality/i.test(
        existing.name || ""
      );

      if (existingIsSuite && !isSuiteLike) {
        map.set(key, ev);
      }
      // Otherwise keep the first one.
    }

    return Array.from(map.values());
  }

  async function searchTicketmasterEvents() {
    const keyword = (eventKeywordInput.value || "").trim();
    const city = (eventCityInput.value || "").trim();

    if (!keyword && !city) {
      setStatus(eventStatusEl, "Enter an artist, team, venue, or city.");
      return;
    }

    setStatus(eventStatusEl, "Searching Ticketmaster…");
    eventResultsEl.innerHTML = "";
    selectedEvent = null;
    updateSelectedEventSummary();
    generatePlanBtn.disabled = true;

    try {
      const url = buildTMUrl({ keyword, city, size: 30 });
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Ticketmaster error");
      }
      const json = await res.json();
      const eventsRaw = (json?._embedded?.events || []).map((ev) => {
        const at = (ev._embedded?.attractions || [])[0];
        const vn = (ev._embedded?.venues || [])[0] || {};
        const loc = vn.location || {};
        const dtISO = ev.dates?.start?.dateTime || null;
        const tz = ev.dates?.timezone || vn.timezone || "";

        return {
          id: ev.id,
          name: ev.name || "",
          artist: at?.name || "",
          venueName: vn.name || "",
          venueCity: [vn.city?.name, vn.state?.stateCode]
            .filter(Boolean)
            .join(", "),
          dateTime: dtISO,
          timezone: tz,
          venueLat: loc.latitude ? Number(loc.latitude) : null,
          venueLng: loc.longitude ? Number(loc.longitude) : null,
          ticketUrl: ev.url || "",
        };
      });

      const events = dedupeEvents(eventsRaw);

      if (!events.length) {
        setStatus(
          eventStatusEl,
          "No events found. Try a different keyword or city."
        );
        return;
      }

      renderEventResults(events);
      setStatus(
        eventStatusEl,
        `Showing ${events.length} result${events.length === 1 ? "" : "s"}. Tap Select to choose one.`
      );
    } catch (err) {
      console.error(err);
      setStatus(
        eventStatusEl,
        "We couldn’t reach Ticketmaster. Please try again."
      );
    }
  }

  function renderEventResults(events) {
    eventResultsEl.innerHTML = "";
    selectedEvent = null;
    updateSelectedEventSummary();

    events.forEach((ev) => {
      const card = document.createElement("div");
      card.className = "event-result";

      const title = document.createElement("h3");
      title.className = "event-result-title";
      title.textContent = ev.artist || ev.name || "Event";

      const meta = document.createElement("div");
      meta.className = "event-result-meta";

      const dt = toDateSafe(ev.dateTime);
      const dateStr = dt
        ? dt.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "Date TBA";
      const timeStr = dt ? formatTime(dt) : "";

      meta.textContent = `${
        ev.venueName || "Venue TBA"
      } · ${ev.venueCity || ""} • ${dateStr}${
        timeStr ? " · " + timeStr : ""
      }`;

      const header = document.createElement("div");
      header.className = "event-result-header";
      header.appendChild(title);

      const footer = document.createElement("div");
      footer.className = "event-result-footer";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Select";
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".event-result.selected")
          .forEach((el) => el.classList.remove("selected"));
        card.classList.add("selected");
        selectedEvent = ev;
        updateSelectedEventSummary();
        generatePlanBtn.disabled = false;

        // Mark Step 1 complete and open Step 2
        const step1 = document.querySelector('.step-pill[data-step="1"]');
        const step2 = document.querySelector('.step-pill[data-step="2"]');
        if (step1) step1.classList.add("completed");
        if (step1) step1.classList.remove("open");
        if (step2) step2.classList.add("open");
        if (step2) step2.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      footer.appendChild(btn);
      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(footer);
      eventResultsEl.appendChild(card);
    });
  }

  function updateSelectedEventSummary() {
    if (!selectedEvent) {
      selectedEventSummary.textContent =
        "Select an event in Step 1 to continue.";
      return;
    }
    const dt = toDateSafe(selectedEvent.dateTime);
    const dateStr = dt
      ? dt.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Date TBA";
    const timeStr = dt ? formatTime(dt) : "Time TBA";

    selectedEventSummary.textContent = `${
      selectedEvent.artist || selectedEvent.name
    } • ${selectedEvent.venueName || "Venue TBA"} • ${dateStr} · ${timeStr}`;
  }

  /* ------------ Vibe selection ------------ */

  function togglePill(pill, list) {
    const vibe = pill.getAttribute("data-vibe");
    if (!vibe) return;
    const idx = list.indexOf(vibe);
    if (idx >= 0) {
      list.splice(idx, 1);
      pill.classList.remove("active");
    } else {
      list.push(vibe);
      pill.classList.add("active");
    }
  }

  function initVibePills() {
    if (preVibePills) {
      preVibePills.addEventListener("click", (e) => {
        if (
          e.target instanceof HTMLButtonElement &&
          e.target.classList.contains("pill")
        ) {
          togglePill(e.target, selectedPreVibes);
        }
      });
    }
    if (postVibePills) {
      postVibePills.addEventListener("click", (e) => {
        if (
          e.target instanceof HTMLButtonElement &&
          e.target.classList.contains("pill")
        ) {
          togglePill(e.target, selectedPostVibes);
        }
      });
    }
    if (paceControl) {
      paceControl.addEventListener("click", (e) => {
        if (
          e.target instanceof HTMLButtonElement &&
          e.target.classList.contains("seg-pill")
        ) {
          paceControl
            .querySelectorAll(".seg-pill")
            .forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");
          selectedPace = e.target.getAttribute("data-pace") || "balanced";
        }
      });
    }
  }

  /* ------------ Places search ------------ */

  function ensureVenueLatLng() {
    if (!selectedEvent) return null;
    if (
      typeof selectedEvent.venueLat === "number" &&
      typeof selectedEvent.venueLng === "number"
    ) {
      return {
        lat: selectedEvent.venueLat,
        lng: selectedEvent.venueLng,
      };
    }
    return null; // For v1, we assume TM gives us coordinates; can expand later.
  }

  function placesSearch({ location, type, keyword, max = 10 }) {
    return new Promise((resolve) => {
      initPlacesService();
      if (!placesService || !location) return resolve([]);

      try {
        placesService.nearbySearch(
          {
            location: new google.maps.LatLng(location.lat, location.lng),
            rankBy: google.maps.places.RankBy.DISTANCE,
            type: type || undefined,
            keyword: keyword || undefined,
          },
          (results, status) => {
            if (
              status === google.maps.places.PlacesServiceStatus.OK &&
              Array.isArray(results)
            ) {
              const mapped = results.slice(0, max).map((p) => {
                const lat = p.geometry?.location?.lat?.();
                const lng = p.geometry?.location?.lng?.();
                return {
                  name: p.name || "",
                  placeId: p.place_id,
                  lat: typeof lat === "number" ? lat : null,
                  lng: typeof lng === "number" ? lng : null,
                  rating: typeof p.rating === "number" ? p.rating : null,
                  price_level:
                    typeof p.price_level === "number" ? p.price_level : null,
                  address: p.vicinity || p.formatted_address || "",
                  photos: p.photos || [],
                };
              });
              resolve(mapped);
            } else {
              console.warn("Places search status:", status);
              resolve([]);
            }
          }
        );
      } catch (err) {
        console.error("Places search error:", err);
        resolve([]);
      }
    });
  }

  /* ------------ Plan generation ------------ */

  function maxStopsForPace(pace) {
    switch (pace) {
      case "chill":
        return 2;
      case "packed":
        return 6;
      case "balanced":
      default:
        return 4;
    }
  }

  async function generatePlan() {
    if (!selectedEvent) {
      alert("Please select an event in Step 1.");
      return;
    }

    const preVibes = selectedPreVibes.slice();
    const postVibes = selectedPostVibes.slice();

    if (!preVibes.length && !postVibes.length) {
      alert("Choose at least one option before or after the show.");
      return;
    }

    const venueLoc = ensureVenueLatLng();
    if (!venueLoc) {
      alert(
        "We couldn’t get the venue location from Ticketmaster yet. Try another event."
      );
      return;
    }

    setStatus(planStatusEl, "Building your plan…");

    try {
      const allVibes = [...preVibes, ...postVibes];
      const placesByVibe = {};

      for (const vibe of allVibes) {
        const cfg = VIBE_CONFIG[vibe];
        if (!cfg) continue;
        const { type, keyword } = cfg.places;
        const results = await placesSearch({
          location: venueLoc,
          type,
          keyword,
          max: 10,
        });
        placesByVibe[vibe] = results;
      }

      const events = buildTimelineAndRails({ venueLoc, placesByVibe });

      renderTimeline(events.timeline);
      renderRails(events.rails, venueLoc);

      // Mark Step 2 complete and open Step 3
      const step2 = document.querySelector('.step-pill[data-step="2"]');
      const step3 = document.querySelector('.step-pill[data-step="3"]');
      if (step2) step2.classList.add("completed");
      if (step2) step2.classList.remove("open");
      if (step3) step3.classList.add("open");
      if (step3) step3.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error("Error while building plan:", err);
      setStatus(
        planStatusEl,
        "We couldn’t finish your plan. Please try again or adjust your choices."
      );
      return;
    } finally {
      // Always clear the "Building your plan…" message if we didn’t override it above.
      if (planStatusEl.textContent === "Building your plan…") {
        setStatus(planStatusEl, "");
      }
      cardPlan && cardPlan.classList.add("completed");
    }
  }

  function buildTimelineAndRails({ venueLoc, placesByVibe }) {
    const timeline = [];
    const rails = [];

    const showStart = toDateSafe(selectedEvent.dateTime);
    if (!showStart) {
      return { timeline, rails };
    }
    const showEnd = new Date(showStart.getTime() + 150 * 60000); // +2.5h

    const maxStops = maxStopsForPace(selectedPace);

    const preOrder = ["coffee", "lunch", "dinner", "shopping", "sightseeing"];
    const postOrder = ["dessert", "drinks", "nightlife", "latenight"];

    const selectedPre = preOrder.filter((v) => selectedPreVibes.includes(v));
    const selectedPost = postOrder.filter((v) => selectedPostVibes.includes(v));

    // Build lists of stops with one place each (if available)
    const preStops = [];
    const postStops = [];

    for (const v of selectedPre) {
      const list = placesByVibe[v] || [];
      if (list.length) {
        preStops.push({ vibe: v, place: list[0] });
      }
    }

    for (const v of selectedPost) {
      const list = placesByVibe[v] || [];
      if (list.length) {
        postStops.push({ vibe: v, place: list[0] });
      }
    }

    // Apply pace limit
    const allStops = [...preStops, ...postStops];
    if (allStops.length > maxStops) {
      const allowedPre = Math.min(preStops.length, Math.floor(maxStops / 2));
      const allowedPost = maxStops - allowedPre;

      const trimmedPre = preStops.slice(0, allowedPre);
      const trimmedPost = postStops.slice(0, allowedPost);
      preStops.length = 0;
      preStops.push(...trimmedPre);
      postStops.length = 0;
      postStops.push(...trimmedPost);
    }

    // Pre-show timing
    if (preStops.length) {
      const totalPre = preStops.length;
      const baseMinutes = totalPre * 60 + 90; // stops + 90min buffer before
      const firstTime = new Date(showStart.getTime() - baseMinutes * 60000);

      preStops.forEach((stop, idx) => {
        const t = new Date(firstTime.getTime() + idx * 60 * 60000);
        const label = buildTimelineLabel("pre", stop.vibe, stop.place);
        timeline.push({
          time: t,
          label,
          place: stop.place,
        });
      });

      // Head to venue
      const arriveBy = new Date(showStart.getTime() - 45 * 60000);
      timeline.push({
        time: new Date(arriveBy.getTime() - 15 * 60000),
        label: `Head to ${selectedEvent.venueName || "the venue"}`,
        place: {
          name: selectedEvent.venueName || "Venue",
          lat: venueLoc.lat,
          lng: venueLoc.lng,
        },
      });
    } else {
      // No pre-stops: simple head to venue
      const arriveBy = new Date(showStart.getTime() - 45 * 60000);
      timeline.push({
        time: new Date(arriveBy.getTime() - 15 * 60000),
        label: `Head to ${selectedEvent.venueName || "the venue"}`,
        place: {
          name: selectedEvent.venueName || "Venue",
          lat: venueLoc.lat,
          lng: venueLoc.lng,
        },
      });
    }

    // Concert start
    timeline.push({
      time: showStart,
      label: "Concert starts",
      place: null,
    });

    // Post-show timing
    if (postStops.length) {
      let t = new Date(showEnd.getTime() + 15 * 60000);
      postStops.forEach((stop) => {
        const label = buildTimelineLabel("post", stop.vibe, stop.place);
        timeline.push({
          time: t,
          label,
          place: stop.place,
        });
        t = new Date(t.getTime() + 75 * 60000);
      });
    }

    // Rails: one rail per vibe that has results
    const usedVibes = new Set(
      Object.keys(placesByVibe).filter((v) => (placesByVibe[v] || []).length)
    );
    usedVibes.forEach((vibe) => {
      const cfg = VIBE_CONFIG[vibe];
      if (!cfg) return;
      rails.push({
        vibe,
        title:
          (cfg.pre ? "Before the show · " : cfg.post ? "After the show · " : "") +
          cfg.label,
        places: placesByVibe[vibe],
      });
    });

    // Sort timeline chronologically
    timeline.sort((a, b) => +a.time - +b.time);

    return { timeline, rails };
  }

  function buildTimelineLabel(phase, vibe, place) {
    const cfg = VIBE_CONFIG[vibe];
    const name = place?.name || cfg?.label || "Stop";

    if (phase === "pre") {
      switch (vibe) {
        case "coffee":
          return `Coffee at ${name}`;
        case "lunch":
          return `Lunch at ${name}`;
        case "dinner":
          return `Dinner at ${name}`;
        case "shopping":
          return `Shopping at ${name}`;
        case "sightseeing":
          return `Explore ${name}`;
        default:
          return name;
      }
    } else {
      switch (vibe) {
        case "dessert":
          return `Dessert at ${name}`;
        case "drinks":
          return `Drinks at ${name}`;
        case "nightlife":
          return `Nightlife at ${name}`;
        case "latenight":
          return `Late-night eats at ${name}`;
        default:
          return name;
      }
    }
  }

  function renderTimeline(items) {
    timelineEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent =
        "We couldn’t build a timeline yet. Try adjusting your choices.";
      timelineEl.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "timeline-item";

      const time = document.createElement("div");
      time.className = "timeline-time";
      time.textContent = formatTime(item.time);

      const label = document.createElement("div");
      label.className = "timeline-label";

      if (item.place && item.place.name) {
        const url = googleMapsUrlForPlace(item.place);
        const nameMatch = item.label.match(/(.+?) at (.+)$/i);

        if (nameMatch && url) {
          const prefix = nameMatch[1];
          const placeName = nameMatch[2];

          label.innerHTML = `${prefix} at <strong><a href="${url}" target="_blank" rel="noopener">${placeName}</a></strong>`;
        } else if (url) {
          label.innerHTML = `${item.label} <strong><a href="${url}" target="_blank" rel="noopener">Open in Maps</a></strong>`;
        } else {
          label.textContent = item.label;
        }
      } else {
        label.textContent = item.label;
      }

      row.appendChild(time);
      row.appendChild(label);
      timelineEl.appendChild(row);
    });
  }

  function renderRails(rails, venueLoc) {
    placeRailsEl.innerHTML = "";
    if (!rails.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No nearby picks yet. Try turning on more options.";
      placeRailsEl.appendChild(empty);
      return;
    }

    rails.forEach((rail) => {
      const block = document.createElement("div");
      block.className = "rail";

      const title = document.createElement("div");
      title.className = "rail-title";
      title.textContent = rail.title;

      const row = document.createElement("div");
      row.className = "rail-row";

      rail.places.forEach((p) => {
        const card = document.createElement("a");
        card.className = "place-card";
        card.href = googleMapsUrlForPlace(p);
        card.target = "_blank";
        card.rel = "noopener";

        const imgWrap = document.createElement("div");
        imgWrap.className = "place-card-img";
        if (p.photos && p.photos[0] && p.photos[0].getUrl) {
          const img = document.createElement("img");
          img.src = p.photos[0].getUrl({ maxWidth: 360, maxHeight: 240 });
          img.alt = p.name || "";
          imgWrap.appendChild(img);
        }

        const body = document.createElement("div");
        body.className = "place-card-body";

        const name = document.createElement("h4");
        name.className = "place-card-name";
        name.textContent = p.name || "Place";

        const meta = document.createElement("div");
        meta.className = "place-card-meta";

        const miles = milesBetween(
          venueLoc.lat,
          venueLoc.lng,
          p.lat,
          p.lng
        );
        if (miles != null) {
          const span = document.createElement("span");
          span.textContent = `${miles.toFixed(1)} mi`;
          meta.appendChild(span);
        }

        if (typeof p.rating === "number") {
          const span = document.createElement("span");
          span.textContent = `★ ${p.rating.toFixed(1)}`;
          meta.appendChild(span);
        }

        if (typeof p.price_level === "number") {
          const span = document.createElement("span");
          span.textContent = "$".repeat(
            Math.max(1, Math.min(4, p.price_level))
          );
          meta.appendChild(span);
        }

        body.appendChild(name);
        body.appendChild(meta);
        card.appendChild(imgWrap);
        card.appendChild(body);
        row.appendChild(card);
      });

      block.appendChild(title);
      block.appendChild(row);
      placeRailsEl.appendChild(block);
    });
  }

  /* ------------ Share ------------ */

  async function sharePlan() {
    if (!selectedEvent) return;
    const dt = toDateSafe(selectedEvent.dateTime);
    const dateStr = dt
      ? dt.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Date TBA";
    const timeStr = dt ? formatTime(dt) : "Time TBA";

    const text = `My Concerto+ plan for ${
      selectedEvent.artist || selectedEvent.name
    } at ${
      selectedEvent.venueName || "the venue"
    } on ${dateStr} · ${timeStr}.`;

    const url = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({ title: "Concerto+ Plan", text, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard.");
      } else {
        alert("Sharing is not available in this browser.");
      }
    } catch (err) {
      console.warn("Share failed", err);
    }
  }

  /* ------------ Step pill accordion behavior ------------ */

  function initStepPills() {
    const pills = Array.from(document.querySelectorAll(".step-pill"));

    pills.forEach((pill) => {
      const header = pill.querySelector(".step-pill-header");
      if (!header) return;

      header.addEventListener("click", () => {
        const isOpen = pill.classList.contains("open");
        if (isOpen) {
          pill.classList.remove("open");
        } else {
          pills.forEach((p) => p.classList.remove("open"));
          pill.classList.add("open");
        }
      });
    });
  }

  /* ------------ Init ------------ */

  function init() {
    if (searchEventsBtn) {
      searchEventsBtn.addEventListener("click", searchTicketmasterEvents);
    }
    if (eventKeywordInput) {
      eventKeywordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") searchTicketmasterEvents();
      });
    }
    if (eventCityInput) {
      eventCityInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") searchTicketmasterEvents();
      });
    }

    initVibePills();
    initStepPills();

    if (generatePlanBtn) {
      generatePlanBtn.addEventListener("click", generatePlan);
    }
    if (editChoicesBtn) {
      editChoicesBtn.addEventListener("click", () => {
        const step2 = document.querySelector('.step-pill[data-step="2"]');
        const step3 = document.querySelector('.step-pill[data-step="3"]');
        if (step3) step3.classList.remove("open");
        if (step2) step2.classList.add("open");
        const cardVibe = document.getElementById("card-vibe");
        if (cardVibe) {
          cardVibe.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      });
    }
    if (sharePlanBtn) {
      sharePlanBtn.addEventListener("click", sharePlan);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
