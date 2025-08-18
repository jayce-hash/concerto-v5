// export-tools.js — share & ICS (v7.3.0)
export async function shareLinkOrCopy(title, url){
  try{
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      alert("Link copied!");
    }
  }catch{
    try{ await navigator.clipboard.writeText(url); alert("Link copied!"); } catch{ prompt("Copy link:", url); }
  }
}

export function toICS(items, calName="Concerto+ Itinerary"){
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ConcertoPlus//EN",
    `X-WR-CALNAME:${calName}`
  ];
  const dt = (d)=> {
    const pad = (n)=> String(n).padStart(2,"0");
    const y=d.getFullYear(), m=pad(d.getMonth()+1), da=pad(d.getDate());
    const h=pad(d.getHours()), mi=pad(d.getMinutes());
    return `${y}${m}${da}T${h}${mi}00`;
  };
  items.forEach((it, i)=>{
    const start = (it.start instanceof Date) ? it.start : new Date(it.start);
    const end = (it.end instanceof Date) ? it.end : new Date(it.end);
    const uid = `concerto-${i}-${Date.now()}@concerto.plus`;
    const title = it.title || "Itinerary Item";
    const desc = (it.details||"").replace(/[\r\n]+/g, " ");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${dt(start)}`);
    lines.push(`DTEND:${dt(end)}`);
    lines.push(`SUMMARY:${title}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  return blob;
}
