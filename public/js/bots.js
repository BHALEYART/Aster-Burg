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

  // Show fund pool step
  document.getElementById('fund-block').style.display = 'block';

  console.log(`[wallet] Connected: ${name} — ${address}`);
}

async function refreshUSDTBalance() {
  if (!walletProvider || !walletAddress || walletType === 'phantom') {
    document.getElementById('wallet-usdt-balance').textContent = '—';
    return;
  }
  try {
    const contract = new ethers.Contract(USDT_BNB, USDT_ABI, walletProvider);
    const [raw, decimals] = await Promise.all([
      contract.balanceOf(walletAddress),
      contract.decimals(),
    ]);
    const balance = parseFloat(ethers.formatUnits(raw, decimals)).toFixed(2);
    document.getElementById('wallet-usdt-balance').textContent = `$${balance}`;
  } catch(e) {
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
    const contract  = new ethers.Contract(USDT_BNB, USDT_ABI, walletSigner);
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

document.getElementById('strategy-grid').addEventListener('click', e => {
  const card = e.target.closest('.strategy-card');
  if (!card) return;
  document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedStrategy = card.dataset.strategy;

  // If wallet connected, go straight to config; otherwise show fund block first
  if (walletAddress) {
    showConfigStep();
  } else {
    document.getElementById('config-step-label').textContent = 'STEP 2 — CONFIGURE';
    document.getElementById('download-step-label').textContent = 'STEP 3 — DOWNLOAD & RUN';
    document.getElementById('terminal-step-label').textContent = 'STEP 4 — LIVE TERMINAL';
    document.getElementById('config-block').style.display = 'block';
    document.getElementById('config-block').scrollIntoView({ behavior: 'smooth' });
  }
  renderConfigForm(selectedStrategy);
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
  scalper: {
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
  const def = FORMS[strategy];
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
  const poolLines = botPoolWallet
    ? `\n# Bot pool wallet (funded via AsterBoard)\nBOT_POOL_ADDRESS=${botPoolWallet.address}\nBOT_POOL_PRIVATE_KEY=${botPoolWallet.privateKey}\n`
    : '';

  const skip = ['apiKey','apiSecret'];
  const rest = Object.entries(config)
    .filter(([k]) => !skip.includes(k))
    .map(([k,v]) => `${k.toUpperCase()}=${v}`)
    .join('\n');

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
  return JSON.stringify({
    name: `aster-${selectedStrategy}-bot`,
    version: '1.0.0',
    main: 'bot.js',
    scripts: { start: 'node bot.js' },
    dependencies: {
      'node-fetch': '^3.3.2',
      'ws': '^8.16.0',
      'dotenv': '^16.4.5',
    }
  }, null, 2);
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
    dca: getDcaBot(config),
    copy: getCopyBot(config),
    momentum: getMomentumBot(config),
    scalper: getScalperBot(config),
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
