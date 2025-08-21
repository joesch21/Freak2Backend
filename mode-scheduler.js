import 'dotenv/config';
import cron from 'node-cron';
import { DateTime } from 'luxon';
import { ethers } from 'ethers';
import abi from './public/freakyFridayGameAbi.json' assert { type: 'json' };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const game     = new ethers.Contract(process.env.FREAKY_ADDRESS, abi, signer);

const PrizeMode = { Standard: 0, Jackpot: 1 };

async function flipModeIfNeeded() {
  try {
    const active = await game.isRoundActive();
    if (active) return;
    const tz = process.env.TIMEZONE || 'Australia/Sydney';
    const now = DateTime.now().setZone(tz);
    const isFriday = now.weekday === 5;
    const desired = isFriday ? PrizeMode.Jackpot : PrizeMode.Standard;
    const current = await (game.getRoundMode ? game.getRoundMode() : game.roundMode());
    if (Number(current) !== desired) {
      const tx = await game.setRoundMode(desired);
      await tx.wait();
      console.log(`[${now.toISO()}] Mode switched to ${isFriday ? 'Jackpot' : 'Standard'} (tx: ${tx.hash})`);
    }
  } catch (err) {
    console.error('mode-scheduler error:', err.message || err);
  }
}

cron.schedule('0 * * * *', flipModeIfNeeded, {
  timezone: process.env.TIMEZONE || 'Australia/Sydney'
});

console.log('Mode scheduler started.  Checking prize mode hourly…');
flipModeIfNeeded();
