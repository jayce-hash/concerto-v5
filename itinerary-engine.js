// itinerary-engine.js — continuous schedule with hotel/dinner/venue beats (v7.9.0)

export function fmtHM(date){
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h>=12 ? "PM":"AM";
  const hh = ((h%12)||12);
  return `${hh}:${m.toString().padStart(2,'0')} ${ampm}`;
}
function addMin(d, delta){ return new Date(d.getTime() + delta*60000); }

/**
 * Build itinerary items used by:
 *  - The vertical schedule (renderer attaches alternatives to `dine` and `post`)
 *  - The top “tour card” (looks for hotel-depart, arrive-venue, show, post-move)
 *
 * Inputs:
 * show:  { startISO, durationMin, doorsBeforeMin, title }
 * venue: { name, lat, lng }
 * hotel: { name, lat, lng } | null
 * prefs: { dine: "before"|"after"|"both", arrivalBufferMin, merch, concessions, water }
 * picks: { dinner: { name, lat, lng, url, mapUrl } | null }
 */
export async function buildItinerary({ show, venue, hotel, prefs, picks }){
  const items = [];

  const start     = new Date(show.startISO);
  const showDur   = Math.max(60, Math.abs(show.durationMin||150));
  const doorsMin  = Math.max(30, Math.abs(show.doorsBeforeMin||90));      // doors open before start
  const mustArriveBuffer = Math.max(45, Math.abs(prefs?.arrivalBufferMin ?? 45)); // enforce >= 45
  const travelPadMin     = 12; // generic “walk over / call car / buffer” to leave a prior stop

  const doorsAt   = addMin(start, -doorsMin);
  const arriveAt  = addMin(start, -mustArriveBuffer); // arrive at venue no later than this
  const showEnd   = addMin(start, showDur);

  const wantsDinnerBefore = !!(picks?.dinner) && (prefs?.dine === "before" || prefs?.dine === "both");
  const wantsAfter        = (prefs?.dine === "after" || prefs?.dine === "both");

  // -------------------------
  // Pre-show dinner (optional)
  // -------------------------
  if (wantsDinnerBefore){
    // Plan dinner so you LEAVE in time to reach the venue and still hit the 45-min min arrival.
    const dinnerDuration = 60;                            // seated hour
    const leaveForVenue  = addMin(arriveAt, -travelPadMin);
    const dinnerStart    = addMin(leaveForVenue, -dinnerDuration);

    // If staying at a hotel, add a “leave hotel” that gets you to dinner on time
    if (hotel?.name){
      const departHotel = addMin(dinnerStart, -15);       // quick buffer to get moving
      items.push({
        type: "hotel-depart",
        title: `Leave ${hotel.name}`,
        start: departHotel,
        end: dinnerStart,
        details: `Head to dinner`
      });
    }

    // Single `dine` block drives the vertical schedule’s alt list
    items.push({
      type: "dine",
      title: `Dinner: ${picks.dinner.name}`,
      start: dinnerStart,
      end: leaveForVenue,
      details: `Reserve around ${fmtHM(dinnerStart)}. Leave at ${fmtHM(leaveForVenue)}.`,
      url: picks.dinner.url || picks.dinner.mapUrl || ""
    });
  } else if (hotel?.name){
    // No dinner: if hotel present, still show a leave-hotel beat toward the venue
    const departHotel = addMin(arriveAt, -Math.max(20, travelPadMin)); // head straight to venue
    items.push({
      type: "hotel-depart",
      title: `Leave ${hotel.name}`,
      start: departHotel,
      end: arriveAt,
      details: `Head to ${venue.name}`
    });
  }

  // -------------------------
  // Venue arrival & show
  // -------------------------
  items.push({
    type: "arrive-venue",
    title: `Arrive at ${venue.name}`,
    start: arriveAt,
    end: doorsAt,
    details: `Doors at ${fmtHM(doorsAt)}. Arrive by ${fmtHM(arriveAt)} (≥ 45 min early).`
  });

  items.push({
    type: "show",
    title: show.title || "Showtime",
    start: start,
    end: showEnd,
    details: `Enjoy the show.`
  });

  // -------------------------
  // Post-show (late bite / drinks)
  // -------------------------
  if (wantsAfter){
    const departVenue = addMin(showEnd, 15);
    const postWindow  = addMin(departVenue, 90);
    // `post` drives the vertical schedule alt list, `post-move` supports the top card chip
    items.push({
      type: "post",
      title: "Dessert / Drinks nearby",
      start: departVenue,
      end: postWindow,
      details: "Late bite or a lounge close to the venue."
    });
    items.push({
      type: "post-move",
      title: "Leave venue for dessert/drinks",
      start: departVenue,
      end: postWindow,
      details: ""
    });
  }

  // Sort defensively by time (renderer expects chronological order)
  return items.sort((a,b)=> (a.start?.getTime?.() ?? new Date(a.start).getTime()) - (b.start?.getTime?.() ?? new Date(b.start).getTime()));
}
