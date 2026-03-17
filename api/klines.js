// api/klines.js
// Proxies Aster klines (candlestick) data.
// Query params: symbol, interval, limit

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const { symbol, interval = '1h', limit = 50 } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'symbol is required' });
  }

  try {
    const url = `https://fapi.asterdex.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url, {
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
    console.error('[klines]', err.message);
    return res.status(502).json({ error: 'Failed to reach Aster API', detail: err.message });
  }
}
