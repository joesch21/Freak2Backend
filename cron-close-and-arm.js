import fs from 'node:fs';
import { ethers } from 'ethers';
import { getEnv } from './env.js';

const ABI = JSON.parse(fs.readFileSync('./public/freakyFridayGameAbi.json', 'utf8'));
const { RPC_URL, FREAKY_CONTRACT, PK, missing } = getEnv();

if (missing.length) {
  console.error('❌ Missing env:', missing.join(', '));
  process.exit(1);
}

let wallet;
let game;
try {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PK, provider);
  game = new ethers.Contract(FREAKY_CONTRACT, ABI, wallet);
} catch (e) {
  console.error('❌ Failed to init wallet. Check PRIVATE_KEY/RELAYER_PK format.', e?.shortMessage || e);
  process.exit(1);
}

async function closeIfEnded() {
  const active = await game.isRoundActive().catch(() => false);
  if (!active) {
    console.log('ℹ️ Round inactive; nothing to close this tick.');
    return false;
  }

  const start = Number(await game.roundStart());
  const dur = Number(await game.duration());
  const now = Math.floor(Date.now() / 1000);
  if (now < start + dur) {
    console.log(`ℹ️ Round active, ${start + dur - now}s remaining; skipping close.`);
    return false;
  }

  console.log('→ close: calling checkTimeExpired()');
  const tx = await game.checkTimeExpired();
  console.log('  tx:', tx.hash);
  await tx.wait();
  console.log('✅ close: RoundCompleted mined');
  return true;
}

async function armIfInactive() {
  const active = await game.isRoundActive().catch(() => false);
  if (active) {
    console.log('ℹ️ Round active; nothing to arm.');
    return false;
  }

  const me = await wallet.getAddress();
  console.log(`→ arm: calling relayedEnter(${me})`);
  // Pre-req (one-time, off-chain): relayer has GCC and has approved GAME to spend entryAmount
  const tx = await game.relayedEnter(me);
  console.log('  tx:', tx.hash);
  await tx.wait();
  console.log('✅ arm: relayedEnter mined');
  return true;
}

(async () => {
  const closed = await closeIfEnded();
  const armed = await armIfInactive();
  console.log(JSON.stringify({ closed, armed }, null, 2));
  process.exit(0);
})().catch(e => {
  console.error('❌ cron error', e?.shortMessage || e);
  process.exit(1);
});
