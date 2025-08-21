/*
  mode-scheduler.js

  This script automatically flips the FreakyFriday game’s prize mode based on
  the day of the week in the configured timezone.  On Fridays (weekday 5 in
  ISO‑8601), the mode is set to Jackpot (1); on all other days it is set to
  Standard (0).  The mode is only changed when no round is active.

  Run this script as a long‑lived process (e.g. via npm run scheduler).  It
  schedules itself to run once per hour, but you can adjust the cron
  expression below to suit your needs.
*/

require('dotenv').config();
const cron = require('node-cron');
const { DateTime } = require('luxon');
const { ethers } = require('ethers');

const abi = require('./public/freakyFridayGameAbi.json');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const game    = new ethers.Contract(process.env.FREAKY_ADDRESS, abi, signer);

const PrizeMode = { Standard: 0, Jackpot: 1 };

async function flipModeIfNeeded() {
  try {
    const active = await game.isRoundActive();
    if (active) return; // never flip mid‑round
    const tz = process.env.TIMEZONE || 'Australia/Sydney';
    const now = DateTime.now().setZone(tz);
    const isFriday = now.weekday === 5; // ISO weekday: 1 = Monday, 5 = Friday
    const desired = isFriday ? PrizeMode.Jackpot : PrizeMode.Standard;
    // Prefer explicit getter; fallback to public var
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

// Schedule the task to run at the top of every hour.  Adjust as needed.
cron.schedule('0 * * * *', flipModeIfNeeded, {
  timezone: process.env.TIMEZONE || 'Australia/Sydney'
});

console.log('Mode scheduler started.  Checking prize mode hourly…');

// Immediately check once on start
flipModeIfNeeded();