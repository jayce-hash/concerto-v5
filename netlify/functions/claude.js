exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
      body: '',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const { service, ...body } = JSON.parse(event.body);

    // ── Claude ──────────────────────────────────────
    if (service === 'claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    // ── Ticketmaster ────────────────────────────────
    if (service === 'ticketmaster') {
      const { keyword, size = 10 } = body;
      const url = `https://app.ticketmaster.com/discovery/v2/events.json`
        + `?apikey=${process.env.TICKETMASTER_API_KEY}`
        + `&keyword=${encodeURIComponent(keyword)}`
        + `&size=${size}&sort=date,asc&classificationName=music`;
      const response = await fetch(url);
      const data = await response.json();
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    // ── Google Places nearby ────────────────────────
    if (service === 'places_nearby') {
      const { lat, lng, type, keyword, radius = 2000 } = body;
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
        + `?location=${lat},${lng}`
        + `&radius=${radius}`
        + `&type=${encodeURIComponent(type)}`
        + `&keyword=${encodeURIComponent(keyword)}`
        + `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    // ── Google Geocode ──────────────────────────────
    if (service === 'geocode') {
      const { address } = body;
      const url = `https://maps.googleapis.com/maps/api/geocode/json`
        + `?address=${encodeURIComponent(address)}`
        + `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown service' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
