/*
  ritual-bot.js

  A simple script that checks whether the current round has expired and,
  if so, calls the on‑chain `checkTimeExpired()` method. It can run once as
  a cron job or loop periodically as a background worker.

  Usage:
    node ritual-bot.js

  This script logs to stdout and exits after performing a single check.
*/

require('dotenv').config();
const { ethers } = require('ethers');

const abi = require('./public/freakyFridayGameAbi.json');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const game     = new ethers.Contract(process.env.FREAKY_ADDRESS, abi, signer);

const LOOP_SECONDS = Number(process.env.LOOP_SECONDS || 60);
const ONE_SHOT = process.env.ONE_SHOT === 'true';

async function checkRound() {
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
    if (now < expiry) {
      console.log('Not expired yet. Seconds remaining:', expiry - now);
      return;
    }
    // Dry run to ensure the transaction will succeed
    await game.checkTimeExpired.staticCall();
    const tx = await game.checkTimeExpired();
    await tx.wait();
    console.log('✅ Round closed; tx hash:', tx.hash);
  } catch (err) {
    console.error('Error while checking round:', err.message || err);
  }
}

async function run() {
  await checkRound();
  if (!ONE_SHOT) {
    setTimeout(run, LOOP_SECONDS * 1000);
  }
}

run();
