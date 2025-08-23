import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const {
  RPC_URL,
  PRIVATE_KEY,
  FREAKY_ADDRESS,
  CHECK_INTERVAL_SEC = '30',
  MIN_GAS_BNB = '0.005',
} = process.env;

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_ADDRESS) {
  console.error('Missing env: RPC_URL, PRIVATE_KEY, FREAKY_ADDRESS');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gameAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, './public/freakyFridayGameAbi.json'), 'utf8')
);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(FREAKY_ADDRESS, gameAbi, wallet);

const fmtBNB = (v) => Number(ethers.formatEther(v)).toFixed(6);

let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const [net, bnb] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address),
    ]);
    const cid = net.chainId;
    if (cid !== 56n && cid !== 56) console.warn(`⚠️ chainId=${cid}, expected 56 (BSC mainnet)`);
    if (Number(fmtBNB(bnb)) < Number(MIN_GAS_BNB)) {
      console.warn(`⚠️ Relayer gas low: ${fmtBNB(bnb)} BNB`);
    }

    const isActive = await game.isRoundActive();
    if (!isActive) { console.log('⏳ No active round.'); inFlight = false; return; }

    const [start, duration, participants] = await Promise.all([
      game.roundStart(), game.duration(), game.getParticipants()
    ]);
    const now    = Math.floor(Date.now()/1000);
    const endsAt = Number(start) + Number(duration);
    const n      = participants.length;

    console.log(`Round status: active=${isActive} players=${n} now=${now} endsAt=${endsAt}`);

    if (n === 0)            { console.log('🟡 Skip: no players'); inFlight = false; return; }
    if (now < endsAt)       { console.log(`🟡 Skip: ${endsAt - now}s remaining`); inFlight = false; return; }

    console.log('🟢 Calling checkTimeExpired()…');
    const tx = await game.checkTimeExpired();
    console.log(`⛓️ sent: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`✅ mined: block=${rcpt.blockNumber} status=${rcpt.status}`);
  } catch (e) {
    console.error('❌ close failed:', e?.shortMessage || e?.reason || e?.message || e);
  } finally {
    inFlight = false;
  }
}

(async () => {
  console.log('Relayer:', wallet.address);
  console.log('Target :', FREAKY_ADDRESS);
  console.log('RPC    :', RPC_URL);
  await tick();
  setInterval(tick, Number(CHECK_INTERVAL_SEC) * 1000);
})();
