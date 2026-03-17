// api/solana-balance.js
// Proxies Solana RPC calls server-side to avoid CORS issues in the browser.
// Used to fetch SPL token (USDT) balance for a given wallet address.

const SOLANA_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'getTokenAccountsByOwner',
    params: [ address, { mint: USDT_MINT }, { encoding: 'jsonParsed' } ]
  });

  for (const rpc of SOLANA_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!r.ok) continue;
      const data = await r.json();
      const accounts = data?.result?.value || [];
      const balance  = accounts.length
        ? parseFloat(accounts[0].account.data.parsed.info.tokenAmount.uiAmount).toFixed(2)
        : '0.00';
      return res.status(200).json({ balance, rpc });
    } catch (_) { continue; }
  }

  return res.status(200).json({ balance: '0.00', error: 'all RPCs failed' });
}
