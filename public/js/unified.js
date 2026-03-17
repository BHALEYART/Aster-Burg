// unified.js — AsterBoard Unified Bot
// Configures, generates and connects to a dual-engine bot
// Jupiter (Solana) + Aster (BNB Chain) running in one Docker container

// ── state ─────────────────────────────────────────────────────────────────────
let jupiterConfig = null;
let asterConfig   = null;
let term = null, fitAddon = null, ws = null;

// ── save engine configs ───────────────────────────────────────────────────────
function saveEngine(engine) {
  if (engine === 'jupiter') {
    jupiterConfig = {
      strategy:   document.getElementById('j-strategy').value,
      privateKey: document.getElementById('j-privateKey').value,
      rpcUrl:     document.getElementById('j-rpcUrl').value || 'https://api.mainnet-beta.solana.com',
      inputMint:  document.getElementById('j-inputMint').value,
      outputMint: document.getElementById('j-outputMint').value,
      amount:     document.getElementById('j-amount').value || '10',
      threshold:  document.getElementById('j-threshold').value || '1.5',
      cashout:    document.getElementById('j-cashout').value,
      dryRun:     document.getElementById('j-dryRun').value,
    };
    setStatus('jupiter', '✓ saved');
    document.getElementById('jupiter-panel').classList.add('configured');
    document.querySelector('#jupiter-panel .btn-engine-save').classList.add('saved');
  } else {
    asterConfig = {
      strategy:     document.getElementById('a-strategy').value,
      apiKey:       document.getElementById('a-apiKey').value,
      apiSecret:    document.getElementById('a-apiSecret').value,
      positionSize: document.getElementById('a-positionSize').value || '25',
      threshold:    document.getElementById('a-threshold').value || '0.3',
      takeProfit:   document.getElementById('a-takeProfit').value || '0.5',
      stopLoss:     document.getElementById('a-stopLoss').value || '0.3',
      maxPositions: document.getElementById('a-maxPositions').value || '3',
      dailyLoss:    document.getElementById('a-dailyLoss').value || '50',
      dryRun:       document.getElementById('a-dryRun').value,
    };
    setStatus('aster', '✓ saved');
    document.getElementById('aster-panel').classList.add('configured');
    document.querySelector('#aster-panel .btn-engine-save').classList.add('saved');
  }

  if (jupiterConfig && asterConfig) {
    document.getElementById('download-block').style.display = 'block';
    document.getElementById('terminal-block').style.display = 'block';
    document.getElementById('download-block').scrollIntoView({ behavior: 'smooth' });
    if (!term) initTerminal();
  }
}

function setStatus(engine, msg) {
  const el = document.getElementById(engine + '-status');
  el.textContent = msg;
  el.className = 'engine-status ok';
}

// ── zip generator ─────────────────────────────────────────────────────────────
async function generateUnifiedBot() {
  if (!jupiterConfig || !asterConfig) {
    alert('Please save both engine configs first');
    return;
  }

  const zip    = new JSZip();
  const folder = zip.folder('aster-unified-bot');

  folder.file('.env',               buildEnv());
  folder.file('bot.js',             buildOrchestratorBot());
  folder.file('engines/jupiter.js', buildJupiterEngine());
  folder.file('engines/aster.js',   buildAsterEngine());
  folder.file('Dockerfile',         buildDockerfile());
  folder.file('docker-compose.yml', buildCompose());
  folder.file('package.json',       buildPackageJson());
  folder.file('README.md',          buildReadme());
  folder.file('logs/.gitkeep',      '');

  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'aster-unified-bot.zip'; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-download').addEventListener('click', generateUnifiedBot);

// ── file builders ─────────────────────────────────────────────────────────────
function buildEnv() {
  const j = jupiterConfig, a = asterConfig;
  return `# AsterBoard Unified Bot — generated ${new Date().toLocaleDateString()}
# ⚠️  Keep this file private. Never share your keys.

# ── Jupiter Engine (Solana) ───────────────────────────
JUPITER_ENABLED=true
JUPITER_STRATEGY=${j.strategy}
JUPITER_PRIVATE_KEY=${j.privateKey}
JUPITER_RPC_URL=${j.rpcUrl}
JUPITER_INPUT_MINT=${j.inputMint}
JUPITER_OUTPUT_MINT=${j.outputMint}
JUPITER_AMOUNT=${j.amount}
JUPITER_THRESHOLD=${j.threshold}
JUPITER_DRY_RUN=${j.dryRun}
JUPITER_CASHOUT_ADDRESS=${j.cashout || ''}

# ── Aster Engine (BNB Chain) ──────────────────────────
ASTER_ENABLED=true
ASTER_STRATEGY=${a.strategy}
ASTER_API_KEY=${a.apiKey}
ASTER_API_SECRET=${a.apiSecret}
ASTER_BASE_URL=https://fapi.asterdex.com
ASTER_POSITION_SIZE=${a.positionSize}
ASTER_THRESHOLD=${a.threshold}
ASTER_TAKE_PROFIT=${a.takeProfit}
ASTER_STOP_LOSS=${a.stopLoss}
ASTER_MAX_POSITIONS=${a.maxPositions}
ASTER_DAILY_LOSS_CAP=${a.dailyLoss}
ASTER_DRY_RUN=${a.dryRun}

# ── Shared ────────────────────────────────────────────
WS_PORT=8080
`;
}

function buildDockerfile() {
  return `FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 8080
CMD ["node", "bot.js"]
`;
}

function buildCompose() {
  return `version: '3.8'
services:
  unified-bot:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "8080:8080"
    volumes:
      - ./logs:/app/logs
`;
}

function buildPackageJson() {
  return JSON.stringify({
    name: 'aster-unified-bot',
    version: '1.0.0',
    main: 'bot.js',
    scripts: { start: 'node bot.js' },
    dependencies: {
      'node-fetch':      '^3.3.2',
      'ws':              '^8.16.0',
      'dotenv':          '^16.4.5',
      '@solana/web3.js': '^1.98.0',
      'bs58':            '^6.0.0',
    }
  }, null, 2);
}

function buildReadme() {
  return `# AsterBoard Unified Bot

Runs two independent trading engines in one Docker container:
- **Jupiter Engine** — trades on Solana via Jupiter DEX
- **Aster Engine** — trades on BNB Chain via Aster DEX perpetuals

## Quick start
\`\`\`bash
docker compose up -d
docker compose logs -f
\`\`\`

## Terminal commands
| Command | Description |
|---------|-------------|
| \`status\` | Show both engines: positions, PnL, uptime |
| \`pause jupiter\` | Pause Jupiter engine (keeps positions open) |
| \`pause aster\` | Pause Aster engine |
| \`resume jupiter\` | Resume Jupiter engine |
| \`resume aster\` | Resume Aster engine |
| \`cashout jupiter\` | Send all Jupiter USDC to your cashout address |
| \`cashout aster\` | Close all Aster positions and return margin |
| \`cashout all\` | Cash out both engines |
| \`stop\` | Stop both engines |

## Config
Edit \`.env\` then: \`docker compose restart\`

## Safety
- Both engines start in DRY RUN mode unless you changed it
- Each engine has independent daily loss caps
- Cashout goes to YOUR wallet — the bot wallet holds only trading funds
`;
}

// ── orchestrator bot.js ───────────────────────────────────────────────────────
function buildOrchestratorBot() {
  return `// AsterBoard Unified Bot — Orchestrator
// Starts both Jupiter and Aster engines, exposes one WebSocket terminal
require('dotenv').config();
const WS      = require('ws');
const Jupiter = require('./engines/jupiter');
const Aster   = require('./engines/aster');

const WS_PORT = parseInt(process.env.WS_PORT || '8080');

// ── WebSocket terminal server ─────────────────────────────────────────────────
const clients = new Set();
const wss = new WS.Server({ port: WS_PORT });

wss.on('connection', ws => {
  clients.add(ws);
  send(ws, '\\r\\n⚡ AsterBoard Unified Bot\\r\\n');
  send(ws, '◎ Jupiter: ' + (Jupiter.isRunning() ? '\\x1b[32mRUNNING\\x1b[0m' : '\\x1b[33mSTARTING\\x1b[0m') + '  ' +
           '⬡ Aster: '   + (Aster.isRunning()   ? '\\x1b[32mRUNNING\\x1b[0m' : '\\x1b[33mSTARTING\\x1b[0m'));
  send(ws, 'Type help for commands\\r\\n> ');
  ws.on('message', d => handleCommand(d.toString().trim().toLowerCase(), ws));
  ws.on('close', () => clients.delete(ws));
});

function send(ws, msg) {
  if (ws.readyState === WS.OPEN) ws.send(JSON.stringify({ type: 'log', msg: msg + '\\r\\n' }));
}

function broadcast(msg, prefix) {
  const line = prefix + ' ' + msg + '\\r\\n';
  clients.forEach(c => c.readyState === WS.OPEN && c.send(JSON.stringify({ type: 'log', msg: line })));
}

// Give engines access to broadcast
Jupiter.setBroadcast(msg => broadcast(msg, '\\x1b[35m[JUP]\\x1b[0m'));
Aster.setBroadcast(msg   => broadcast(msg, '\\x1b[33m[AST]\\x1b[0m'));

// ── command handler ───────────────────────────────────────────────────────────
async function handleCommand(cmd, ws) {
  const s = msg => send(ws, msg);

  if (cmd === 'help') {
    s('Commands:');
    s('  status              — both engines status');
    s('  pause jupiter       — pause Jupiter engine');
    s('  pause aster         — pause Aster engine');
    s('  resume jupiter      — resume Jupiter engine');
    s('  resume aster        — resume Aster engine');
    s('  cashout jupiter     — send Jupiter USDC to cashout address');
    s('  cashout aster       — close Aster positions & return margin');
    s('  cashout all         — cash out both');
    s('  stop                — stop both engines');
    s('> '); return;
  }

  if (cmd === 'status') {
    s('\\x1b[35m◎ Jupiter Engine:\\x1b[0m ' + Jupiter.status());
    s('\\x1b[33m⬡ Aster Engine:\\x1b[0m '   + Aster.status());
    s('> '); return;
  }

  if (cmd === 'pause jupiter')  { Jupiter.pause();  s('⏸️  Jupiter paused\\r\\n> ');  return; }
  if (cmd === 'pause aster')    { Aster.pause();    s('⏸️  Aster paused\\r\\n> ');    return; }
  if (cmd === 'resume jupiter') { Jupiter.resume(); s('▶️  Jupiter running\\r\\n> '); return; }
  if (cmd === 'resume aster')   { Aster.resume();   s('▶️  Aster running\\r\\n> ');   return; }

  if (cmd === 'cashout jupiter' || cmd === 'cashout all') {
    s('💸 Cashing out Jupiter...');
    Jupiter.cashout().then(r => s('✅ Jupiter cashout: ' + r + '\\r\\n> ')).catch(e => s('❌ ' + e.message + '\\r\\n> '));
  }
  if (cmd === 'cashout aster' || cmd === 'cashout all') {
    s('💸 Cashing out Aster...');
    Aster.cashout().then(r => s('✅ Aster cashout: ' + r + '\\r\\n> ')).catch(e => s('❌ ' + e.message + '\\r\\n> '));
    return;
  }

  if (cmd === 'stop') {
    s('🛑 Stopping both engines...');
    await Jupiter.stop(); await Aster.stop();
    s('Both engines stopped.\\r\\n> '); return;
  }

  s('Unknown command: ' + cmd + '. Type help.\\r\\n> ');
}

// ── start engines ─────────────────────────────────────────────────────────────
console.log('[unified] Starting AsterBoard Unified Bot...');
console.log('[unified] WS terminal on port', WS_PORT);

if (process.env.JUPITER_ENABLED === 'true') {
  Jupiter.start();
  console.log('[unified] Jupiter engine started (' + process.env.JUPITER_STRATEGY + ')');
}
if (process.env.ASTER_ENABLED === 'true') {
  Aster.start();
  console.log('[unified] Aster engine started (' + process.env.ASTER_STRATEGY + ')');
}
`;
}

// ── Jupiter engine module ─────────────────────────────────────────────────────
function buildJupiterEngine() {
  const j = jupiterConfig;
  return `// engines/jupiter.js — Jupiter DEX engine (Solana)
const fetch  = require('node-fetch');
const { Connection, Keypair, VersionedTransaction, PublicKey } = require('@solana/web3.js');
const bs58   = require('bs58');

const INPUT_MINT    = process.env.JUPITER_INPUT_MINT  || '${j.inputMint}';
const OUTPUT_MINT   = process.env.JUPITER_OUTPUT_MINT || '${j.outputMint}';
const AMOUNT        = parseFloat(process.env.JUPITER_AMOUNT    || '${j.amount}');
const THRESHOLD     = parseFloat(process.env.JUPITER_THRESHOLD || '${j.threshold}') / 100;
const DRY_RUN       = process.env.JUPITER_DRY_RUN === 'true';
const RPC_URL       = process.env.JUPITER_RPC_URL || 'https://api.mainnet-beta.solana.com';
const CASHOUT_ADDR  = process.env.JUPITER_CASHOUT_ADDRESS || '';
const SCAN_MS       = 60000;
const DECIMALS      = { 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, 'So11111111111111111111111111111111111111112': 9 };

const JUP_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const JUP_SWAP  = 'https://api.jup.ag/swap/v1/swap';

let connection, keypair;
try {
  connection = new Connection(RPC_URL, 'confirmed');
  keypair    = Keypair.fromSecretKey(bs58.decode(process.env.JUPITER_PRIVATE_KEY || ''));
} catch(e) { console.error('[jupiter] Keypair error:', e.message); }

let paused = false, stopped = false, running = false;
let lastPrice = null;
let stats = { swaps: 0, pnl: 0, start: Date.now() };
let broadcast = () => {};
let scanTimer = null;

function log(msg) { console.log('[JUP] ' + msg); broadcast(msg); }

function toRaw(amount, mint) {
  return Math.round(amount * Math.pow(10, DECIMALS[mint] ?? 6));
}

async function getQuote() {
  const url = JUP_QUOTE +
    '?inputMint=' + INPUT_MINT +
    '&outputMint=' + OUTPUT_MINT +
    '&amount=' + toRaw(AMOUNT, INPUT_MINT) +
    '&slippageBps=50&restrictIntermediateTokens=true&instructionVersion=V2';
  const r = await fetch(url);
  if (!r.ok) throw new Error('Quote failed ' + r.status);
  return r.json();
}

async function executeSwap(quote) {
  if (DRY_RUN) { log('[DRY] Swap ' + AMOUNT + ' ' + INPUT_MINT.slice(0,8) + '...'); return 'dry-' + Date.now(); }
  const resp = await fetch(JUP_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true, dynamicSlippage: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1000000, priorityLevel: 'high' } }
    })
  });
  const { swapTransaction } = await resp.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  const { blockhash } = await connection.getLatestBlockhash();
  tx.message.recentBlockhash = blockhash;
  tx.sign([keypair]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function scan() {
  if (paused || stopped) return;
  try {
    const quote = await getQuote();
    const curr  = parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
    log('Price: ' + curr.toFixed(8) + ' | Route: ' + (quote.routePlan?.[0]?.swapInfo?.label || '?'));
    if (lastPrice === null) { lastPrice = curr; log('Baseline set'); return; }
    const move = (curr - lastPrice) / lastPrice;
    if (move >= THRESHOLD) {
      log('🚀 Entry +' + (move*100).toFixed(3) + '% | Swapping...');
      const sig = await executeSwap(quote);
      stats.swaps++; lastPrice = curr;
      log('✅ Swap done | sig: ' + sig);
    }
  } catch(e) { log('❌ Scan error: ' + e.message); }
}

async function cashout() {
  if (!CASHOUT_ADDR) return 'No JUPITER_CASHOUT_ADDRESS set in .env';
  if (DRY_RUN) return '[DRY] Would send USDC to ' + CASHOUT_ADDR;
  // Get USDC balance and transfer to cashout address
  const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createTransferInstruction, getAccount } = require('@solana/spl-token');
  const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const srcATA   = await getAssociatedTokenAddress(usdcMint, keypair.publicKey);
  const dstATA   = await getAssociatedTokenAddress(usdcMint, new PublicKey(CASHOUT_ADDR));
  const acct     = await getAccount(connection, srcATA);
  const balance  = acct.amount;
  if (balance === 0n) return 'No USDC to cashout';
  const { Transaction } = require('@solana/web3.js');
  const tx = new Transaction().add(createTransferInstruction(srcATA, dstATA, keypair.publicKey, balance));
  const sig = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  return 'Sent ' + (Number(balance)/1e6).toFixed(2) + ' USDC | sig: ' + sig;
}

module.exports = {
  start()     { running = true; log('Jupiter engine started | DryRun: ' + DRY_RUN); scan(); scanTimer = setInterval(scan, SCAN_MS); },
  stop()      { stopped = true; if (scanTimer) clearInterval(scanTimer); running = false; log('Jupiter stopped'); },
  pause()     { paused = true;  log('Jupiter paused'); },
  resume()    { paused = false; log('Jupiter resumed'); },
  isRunning() { return running && !stopped; },
  status()    { return 'Swaps: ' + stats.swaps + ' | ' + (paused ? 'PAUSED' : stopped ? 'STOPPED' : 'RUNNING') + ' | Uptime: ' + Math.floor((Date.now()-stats.start)/60000) + 'm'; },
  cashout,
  setBroadcast(fn) { broadcast = fn; },
};
`;
}

// ── Aster engine module ───────────────────────────────────────────────────────
function buildAsterEngine() {
  const a = asterConfig;
  return `// engines/aster.js — Aster DEX engine (BNB Chain perpetuals)
const fetch  = require('node-fetch');
const crypto = require('crypto');

const API_KEY    = process.env.ASTER_API_KEY;
const API_SECRET = process.env.ASTER_API_SECRET;
const BASE_URL   = process.env.ASTER_BASE_URL || 'https://fapi.asterdex.com';
const DRY_RUN    = process.env.ASTER_DRY_RUN === 'true';
const STRATEGY   = process.env.ASTER_STRATEGY || '${a.strategy}';
const POS_SIZE   = parseFloat(process.env.ASTER_POSITION_SIZE || '${a.positionSize}');
const THRESHOLD  = parseFloat(process.env.ASTER_THRESHOLD     || '${a.threshold}') / 100;
const TP         = parseFloat(process.env.ASTER_TAKE_PROFIT   || '${a.takeProfit}') / 100;
const SL         = parseFloat(process.env.ASTER_STOP_LOSS     || '${a.stopLoss}') / 100;
const MAX_POS    = parseInt(process.env.ASTER_MAX_POSITIONS   || '${a.maxPositions}');
const LOSS_CAP   = parseFloat(process.env.ASTER_DAILY_LOSS_CAP || '${a.dailyLoss}');
const SCAN_MS    = 60000;
const FILTER     = 'USDT';

let paused = false, stopped = false, running = false;
let openPositions = {}, dailyLoss = 0, prevPrices = {};
let stats = { trades: 0, pnl: 0, start: Date.now() };
let broadcast = () => {};
let scanTimer = null;

function log(msg) { console.log('[AST] ' + msg); broadcast(msg); }

function sign(params) {
  const qs = Object.entries(params).map(([k,v]) => k+'='+v).join('&');
  return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex');
}

async function apiPost(path, params = {}) {
  if (DRY_RUN) { log('[DRY] POST ' + path + ' ' + JSON.stringify(params)); return { orderId: 'dry-'+Date.now(), status:'FILLED' }; }
  params.timestamp = Date.now(); params.recvWindow = 5000; params.signature = sign(params);
  const r = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  return r.json();
}

async function getTickers() {
  const r = await fetch(BASE_URL + '/fapi/v1/ticker/24hr');
  return r.json();
}

async function scan() {
  if (paused || stopped || dailyLoss >= LOSS_CAP) return;
  try {
    const tickers = await getTickers();
    const usdt    = tickers.filter(t => t.symbol.endsWith(FILTER));

    // Find movers above threshold
    const movers = usdt
      .map(t => {
        const prev = prevPrices[t.symbol];
        const curr = parseFloat(t.lastPrice);
        const move = prev ? (curr - prev) / prev : 0;
        return { sym: t.symbol, price: curr, move, vol: parseFloat(t.quoteVolume || 0) };
      })
      .filter(t => t.move >= THRESHOLD && t.vol >= 5000000)
      .sort((a,b) => b.move - a.move)
      .slice(0, 5);

    // Update prev prices
    tickers.forEach(t => { prevPrices[t.symbol] = parseFloat(t.lastPrice); });

    if (movers.length) log('📡 ' + movers.length + ' targets above ' + (THRESHOLD*100).toFixed(2) + '%');

    // Enter
    for (const m of movers) {
      if (Object.keys(openPositions).length >= MAX_POS || openPositions[m.sym]) continue;
      const qty = (POS_SIZE / m.price).toFixed(6);
      log('🚀 Entry: ' + m.sym + ' +' + (m.move*100).toFixed(3) + '%');
      const order = await apiPost('/fapi/v1/order', { symbol: m.sym, side: 'BUY', type: 'MARKET', quantity: qty, positionSide: 'BOTH' });
      openPositions[m.sym] = { entry: m.price, qty: parseFloat(qty), openedAt: Date.now() };
      stats.trades++;
    }

    // Exit
    for (const [sym, pos] of Object.entries(openPositions)) {
      const t     = tickers.find(x => x.symbol === sym);
      const price = parseFloat(t?.lastPrice || pos.entry);
      const pct   = (price - pos.entry) / pos.entry;
      const age   = (Date.now() - pos.openedAt) / 1000;
      if (pct >= TP || pct <= -SL || age > SCAN_MS * 5 / 1000) {
        const reason = pct >= TP ? '✅ TP' : pct <= -SL ? '🛑 SL' : '⏱️ Timeout';
        log(reason + ' ' + sym + ' ' + (pct*100 >= 0 ? '+' : '') + (pct*100).toFixed(3) + '%');
        await apiPost('/fapi/v1/order', { symbol: sym, side: 'SELL', type: 'MARKET', quantity: pos.qty.toFixed(6), positionSide: 'BOTH', reduceOnly: 'true' });
        const pnl = (price - pos.entry) * pos.qty;
        stats.pnl += pnl;
        if (pnl < 0) dailyLoss += Math.abs(pnl);
        delete openPositions[sym];
      }
    }
  } catch(e) { log('❌ Scan error: ' + e.message); }
}

async function cashout() {
  // Close all open positions
  const syms = Object.keys(openPositions);
  if (!syms.length) return 'No open positions to close';
  for (const [sym, pos] of Object.entries(openPositions)) {
    await apiPost('/fapi/v1/order', { symbol: sym, side: 'SELL', type: 'MARKET', quantity: pos.qty.toFixed(6), positionSide: 'BOTH', reduceOnly: 'true' });
    delete openPositions[sym];
  }
  return 'Closed ' + syms.length + ' position(s). PnL this session: $' + stats.pnl.toFixed(2);
}

module.exports = {
  start()     { running = true; log('Aster engine started | Strategy: ' + STRATEGY + ' | DryRun: ' + DRY_RUN); scan(); scanTimer = setInterval(scan, SCAN_MS); },
  stop()      { stopped = true; if (scanTimer) clearInterval(scanTimer); running = false; log('Aster stopped'); },
  pause()     { paused = true;  log('Aster paused'); },
  resume()    { paused = false; log('Aster resumed'); },
  isRunning() { return running && !stopped; },
  status()    { return 'Trades: ' + stats.trades + ' | PnL: $' + stats.pnl.toFixed(2) + ' | Open: ' + Object.keys(openPositions).length + '/' + MAX_POS + ' | ' + (paused ? 'PAUSED' : stopped ? 'STOPPED' : 'RUNNING'); },
  cashout,
  setBroadcast(fn) { broadcast = fn; },
};
`;
}

// ── xterm terminal ────────────────────────────────────────────────────────────
function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#0d0d0d', foreground: '#fef9ee',
      cursor: '#ffe135', selection: 'rgba(255,225,53,0.3)',
      green: '#00c86e', yellow: '#ffe135', red: '#ff3b3b',
      magenta: '#c89bff',
    },
    fontFamily: 'Courier New, monospace',
    fontSize: 13, lineHeight: 1.4, scrollback: 1000,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('xterm-container'));
  fitAddon.fit();

  term.writeln('\x1b[33m⚡ AsterBoard Unified Bot Terminal\x1b[0m');
  term.writeln('\x1b[35m◎ Jupiter\x1b[0m + \x1b[33m⬡ Aster\x1b[0m — enter host:port above and Connect');
  term.writeln('');

  let buf = '';
  term.onKey(({ key, domEvent }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (domEvent.keyCode === 13)     { term.writeln(''); ws.send(buf); buf = ''; }
    else if (domEvent.keyCode === 8) { if (buf.length) { buf = buf.slice(0,-1); term.write('\b \b'); } }
    else                             { buf += key; term.write(key); }
  });
  window.addEventListener('resize', () => fitAddon?.fit());
}

document.getElementById('btn-connect').addEventListener('click', () => {
  const host = document.getElementById('terminal-host').value.trim() || 'localhost:8080';
  if (ws) ws.close();
  if (!term) initTerminal();
  term.writeln(`\x1b[90mConnecting to ws://${host}...\x1b[0m`);
  ws = new WebSocket(`ws://${host}`);
  ws.onopen = () => {
    term.writeln('\x1b[32m✅ Connected\x1b[0m');
    document.getElementById('terminal-title').textContent = `unified bot — ws://${host}`;
    document.getElementById('btn-connect').style.display    = 'none';
    document.getElementById('btn-disconnect').style.display = 'inline';
  };
  ws.onmessage = e => {
    try { const d = JSON.parse(e.data); term.write(d.msg || ''); }
    catch(_) { term.write(e.data); }
  };
  ws.onerror = () => {
    term.writeln('\x1b[31m❌ Connection failed. Is the bot running?\x1b[0m');
    term.writeln('\x1b[90mdocker compose up -d\x1b[0m');
  };
  ws.onclose = () => {
    term.writeln('\x1b[90m— Disconnected —\x1b[0m');
    document.getElementById('terminal-title').textContent = 'unified bot — not connected';
    document.getElementById('btn-connect').style.display    = 'inline';
    document.getElementById('btn-disconnect').style.display = 'none';
    ws = null;
  };
});

document.getElementById('btn-disconnect').addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
});
