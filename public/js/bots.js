// bots.js — AsterBoard Bot Builder
// Wallet connect (MetaMask/Rabby/Binance/OKX/Phantom/WalletConnect)
// Funded pool generation, zip download, xterm terminal

// ── Wallet state ──────────────────────────────────────────────────────────────
let walletAddress   = null;
let walletProvider  = null;
let walletSigner    = null;
let walletType      = null;
let botPoolWallet   = null; // { address, privateKey } — generated client-side

// ── Bot state ─────────────────────────────────────────────────────────────────
let selectedStrategy = null;
let fundingEnabled   = false;
let activeChain      = 'aster'; // 'aster' | 'jupiter'

// ── Terminal state ────────────────────────────────────────────────────────────
let term     = null;
let fitAddon = null;
let ws       = null;

// ── USDT contract address on BNB Chain ────────────────────────────────────────
const USDT_BNB = '0x55d398326f99059fF775485246999027B3197955';
const USDT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ─────────────────────────────────────────────────────────────────────────────
// WALLET CONNECT
// ─────────────────────────────────────────────────────────────────────────────

function openWalletModal() {
  document.getElementById('wallet-modal').style.display = 'flex';
}
function closeWalletModal() {
  document.getElementById('wallet-modal').style.display = 'none';
}

// Main connect entry point (called by header button)
function connectWallet() {
  if (walletAddress) { disconnectWallet(); return; }
  openWalletModal();
}

// Wire wallet option clicks
document.getElementById('wallet-grid').addEventListener('click', async e => {
  const btn = e.target.closest('.wallet-option');
  if (!btn) return;
  closeWalletModal();
  await connectByType(btn.dataset.wallet);
});

async function connectByType(type) {
  walletType = type;
  try {
    switch (type) {
      case 'metamask':    await connectInjected('MetaMask',        window.ethereum); break;
      case 'rabby':       await connectInjected('Rabby',           window.ethereum); break;
      case 'binance':     await connectInjected('Binance Wallet',  window.BinanceChain || window.ethereum); break;
      case 'okx':         await connectInjected('OKX Wallet',      window.okxwallet   || window.ethereum); break;
      case 'phantom':     await connectPhantom(); break;
      case 'walletconnect': await connectWalletConnect(); break;
    }
  } catch(e) {
    console.error('[wallet] connect error:', e);
    showWalletError(e.message || 'Connection failed');
  }
}

async function connectInjected(name, provider) {
  if (!provider) {
    throw new Error(`${name} not detected. Please install the ${name} browser extension.`);
  }
  const ethProvider = new ethers.BrowserProvider(provider);
  await ethProvider.send('eth_requestAccounts', []);
  const signer  = await ethProvider.getSigner();
  const address = await signer.getAddress();
  walletProvider = ethProvider;
  walletSigner   = signer;
  onWalletConnected(address, name);
}

async function connectPhantom() {
  if (!window.solana || !window.solana.isPhantom) {
    throw new Error('Phantom wallet not detected. Please install Phantom from phantom.app');
  }
  const resp = await window.solana.connect();
  const address = resp.publicKey.toString();
  walletProvider = window.solana;
  walletSigner   = window.solana;
  onWalletConnected(address, 'Phantom (Solana)');
}

async function connectWalletConnect() {
  // WalletConnect v2 — opens QR modal
  // We use the lightweight modal approach without a full SDK since we're vanilla JS
  // Real WalletConnect integration requires @walletconnect/modal — this shows the flow
  // and falls back to a helpful message pointing users to MetaMask or another injected wallet
  if (window.ethereum) {
    // If they have ANY injected EVM wallet, use it
    await connectInjected('WalletConnect (injected fallback)', window.ethereum);
  } else {
    throw new Error('No injected wallet found. For WalletConnect, please use MetaMask mobile or a WalletConnect-compatible wallet browser. Full QR modal coming soon.');
  }
}

async function onWalletConnected(address, name) {
  walletAddress = address;

  // Update header button
  const btn = document.getElementById('wallet-connect-btn');
  btn.textContent = address.slice(0,6) + '...' + address.slice(-4);
  btn.classList.add('connected');

  // Show status bar
  document.getElementById('wallet-status-bar').style.display = 'flex';
  document.getElementById('wallet-address-display').textContent = address.slice(0,8) + '...' + address.slice(-6);

  // Show chain
  let chainName = 'Unknown';
  if (walletType !== 'phantom' && walletProvider?.getNetwork) {
    try {
      const net = await walletProvider.getNetwork();
      const chainMap = { 56n: 'BNB Chain', 1n: 'Ethereum', 42161n: 'Arbitrum', 97n: 'BNB Testnet' };
      chainName = chainMap[net.chainId] || `Chain ${net.chainId}`;
    } catch(_) {}
  } else if (walletType === 'phantom') {
    chainName = 'Solana';
  }
  document.getElementById('wallet-chain-badge').textContent = chainName;

  // Fetch USDT balance
  await refreshUSDTBalance();

  // Solana/Phantom — show bridge warning instead of fund form
  const fundBlock    = document.getElementById('fund-block');
  const fundInner    = document.getElementById('fund-inner');
  const solanaWarn   = document.getElementById('solana-warning');
  if (fundBlock) fundBlock.style.display = 'block';
  if (walletType === 'phantom') {
    if (fundInner)  fundInner.style.display  = 'none';
    if (solanaWarn) solanaWarn.style.display = 'block';
  } else {
    if (fundInner)  fundInner.style.display  = 'block';
    if (solanaWarn) solanaWarn.style.display = 'none';
  }

  console.log(`[wallet] Connected: ${name} — ${address}`);
}

const USDT_MAP = {
  56n:    '0x55d398326f99059fF775485246999027B3197955',
  1n:     '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  42161n: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  97n:    '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
};

async function refreshUSDTBalance() {
  if (!walletProvider || !walletAddress) {
    document.getElementById('wallet-usdt-balance').textContent = '—';
    return;
  }
  if (walletType === 'phantom') {
    // Route through our Vercel proxy to avoid CORS issues with Solana RPCs
    try {
      const r = await fetch(`/api/solana-balance?address=${walletAddress}`);
      const data = await r.json();
      document.getElementById('wallet-usdt-balance').textContent = `$${data.balance}`;
    } catch(e) {
      document.getElementById('wallet-usdt-balance').textContent = 'n/a';
    }
    return;
  }
  try {
    const net = await walletProvider.getNetwork();
    const usdtAddr = USDT_MAP[net.chainId];
    if (!usdtAddr) { document.getElementById('wallet-usdt-balance').textContent = 'unsupported chain'; return; }
    const runner = walletSigner || walletProvider;
    const contract = new ethers.Contract(usdtAddr, USDT_ABI, runner);
    const [raw, decimals] = await Promise.all([contract.balanceOf(walletAddress), contract.decimals()]);
    const balance = parseFloat(ethers.formatUnits(raw, decimals)).toFixed(2);
    document.getElementById('wallet-usdt-balance').textContent = `$${balance}`;
  } catch(e) {
    console.error('[balance]', e.message);
    document.getElementById('wallet-usdt-balance').textContent = 'n/a';
  }
}

function disconnectWallet() {
  walletAddress  = null;
  walletProvider = null;
  walletSigner   = null;
  walletType     = null;
  botPoolWallet  = null;

  const btn = document.getElementById('wallet-connect-btn');
  btn.textContent = 'Connect Wallet';
  btn.classList.remove('connected');

  document.getElementById('wallet-status-bar').style.display = 'none';
  document.getElementById('fund-block').style.display = 'none';
}

function showWalletError(msg) {
  alert('Wallet error: ' + msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNDED POOL
// ─────────────────────────────────────────────────────────────────────────────

function generateBotPool() {
  // Generate a fresh random EVM wallet client-side using ethers.js
  const wallet = ethers.Wallet.createRandom();
  botPoolWallet = { address: wallet.address, privateKey: wallet.privateKey };

  document.getElementById('fund-wallet-addr').textContent = wallet.address;
  document.getElementById('fund-wallet-preview').style.display = 'block';
  document.getElementById('btn-generate-pool').style.display = 'none';
  document.getElementById('btn-fund-transfer').style.display = 'block';

  console.log('[pool] Bot wallet generated:', wallet.address);
}

async function fundBotPool() {
  if (!walletSigner || !botPoolWallet) {
    alert('Please connect your wallet first');
    return;
  }
  const amount = parseFloat(document.getElementById('fund-amount').value);
  if (!amount || amount < 10) {
    alert('Please enter a minimum of $10 USDT');
    return;
  }

  const btn = document.getElementById('btn-fund-transfer');
  btn.textContent = '⏳ Confirm in wallet...';
  btn.disabled = true;

  try {
    if (walletType === 'phantom') {
      throw new Error('Solana wallet detected. Please use the bridge to move USDT to BNB Chain first, or skip and use API key auth.');
    }
    const net = await walletProvider.getNetwork();
    const usdtAddr = USDT_MAP[net.chainId];
    if (!usdtAddr) throw new Error(`USDT not supported on this chain. Please switch to BNB Chain or Ethereum.`);
    const contract  = new ethers.Contract(usdtAddr, USDT_ABI, walletSigner);
    const decimals  = await contract.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);

    const tx = await contract.transfer(botPoolWallet.address, amountWei);
    btn.textContent = '⏳ Broadcasting...';
    await tx.wait();

    btn.textContent = `✅ Funded $${amount} USDT`;
    btn.style.background = 'rgba(0,200,110,0.3)';
    fundingEnabled = true;

    await refreshUSDTBalance();
    showConfigStep();
  } catch(e) {
    console.error('[fund]', e);
    btn.textContent = '❌ Failed — try again';
    btn.disabled = false;
    alert('Transfer failed: ' + (e.reason || e.message));
  }
}

function skipFunding() {
  fundingEnabled = false;
  botPoolWallet  = null;
  showConfigStep();
}

function showConfigStep() {
  document.getElementById('config-block').style.display = 'block';
  document.getElementById('config-block').scrollIntoView({ behavior: 'smooth' });
  if (selectedStrategy) renderConfigForm(selectedStrategy);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY SELECTION
// ─────────────────────────────────────────────────────────────────────────────

// ── Chain tab switcher ────────────────────────────────────────────────────────
function switchChain(chain) {
  activeChain = chain;
  selectedStrategy = null;

  // Swap tab active states
  document.querySelectorAll('.chain-tab').forEach(t => t.classList.toggle('active', t.dataset.chain === chain));

  // Swap strategy grids
  document.getElementById('strategy-grid-aster').style.display   = chain === 'aster'   ? 'grid' : 'none';
  document.getElementById('strategy-grid-jupiter').style.display = chain === 'jupiter' ? 'grid' : 'none';

  // Clear any selection
  document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));

  // Hide downstream steps when switching chains
  ['config-block','download-block','terminal-block'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });

  // On Jupiter tab: show fund block only if wallet connected AND Phantom; hide Solana warning on Aster tab
  if (walletAddress) {
    const isPhantom = walletType === 'phantom';
    if (chain === 'jupiter' && isPhantom) {
      document.getElementById('fund-block').style.display   = 'block';
      document.getElementById('fund-inner').style.display   = 'block';
      document.getElementById('solana-warning').style.display = 'none';
    } else if (chain === 'aster' && isPhantom) {
      document.getElementById('fund-block').style.display   = 'block';
      document.getElementById('fund-inner').style.display   = 'none';
      document.getElementById('solana-warning').style.display = 'block';
    }
  }
}

// ── Strategy card clicks (both grids) ────────────────────────────────────────
['strategy-grid-aster','strategy-grid-jupiter'].forEach(gridId => {
  document.getElementById(gridId).addEventListener('click', e => {
    const card = e.target.closest('.strategy-card');
    if (!card) return;
    document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedStrategy = card.dataset.strategy;

    // If wallet connected, go straight to config; otherwise show fund block first
    if (walletAddress) {
      showConfigStep();
    } else {
      document.getElementById('config-step-label').textContent    = 'STEP 2 — CONFIGURE';
      document.getElementById('download-step-label').textContent  = 'STEP 3 — DOWNLOAD & RUN';
      document.getElementById('terminal-step-label').textContent  = 'STEP 4 — LIVE TERMINAL';
      document.getElementById('config-block').style.display = 'block';
      document.getElementById('config-block').scrollIntoView({ behavior: 'smooth' });
    }
    renderConfigForm(selectedStrategy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG FORMS
// ─────────────────────────────────────────────────────────────────────────────

const FORMS = {
  dca: {
    title: '💰 DCA Bot',
    sections: [
      { title: 'Aster API credentials', fields: [
        { id: 'apiKey',    label: 'API Key',    type: 'text',     placeholder: '0xYourApiKey', hint: 'From Aster → Settings → API. Never sent to our servers.' },
        { id: 'apiSecret', label: 'API Secret', type: 'password', placeholder: '0xYourSecret', hint: 'Stored only in your local .env file.' },
      ]},
      { title: 'Strategy', fields: [
        { id: 'symbol',    label: 'Symbol',              type: 'text',   placeholder: 'BTCUSDT' },
        { id: 'buyAmount', label: 'Buy amount (USDT)',   type: 'number', placeholder: '20',  hint: 'Fixed USDT per buy' },
        { id: 'interval',  label: 'Interval',            type: 'select', options: ['5m','15m','1h','4h','1d'] },
        { id: 'budgetCap', label: 'Total budget (USDT)', type: 'number', placeholder: '500', hint: 'Bot stops at this total' },
        { id: 'stopLoss',  label: 'Stop-loss %',         type: 'number', placeholder: '15' },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxPositions', label: 'Max positions', type: 'number', placeholder: '1' },
        { id: 'dryRun',       label: 'Dry run mode',  type: 'select', options: ['true','false'], hint: 'Simulate without real orders' },
      ]},
    ]
  },
  copy: {
    title: '👑 Copy Bot',
    sections: [
      { title: 'Aster API credentials', fields: [
        { id: 'apiKey',    label: 'API Key',    type: 'text',     placeholder: '0xYourApiKey' },
        { id: 'apiSecret', label: 'API Secret', type: 'password', placeholder: '0xYourSecret' },
      ]},
      { title: 'Strategy', fields: [
        { id: 'traderRank',   label: 'Rank to copy',     type: 'number', placeholder: '1',   hint: '#1 = top leaderboard trader' },
        { id: 'positionSize', label: 'Position (USDT)',  type: 'number', placeholder: '50' },
        { id: 'maxDrawdown',  label: 'Max drawdown %',   type: 'number', placeholder: '20',  hint: 'Pauses if account drops this %' },
        { id: 'blacklist',    label: 'Blacklist symbols',type: 'text',   placeholder: 'DOGEUSDT,PEPEUSDT' },
        { id: 'pollInterval', label: 'Poll interval',    type: 'select', options: ['30s','1m','5m'] },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxPositions', label: 'Max positions', type: 'number', placeholder: '3' },
        { id: 'dryRun',       label: 'Dry run mode',  type: 'select', options: ['true','false'] },
      ]},
    ]
  },
  momentum: {
    title: '🚀 Momentum Bot',
    sections: [
      { title: 'Aster API credentials', fields: [
        { id: 'apiKey',    label: 'API Key',    type: 'text',     placeholder: '0xYourApiKey' },
        { id: 'apiSecret', label: 'API Secret', type: 'password', placeholder: '0xYourSecret' },
      ]},
      { title: 'Strategy', fields: [
        { id: 'gainThreshold', label: 'Entry threshold %', type: 'number', placeholder: '5',   hint: 'Buy when symbol gains this %' },
        { id: 'scanInterval',  label: 'Scan interval',     type: 'select', options: ['1m','5m','15m','1h'] },
        { id: 'positionSize',  label: 'Position (USDT)',   type: 'number', placeholder: '50' },
        { id: 'takeProfit',    label: 'Take-profit %',     type: 'number', placeholder: '8' },
        { id: 'stopLoss',      label: 'Stop-loss %',       type: 'number', placeholder: '4' },
        { id: 'symbolFilter',  label: 'Symbol filter',     type: 'text',   placeholder: 'USDT', hint: 'Only scan symbols ending with this' },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxPositions',  label: 'Max positions',     type: 'number', placeholder: '3' },
        { id: 'dailyLossCap',  label: 'Daily loss cap $',  type: 'number', placeholder: '100' },
        { id: 'dryRun',        label: 'Dry run mode',      type: 'select', options: ['true','false'] },
      ]},
    ]
  },
  // ── kept for legacy bot.js references ──
  jupiter: {
    title: '🪐 Jupiter Bot (Solana)',
    sections: [
      { title: 'Solana wallet', fields: [
        { id: 'privateKey', label: 'Wallet private key (base58)', type: 'password', placeholder: 'your-base58-private-key', hint: 'The bot signs transactions with this key. Stored only in your local .env. Never shared.' },
        { id: 'rpcUrl',     label: 'Solana RPC URL', type: 'text', placeholder: 'https://api.mainnet-beta.solana.com', hint: 'Use a private RPC for better performance (Helius, QuickNode, Alchemy). Public RPC may rate-limit.' },
      ]},
      { title: 'Strategy', fields: [
        { id: 'inputMint',  label: 'Input token mint',  type: 'text', placeholder: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', hint: 'Default: USDC. Paste any SPL token mint address.' },
        { id: 'outputMint', label: 'Output token mint', type: 'text', placeholder: 'So11111111111111111111111111111111111111112',   hint: 'Default: SOL (Wrapped). Jupiter routes through all Solana DEXs for best price.' },
        { id: 'inputAmount',   label: 'Input amount (per swap)', type: 'number', placeholder: '10', hint: 'In human-readable units e.g. 10 = $10 USDC' },
        { id: 'gainThreshold', label: 'Entry threshold %', type: 'number', placeholder: '1.5', hint: 'Only swap when price has moved this % since last check' },
        { id: 'scanInterval',  label: 'Scan interval',    type: 'select', options: ['30s','1m','5m','15m'], hint: 'How often to check price and potentially swap' },
        { id: 'slippageBps',   label: 'Slippage (bps)',   type: 'number', placeholder: '50', hint: '50 = 0.5% slippage tolerance. Higher = more likely to fill, worse price.' },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxSwapsPerDay', label: 'Max swaps per day', type: 'number', placeholder: '10', hint: 'Hard cap on daily swaps' },
        { id: 'dryRun',        label: 'Dry run mode',      type: 'select', options: ['true','false'], hint: 'Simulate swaps without sending real transactions' },
      ]},
    ]
  },

  // ── Aster chain variants ──────────────────────────────────────────────────
  aster_dca:      null, // resolved dynamically — points to dca
  aster_copy:     null,
  aster_momentum: null,
  aster_scalper:  null,

  // ── Jupiter chain variants ────────────────────────────────────────────────
  jupiter_dca: {
    title: '💰 Jupiter DCA Bot (Solana)',
    sections: [
      { title: 'Solana wallet', fields: [
        { id: 'privateKey', label: 'Wallet private key (base58)', type: 'password', placeholder: 'your-base58-private-key', hint: 'Stored only in your local .env. Never shared.' },
        { id: 'rpcUrl',     label: 'Solana RPC URL', type: 'text', placeholder: 'https://api.mainnet-beta.solana.com', hint: 'Use Helius or QuickNode for better rate limits.' },
        { id: 'cashoutAddress', label: 'Cashout address (Solana)', type: 'text', placeholder: 'Your Phantom wallet address', hint: 'Where profits go on cashout command.' },
      ]},
      { title: 'DCA settings', fields: [
        { id: 'inputMint',  label: 'Input token mint (spend)',  type: 'text', placeholder: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', hint: 'Default: USDC' },
        { id: 'outputMint', label: 'Output token mint (buy)',   type: 'text', placeholder: 'So11111111111111111111111111111111111111112', hint: 'Default: SOL' },
        { id: 'inputAmount',  label: 'Buy amount per interval (USDC)', type: 'number', placeholder: '10' },
        { id: 'interval',     label: 'Buy interval',             type: 'select', options: ['5m','15m','1h','4h','1d'] },
        { id: 'budgetCap',    label: 'Total budget cap (USDC)',  type: 'number', placeholder: '500', hint: 'Bot stops buying after this total spend' },
        { id: 'slippageBps',  label: 'Slippage (bps)',           type: 'number', placeholder: '50' },
      ]},
      { title: 'Risk', fields: [
        { id: 'dryRun', label: 'Dry run mode', type: 'select', options: ['true','false'], hint: 'Simulate without real transactions' },
      ]},
    ]
  },

  jupiter_copy: {
    title: '👑 Jupiter Copy Bot (Solana)',
    sections: [
      { title: 'Solana wallet', fields: [
        { id: 'privateKey',     label: 'Wallet private key (base58)', type: 'password', placeholder: 'your-base58-private-key', hint: 'Stored only in your local .env. Never shared.' },
        { id: 'rpcUrl',         label: 'Solana RPC URL', type: 'text', placeholder: 'https://api.mainnet-beta.solana.com' },
        { id: 'cashoutAddress', label: 'Cashout address', type: 'text', placeholder: 'Your Phantom wallet address' },
      ]},
      { title: 'Copy settings', fields: [
        { id: 'targetWallet',  label: 'Target wallet to mirror', type: 'text', placeholder: 'Solana wallet address', hint: 'Monitor this wallet\'s Jupiter swaps and mirror them.' },
        { id: 'positionSize',  label: 'Max position size (USDC)', type: 'number', placeholder: '50', hint: 'Cap per mirrored trade regardless of target\'s size' },
        { id: 'mirrorRatio',   label: 'Mirror ratio %', type: 'number', placeholder: '10', hint: 'Trade 10% of what the target trades' },
        { id: 'maxDrawdown',   label: 'Max drawdown %', type: 'number', placeholder: '20', hint: 'Pauses if your wallet drops this %' },
        { id: 'blacklist',     label: 'Blacklist tokens', type: 'text', placeholder: 'mint1,mint2', hint: 'Never mirror swaps into these token mints' },
        { id: 'pollInterval',  label: 'Poll interval', type: 'select', options: ['10s','30s','1m'] },
        { id: 'slippageBps',   label: 'Slippage (bps)', type: 'number', placeholder: '100' },
      ]},
      { title: 'Risk', fields: [
        { id: 'dryRun', label: 'Dry run mode', type: 'select', options: ['true','false'] },
      ]},
    ]
  },

  jupiter_momentum: {
    title: '🚀 Jupiter Momentum Bot (Solana)',
    sections: [
      { title: 'Solana wallet', fields: [
        { id: 'privateKey',     label: 'Wallet private key (base58)', type: 'password', placeholder: 'your-base58-private-key', hint: 'Stored only in your local .env. Never shared.' },
        { id: 'rpcUrl',         label: 'Solana RPC URL', type: 'text', placeholder: 'https://api.mainnet-beta.solana.com' },
        { id: 'cashoutAddress', label: 'Cashout address', type: 'text', placeholder: 'Your Phantom wallet address' },
      ]},
      { title: 'Momentum settings', fields: [
        { id: 'inputMint',     label: 'Input mint (USDC to spend)', type: 'text', placeholder: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        { id: 'outputMint',    label: 'Output mint (token to buy)', type: 'text', placeholder: 'So11111111111111111111111111111111111111112', hint: 'SOL by default. Change to any SPL token.' },
        { id: 'gainThreshold', label: 'Entry threshold %',  type: 'number', placeholder: '1.5', hint: 'Buy when price moves this % upward' },
        { id: 'inputAmount',   label: 'Position size (USDC)', type: 'number', placeholder: '25' },
        { id: 'takeProfit',    label: 'Take-profit %',  type: 'number', placeholder: '5' },
        { id: 'stopLoss',      label: 'Stop-loss %',    type: 'number', placeholder: '3' },
        { id: 'scanInterval',  label: 'Scan interval',  type: 'select', options: ['30s','1m','5m','15m'] },
        { id: 'slippageBps',   label: 'Slippage (bps)', type: 'number', placeholder: '50' },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxSwapsPerDay', label: 'Max swaps per day', type: 'number', placeholder: '20' },
        { id: 'dryRun',         label: 'Dry run mode', type: 'select', options: ['true','false'] },
      ]},
    ]
  },

  jupiter_scalper: {
    title: '⚡ Jupiter Scalper Bot (Solana)',
    sections: [
      { title: 'Solana wallet', fields: [
        { id: 'privateKey',     label: 'Wallet private key (base58)', type: 'password', placeholder: 'your-base58-private-key', hint: 'Stored only in your local .env. Never shared.' },
        { id: 'rpcUrl',         label: 'Solana RPC URL', type: 'text', placeholder: 'https://api.mainnet-beta.solana.com', hint: 'Private RPC strongly recommended for scalping speed.' },
        { id: 'cashoutAddress', label: 'Cashout address', type: 'text', placeholder: 'Your Phantom wallet address' },
      ]},
      { title: 'Scalper settings', fields: [
        { id: 'inputMint',     label: 'Input mint (spend)',  type: 'text', placeholder: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', hint: 'USDC by default' },
        { id: 'outputMint',    label: 'Output mint (buy)',   type: 'text', placeholder: 'So11111111111111111111111111111111111111112' },
        { id: 'gainThreshold', label: 'Entry threshold %',  type: 'number', placeholder: '0.3', hint: 'Swap when price moves 0.3% in one scan window' },
        { id: 'inputAmount',   label: 'Position size (USDC)', type: 'number', placeholder: '10' },
        { id: 'takeProfit',    label: 'Take-profit %',  type: 'number', placeholder: '0.5' },
        { id: 'stopLoss',      label: 'Stop-loss %',    type: 'number', placeholder: '0.3' },
        { id: 'scanInterval',  label: 'Scan interval',  type: 'select', options: ['10s','30s','1m'], hint: '30s recommended for scalping' },
        { id: 'slippageBps',   label: 'Slippage (bps)', type: 'number', placeholder: '30', hint: 'Keep tight — 30bps = 0.3%' },
      ]},
      { title: 'Risk', fields: [
        { id: 'dailyTradeCap', label: 'Max swaps per day',    type: 'number', placeholder: '100' },
        { id: 'dryRun',        label: 'Dry run mode', type: 'select', options: ['true','false'], hint: 'STRONGLY recommend true first' },
      ]},
    ]
  },
};
    title: '⚡ Scalper Bot',
    sections: [
      { title: 'Aster API credentials', fields: [
        { id: 'apiKey',    label: 'API Key',    type: 'text',     placeholder: '0xYourApiKey' },
        { id: 'apiSecret', label: 'API Secret', type: 'password', placeholder: '0xYourSecret' },
      ]},
      { title: 'Scalper settings', fields: [
        { id: 'gainThreshold', label: 'Entry threshold %',    type: 'number', placeholder: '0.3', hint: 'Buy when a symbol moves this % in one scan window (default 0.3%)' },
        { id: 'scanInterval',  label: 'Scan interval',        type: 'select', options: ['30s','1m','2m','5m'], hint: '60s recommended for scalping' },
        { id: 'positionSize',  label: 'Position size (USDT)', type: 'number', placeholder: '25',  hint: 'Smaller is safer for scalping' },
        { id: 'takeProfit',    label: 'Take-profit %',        type: 'number', placeholder: '0.5', hint: 'Exit when up 0.5%' },
        { id: 'stopLoss',      label: 'Stop-loss %',          type: 'number', placeholder: '0.3', hint: 'Exit when down 0.3%' },
        { id: 'minVolume24h',  label: 'Min 24h volume (USDT)',type: 'number', placeholder: '5000000', hint: 'Ignore low-liquidity coins. $5M minimum recommended' },
        { id: 'symbolFilter',  label: 'Symbol filter',        type: 'text',   placeholder: 'USDT', hint: 'Only scan USDT pairs' },
      ]},
      { title: 'Risk', fields: [
        { id: 'maxPositions', label: 'Max concurrent positions', type: 'number', placeholder: '5',   hint: 'Scalper can hold multiple at once' },
        { id: 'dailyLossCap', label: 'Daily loss cap (USDT)',    type: 'number', placeholder: '50',  hint: 'Pauses bot for the day if hit' },
        { id: 'dailyTradeCap',label: 'Max trades per day',       type: 'number', placeholder: '100', hint: 'Prevents runaway loops' },
        { id: 'dryRun',       label: 'Dry run mode',             type: 'select', options: ['true','false'], hint: 'STRONGLY recommend true first' },
      ]},
    ]
  },
};

function renderConfigForm(strategy) {
  // Resolve aster_ aliases to their base strategy
  const baseStrategy = strategy.startsWith('aster_') ? strategy.replace('aster_', '') : strategy;
  const def = FORMS[strategy] || FORMS[baseStrategy];
  const el  = document.getElementById('config-form');
  let html  = `<div class="form-section-title" style="margin-top:0;font-size:14px">${def.title}</div>`;

  // If funded pool was set up, show it's pre-filled
  if (botPoolWallet) {
    html += `<div style="margin-bottom:1rem;padding:8px 10px;background:rgba(0,200,110,0.07);border:1px solid rgba(0,200,110,0.2);border-radius:4px;font-family:var(--font-mono);font-size:11px;color:rgba(255,255,255,0.5)">
      ✅ Bot pool wallet pre-filled: <span style="color:var(--green)">${botPoolWallet.address.slice(0,16)}...</span>
    </div>`;
  }

  def.sections.forEach(section => {
    html += `<div class="form-section-title">${section.title}</div>`;
    section.fields.forEach(f => {
      html += `<div class="form-group"><label class="form-label" for="f_${f.id}">${f.label}</label>`;
      if (f.type === 'select') {
        html += `<select class="form-select" id="f_${f.id}" data-key="${f.id}">${f.options.map(o=>`<option value="${o}">${o}</option>`).join('')}</select>`;
      } else {
        html += `<input class="form-input" id="f_${f.id}" type="${f.type}" placeholder="${f.placeholder||''}" data-key="${f.id}" autocomplete="off" spellcheck="false" />`;
      }
      if (f.hint) html += `<div class="form-hint">ℹ️ ${f.hint}</div>`;
      html += `</div>`;
    });
  });

  html += `<button class="btn-generate" id="btn-generate">⚡ Generate Bot Package</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.form-input, .form-select').forEach(i => i.addEventListener('input', updateConfigPreview));
  document.getElementById('btn-generate').addEventListener('click', generateBot);
  updateConfigPreview();
}

function updateConfigPreview() {
  const inputs = document.querySelectorAll('#config-form .form-input, #config-form .form-select');
  const config = {};
  inputs.forEach(i => { if (i.dataset.key) config[i.dataset.key] = i.value; });

  const strategyLine = `STRATEGY=${selectedStrategy?.toUpperCase() || ''}`;
  const poolLine     = botPoolWallet ? `\nBOT_POOL_ADDRESS=${botPoolWallet.address}\nBOT_POOL_KEY=***hidden***` : '';
  const lines = Object.entries(config)
    .map(([k, v]) => `${k.toUpperCase()}=${i => i.type === 'password' ? (v ? '***' : '') : v}`)
    .join('\n');

  const allLines = Object.entries(config).map(([k, v]) => {
    const input = document.getElementById(`f_${k}`);
    const display = input?.type === 'password' ? (v ? '***hidden***' : '') : (v || '<not set>');
    return `${k.toUpperCase()}=${display}`;
  });

  document.getElementById('config-pre').textContent =
    `# ${selectedStrategy?.toUpperCase()} BOT — AsterBoard\n# Generated ${new Date().toLocaleDateString()}\n\nSTRATEGY=${selectedStrategy || ''}${poolLine}\nASTER_BASE_URL=https://fapi.asterdex.com\nWS_PORT=8080\n\n` +
    allLines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function generateBot() {
  const inputs = document.querySelectorAll('#config-form .form-input, #config-form .form-select');
  const config = {};
  inputs.forEach(i => { if (i.dataset.key) config[i.dataset.key] = i.value; });

  const zip    = new JSZip();
  const folder = zip.folder(`aster-${selectedStrategy}-bot`);

  folder.file('.env',               buildEnvFile(config));
  folder.file('bot.js',             getBotJs(selectedStrategy, config));
  folder.file('Dockerfile',         getDockerfile());
  folder.file('docker-compose.yml', getDockerCompose());
  folder.file('package.json',       getBotPackageJson());
  folder.file('README.md',          getReadme(selectedStrategy, config));
  folder.file('logs/.gitkeep',      '');

  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `aster-${selectedStrategy}-bot.zip`;
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById('download-block').style.display  = 'block';
  document.getElementById('terminal-block').style.display  = 'block';
  document.getElementById('download-block').scrollIntoView({ behavior: 'smooth' });

  if (!term) initTerminal();
}

document.getElementById('btn-download').addEventListener('click', () => {
  if (selectedStrategy) generateBot();
});

// ─────────────────────────────────────────────────────────────────────────────
// BOT FILE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildEnvFile(config) {
  const isJupiter = selectedStrategy && selectedStrategy.startsWith('jupiter_');
  const poolLines = botPoolWallet
    ? `\n# Bot pool wallet (funded via AsterBoard)\nBOT_POOL_ADDRESS=${botPoolWallet.address}\nBOT_POOL_PRIVATE_KEY=${botPoolWallet.privateKey}\n`
    : '';

  const skip = isJupiter ? ['privateKey'] : ['apiKey','apiSecret'];
  const rest = Object.entries(config)
    .filter(([k]) => !skip.includes(k))
    .map(([k,v]) => `${k.toUpperCase()}=${v}`)
    .join('\n');

  if (isJupiter) {
    return `# Jupiter ${selectedStrategy?.toUpperCase()} Bot — generated by AsterBoard
# ⚠️  Keep this file private. Never share your private key.

STRATEGY=${selectedStrategy}
JUPITER_PRIVATE_KEY=${config.privateKey || ''}
JUPITER_RPC_URL=${config.rpcUrl || 'https://api.mainnet-beta.solana.com'}
WS_PORT=8080
${poolLines}
${rest}
`;
  }

  return `# Aster ${selectedStrategy?.toUpperCase()} Bot — generated by AsterBoard
# ⚠️  Keep this file private. Never share your API keys or private key.

STRATEGY=${selectedStrategy}
ASTER_API_KEY=${config.apiKey || ''}
ASTER_API_SECRET=${config.apiSecret || ''}
ASTER_BASE_URL=https://fapi.asterdex.com
WS_PORT=8080
${poolLines}
${rest}
`;
}

function getDockerfile() {
  return `FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 8080
CMD ["node", "bot.js"]
`;
}

function getDockerCompose() {
  return `version: '3.8'
services:
  aster-bot:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "8080:8080"
    volumes:
      - ./logs:/app/logs
`;
}

function getBotPackageJson() {
  const isJupiter = selectedStrategy && selectedStrategy.startsWith('jupiter_');
  const base = {
    name: `aster-${selectedStrategy}-bot`,
    version: '1.0.0',
    main: 'bot.js',
    scripts: { start: 'node bot.js' },
    dependencies: {
      'node-fetch': '^3.3.2',
      'ws': '^8.16.0',
      'dotenv': '^16.4.5',
    }
  };
  if (isJupiter || selectedStrategy === 'jupiter') {
    base.dependencies['@solana/web3.js'] = '^1.98.0';
    base.dependencies['bs58']            = '^6.0.0';
  }
  return JSON.stringify(base, null, 2);
}

function getReadme(strategy, config) {
  return `# Aster ${strategy.toUpperCase()} Bot — AsterBoard

## Quick start
\`\`\`bash
# 1. Install Docker Desktop: https://docs.docker.com/get-docker/
# 2. Unzip this folder
# 3. Open terminal here:
docker compose up -d

# Watch logs:
docker compose logs -f
\`\`\`

## Live terminal
Go to https://asterboard.vercel.app/bots/ → enter \`localhost:8080\` → Connect

## Commands
| Command | Action |
|---------|--------|
| \`status\` | Show positions & PnL |
| \`pause\` | Pause trading |
| \`resume\` | Resume trading |
| \`stop\` | Stop & close positions |
| \`withdraw\` | Return pool funds to your wallet |
| \`help\` | All commands |

## Config
Edit \`.env\` then \`docker compose restart\`

## Safety
- Start with \`DRY_RUN=true\` — simulates without real orders
- Never share \`.env\` or your private key
${config.dryRun === 'true' ? '\n⚠️  DRY RUN IS ENABLED — no real orders will be placed\n' : ''}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT LOGIC (bot.js templates)
// ─────────────────────────────────────────────────────────────────────────────

function getBotJs(strategy, config) {
  const header = `// Aster ${strategy.toUpperCase()} Bot — generated by AsterBoard
require('dotenv').config();
const fetch  = require('node-fetch');
const WS     = require('ws');
const crypto = require('crypto');

const API_KEY    = process.env.ASTER_API_KEY;
const API_SECRET = process.env.ASTER_API_SECRET;
const BASE_URL   = process.env.ASTER_BASE_URL || 'https://fapi.asterdex.com';
const DRY_RUN    = process.env.DRY_RUN === 'true';
const WS_PORT    = parseInt(process.env.WS_PORT || '8080');
const POOL_KEY   = process.env.BOT_POOL_PRIVATE_KEY || null;
const POOL_ADDR  = process.env.BOT_POOL_ADDRESS     || null;

// ── WebSocket terminal server ─────────────────────────────────────────────────
const clients = new Set();
const wss = new WS.Server({ port: WS_PORT });
wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'welcome', msg: '\\r\\n🤖 ' + STRATEGY_NAME + ' connected\\r\\nType help for commands\\r\\n> ' }));
  ws.on('message', d => handleCommand(d.toString().trim().toLowerCase(), ws));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(msg) {
  const p = JSON.stringify({ type: 'log', msg: msg + '\\r\\n' });
  clients.forEach(c => c.readyState === WS.OPEN && c.send(p));
}
function log(msg) {
  const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  console.log(line);
  broadcast(line);
}

// ── Aster API helpers ─────────────────────────────────────────────────────────
function sign(params) {
  const qs = Object.entries(params).map(([k,v]) => k+'='+v).join('&');
  return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex');
}
async function apiPost(path, params = {}) {
  if (DRY_RUN) { log('[DRY] POST ' + path + ' ' + JSON.stringify(params)); return { orderId: 'dry-' + Date.now(), status: 'FILLED' }; }
  params.timestamp  = Date.now();
  params.recvWindow = 5000;
  params.signature  = sign(params);
  const r = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  return r.json();
}
async function apiGet(path, params = {}) {
  params.timestamp  = Date.now();
  params.recvWindow = 5000;
  params.signature  = sign(params);
  const r = await fetch(BASE_URL + path + '?' + new URLSearchParams(params), { headers: { 'X-MBX-APIKEY': API_KEY } });
  return r.json();
}
async function getTickers() {
  const r = await fetch(BASE_URL + '/fapi/v1/ticker/24hr');
  return r.json();
}

let paused = false, stopped = false;
let stats = { trades: 0, pnl: 0, start: Date.now() };
`;

  const strategies = {
    dca:              getDcaBot(config),
    copy:             getCopyBot(config),
    momentum:         getMomentumBot(config),
    jupiter:          getJupiterBot(config),
    scalper:          getScalperBot(config),
    // aster_ aliases — use same Aster templates
    aster_dca:        getDcaBot(config),
    aster_copy:       getCopyBot(config),
    aster_momentum:   getMomentumBot(config),
    aster_scalper:    getScalperBot(config),
    // jupiter_ variants — all use Jupiter bot template with strategy param
    jupiter_dca:      getJupiterBot(config, 'dca'),
    jupiter_copy:     getJupiterBot(config, 'copy'),
    jupiter_momentum: getJupiterBot(config, 'momentum'),
    jupiter_scalper:  getJupiterBot(config, 'scalper'),
  };

  return header + (strategies[strategy] || '// Unknown strategy');
}

function getDcaBot(c) {
  return `
const STRATEGY_NAME = 'DCA Bot';
const SYMBOL       = process.env.SYMBOL      || '${c.symbol||'BTCUSDT'}';
const BUY_AMOUNT   = parseFloat(process.env.BUYAMOUNT  || '${c.buyAmount||20}');
const BUDGET_CAP   = parseFloat(process.env.BUDGETCAP  || '${c.budgetCap||500}');
const STOP_LOSS    = parseFloat(process.env.STOPLOSS   || '${c.stopLoss||15}') / 100;
const INTERVAL_MS  = { '5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 }[process.env.INTERVAL||'${c.interval||'1h'}'] || 3600000;

let totalSpent = 0, totalQty = 0, avgEntry = 0;

async function dcaBuy() {
  if (paused || stopped || totalSpent >= BUDGET_CAP) return;
  const tickers = await getTickers();
  const t       = tickers.find(x => x.symbol === SYMBOL);
  const price   = parseFloat(t?.lastPrice || 0);
  if (!price) { log('⚠️ Could not fetch price for ' + SYMBOL); return; }
  const qty = (BUY_AMOUNT / price).toFixed(6);
  log('💰 DCA ' + qty + ' ' + SYMBOL + ' @ $' + price.toFixed(2));
  await apiPost('/fapi/v1/order', { symbol: SYMBOL, side: 'BUY', type: 'MARKET', quantity: qty, positionSide: 'BOTH' });
  totalSpent += BUY_AMOUNT; totalQty += parseFloat(qty); avgEntry = totalSpent / totalQty; stats.trades++;
  log('✅ Avg entry: $' + avgEntry.toFixed(2) + ' | Spent: $' + totalSpent.toFixed(2));
  if (price < avgEntry * (1 - STOP_LOSS)) { log('🛑 Stop-loss hit'); closeAll(); }
}

async function closeAll() {
  if (totalQty <= 0) return;
  await apiPost('/fapi/v1/order', { symbol: SYMBOL, side: 'SELL', type: 'MARKET', quantity: totalQty.toFixed(6), positionSide: 'BOTH', reduceOnly: 'true' });
  totalSpent = 0; totalQty = 0; avgEntry = 0;
  log('✅ Position closed');
}

function handleCommand(cmd, ws) {
  const s = m => ws.send(JSON.stringify({ type: 'log', msg: m + '\\r\\n> ' }));
  if      (cmd === 'help')    s('Commands: status | pause | resume | close | stop');
  else if (cmd === 'status')  s('Symbol: ' + SYMBOL + ' | Spent: $' + totalSpent.toFixed(2) + ' | Avg: $' + avgEntry.toFixed(2) + ' | ' + (paused?'PAUSED':'RUNNING'));
  else if (cmd === 'pause')   { paused = true; s('⏸️ Paused'); }
  else if (cmd === 'resume')  { paused = false; s('▶️ Running'); }
  else if (cmd === 'close')   { closeAll(); }
  else if (cmd === 'stop')    { stopped = true; closeAll(); s('🛑 Stopped'); }
  else s('Unknown: ' + cmd);
}

log('🚀 DCA Bot | ' + SYMBOL + ' | $' + BUY_AMOUNT + ' / interval | DryRun: ' + DRY_RUN);
if (DRY_RUN) log('⚠️  DRY RUN — no real orders');
dcaBuy();
setInterval(dcaBuy, INTERVAL_MS);
`;
}

function getCopyBot(c) {
  return `
const STRATEGY_NAME   = 'Copy Bot';
const TRADER_RANK     = parseInt(process.env.TRADERRANK    || '${c.traderRank||1}');
const POSITION_SIZE   = parseFloat(process.env.POSITIONSIZE|| '${c.positionSize||50}');
const MAX_DRAWDOWN    = parseFloat(process.env.MAXDRAWDOWN || '${c.maxDrawdown||20}') / 100;
const BLACKLIST       = (process.env.BLACKLIST||'${c.blacklist||''}').split(',').filter(Boolean);
const POLL_MS         = { '30s':30000,'1m':60000,'5m':300000 }[process.env.POLLINTERVAL||'${c.pollInterval||'1m'}'] || 60000;
const LB_URL          = 'https://www.asterdex.com/bapi/futures/v1/public/campaign/trade/pro/leaderboard';

let openPositions = {}, peakBalance = null;

async function pollLeaderboard() {
  if (paused || stopped) return;
  const r = await fetch(LB_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ period:'d1', sort:'pnl_rank', order:'asc', page:1, rows:10 }) });
  const data = await r.json();
  const trader = (data?.data?.list || [])[TRADER_RANK - 1];
  if (!trader) { log('⚠️ Leaderboard empty'); return; }
  log('👑 Tracking: ' + (trader.nickName||'Unknown') + ' | PnL: $' + parseFloat(trader.pnl||0).toFixed(2));
}

function handleCommand(cmd, ws) {
  const s = m => ws.send(JSON.stringify({ type: 'log', msg: m + '\\r\\n> ' }));
  if      (cmd === 'help')   s('Commands: status | pause | resume | stop');
  else if (cmd === 'status') s('Copying rank #' + TRADER_RANK + ' | Size: $' + POSITION_SIZE + ' | ' + (paused?'PAUSED':'RUNNING'));
  else if (cmd === 'pause')  { paused = true; s('⏸️ Paused'); }
  else if (cmd === 'resume') { paused = false; s('▶️ Running'); }
  else if (cmd === 'stop')   { stopped = true; s('🛑 Stopped'); }
  else s('Unknown: ' + cmd);
}

log('🚀 Copy Bot | Rank #' + TRADER_RANK + ' | $' + POSITION_SIZE + '/trade | DryRun: ' + DRY_RUN);
if (DRY_RUN) log('⚠️  DRY RUN — no real orders');
pollLeaderboard();
setInterval(pollLeaderboard, POLL_MS);
`;
}

function getMomentumBot(c) {
  return `
const STRATEGY_NAME  = 'Momentum Bot';
const THRESHOLD      = parseFloat(process.env.GAINTHRESHOLD || '${c.gainThreshold||5}') / 100;
const SCAN_MS        = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000 }[process.env.SCANINTERVAL||'${c.scanInterval||'5m'}'] || 300000;
const POSITION_SIZE  = parseFloat(process.env.POSITIONSIZE  || '${c.positionSize||50}');
const TAKE_PROFIT    = parseFloat(process.env.TAKEPROFIT     || '${c.takeProfit||8}') / 100;
const STOP_LOSS      = parseFloat(process.env.STOPLOSS       || '${c.stopLoss||4}') / 100;
const FILTER         = process.env.SYMBOLFILTER || '${c.symbolFilter||'USDT'}';
const MAX_POS        = parseInt(process.env.MAXPOSITIONS    || '${c.maxPositions||3}');
const DAILY_LOSS_CAP = parseFloat(process.env.DAILYLOSSCAP  || '${c.dailyLossCap||100}');

let openPositions = {}, dailyLoss = 0;

async function scan() {
  if (paused || stopped || dailyLoss >= DAILY_LOSS_CAP) return;
  const tickers = await getTickers();
  const gainers = tickers
    .filter(t => t.symbol.endsWith(FILTER) && parseFloat(t.priceChangePercent||0)/100 >= THRESHOLD)
    .sort((a,b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, 5);

  log('📡 Scan: ' + gainers.length + ' symbols above ' + (THRESHOLD*100).toFixed(1) + '%');

  for (const g of gainers) {
    if (Object.keys(openPositions).length >= MAX_POS || openPositions[g.symbol]) continue;
    const price = parseFloat(g.lastPrice);
    const qty   = (POSITION_SIZE / price).toFixed(6);
    log('🚀 Entry: ' + g.symbol + ' +' + parseFloat(g.priceChangePercent).toFixed(2) + '%');
    const order = await apiPost('/fapi/v1/order', { symbol: g.symbol, side: 'BUY', type: 'MARKET', quantity: qty, positionSide: 'BOTH' });
    openPositions[g.symbol] = { entry: price, qty: parseFloat(qty) };
    stats.trades++;
  }

  for (const [sym, pos] of Object.entries(openPositions)) {
    const t     = tickers.find(x => x.symbol === sym);
    const price = parseFloat(t?.lastPrice || pos.entry);
    const pct   = (price - pos.entry) / pos.entry;
    if (pct >= TAKE_PROFIT || pct <= -STOP_LOSS) {
      log((pct >= 0 ? '✅ TP' : '🛑 SL') + ' ' + sym + ' ' + (pct*100).toFixed(2) + '%');
      await apiPost('/fapi/v1/order', { symbol: sym, side: 'SELL', type: 'MARKET', quantity: pos.qty.toFixed(6), positionSide: 'BOTH', reduceOnly: 'true' });
      stats.pnl += (price - pos.entry) * pos.qty;
      if (pct < 0) dailyLoss += POSITION_SIZE * STOP_LOSS;
      delete openPositions[sym];
    }
  }
}

function handleCommand(cmd, ws) {
  const s = m => ws.send(JSON.stringify({ type: 'log', msg: m + '\\r\\n> ' }));
  if      (cmd === 'help')       s('Commands: status | positions | pause | resume | stop');
  else if (cmd === 'status')     s('Open: ' + Object.keys(openPositions).length + '/' + MAX_POS + ' | PnL: $' + stats.pnl.toFixed(2) + ' | ' + (paused?'PAUSED':'RUNNING'));
  else if (cmd === 'positions')  s(JSON.stringify(openPositions, null, 2));
  else if (cmd === 'pause')      { paused = true; s('⏸️ Paused'); }
  else if (cmd === 'resume')     { paused = false; s('▶️ Running'); }
  else if (cmd === 'stop')       { stopped = true; s('🛑 Stopped'); }
  else s('Unknown: ' + cmd);
}

log('🚀 Momentum Bot | Threshold: ' + (THRESHOLD*100).toFixed(1) + '% | DryRun: ' + DRY_RUN);
if (DRY_RUN) log('⚠️  DRY RUN — no real orders');
scan();
setInterval(scan, SCAN_MS);
`;
}

function getJupiterBot(c, variant) {
  const variantNames = { dca: 'Jupiter DCA Bot', copy: 'Jupiter Copy Bot', momentum: 'Jupiter Momentum Bot', scalper: 'Jupiter Scalper Bot' };
  const stratName    = variantNames[variant] || 'Jupiter Bot';
  const defaultThreshold = variant === 'scalper' ? '0.3' : variant === 'dca' ? '0' : '1.5';
  const defaultAmount    = variant === 'scalper' ? '10' : '10';
  const defaultInterval  = variant === 'scalper' ? '30s' : variant === 'dca' ? '1h' : '1m';
  const defaultSlippage  = variant === 'scalper' ? '30' : '50';
  const defaultMaxSwaps  = variant === 'scalper' ? '100' : variant === 'dca' ? '999' : '20';

  return `
const STRATEGY_NAME  = '${stratName}';
const INPUT_MINT     = process.env.INPUTMINT    || '${c.inputMint  || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}'; // USDC
const OUTPUT_MINT    = process.env.OUTPUTMINT   || '${c.outputMint || 'So11111111111111111111111111111111111111112'}';   // SOL
const INPUT_AMOUNT   = parseFloat(process.env.INPUTAMOUNT   || '${c.inputAmount   || defaultAmount}');
const THRESHOLD      = parseFloat(process.env.GAINTHRESHOLD || '${c.gainThreshold || defaultThreshold}') / 100;
const SCAN_MS        = { '10s':10000,'30s':30000,'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 }[process.env.SCANINTERVAL || '${c.scanInterval || defaultInterval}'] || 60000;
const SLIPPAGE_BPS   = parseInt(process.env.SLIPPAGEBPS     || '${c.slippageBps   || defaultSlippage}');
const MAX_SWAPS_DAY  = parseInt(process.env.MAXSWAPSPERDAY  || '${c.maxSwapsPerDay || c.dailyTradeCap || defaultMaxSwaps}');
const CASHOUT_ADDR   = process.env.CASHOUTADDRESS || '${c.cashoutAddress || ''}';
const DRY_RUN        = process.env.DRY_RUN === 'true';
const RPC_URL        = process.env.RPCURL || process.env.JUPITER_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PRIVATE_KEY    = process.env.JUPITER_PRIVATE_KEY || process.env.PRIVATE_KEY;

// Jupiter API v6 (Metis routing engine)
const JUP_QUOTE_URL  = 'https://api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL   = 'https://api.jup.ag/swap/v1/swap';

const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');

const connection = new Connection(RPC_URL, 'confirmed');
const keypair    = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

// Token decimals map (common tokens)
const DECIMALS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':  6,  // USDT
  'So11111111111111111111111111111111111111112':    9,  // SOL
};

function toRaw(amount, mint) {
  const decimals = DECIMALS[mint] ?? 6;
  return Math.round(amount * Math.pow(10, decimals));
}

let dailySwaps  = 0;
let lastPrice   = null; // last observed output/input ratio
let stats       = { swaps: 0, start: Date.now() };

async function getQuote() {
  const rawAmount = toRaw(INPUT_AMOUNT, INPUT_MINT);
  const url = JUP_QUOTE_URL +
    '?inputMint='  + INPUT_MINT +
    '&outputMint=' + OUTPUT_MINT +
    '&amount='     + rawAmount +
    '&slippageBps='+ SLIPPAGE_BPS +
    '&restrictIntermediateTokens=true' +
    '&instructionVersion=V2';

  const r = await fetch(url);
  if (!r.ok) throw new Error('Quote failed: ' + r.status);
  return r.json();
}

async function executeSwap(quoteResponse) {
  if (DRY_RUN) {
    log('[DRY] Would swap ' + INPUT_AMOUNT + ' ' + INPUT_MINT.slice(0,8) + '... → ' + OUTPUT_MINT.slice(0,8) + '...');
    log('[DRY] outAmount: ' + quoteResponse.outAmount + ' | route: ' + (quoteResponse.routePlan?.[0]?.swapInfo?.label || 'unknown'));
    return { signature: 'dry-' + Date.now() };
  }

  const swapResp = await fetch(JUP_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: 1000000, priorityLevel: 'high' }
      }
    })
  });

  if (!swapResp.ok) throw new Error('Swap build failed: ' + swapResp.status);
  const { swapTransaction } = await swapResp.json();

  // Deserialise, sign, send
  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx    = VersionedTransaction.deserialize(txBuf);
  tx.sign([keypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');
  return { signature: sig };
}

async function scan() {
  if (paused || stopped) return;
  if (dailySwaps >= MAX_SWAPS_DAY) { log('⛔ Daily swap cap (' + MAX_SWAPS_DAY + ') hit. Paused until restart.'); paused = true; return; }

  const quote = await getQuote();
  const outAmount  = parseFloat(quote.outAmount);
  const inAmount   = parseFloat(quote.inAmount);
  const currentPrice = outAmount / inAmount; // output per input unit

  log('📡 Price check | In: ' + INPUT_AMOUNT + ' | Out: ' + (outAmount / Math.pow(10, DECIMALS[OUTPUT_MINT] ?? 9)).toFixed(6) + ' | Route: ' + (quote.routePlan?.[0]?.swapInfo?.label || 'unknown') + ' | Impact: ' + (parseFloat(quote.priceImpactPct || 0) * 100).toFixed(4) + '%');

  if (lastPrice === null) {
    lastPrice = currentPrice;
    log('✅ Baseline price set: ' + currentPrice.toFixed(8));
    return;
  }

  const move = (currentPrice - lastPrice) / lastPrice;
  log('📊 Price move: ' + (move * 100).toFixed(4) + '% | Threshold: ' + (THRESHOLD * 100).toFixed(2) + '%');

  if (move >= THRESHOLD) {
    log('🪐 JUPITER SWAP | Move: +' + (move * 100).toFixed(3) + '% | Executing...');
    try {
      const result = await executeSwap(quote);
      stats.swaps++;
      dailySwaps++;
      lastPrice = currentPrice;
      log('✅ Swap confirmed | Sig: ' + result.signature);
    } catch(e) {
      log('❌ Swap failed: ' + e.message);
    }
  }
}

function handleCommand(cmd, ws) {
  const s = m => ws.send(JSON.stringify({ type: 'log', msg: m + '\r\n> ' }));
  const uptime = Math.floor((Date.now() - stats.start) / 60000);
  if (cmd === 'help')   s('Commands: status | pause | resume | stop');
  else if (cmd === 'status') s(
    '🪐 Jupiter Bot | Swaps today: ' + dailySwaps + '/' + MAX_SWAPS_DAY +
    ' | Total: ' + stats.swaps +
    ' | Uptime: ' + uptime + 'm | ' + (paused?'PAUSED':'RUNNING') +
    '\r\nRoute: ' + INPUT_MINT.slice(0,8) + '... → ' + OUTPUT_MINT.slice(0,8) + '...' +
    '\r\nLast price: ' + (lastPrice ? lastPrice.toFixed(8) : 'not set')
  );
  else if (cmd === 'pause')  { paused = true; s('⏸️ Paused'); }
  else if (cmd === 'resume') { paused = false; s('▶️ Running'); }
  else if (cmd === 'stop')   { stopped = true; s('🛑 Stopped'); }
  else s('Unknown: ' + cmd + '. Type help.');
}

log('🪐 Jupiter Bot starting | ' + INPUT_MINT.slice(0,8) + '... → ' + OUTPUT_MINT.slice(0,8) + '...');
log('Amount: ' + INPUT_AMOUNT + ' | Threshold: ' + (THRESHOLD*100).toFixed(2) + '% | Slippage: ' + SLIPPAGE_BPS + 'bps | DryRun: ' + DRY_RUN);
if (DRY_RUN) log('⚠️  DRY RUN — no real transactions will be sent');
log('Fetching initial price baseline...');
scan();
setInterval(scan, SCAN_MS);
\`;
}

function getScalperBot(c) {
  return `
const STRATEGY_NAME  = 'Scalper Bot';
const THRESHOLD      = parseFloat(process.env.GAINTHRESHOLD || '${c.gainThreshold||0.3}') / 100;
const SCAN_MS        = { '30s':30000,'1m':60000,'2m':120000,'5m':300000 }[process.env.SCANINTERVAL||'${c.scanInterval||'1m'}'] || 60000;
const POSITION_SIZE  = parseFloat(process.env.POSITIONSIZE  || '${c.positionSize||25}');
const TAKE_PROFIT    = parseFloat(process.env.TAKEPROFIT     || '${c.takeProfit||0.5}') / 100;
const STOP_LOSS      = parseFloat(process.env.STOPLOSS       || '${c.stopLoss||0.3}') / 100;
const MIN_VOLUME     = parseFloat(process.env.MINVOLUME24H   || '${c.minVolume24h||5000000}');
const FILTER         = process.env.SYMBOLFILTER || '${c.symbolFilter||'USDT'}';
const MAX_POS        = parseInt(process.env.MAXPOSITIONS    || '${c.maxPositions||5}');
const DAILY_LOSS_CAP = parseFloat(process.env.DAILYLOSSCAP  || '${c.dailyLossCap||50}');
const DAILY_TRADE_CAP= parseInt(process.env.DAILYTRADECAP   || '${c.dailyTradeCap||100}');

let openPositions = {}, dailyLoss = 0, dailyTrades = 0;
let prevPrices    = {}; // track price at start of each scan window

async function scalperScan() {
  if (paused || stopped || dailyLoss >= DAILY_LOSS_CAP || dailyTrades >= DAILY_TRADE_CAP) {
    if (dailyLoss >= DAILY_LOSS_CAP) log('⛔ Daily loss cap hit ($' + dailyLoss.toFixed(2) + '). Paused.');
    return;
  }

  const tickers = await getTickers();

  // Build price movement from last scan window
  const movers = tickers
    .filter(t =>
      t.symbol.endsWith(FILTER) &&
      parseFloat(t.quoteVolume || t.volume || 0) >= MIN_VOLUME &&
      prevPrices[t.symbol] // must have a previous price to compare
    )
    .map(t => {
      const prev = prevPrices[t.symbol];
      const curr = parseFloat(t.lastPrice);
      const move = (curr - prev) / prev;
      return { sym: t.symbol, price: curr, move, volume: parseFloat(t.quoteVolume || 0) };
    })
    .filter(t => t.move >= THRESHOLD)
    .sort((a,b) => b.move - a.move)
    .slice(0, 8);

  // Update prev prices for next scan
  tickers.forEach(t => { prevPrices[t.symbol] = parseFloat(t.lastPrice); });

  if (movers.length > 0) {
    log('⚡ ' + movers.length + ' scalp targets above +' + (THRESHOLD*100).toFixed(2) + '%');
  }

  // Enter new positions
  for (const m of movers) {
    if (Object.keys(openPositions).length >= MAX_POS || openPositions[m.sym] || dailyTrades >= DAILY_TRADE_CAP) continue;
    const qty = (POSITION_SIZE / m.price).toFixed(6);
    log('⚡ SCALP ENTRY: ' + m.sym + ' +' + (m.move*100).toFixed(3) + '% | Vol: $' + (m.volume/1e6).toFixed(1) + 'M');
    const order = await apiPost('/fapi/v1/order', { symbol: m.sym, side: 'BUY', type: 'MARKET', quantity: qty, positionSide: 'BOTH' });
    openPositions[m.sym] = { entry: m.price, qty: parseFloat(qty), openedAt: Date.now() };
    dailyTrades++; stats.trades++;
    log('✅ Entry ' + m.sym + ' | TP: $' + (m.price*(1+TAKE_PROFIT)).toFixed(6) + ' | SL: $' + (m.price*(1-STOP_LOSS)).toFixed(6));
  }

  // Check exits
  for (const [sym, pos] of Object.entries(openPositions)) {
    const t     = tickers.find(x => x.symbol === sym);
    const price = parseFloat(t?.lastPrice || pos.entry);
    const pct   = (price - pos.entry) / pos.entry;
    const age   = (Date.now() - pos.openedAt) / 1000;

    const shouldTP   = pct >= TAKE_PROFIT;
    const shouldSL   = pct <= -STOP_LOSS;
    const timeout    = age > SCAN_MS * 5 / 1000; // exit after 5 scan windows max

    if (shouldTP || shouldSL || timeout) {
      const reason = shouldTP ? '✅ TP' : shouldSL ? '🛑 SL' : '⏱️ Timeout';
      log(reason + ' EXIT: ' + sym + ' ' + (pct*100>=0?'+':'') + (pct*100).toFixed(3) + '% | $' + ((price - pos.entry)*pos.qty).toFixed(2));
      await apiPost('/fapi/v1/order', { symbol: sym, side: 'SELL', type: 'MARKET', quantity: pos.qty.toFixed(6), positionSide: 'BOTH', reduceOnly: 'true' });
      const pnl = (price - pos.entry) * pos.qty;
      stats.pnl += pnl;
      if (pnl < 0) dailyLoss += Math.abs(pnl);
      delete openPositions[sym];
    }
  }
}

function handleCommand(cmd, ws) {
  const s = m => ws.send(JSON.stringify({ type: 'log', msg: m + '\\r\\n> ' }));
  const uptime = Math.floor((Date.now() - stats.start) / 60000);
  if (cmd === 'help') s('Commands: status | positions | pause | resume | stop');
  else if (cmd === 'status') s(
    '⚡ Scalper | Open: ' + Object.keys(openPositions).length + '/' + MAX_POS +
    ' | Trades today: ' + dailyTrades + '/' + DAILY_TRADE_CAP +
    ' | PnL: $' + stats.pnl.toFixed(2) +
    ' | Loss today: $' + dailyLoss.toFixed(2) +
    ' | Uptime: ' + uptime + 'm | ' + (paused?'PAUSED':'RUNNING')
  );
  else if (cmd === 'positions') s(JSON.stringify(openPositions, null, 2));
  else if (cmd === 'pause')     { paused = true; s('⏸️ Paused — open positions held'); }
  else if (cmd === 'resume')    { paused = false; s('▶️ Running'); }
  else if (cmd === 'stop')      { stopped = true; s('🛑 Stopped'); }
  else s('Unknown: ' + cmd + '. Type help.');
}

log('⚡ Scalper Bot | Threshold: ' + (THRESHOLD*100).toFixed(2) + '% | TP: ' + (TAKE_PROFIT*100).toFixed(2) + '% | SL: ' + (STOP_LOSS*100).toFixed(2) + '% | DryRun: ' + DRY_RUN);
log('Min volume filter: $' + (MIN_VOLUME/1e6).toFixed(0) + 'M | Max positions: ' + MAX_POS + ' | Max daily trades: ' + DAILY_TRADE_CAP);
if (DRY_RUN) log('⚠️  DRY RUN MODE — simulating only, no real orders placed');
log('Initialising price baseline on first scan...');
// First scan just builds price baseline, no trades
getTickers().then(t => { t.forEach(x => { prevPrices[x.symbol] = parseFloat(x.lastPrice); }); log('✅ Baseline set. Scalping begins next scan.'); });
setInterval(scalperScan, SCAN_MS);
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// XTERM TERMINAL
// ─────────────────────────────────────────────────────────────────────────────

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#0d0d0d', foreground: '#fef9ee',
      cursor: '#ffe135', selection: 'rgba(255,225,53,0.3)',
      green: '#00c86e', yellow: '#ffe135', red: '#ff3b3b',
    },
    fontFamily: 'Courier New, monospace',
    fontSize: 13, lineHeight: 1.4, scrollback: 1000,
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('xterm-container'));
  fitAddon.fit();

  term.writeln('\x1b[33m⚡ AsterBoard Bot Terminal\x1b[0m');
  term.writeln('\x1b[90mEnter your bot host:port above and click Connect\x1b[0m');
  term.writeln('');

  let buf = '';
  term.onKey(({ key, domEvent }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (domEvent.keyCode === 13) { term.writeln(''); ws.send(buf); buf = ''; }
    else if (domEvent.keyCode === 8) { if (buf.length) { buf = buf.slice(0,-1); term.write('\b \b'); } }
    else { buf += key; term.write(key); }
  });

  window.addEventListener('resize', () => fitAddon?.fit());
}

document.getElementById('btn-connect').addEventListener('click', connectTerminal);
document.getElementById('btn-disconnect').addEventListener('click', disconnectTerminal);

function connectTerminal() {
  const host = document.getElementById('terminal-host').value.trim() || 'localhost:8080';
  if (ws) ws.close();
  if (!term) initTerminal();

  term.writeln(`\x1b[90mConnecting to ws://${host}...\x1b[0m`);
  ws = new WebSocket(`ws://${host}`);

  ws.onopen = () => {
    term.writeln('\x1b[32m✅ Connected\x1b[0m');
    document.getElementById('terminal-title').textContent = `bot — ws://${host}`;
    document.getElementById('btn-connect').style.display    = 'none';
    document.getElementById('btn-disconnect').style.display = 'inline';
  };
  ws.onmessage = e => {
    try { const d = JSON.parse(e.data); term.write(d.msg || ''); }
    catch(_) { term.write(e.data); }
  };
  ws.onerror = () => {
    term.writeln('\x1b[31m❌ Connection failed. Is the bot running?\x1b[0m');
    term.writeln('\x1b[90mRun: docker compose up -d\x1b[0m');
  };
  ws.onclose = () => {
    term.writeln('\x1b[90m— Disconnected —\x1b[0m');
    document.getElementById('terminal-title').textContent = 'bot — not connected';
    document.getElementById('btn-connect').style.display    = 'inline';
    document.getElementById('btn-disconnect').style.display = 'none';
    ws = null;
  };
}

function disconnectTerminal() {
  if (ws) { ws.close(); ws = null; }
}
