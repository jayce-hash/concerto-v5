// timeline-renderer.js — continuous schedule with aligned header + alternatives (v7.5.1)
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

  // toggle handlers
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
  let note = esc(it.details||it.note||"");

  if (it.type === "dine"){
    const alts = before.slice(0,6);
    altHtml = altBlock(id, alts);
    meta = linkify(alts?.[0]); // show primary dinner’s links
    title = `Dinner: ${title}`;
  } else if (it.type === "post"){
    const alts = after.slice(0,8);
    altHtml = altBlock(id, alts);
    title = "Post-show";
    meta = linkify(alts?.[0]);
  } else if (it.type === "custom" && it.userChosen){
    // badge
    note = (note ? note + " " : "") + "";
  }

  return `
    <div class="row">
      <div class="hdr" style="display:flex; align-items:center; gap:.6rem;">
        <span class="pin" aria-hidden="true"></span>
        <div class="time">${fmtTime(it.startISO || it.start)}</div>
        <div class="title">${title}${it.userChosen ? ` <span class="pill" style="padding:.25rem .55rem; font-size:.9rem; margin-left:.4rem;">You chose this</span>` : ""}</div>
      </div>
      ${meta?`<div class="meta" style="margin-top:.25rem;">${meta}</div>`:""}
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
