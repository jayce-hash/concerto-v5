// itinerary-engine.js
export function minutes(n){ return n*60*1000; }
export function add(t, ms){ return new Date(t.getTime()+ms); }
export function fmtTime(d){
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
function haversineMinutes(a, b, mph=22){
  const R = 3959, toRad = d=>d*Math.PI/180;
  const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  const miles = 2*R*Math.asin(Math.sqrt(s));
  const min = (miles/Math.max(3, mph))*60;
  return Math.max(4, Math.round(min));
}
async function travelMinutes({ from, to, mode='driving' }){
  try{
    if (window.google?.maps?.DistanceMatrixService){
      const svc = new google.maps.DistanceMatrixService();
      const res = await new Promise((resolve,reject)=>{
        svc.getDistanceMatrix({
          origins: [new google.maps.LatLng(from.lat, from.lng)],
          destinations: [new google.maps.LatLng(to.lat, to.lng)],
          travelMode: mode === 'walking' ? 'WALKING' : 'DRIVING'
        }, (out, status)=>{
          if (status === 'OK' && out?.rows?.[0]?.elements?.[0]?.duration){
            resolve(out.rows[0].elements[0].duration.value/60);
          } else resolve(null);
        });
      });
      if (typeof res === 'number' && isFinite(res)) return Math.max(4, Math.round(res));
    }
  }catch{}
  return haversineMinutes(from, to, mode === 'walking' ? 3 : 22);
}

export async function buildItinerary(cfg){
  const travelFn = cfg.travelFn || travelMinutes;
  const showStart = new Date(cfg.show.startISO);
  const showEnd = add(showStart, minutes(cfg.show.durationMin ?? 150));
  const doorsOpen = add(showStart, -minutes(cfg.show.doorsBeforeMin ?? 90));
  const items = [];
  function push(type, title, start, end, details, url){ items.push({ type, title, start, end, details, url }); }
  function noteAt(time, title, details){ items.push({ type:'note', title, start: time, end: time, details }); }

  const arriveBy = add(showStart, -minutes(Math.max(30, cfg.prefs.arrivalBufferMin ?? 45)));

  const preBlocks = [];
  if (cfg.prefs.dine === 'before' || cfg.prefs.dine === 'both'){
    if (cfg.picks.dinner) preBlocks.push({ label:'Dinner', mins: 75, pick: cfg.picks.dinner });
    if (cfg.picks.drinks) preBlocks.push({ label:'Drinks', mins: 45, pick: cfg.picks.drinks });
    if (cfg.picks.coffee) preBlocks.push({ label:'Coffee', mins: 25, pick: cfg.picks.coffee });
  }

  for (let i = preBlocks.length-1; i >= 0; i--){
    const b = preBlocks[i];
    const toVenue = await travelFn({ from:{lat:b.pick.lat,lng:b.pick.lng}, to:{lat:cfg.venue.lat,lng:cfg.venue.lng}, mode:'driving' });
    const total = b.mins + toVenue + 10;
    const startBlock = add(arriveBy, -minutes(total));

    if (cfg.hotel){
      const toBlock = await travelFn({ from: cfg.hotel, to:{lat:b.pick.lat,lng:b.pick.lng}, mode:'driving' });
      const legStart = add(startBlock, -minutes(toBlock+6));
      push('travel', `To ${b.pick.name}`, legStart, add(legStart, minutes(toBlock+6)), `~${toBlock} min`, b.pick.url || b.pick.mapUrl);
    }

    push('activity', `${b.label} at ${b.pick.name}`, startBlock, add(startBlock, minutes(b.mins)), b.pick.note || '', b.pick.url || b.pick.mapUrl);

    const legStart2 = add(startBlock, minutes(b.mins));
    push('travel', `To ${cfg.venue.name}`, legStart2, add(legStart2, minutes(toVenue+6)), `~${toVenue} min`, cfg.venue.url || '');
  }

  if (!preBlocks.length && cfg.hotel){
    const toVenue = await travelFn({ from: cfg.hotel, to: cfg.venue, mode:'driving' });
    const legStart = add(arriveBy, -minutes(toVenue+8));
    push('travel', `To ${cfg.venue.name}`, legStart, add(legStart, minutes(toVenue+8)), `~${toVenue} min`, cfg.venue.url || '');
  }

  noteAt(doorsOpen, 'Doors Open', fmtTime(doorsOpen));
  if (cfg.prefs.merch)  push('activity','Merch Hunt', add(doorsOpen, 0), add(doorsOpen, minutes(20)), 'Main lobby stand recommended');
  if (cfg.prefs.concessions) push('activity','Concessions', add(doorsOpen, minutes(20)), add(doorsOpen, minutes(35)), 'Grab a drink/snack');
  if (cfg.prefs.water) push('activity','Hydration', add(doorsOpen, minutes(35)), add(doorsOpen, minutes(40)), 'Refill water bottle');

  push('anchor','Showtime', showStart, showEnd, `Enjoy the show at ${cfg.venue.name}`);

  if (cfg.prefs.dine === 'after' || cfg.prefs.dine === 'both'){
    const target = cfg.picks.dinner || cfg.picks.drinks || cfg.picks.coffee;
    if (target){
      const toSpot = await travelFn({ from: cfg.venue, to: target, mode:'driving' });
      const outStart = add(showEnd, minutes(8));
      push('travel', `To ${target.name}`, outStart, add(outStart, minutes(toSpot+6)), `~${toSpot} min`, target.url || target.mapUrl);
      push('activity', `Post-Show at ${target.name}`, add(outStart, minutes(toSpot+6)), add(outStart, minutes(toSpot+6 + (cfg.picks.dinner?70:(cfg.picks.drinks?45:25)))), target.note || '', target.url || target.mapUrl);
    }
  }

  if (cfg.hotel){
    const toHotel = await travelFn({ from: cfg.venue, to: cfg.hotel, mode:'driving' });
    const leave = add(showEnd, minutes(6));
    push('travel','Return to Hotel', leave, add(leave, minutes(toHotel+6)), `~${toHotel} min`);
  }

  return items.sort((a,b)=>a.start-b.start);
}