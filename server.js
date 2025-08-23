require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { tryCloseRound, syncPrizeMode } = require('./services/closer');
const { getGameContract } = require('./lib/contract');

const app = express();

// Health
app.get('/health', async (_req, res) => {
  try {
    const game = getGameContract(true);
    await game.currentRound(); // simple read
    res.send('ok');
  } catch (e) {
    console.error(e);
    res.status(500).send('bad');
  }
});

// Manual trigger (guarded and idempotent)
app.get('/close/now', async (_req, res) => {
  try {
    const result = await tryCloseRound(console);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Manual mode sync (optional)
app.get('/mode/sync', async (_req, res) => {
  try {
    await syncPrizeMode(console);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Schedulers ---
// 1) Regular heartbeat every 60s
cron.schedule('* * * * *', async () => {
  try { await tryCloseRound(console); } catch (e) { console.error(e); }
});

// 2) “Last two minutes” turbo: every 10s
cron.schedule('*/10 * * * * *', async () => {
  try {
    const game = getGameContract(true);
    if (!(await game.isRoundActive())) return;
    const start = Number(await game.roundStart());
    const dur   = Number(await game.duration());
    const now   = Math.floor(Date.now()/1000);
    const left  = start + dur - now;
    if (left <= 120) await tryCloseRound(console);
  } catch (e) { console.error(e); }
});

// 3) Mode sync every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  try { await syncPrizeMode(console); } catch (e) { console.error(e); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Freaks2 backend listening on ${PORT}`);
  console.log(`Contract: ${process.env.FREAKY_ADDRESS}`);
});
