import fs from 'node:fs';
import { ethers } from 'ethers';

const ABI = JSON.parse(fs.readFileSync('./public/freakyFridayGameAbi.json','utf8'));
const RPC = process.env.RPC_URL;
const PK  = process.env.RELAYER_PK;
const GAME= process.env.FREAKY_CONTRACT;
const provider = new ethers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(PK, provider);
const game     = new ethers.Contract(GAME, ABI, wallet);

const arg = (process.argv[2]||'').toLowerCase(); // "on" or "off"
const target = arg === 'on' ? 1 : 0;

(async () => {
  const cur = Number(await game.getRoundMode());
  if (cur !== target) {
    const tx = await game.setRoundMode(target);
    console.log('[mode] tx', tx.hash);
    await tx.wait();
  }
  console.log('[mode] now =', await game.getRoundMode());
})().catch(e => { console.error(e); process.exit(1); });
