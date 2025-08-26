// ticketmaster.js — Ticketmaster Discovery helpers (v1.0.0)

const TM_KEY = "oMkciJfNTvAuK1N4O1XXe49pdPEeJQuh"; // provided key

function buildUrl(path, params){
  const u = new URL(`https://app.ticketmaster.com${path}`);
  Object.entries(params || {}).forEach(([k,v])=>{
    if (v === undefined || v === null || v==="") return;
    u.searchParams.set(k, String(v));
  });
  u.searchParams.set("apikey", TM_KEY);
  return u.toString();
}

/**
 * Search Ticketmaster events by keyword (artist or venue), optional city, date range
 * @returns {Promise<Array>} normalized event summaries
 */
export async function tmSearch({ keyword, city="", size=10, startDateTime, endDateTime }){
  if (!keyword) return [];
  const url = buildUrl("/discovery/v2/events.json", {
    keyword,
    size: Math.max(1, Math.min(20, size)),
    classificationName: "music",
    city: city || undefined,
    startDateTime, // ISO8601 with Z, e.g., 2025-10-01T00:00:00Z
    endDateTime
  });

  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const list = json?._embedded?.events || [];
  return list.map(ev => normalizeEvent(ev));
}

function normalizeEvent(ev){
  const at = (ev?._embedded?.attractions || [])[0];
  const vn = (ev?._embedded?.venues || [])[0] || {};
  const dtISO = ev?.dates?.start?.dateTime || null;
  const tz = ev?.dates?.timezone || vn?.timezone || null;
  const location = vn?.location || {};
  return {
    id: ev?.id || "",
    name: ev?.name || "",
    artist: at?.name || (ev?.name || "").replace(/\s+-\s+.*$/, ""),
    venue: vn?.name || "",
    city: [vn?.city?.name, vn?.state?.stateCode].filter(Boolean).join(", "),
    address: [vn?.address?.line1, vn?.city?.name, vn?.state?.stateCode, vn?.postalCode].filter(Boolean).join(", "),
    dateTime: dtISO,         // full ISO
    timezone: tz || "",
    venueLat: location?.latitude ? Number(location.latitude) : null,
    venueLng: location?.longitude ? Number(location.longitude) : null,
  };
}
