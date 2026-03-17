// api/leaderboard.js
// Proxies the real Aster leaderboard endpoint discovered via DevTools:
// POST https://www.asterdex.com/bapi/futures/v1/public/campaign/trade/pro/leaderboard
//
// Payload params:
//   period  : "d1" | "d7" | "d30"  (maps from our 1h/1d/1w/1m timeframe)
//   sort    : "pnl_rank" | "roi_rank"
//   order   : "asc"
//   page    : 1
//   rows    : 10
//   symbol  : ""
//   address : ""

const LEADERBOARD_URL = 'https://www.asterdex.com/bapi/futures/v1/public/campaign/trade/pro/leaderboard';

// Map our UI timeframes to Aster's period param
// Note: Aster only supports d1 / d7 / d30 — 1h falls back to d1
const TF_TO_PERIOD = {
  '1h': 'd1',
  '1d': 'd1',
  '1w': 'd7',
  '1m': 'd30',
};

function simulatedLeaderboard() {
  return [
    { rank: 1,  nickName: '0x7f3a...c892', pnl: 184250, roi: 284.3, tradeCount: 41, winRate: 82.9 },
    { rank: 2,  nickName: '0xd9b1...3fe7', pnl:  97830, roi: 193.7, tradeCount: 35, winRate: 80.0 },
    { rank: 3,  nickName: 'apexBull.eth',  pnl:  76400, roi: 161.2, tradeCount: 29, winRate: 75.9 },
    { rank: 4,  nickName: '0x44cc...a1b0', pnl:  61200, roi: 143.8, tradeCount: 25, winRate: 76.0 },
    { rank: 5,  nickName: 'defiwhale01',   pnl:  54700, roi:  98.4, tradeCount: 52, winRate: 78.8 },
    { rank: 6,  nickName: '0x9ef0...22d4', pnl:  43100, roi:  87.1, tradeCount: 22, winRate: 77.3 },
    { rank: 7,  nickName: '0xb77a...dd91', pnl:  38600, roi:  74.5, tradeCount: 20, winRate: 75.0 },
    { rank: 8,  nickName: 'perp_king99',   pnl:  31450, roi:  66.2, tradeCount: 18, winRate: 72.2 },
    { rank: 9,  nickName: '0x50f2...1a3c', pnl:  24800, roi:  54.8, tradeCount: 16, winRate: 68.8 },
    { rank: 10, nickName: '0x1d88...9c06', pnl:  19300, roi:  44.1, tradeCount: 14, winRate: 64.3 },
  ];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const { period = '1d', sort = 'pnl_rank' } = req.query;
  const asterPeriod = TF_TO_PERIOD[period] || 'd1';

  const payload = {
    period:  asterPeriod,
    sort:    sort,
    order:   'asc',
    page:    1,
    rows:    10,
    symbol:  '',
    address: '',
  };

  try {
    const response = await fetch(LEADERBOARD_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Origin':        'https://www.asterdex.com',
        'Referer':       'https://www.asterdex.com/en/trading-leaderboard',
        'User-Agent':    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Aster returned HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log("[leaderboard] raw response:", JSON.stringify(data).slice(0, 500));

    // Aster wraps data in { code, message, data: { list: [...] } }
    // Normalise to a flat array so the frontend doesn't need to know the shape
    const rows = data?.data?.list ?? data?.data ?? data?.rows ?? data ?? [];

    return res.status(200).json({
      source: 'live',
      period: asterPeriod,
      data:   Array.isArray(rows) ? rows : [],
    });

  } catch (err) {
    console.error('[leaderboard] fetch failed:', err.message);

    // Fallback to simulated so the UI never breaks
    return res.status(200).json({
      source: 'simulated',
      error:  err.message,
      data:   simulatedLeaderboard(),
    });
  }
}
