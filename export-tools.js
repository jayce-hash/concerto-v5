// export-tools.js
export async function shareLinkOrCopy(text, url){
  try{
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(url); alert('Link copied!'); }
  }catch(e){
    try{ await navigator.clipboard.writeText(url); alert('Link copied!'); }
    catch{ prompt("Copy link:", url); }
  }
}

export function toICS(items, title='Concert Day'){
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
function fmtTime(d){
  try{
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  }catch{
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2,'0');
    const ampm = h >= 12 ? "PM":"AM";
    const hh = ((h % 12) || 12);
    return `${hh}:${m} ${ampm}`;
  }
}