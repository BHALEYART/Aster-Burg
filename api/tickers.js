// api/tickers.js
// Proxies the public Aster fapi ticker endpoint — no auth needed.
// Vercel runs this server-side so there are no CORS issues.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  try {
    const response = await fetch('https://fapi.asterdex.com/fapi/v1/ticker/24hr', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; aster-trader-board/1.0)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Aster API returned ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[tickers]', err.message);
    return res.status(502).json({ error: 'Failed to reach Aster API', detail: err.message });
  }
}
