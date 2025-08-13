// netlify/functions/concerto_cohere.js
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { state, candidates } = JSON.parse(event.body || "{}");

    const system = `You are Concerto, a concert-night concierge.
Return JSON ONLY with keys:
intro: string,
show: { title, venue },
diningBefore: Place[],
diningAfter: Place[],
tips: string[]
Where Place = { name, address, distance, url?, mapUrl?, price?, rating?, openNow?, blurb }
Rules:
- Only select from the provided candidates; never invent places.
- Rank 4–5 options per requested section (before/after) based on distance, rating, and the user's style/budget.
- Prefer open-late places for after-show when eatWhen != "before".
- Write a crisp, specific 1-sentence blurb for each place.
- Keep JSON compact. No markdown.`;

    const user = { state, candidates };

    const res = await fetch("https://api.cohere.ai/v2/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "command-r-plus-08-2024",
        temperature: 0.4,
        seed: 7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ]
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(()=> "");
      throw new Error(`Cohere ${res.status}: ${t}`);
    }
    const json = await res.json();
    const text = json?.message?.content?.[0]?.text || "{}";
    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: text };
  } catch (e) {
    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(fallback()) };
  }
}

function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type,Authorization"
};}

function fallback(){
  return {
    intro: "Here’s a clean plan for your concert night.",
    show: { title: "Your Show", venue: "Selected Venue" },
    diningBefore: [],
    diningAfter: [],
    tips: ["Arrive early for merch.", "Check the bag policy."]
  };
}
