import 'dotenv/config';
import { ethers } from 'ethers';

const {
  RPC_URL,
  PRIVATE_KEY,
  FREAKY_ADDRESS,
  LOOP_SECONDS = '60',
  ONE_SHOT,
} = process.env;

import abi from './public/freakyFridayGameAbi.json' assert { type: 'json' };

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(FREAKY_ADDRESS, abi, wallet);

const TZ = 'Australia/Sydney';
const nowSydney = () =>
  new Intl.DateTimeFormat('en-AU',{timeZone:TZ,hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());

async function checkOnce() {
  try {
    console.log(`[${nowSydney()}] \u23f3 Checking round…`);
    const [active, start, duration] = await Promise.all([
      game.isRoundActive(), game.roundStart(), game.duration()
    ]);
    if (!active) { console.log('• No active round.'); return; }
    const end = start + duration;
    const now = BigInt(Math.floor(Date.now()/1000));
    if (now < end) { console.log(`• Not expired. Ends=${end} now=${now}`); return; }

    // Dry-run to avoid revert spam
    try { await game.checkTimeExpired.staticCall(); }
    catch (e) { console.log('• would revert:', e.message); return; }

    const tx = await game.checkTimeExpired({ gasLimit: 800000 });
    console.log('✅ sent:', tx.hash);
    const rcpt = await tx.wait();
    console.log('✅ confirmed block', rcpt.blockNumber);
  } catch (err) {
    console.error('⚠️ bot error:', err?.reason || err?.message || err);
  }
}

async function main() {
  if (ONE_SHOT === 'true') { await checkOnce(); return; }
  console.log(`ritual-bot started @ ${nowSydney()} (every ${LOOP_SECONDS}s, TZ=${TZ})`);
  await checkOnce();
  setInterval(checkOnce, Number(LOOP_SECONDS)*1000);
}
main().catch(e => { console.error('fatal:', e); process.exit(1); });
