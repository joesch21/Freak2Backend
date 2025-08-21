/*
  ritual-bot.js

  A simple script that checks whether the current round has expired and,
  if so, calls the on‑chain `checkTimeExpired()` method.  Run this on a
  schedule (e.g. with cron or `npm run bot`) to ensure rounds are closed
  promptly when their duration elapses.

  Usage:
    node ritual-bot.js

  This script logs to stdout and exits after performing a single check.
*/

require('dotenv').config();
const { ethers } = require('ethers');

const abi = require('./public/freakyFridayGameAbi.json');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const game    = new ethers.Contract(process.env.FREAKY_ADDRESS, abi, signer);

async function main() {
  try {
    const isActive = await game.isRoundActive();
    if (!isActive) {
      console.log('No active round to check.');
      return;
    }
    const [start, duration] = await Promise.all([
      game.roundStart(),
      game.duration()
    ]);
    const now = Math.floor(Date.now() / 1000);
    const expiry = Number(start) + Number(duration);
    if (now >= expiry) {
      console.log('Round has expired; submitting checkTimeExpired transaction...');
      const tx = await game.checkTimeExpired();
      await tx.wait();
      console.log('✅ Round closed; tx hash:', tx.hash);
    } else {
      console.log('Round still active.  Seconds remaining:', expiry - now);
    }
  } catch (err) {
    console.error('Error while checking round:', err.message || err);
  }
}

main().then(() => process.exit(0));