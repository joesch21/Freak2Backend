import fs from 'fs';
import { DateTime } from 'luxon';
import { ethers } from 'ethers';
import { getEnv } from './env.js';

const { RPC_URL, FREAKY_CONTRACT, PK, missing } = getEnv();
const JACKPOT_TZ = process.env.JACKPOT_TZ || 'Australia/Sydney';

if (missing.length) {
  console.error('❌ Missing env:', missing.join(', '));
  process.exit(1);
}

// Load ABI without JSON assert (Render Node v24 quirk)
const gameAbi = JSON.parse(fs.readFileSync('./public/freakyFridayGameAbi.json', 'utf8'));

let wallet;
let game;
try {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PK, provider);
  game = new ethers.Contract(FREAKY_CONTRACT, gameAbi, wallet);
} catch (e) {
  console.error('❌ Failed to init wallet. Check PRIVATE_KEY/RELAYER_PK format.', e?.shortMessage || e);
  process.exit(1);
}

function isFridaySydney(tsSec) {
  const dt = DateTime.fromSeconds(tsSec, { zone: JACKPOT_TZ });
  return dt.weekday === 5; // 1=Mon..7=Sun -> 5 is Friday
}

async function run() {
  try {
    const active = await game.isRoundActive();

    // If idle, ensure mode based on Sydney Friday
    if (!active) {
      const target = isFridaySydney(Math.floor(Date.now() / 1000)) ? 1 : 0; // 0=Standard, 1=Jackpot
      if (typeof game.getRoundMode === 'function') {
        const current = Number(await game.getRoundMode());
        if (current !== target && typeof game.setRoundMode === 'function') {
          console.log(`→ mode: setRoundMode(${target})`);
          const tx = await game.setRoundMode(target);
          console.log('  tx:', tx.hash);
          await tx.wait();
          console.log('✅ mode: setRoundMode mined');
        }
      }
      console.log('ℹ️ Round inactive; nothing to close this tick.');
      process.exit(0);
    }

    // If active, close when expired
    const start = Number(await game.roundStart());
    const duration = Number(await game.duration());
    const endTs = start + duration;
    const now = Math.floor(Date.now() / 1000);

    if (now < endTs) {
      console.log(`ℹ️ Round active, ${endTs - now}s remaining; nothing to close.`);
      process.exit(0);
    }

    console.log('→ close: calling checkTimeExpired()');
    const tx = await game.checkTimeExpired();
    console.log('  tx:', tx.hash);
    const rcpt = await tx.wait();
    console.log(`✅ close: RoundCompleted mined (block ${rcpt.blockNumber})`);
    process.exit(0);
  } catch (e) {
    console.error('❌ cron error', e?.shortMessage || e);
    process.exit(1);
  }
}

run();

