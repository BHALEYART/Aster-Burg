// api/solana-balance.js
// Fetches USDC and USDT SPL token balances for a Solana wallet.
// Called server-side to avoid browser CORS restrictions.

const SOLANA_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];

const MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

async function getTokenBalance(rpc, address, mint) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenAccountsByOwner',
      params: [ address, { mint }, { encoding: 'jsonParsed' } ]
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const accounts = data?.result?.value || [];
  if (!accounts.length) return '0.00';
  return parseFloat(accounts[0].account.data.parsed.info.tokenAmount.uiAmount).toFixed(2);
}

async function getNativeBalance(rpc, address) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2,
      method: 'getBalance',
      params: [ address ]
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const lamports = data?.result?.value || 0;
  return (lamports / 1e9).toFixed(4);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  for (const rpc of SOLANA_RPCS) {
    try {
      const [usdc, usdt, sol] = await Promise.all([
        getTokenBalance(rpc, address, MINTS.USDC),
        getTokenBalance(rpc, address, MINTS.USDT),
        getNativeBalance(rpc, address),
      ]);
      return res.status(200).json({ usdc, usdt, sol, rpc });
    } catch (e) {
      console.warn('[solana-balance] RPC failed:', rpc, e.message);
      continue;
    }
  }

  return res.status(200).json({ usdc: '0.00', usdt: '0.00', sol: '0.0000', error: 'all RPCs failed' });
}
