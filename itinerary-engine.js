// itinerary-engine.js — builds a continuous schedule array (v7.3.0)
export function fmtHM(date){
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h>=12 ? "PM":"AM";
  const hh = ((h%12)||12);
  return `${hh}:${m.toString().padStart(2,'0')} ${ampm}`;
}
function addMin(d, delta){ return new Date(d.getTime() + delta*60000); }

export async function buildItinerary({ show, venue, hotel, prefs, picks }){
  // Inputs:
  // show: { startISO, durationMin, doorsBeforeMin, title }
  // prefs: { dine: "before"|"after"|"both", arrivalBufferMin, merch, concessions, water }
  // picks: { dinner: { name, lat, lng, url, mapUrl } | null }

  const items = [];
  const start = new Date(show.startISO);
  const doors = addMin(start, -Math.abs(show.doorsBeforeMin||90));
  const arrive = addMin(doors, -Math.abs(prefs.arrivalBufferMin||45));
  const end = addMin(start, Math.abs(show.durationMin||150));

  // Pre-show dinner block (optional)
  if (picks?.dinner && (prefs.dine==="before" || prefs.dine==="both")){
    items.push({
      type:"dine", title:`Dinner: ${picks.dinner.name}`, start:addMin(start,-90), end:addMin(start,-10),
      details:`Reserve around ${fmtHM(addMin(start,-90))}.`, link:picks.dinner.url || picks.dinner.mapUrl || ""
    });
  }

  // Arrivals
  items.push({ type:"arrive", title:`Arrive at ${venue.name}`, start: arrive, end: doors, details:`Doors at ${fmtHM(doors)}.` });

  // Show
  items.push({ type:"show", title: show.title || "Showtime", start: start, end: end, details:`Enjoy the show.` });

  // Post-show suggestions (slots only; actual places displayed inline by renderer)
  if (prefs.dine==="after" || prefs.dine==="both"){
    items.push({ type:"post", title:"Post-show", start: addMin(start, 45), end: addMin(start, 130), details:"Late bite / drinks nearby." });
  }

  return items.sort((a,b)=> a.start - b.start);
}
