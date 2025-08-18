// timeline-renderer.js — renders continuous schedule with alternatives (v7.3.0)
export function fmtTime(d){
  const date = (d instanceof Date) ? d : new Date(d);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h>=12 ? "PM":"AM";
  const hh = ((h%12)||12);
  return `${hh}:${m.toString().padStart(2,'0')} ${ampm}`;
}

function esc(s){ return (s || "").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

export function renderSchedule(items, container, options){
  const { before=[], after=[] } = options || {};
  container.innerHTML = items.map(it => row(it, before, after)).join("");

  // hook up open/close toggles
  container.querySelectorAll('[data-alt-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-alt-toggle');
      const box = container.querySelector(`[data-alt="${id}"]`);
      if (!box) return;
      box.classList.toggle('open');
      btn.textContent = box.classList.contains('open') ? "Hide alternatives" : "See alternatives";
    });
  });
}

function row(it, before, after){
  const id = Math.random().toString(36).slice(2,8);
  let meta = "";
  let altHtml = "";
  let title = esc(it.title);
  let note = esc(it.details||"");

  if (it.type === "dine"){
    const alts = before.slice(0,6);
    altHtml = altBlock(id, alts);
    meta = linkify(alts?.[0]);
  } else if (it.type === "post"){
    const alts = after.slice(0,8);
    altHtml = altBlock(id, alts);
    title = "Post-show: late bite / drinks";
    meta = linkify(alts?.[0]);
  }

  return `
    <div class="row">
      <span class="pin" aria-hidden="true"></span>
      <div class="time">${fmtTime(it.start)}</div>
      <div class="title">${title}</div>
      ${meta?`<div class="meta">${meta}</div>`:""}
      ${note?`<div class="note">${note}</div>`:""}
      ${altHtml}
    </div>
  `;
}

function altBlock(id, list){
  if (!Array.isArray(list) || !list.length) return "";
  const lis = list.map(p => `
    <li>
      <strong>${esc(p.name||"")}</strong> — ${esc(p.address||"")}
      <div class="meta">
        ${p.distance!=null?`<span>📍 ${p.distance.toFixed ? p.distance.toFixed(1) : p.distance} mi</span>`:""}
        ${typeof p.rating==="number"?`<span>★ ${p.rating.toFixed(1)}</span>`:""}
        ${p.price?`<span>${esc(p.price)}</span>`:""}
        ${p.mapUrl?`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`:""}
        ${p.url?`<a href="${p.url}" target="_blank" rel="noopener">Website</a>`:""}
      </div>
      ${p.blurb?`<div class="blurb">${esc(p.blurb)}</div>`:""}
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

function linkify(p){
  if (!p) return "";
  const parts = [];
  if (p.mapUrl) parts.push(`<a href="${p.mapUrl}" target="_blank" rel="noopener">Map</a>`);
  if (p.url) parts.push(`<a href="${p.url}" target="_blank" rel="noopener">Website</a>`);
  if (typeof p.rating === "number") parts.push(`<span>★ ${p.rating.toFixed(1)}</span>`);
  if (p.price) parts.push(`<span>${esc(p.price)}</span>`);
  if (p.distance!=null) parts.push(`<span>📍 ${p.distance.toFixed ? p.distance.toFixed(1) : p.distance} mi</span>`);
  return parts.join(" · ");
}
