// timeline-renderer.js — continuous schedule with alternatives + extras + chosen badge (v7.4.1)

export function fmtTime(d){
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return "";
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h>=12 ? "PM":"AM";
  const hh = ((h%12)||12);
  return `${hh}:${m.toString().padStart(2,'0')} ${ampm}`;
}

function esc(s){ return (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function safeNum(n){ return (typeof n === "number" && isFinite(n)) ? n : null; }
function timeOf(it){ return it?.start ?? it?.startISO ?? it?.startIso ?? it?.startUtc ?? null; }

export function renderSchedule(items, container, options={}){
  const { before=[], after=[], extras=[] } = options;

  // sort defensively by time if not already
  const sorted = Array.isArray(items) ? items.slice().sort((a,b)=>{
    const ta = new Date(timeOf(a)).getTime() || 0;
    const tb = new Date(timeOf(b)).getTime() || 0;
    return ta - tb;
  }) : [];

  const rows = sorted.map(it => row(it, before, after)).join("");

  // Extras block (grouped by section)
  const extrasHtml = buildExtras(extras);

  container.innerHTML = rows + extrasHtml;

  // hook up open/close toggles
  container.querySelectorAll('[data-alt-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-alt-toggle');
      const box = container.querySelector(`[data-alt="${id}"]`);
      if (!box) return;
      const open = box.classList.toggle('open');
      btn.textContent = open ? "Hide alternatives" : "See alternatives";
    });
  });
}

function row(it, before, after){
  const id = Math.random().toString(36).slice(2,8);

  // base fields
  const t = timeOf(it);
  const timeLabel = t ? fmtTime(t) : "";
  const title = esc(it?.title || "");
  const note  = esc(it?.note || it?.details || "");

  // chosen badge
  const chosenBadge = it?.userChosen ? `<span class="badge-chosen">You chose this</span>` : "";

  // meta & alternatives logic
  let meta = "";
  let altHtml = "";

  if (it?.type === "dine"){
    const alts = Array.isArray(before) ? before.slice(0,6) : [];
    altHtml = altBlock(id, alts, "Alternatives");
    meta = linkify(alts?.[0]);
  } else if (it?.type === "post"){
    const alts = Array.isArray(after) ? after.slice(0,8) : [];
    altHtml = altBlock(id, alts, "Late-night options");
    // keep original title override if needed
    // meta: point to the top curated option
    meta = linkify(alts?.[0]);
  } else if (it?.type === "custom"){
    // custom stops: show links if present
    meta = linkify({ mapUrl: it.mapUrl, url: it.url });
  }

  return `
    <div class="row">
      <span class="pin" aria-hidden="true"></span>
      <div class="time">${timeLabel}</div>
      <div class="title">${title} ${chosenBadge}</div>
      ${meta?`<div class="meta">${meta}</div>`:""}
      ${note?`<div class="note">${note}</div>`:""}
      ${altHtml}
    </div>
  `;
}

function altBlock(id, list, label="Alternatives"){
  if (!Array.isArray(list) || !list.length) return "";
  const lis = list.map(p => {
    const dist = (p && safeNum(p.distance) != null)
      ? (p.distance.toFixed ? p.distance.toFixed(1) : p.distance)
      : null;
    const rating = safeNum(p?.rating);
    return `
      <li>
        <strong>${esc(p?.name||"")}</strong> — ${esc(p?.address||"")}
        <div class="meta">
          ${dist!=null?`<span>📍 ${dist} mi</span>`:""}
          ${rating!=null?`<span>★ ${rating.toFixed(1)}</span>`:""}
          ${p?.price?`<span>${esc(p.price)}</span>`:""}
          ${p?.mapUrl?`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`:""}
          ${p?.url?`<a href="${p.url}" target="_blank" rel="noopener">Website</a>`:""}
        </div>
        ${p?.blurb?`<div class="blurb">${esc(p.blurb)}</div>`:""}
      </li>
    `;
  }).join("");

  return `
    <div class="alt" data-alt="${id}">
      <h5>${esc(label)}</h5>
      <ul>${lis}</ul>
    </div>
    <div class="link-alt" data-alt-toggle="${id}">See alternatives</div>
  `;
}

function linkify(p){
  if (!p) return "";
  const parts = [];
  if (p.mapUrl) parts.push(`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`);
  if (p.url) parts.push(`<a href="${p.url}" target="_blank" rel="noopener">Website</a>`);
  const rating = safeNum(p.rating);
  if (rating!=null) parts.push(`<span>★ ${rating.toFixed(1)}</span>`);
  if (p.price) parts.push(`<span>${esc(p.price)}</span>`);
  const dist = safeNum(p.distance);
  if (dist!=null) parts.push(`<span>📍 ${(dist.toFixed ? dist.toFixed(1) : dist)} mi</span>`);
  return parts.join(" · ");
}

// ----- Extras: grouped by section (Coffee / Drinks / Dessert / Sights)
function buildExtras(extras){
  if (!Array.isArray(extras) || !extras.length) return "";
  const bySec = {};
  extras.forEach(x => {
    const sec = x?.section || "Nearby";
    (bySec[sec] ||= []).push(x);
  });

  let html = `
    <div class="row">
      <span class="pin" aria-hidden="true"></span>
      <div class="time"></div>
      <div class="title">Optional extras nearby</div>
      <div class="note muted" style="margin-top:6px;">Shortlist of nearby picks based on your interests.</div>
    </div>
  `;

  Object.entries(bySec).forEach(([sec, list])=>{
    html += `
      <div class="alt open">
        <h5>${esc(sec)}</h5>
        <ul>
          ${list.slice(0,4).map(p=>{
            const dist = safeNum(p?.distance);
            const rating = safeNum(p?.rating);
            return `
              <li>
                <strong>${esc(p?.name||"")}</strong> — ${esc(p?.address||"")}
                <div class="meta">
                  ${p?.mapUrl?`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`:""}
                  ${p?.url?` · <a href="${p.url}" target="_blank" rel="noopener">Website</a>`:""}
                  ${rating!=null?` · ★ ${rating.toFixed(1)}`:""}
                  ${dist!=null?` · ${dist.toFixed ? dist.toFixed(1) : dist} mi`:""}
                </div>
              </li>
            `;
          }).join("")}
        </ul>
      </div>
    `;
  });

  return html;
}
