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

const arg = (process.argv[2]||'').toLowerCase(); // "on" or "off"
const target = arg === 'on' ? 1 : 0;

(async () => {
  const cur = Number(await game.getRoundMode());
  if (cur !== target) {
    console.log(`→ mode: setRoundMode(${target})`);
    const tx = await game.setRoundMode(target);
    console.log('  tx:', tx.hash);
    await tx.wait();
    console.log('✅ mode: setRoundMode mined');
  } else {
    console.log('ℹ️ Mode already set; nothing to do.');
  }
  console.log('[mode] now =', await game.getRoundMode());
  process.exit(0);
})().catch(e => {
  console.error('❌ cron error', e?.shortMessage || e);
  process.exit(1);
});
