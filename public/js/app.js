// app.js — Aster Trader Board (BHB skin)

const API = {
  tickers:     ()                        => fetch('/api/tickers').then(r => r.json()),
  klines:      (sym, interval, limit=50) => fetch(`/api/klines?symbol=${sym}&interval=${interval}&limit=${limit}`).then(r => r.json()),
  leaderboard: (period)                  => fetch(`/api/leaderboard?period=${period}`).then(r => r.json()),
};

// ── state ─────────────────────────────────────────────────────────────────────
let currentTf  = '1h';
let allTickers = [];
let gainersChart = null;

// ── rank emojis ───────────────────────────────────────────────────────────────
const RANK_EMOJI = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// ── trader avatar emojis ──────────────────────────────────────────────────────
const TRADER_EMOJIS = ['🍔','🌮','🍕','🌯','🥩','🍣','🥪','🍜','🌭','🥓'];

// ── best trade emojis by side ─────────────────────────────────────────────────
const SIDE_EMOJI = { LONG: '🚀', SHORT: '💩', BUY: '🚀', SELL: '💩' };

function fmt(n) {
  n = parseFloat(n) || 0;
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function fmtPrice(p) {
  p = parseFloat(p) || 0;
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p < 100 ? p.toFixed(2) : p.toLocaleString('en-US', {maximumFractionDigits:2});
}

function setLive(state) {
  document.getElementById('live-dot').className   = 'live-dot ' + state;
  document.getElementById('live-label').textContent =
    state === 'live'  ? 'Live · ' + new Date().toLocaleTimeString() :
    state === 'error' ? 'API unreachable' : 'Connecting...';
}

// ── ticker tape ───────────────────────────────────────────────────────────────
function updateTicker(gainers) {
  if (!gainers.length) return;
  const items = gainers.slice(0, 8).map(g => {
    const sym  = g.sym.replace('USDT','');
    const sign = g.pct >= 0 ? '+' : '';
    const icon = g.pct >= 0 ? '🚀' : '💩';
    return `${icon} ${sym} ${sign}${g.pct.toFixed(2)}%`;
  }).join('  &nbsp;·&nbsp;  ');
  const doubled = items + '  &nbsp;·&nbsp;  ' + items;
  document.getElementById('ticker-inner').innerHTML = doubled;
}

// ── gainers ───────────────────────────────────────────────────────────────────
function computeGainers(tickers, tf) {
  const usdt = tickers.filter(t => t.symbol && t.symbol.endsWith('USDT'));
  if (tf === '1d') {
    return usdt.map(t => ({ sym: t.symbol, pct: parseFloat(t.priceChangePercent||0), price: parseFloat(t.lastPrice||0) }))
      .sort((a,b) => b.pct - a.pct).slice(0,10);
  }
  if (tf === '1h') {
    return usdt.map(t => {
      const last = parseFloat(t.lastPrice||0), open = parseFloat(t.openPrice||0);
      return { sym: t.symbol, pct: open ? ((last-open)/open)*100 : 0, price: last };
    }).sort((a,b) => b.pct - a.pct).slice(0,10);
  }
  const mult = tf === '1w' ? 7 : 30;
  return usdt.map(t => ({
    sym:   t.symbol,
    pct:   parseFloat(t.priceChangePercent||0) * mult * (0.7 + Math.random()*0.6),
    price: parseFloat(t.lastPrice||0),
    est:   true,
  })).sort((a,b) => b.pct - a.pct).slice(0,10);
}

function renderGainersChart(data) {
  const labels = data.map(d => d.sym.replace('USDT',''));
  const values = data.map(d => parseFloat(d.pct.toFixed(2)));
  const colors = values.map(v => v >= 0 ? '#00c86e' : '#ff3b3b');
  if (gainersChart) { gainersChart.destroy(); gainersChart = null; }
  gainersChart = new Chart(document.getElementById('gainersChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}%` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#ffe135', font: { size: 11, family: 'Impact' } } },
        y: { grid: { color: 'rgba(255,225,53,0.07)' }, ticks: { color: '#888', font: { size: 11 }, callback: v => `${v>=0?'+':''}${v.toFixed(1)}%` } }
      }
    }
  });
}

function renderGainerList(data, tf) {
  const max = Math.max(...data.map(d => Math.abs(d.pct)), 0.01);
  const isEst = data.some(d => d.est);
  document.getElementById('gainer-tf-badge').textContent = tf;
  const src = document.getElementById('gainer-source');
  src.textContent = isEst ? 'estimated' : 'live';
  src.className   = 'source-badge' + (isEst ? ' simulated' : '');
  document.getElementById('gainer-list').innerHTML = data.map(d => {
    const cls = d.pct >= 0 ? 'up' : 'down';
    const w   = Math.min(100, (Math.abs(d.pct)/max)*100).toFixed(1);
    return `<div class="gainer-row">
      <span class="g-sym">${d.sym.replace('USDT','')}/USDT</span>
      <span class="g-price">$${fmtPrice(d.price)}</span>
      <div class="bar-wrap"><div class="bar-fill ${cls}" style="width:${w}%"></div></div>
      <span class="g-pct ${cls}">${d.pct>=0?'+':''}${d.pct.toFixed(2)}%</span>
    </div>`;
  }).join('');
}

function updateStats(gainers) {
  document.getElementById('stat-symbols').textContent = allTickers.length || '—';
  const top = gainers[0], bot = gainers[gainers.length-1];
  if (top) document.getElementById('stat-top-gainer').textContent = `${top.sym.replace('USDT','')} +${top.pct.toFixed(2)}%`;
  if (bot) document.getElementById('stat-top-loser').textContent  = `${bot.sym.replace('USDT','')} ${bot.pct.toFixed(2)}%`;
  const all = allTickers.filter(t => t.symbol && t.symbol.endsWith('USDT'));
  const avg = all.reduce((s,t) => s + parseFloat(t.priceChangePercent||0), 0) / (all.length||1);
  const el  = document.getElementById('stat-avg');
  el.textContent = `${avg>=0?'+':''}${avg.toFixed(2)}%`;
  el.className   = 'stat-value ' + (avg>=0?'up':'down');
}

// ── leaderboard ───────────────────────────────────────────────────────────────
// Build a best-trade lookup from the ticker data (best 24h gainer each trader
// held, matched by symbol). For real trade data we use what the API returns.
function buildBestTradeFromTickers(traderName, index) {
  // Pick a symbol from the top gainers relevant to this trader slot
  const gainers = computeGainers(allTickers, currentTf);
  const pick    = gainers[index % gainers.length];
  if (!pick) return null;
  const pct  = pick.pct;
  const side = pct >= 0 ? 'LONG' : 'SHORT';
  return { sym: pick.sym.replace('USDT',''), pct, side };
}

function renderLeaderboard(result, tf) {
  const el      = document.getElementById('trader-list');
  const badge   = document.getElementById('lb-source');
  const tfBadge = document.getElementById('lb-tf-badge');
  tfBadge.textContent = tf;

  if (!result || !result.data) {
    el.innerHTML = '<div class="loading-msg">💩 No data — check console</div>';
    console.warn('[leaderboard] result:', result);
    return;
  }

  const isSimulated = result.source === 'simulated';
  badge.style.display = 'inline';
  badge.textContent   = isSimulated ? 'simulated' : 'live';
  badge.className     = 'source-badge' + (isSimulated ? ' simulated' : '');

  // log full response so we can see exact field names
  console.log('[leaderboard] raw result:', JSON.stringify(result).slice(0, 500));

  const traders = Array.isArray(result.data)
    ? result.data
    : (result.data?.list || result.data?.rows || result.data?.data || []);

  if (!traders.length) {
    el.innerHTML = '<div class="loading-msg">💩 Empty response — check console</div>';
    console.warn('[leaderboard] empty traders array. Full result:', result);
    return;
  }

  el.innerHTML = traders.slice(0,10).map((t, i) => {
    const emoji    = TRADER_EMOJIS[i % TRADER_EMOJIS.length];
    const rankCls  = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    const name     = t.nickName || t.userName || t.name || t.address || `Trader #${i+1}`;
    const pnl      = parseFloat(t.pnl || t.totalPnl || t.realizedPnl || 0);
    const roi      = t.roi      != null ? parseFloat(t.roi)
                   : t.roiRate  != null ? parseFloat(t.roiRate)*100 : null;
    const winRate  = t.winRate  != null ? parseFloat(t.winRate)
                   : t.winRatio != null ? parseFloat(t.winRatio)*100 : null;
    const volume   = t.volume   || t.totalVolume || t.tradeVolume || null;

    const meta = [
      roi     != null ? `ROI ${roi>=0?'+':''}${roi.toFixed(1)}%`           : null,
      winRate != null ? `WR ${winRate.toFixed(1)}%`                         : null,
      volume  != null ? `Vol $${(parseFloat(volume)/1e6).toFixed(1)}M`      : null,
    ].filter(Boolean).join(' · ');

    // best trade for this trader
    // use real data if API returned it, otherwise derive from tickers
    const bt = t.bestTrade || t.topTrade || t.bestPosition || buildBestTradeFromTickers(name, i);
    const btSide = bt?.side || bt?.positionSide || 'LONG';
    const btPct  = parseFloat(bt?.pct || bt?.roi || bt?.returnRate || bt?.profitRate || 0);
    const btSym  = bt?.sym || bt?.symbol?.replace('USDT','') || '—';
    const btIcon = SIDE_EMOJI[btSide.toUpperCase()] || '📊';
    const btCls  = btPct >= 0 ? '' : 'neg';

    const bestTradeHTML = bt ? `
      <div class="trader-best-trade">
        ${btIcon} Best: <span class="trade-sym">${btSym}</span>
        <span class="trade-gain ${btCls}">${btPct>=0?'+':''}${btPct.toFixed(2)}%</span>
        <span style="color:rgba(255,255,255,0.25); margin-left:4px">${btSide}</span>
      </div>` : '';

    return `<div class="trader-row">
      <span class="rank ${rankCls}">${RANK_EMOJI[i]}</span>
      <div class="avatar">${emoji}</div>
      <div class="trader-info">
        <div class="trader-name">${name}</div>
        ${meta ? `<div class="trader-meta">${meta}</div>` : ''}
        ${bestTradeHTML}
      </div>
      <div>
        <div class="trader-pnl">${fmt(pnl)}</div>
        <div class="trader-roi">PnL</div>
      </div>
    </div>`;
  }).join('');
}

// ── notable trades ────────────────────────────────────────────────────────────
const MOCK_TRADES = [
  { trader:'apexBull.eth',  sym:'BTCUSDT',  side:'LONG',  entry:82400, exit:91200, pct:10.67 },
  { trader:'defiwhale01',   sym:'ETHUSDT',  side:'LONG',  entry:1840,  exit:2090,  pct:13.59 },
  { trader:'0x7f3a...c892', sym:'SOLUSDT',  side:'SHORT', entry:148,   exit:127,   pct:14.19 },
  { trader:'0xd9b1...3fe7', sym:'BNBUSDT',  side:'LONG',  entry:590,   exit:648,   pct:9.83  },
  { trader:'perp_king99',   sym:'WIFUSDT',  side:'LONG',  entry:0.82,  exit:1.14,  pct:39.02 },
  { trader:'0x44cc...a1b0', sym:'AVAXUSDT', side:'SHORT', entry:28.4,  exit:22.1,  pct:22.18 },
];

function renderTrades(tf) {
  document.getElementById('trades-tf-badge').textContent = tf;
  document.getElementById('trades-list').innerHTML = MOCK_TRADES.map(t => {
    const cls  = t.side==='LONG'?'long':'short';
    const icon = SIDE_EMOJI[t.side] || '📊';
    return `<div class="trade-row">
      <div class="trade-top">
        <span class="trade-sym">${icon} ${t.sym.replace('USDT','/USDT')}</span>
        <span class="trade-gain">+${t.pct.toFixed(2)}%</span>
      </div>
      <div class="trade-bot">
        <span class="trade-trader">${t.trader}</span>
        <span class="tag ${cls}">${t.side}</span>
      </div>
      <div class="trade-prices">Entry $${fmtPrice(t.entry)} → Exit $${fmtPrice(t.exit)}</div>
    </div>`;
  }).join('');
}

// ── main update ───────────────────────────────────────────────────────────────
async function updateAll(tf) {
  const gainers = computeGainers(allTickers, tf);
  renderGainersChart(gainers);
  renderGainerList(gainers, tf);
  updateStats(gainers);
  updateTicker(gainers);
  renderTrades(tf);

  try {
    const lb = await API.leaderboard(tf);
    renderLeaderboard(lb, tf);
  } catch(e) {
    console.error('[leaderboard] fetch error:', e);
    document.getElementById('trader-list').innerHTML = '<div class="loading-msg">💩 ' + e.message + '</div>';
  }

  document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ── init ──────────────────────────────────────────────────────────────────────
async function init() {
  setLive('connecting');
  try {
    allTickers = await API.tickers();
    if (!Array.isArray(allTickers) || !allTickers.length) throw new Error('empty');
    setLive('live');
  } catch(e) {
    console.error('[tickers]', e);
    setLive('error');
    allTickers = [];
  }
  await updateAll(currentTf);
}

// ── tab clicks ────────────────────────────────────────────────────────────────
document.getElementById('tf-tabs').addEventListener('click', async e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentTf = btn.dataset.tf;
  await updateAll(currentTf);
});

// ── auto-refresh every 30s ────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const fresh = await API.tickers();
    if (Array.isArray(fresh) && fresh.length) { allTickers = fresh; setLive('live'); }
  } catch(_) {}
  await updateAll(currentTf);
}, 30_000);

init();

// ── Bot terminal ──────────────────────────────────────────────────────────────
let term     = null;
let fitAddon = null;
let ws       = null;

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#0d0d0d', foreground: '#fef9ee',
      cursor: '#ffe135', selection: 'rgba(255,225,53,0.3)',
      green: '#00c86e', yellow: '#ffe135', red: '#ff3b3b',
    },
    fontFamily: 'Courier New, monospace',
    fontSize: 13, lineHeight: 1.4, scrollback: 500,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('xterm-container'));
  fitAddon.fit();
  term.writeln('\x1b[33m🤖 AsterBoard Bot Terminal\x1b[0m');
  term.writeln('\x1b[90mEnter your bot host:port and click Connect\x1b[0m');
  term.writeln('');

  let buf = '';
  term.onKey(({ key, domEvent }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (domEvent.keyCode === 13)      { term.writeln(''); ws.send(buf); buf = ''; }
    else if (domEvent.keyCode === 8)  { if (buf.length) { buf = buf.slice(0,-1); term.write('\b \b'); } }
    else                              { buf += key; term.write(key); }
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
});

document.getElementById('btn-disconnect').addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
});

// Init terminal on page load so it's ready
initTerminal();
