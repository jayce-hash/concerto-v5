// timeline-renderer.js — continuous schedule + extras (v7.6.0)

export function fmtTime(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const h = date.getHours(), m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h % 12) || 12);
  return `${hh}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function asDate(x) {
  // accepts Date, ISO string, millis, or object with start/startISO
  if (!x) return null;
  if (x.startISO) return new Date(x.startISO);
  if (x.start) return new Date(x.start);
  return (x instanceof Date) ? x : new Date(x);
}

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[m]));
}

export function renderSchedule(items, container, options) {
  const { before = [], after = [], extras = [], interests = {} } = options || {};
  if (!container) return;

  // Sort by time (defensive)
  const sorted = (Array.isArray(items) ? [...items] : []).sort((a, b) => {
    const da = asDate(a), db = asDate(b);
    return (da?.getTime() || 0) - (db?.getTime() || 0);
  });

  const rows = sorted.map((it) => row(it, before, after)).join("");

  // Extras block (only for selected interests)
  const extrasHtml = renderExtras(extras, interests);

  container.innerHTML = rows + extrasHtml;

  // alt toggles
  container.querySelectorAll("[data-alt-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-alt-toggle");
      const box = container.querySelector(`[data-alt="${id}"]`);
      if (!box) return;
      box.classList.toggle("open");
      btn.textContent = box.classList.contains("open") ? "Hide alternatives" : "See alternatives";
    });
  });
}

function row(it, before, after) {
  const id = Math.random().toString(36).slice(2, 8);

  const when = asDate(it);
  const time = fmtTime(when);
  const titleBits = [esc(it.title || "")];
  if (it.userChosen) titleBits.push(`<span class="muted" style="font-weight:500;">(your pick)</span>`);

  let meta = "";
  let altHtml = "";
  let note = esc(it.details || it.note || "");

  // Attach alternatives to pre-show dine / post-show rows
  if (it.type === "dine") {
    const alts = (before || []).slice(0, 6);
    altHtml = altBlock(id, alts);
    meta = linkify(alts?.[0]);
  } else if (it.type === "post") {
    const alts = (after || []).slice(0, 8);
    altHtml = altBlock(id, alts);
    meta = linkify(alts?.[0]);
  } else if (it.type === "custom") {
    meta = linkify({ mapUrl: it.mapUrl, url: it.url });
  }

  return `
    <div class="row">
      <div class="hdr">
        <span class="pin" aria-hidden="true"></span>
        <div class="time">${esc(time)}</div>
        <div class="title">${titleBits.join(" ")}</div>
      </div>
      ${meta ? `<div class="meta">${meta}</div>` : ""}
      ${note ? `<div class="note">${note}</div>` : ""}
      ${altHtml}
    </div>
  `;
}

function altBlock(id, list) {
  if (!Array.isArray(list) || !list.length) return "";
  const lis = list.map((p) => `
    <li>
      <strong>${esc(p.name || "")}</strong> — ${esc(p.address || "")}
      <div class="meta">
        ${p.distance != null ? `<span>📍 ${p.distance.toFixed ? p.distance.toFixed(1) : p.distance} mi</span>` : ""}
        ${typeof p.rating === "number" ? `<span>★ ${p.rating.toFixed(1)}</span>` : ""}
        ${p.price ? `<span>${esc(p.price)}</span>` : ""}
        ${p.mapUrl ? `<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>` : ""}
        ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Website</a>` : ""}
      </div>
      ${p.blurb ? `<div class="blurb">${esc(p.blurb)}</div>` : ""}
    </li>
  `).join("");

  return `
    <div class="alt" data-alt="${id}">
      <h5>Alternatives</h5>
      <ul>${lis}</ul>
    </div>
    <div class="link-alt" data-alt-toggle="${id}">See alternatives</div>
  `;
}

function linkify(p) {
  if (!p) return "";
  const parts = [];
  if (p.mapUrl) parts.push(`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`);
  if (p.url) parts.push(`<a href="${p.url}" target="_blank" rel="noopener">Website</a>`);
  if (typeof p.rating === "number") parts.push(`<span>★ ${p.rating.toFixed(1)}</span>`);
  if (p.price) parts.push(`<span>${esc(p.price)}</span>`);
  if (p.distance != null) parts.push(`<span>📍 ${p.distance.toFixed ? p.distance.toFixed(1) : p.distance} mi</span>`);
  return parts.join(" · ");
}

/* ---------- Extras block ---------- */

function renderExtras(extras, interests) {
  if (!Array.isArray(extras) || !extras.length) return "";

  // Filter by selected interests
  const want = {
    Coffee: !!interests?.coffee,
    Drinks: !!interests?.drinks,
    Dessert: !!interests?.dessert,
    Sights: !!interests?.sights
  };

  const bySec = groupBy(extras, (x) => x.section || "Other");

  const sections = Object.entries(bySec)
    .filter(([sec]) => want[sec] === true)        // only show if the box was checked
    .map(([sec, items]) => {
      const lis = items.slice(0, 6).map((p) => `
        <li>
          <strong>${esc(p.name || "")}</strong> — ${esc(p.address || "")}
          <div class="meta">
            ${p.distance != null ? `<span>📍 ${p.distance.toFixed ? p.distance.toFixed(1) : p.distance} mi</span>` : ""}
            ${typeof p.rating === "number" ? `<span>★ ${p.rating.toFixed(1)}</span>` : ""}
            ${p.mapUrl ? `<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>` : ""}
            ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Website</a>` : ""}
          </div>
          ${p.blurb ? `<div class="blurb">${esc(p.blurb)}</div>` : ""}
        </li>
      `).join("");

      return `
        <div class="row">
          <div class="hdr">
            <span class="pin" aria-hidden="true"></span>
            <div class="time">Optional</div>
            <div class="title">${esc(sec)} near the venue</div>
          </div>
          <div class="alt open">
            <ul>${lis}</ul>
          </div>
        </div>
      `;
    }).join("");

  return sections ? `<div class="row" style="padding-top:0;"></div>${sections}` : "";
}

function groupBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x);
    (m[k] ||= []).push(x);
  }
  return m;
}
// timeline-renderer.js
export function fmtTime(d){
  const date = (d instanceof Date) ? d : new Date(d);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h>=12 ? "PM":"AM";
  const hh = ((h%12)||12);
  return `${hh}:${m.toString().padStart(2,'0')} ${ampm}`;
}
