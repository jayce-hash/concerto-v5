// netlify/functions/flights.js

export default async function handler(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const kind      = url.searchParams.get('kind') || 'inbound';
    const airline   = (url.searchParams.get('airline') || '').trim();
    const flightNo  = (url.searchParams.get('flightNo') || '').trim();
    const date      = (url.searchParams.get('date') || '').trim();  // format YYYY-MM-DD

    if (!airline || !flightNo || !date) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: airline, flightNo, date' }), { status: 400 });
    }

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
    if (!RAPIDAPI_KEY) {
      return new Response(JSON.stringify({ error: 'Missing RapidAPI key on server' }), { status: 500 });
    }

    const apiUrl = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(airline + flightNo)}/${date}T00:00/${date}T23:59`;

    const resp = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
      }
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: `AeroDataBox error ${resp.status}`, details: txt }), { status: 502 });
    }

    const data = await resp.json();

    // Normalize results
    const out = (data || []).map(f => {
      const departure = f.departure || {};
      const arrival   = f.arrival   || {};
      const op        = f.airline   || {};  // operator
      const num       = f.number     || `${airline}${flightNo}`;

      const depIATA = departure.iata || departure.airport?.iata;
      const arrIATA = arrival.iata   || arrival.airport?.iata;

      const depLat = departure.airport?.location?.lat ?? null;
      const depLng = departure.airport?.location?.lon ?? null;
      const arrLat = arrival.airport?.location?.lat ?? null;
      const arrLng = arrival.airport?.location?.lon ?? null;

      const depTime = departure.scheduledTimeLocal || departure.scheduledTimeUtc || departure.scheduledTime;
      const arrTime = arrival.scheduledTimeLocal   || arrival.scheduledTimeUtc   || arrival.scheduledTime;

      return {
        airline: (op.name || airline),
        flightNo: String(num).trim(),
        depISO: depTime || null,
        arrISO: arrTime || null,
        depIATA, arrIATA, depLat, depLng, arrLat, arrLng,
        summary: `${op.name || airline} ${num} — ${depIATA || 'TBA'} → ${arrIATA || 'TBA'}`
      };
    });

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), { status: 500 });
  }
}
