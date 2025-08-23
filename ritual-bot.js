require('dotenv').config();
const cron = require('node-cron');
const { DateTime } = require('luxon');
const {
  isRoundActive,
  roundStart,
  duration,
  checkTimeExpired,
  setRoundMode,
} = require('./ritual-relayer');

function isFridaySydney() {
  return DateTime.now().setZone('Australia/Sydney').weekday === 5;
}

async function tryCloseRound() {
  try {
    const active = await isRoundActive();
    if (!active) return;
    const [start, dur] = await Promise.all([roundStart(), duration()]);
    const now = Math.floor(Date.now() / 1000);
    if (now >= Number(start) + Number(dur)) {
      console.log('Closing round…');
      const tx = await checkTimeExpired();
      console.log(`Close tx: ${tx.hash}`);
      await tx.wait();
    }
  } catch (err) {
    console.error('tryCloseRound error:', err.shortMessage || err.message || err);
  }
}

async function flipModeIfIdle() {
  try {
    const active = await isRoundActive();
    if (active) return;
    const mode = isFridaySydney() ? 1 : 0; // 1=Jackpot, 0=Standard
    const tx = await setRoundMode(mode);
    console.log(`Switching mode to ${mode === 1 ? 'Jackpot' : 'Standard'}, tx: ${tx.hash}`);
    await tx.wait();
  } catch (err) {
    console.error('flipModeIfIdle error:', err.shortMessage || err.message || err);
  }
}

cron.schedule('* * * * *', async () => {
  await flipModeIfIdle();
  await tryCloseRound();
});

console.log('Ritual bot started.');
