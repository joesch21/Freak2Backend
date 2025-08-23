import fs from 'fs';
import { DateTime } from 'luxon';
import { ethers } from 'ethers';

const {
  RPC_URL,
  RELAYER_PK,
  FREAKY_CONTRACT,
  JACKPOT_TZ = 'Australia/Sydney'
} = process.env;

if (!RPC_URL || !RELAYER_PK || !FREAKY_CONTRACT) {
  console.error('Missing env: RPC_URL / RELAYER_PK / FREAKY_CONTRACT');
  process.exit(1);
}

// Load ABI without JSON assert (Render Node v24 quirk)
const gameAbi = JSON.parse(fs.readFileSync('./public/freakyFridayGameAbi.json', 'utf8'));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(RELAYER_PK, provider);
const game     = new ethers.Contract(FREAKY_CONTRACT, gameAbi, wallet);

function isFridaySydney(tsSec) {
  const dt = DateTime.fromSeconds(tsSec, { zone: JACKPOT_TZ });
  return dt.weekday === 5; // 1=Mon..7=Sun -> 5 is Friday
}

async function run() {
  try {
    const active = await game.isRoundActive();

    // If idle, set mode based on Sydney Friday
    if (!active) {
      const target = isFridaySydney(Math.floor(Date.now()/1000)) ? 1 : 0; // 0=Standard, 1=Jackpot
      if (typeof game.getRoundMode === 'function') {
        const current = Number(await game.getRoundMode());
        if (current !== target && typeof game.setRoundMode === 'function') {
          const tx = await game.setRoundMode(target);
          console.log(`[mode] setRoundMode(${target}) tx=${tx.hash}`);
          await tx.wait();
        }
      }
      console.log('[cron] idle; mode ensured; exit 0');
      process.exit(0);
    }

    // If active, close when expired
    const start    = Number(await game.roundStart());
    const duration = Number(await game.duration());
    const endTs    = start + duration;
    const now      = Math.floor(Date.now()/1000);

    if (now < endTs) {
      console.log(`[cron] round active, ${endTs - now}s remaining; exit 0`);
      process.exit(0);
    }

    const tx = await game.checkTimeExpired();
    console.log(`[close] checkTimeExpired tx=${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`[close] mined block ${rcpt.blockNumber}`);
    process.exit(0);
  } catch (e) {
    console.error('❌ cron error', e);
    process.exit(1);
  }
}

run();

