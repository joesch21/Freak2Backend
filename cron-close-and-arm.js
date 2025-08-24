import fs from 'node:fs';
import { ethers } from 'ethers';

const ABI = JSON.parse(fs.readFileSync('./public/freakyFridayGameAbi.json','utf8')); // <- no import assert
const RPC = process.env.RPC_URL;
const PK  = process.env.RELAYER_PK;
const GAME = process.env.FREAKY_CONTRACT;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(PK, provider);
const game     = new ethers.Contract(GAME, ABI, wallet);

async function closeIfEnded() {
  const active = await game.isRoundActive();
  if (!active) return false;
  const start = Number(await game.roundStart());
  const dur   = Number(await game.duration());
  const now   = Math.floor(Date.now()/1000);
  if (now >= start + dur) {
    const tx = await game.checkTimeExpired();
    console.log('[close] tx', tx.hash);
    await tx.wait();
    return true;
  }
  return false;
}

async function armIfInactive() {
  const active = await game.isRoundActive();
  if (active) return false;

  const me = await wallet.getAddress();
  // Pre-req (one-time, off-chain): relayer has GCC and has approved GAME to spend entryAmount
  const tx = await game.relayedEnter(me);
  console.log('[arm] tx', tx.hash);
  await tx.wait();
  return true;
}

(async () => {
  const closed = await closeIfEnded();
  const armed  = await armIfInactive();
  console.log(JSON.stringify({ closed, armed }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
