import 'dotenv/config';
import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// JSON import that works on Node 18–20 without --experimental flags
const gameAbi = require('./public/freakyFridayGameAbi.json');
const erc20Abi = require('./public/erc20Abi.json');

// ---- env
const { RPC_URL, PRIVATE_KEY, FREAKY_CONTRACT, CLOSE_TIP } = process.env;

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_CONTRACT) {
  console.error('Missing RPC_URL / PRIVATE_KEY / FREAKY_CONTRACT');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const game = new ethers.Contract(FREAKY_CONTRACT, gameAbi, wallet);

async function maybeCloseRound() {
  const active = await game.isRoundActive();
  if (!active) return;
  const start = await game.roundStart();
  const duration = await game.duration();
  const now = Math.floor(Date.now()/1000);
  if (now >= Number(start) + Number(duration)) {
    console.log('Closing round…');
    const tx = await game.checkTimeExpired();
    console.log('Submitted:', tx.hash);
    await tx.wait();
    console.log('Closed.');
  }
}

// one-shot runner so Render “Web Service” starts fine
maybeCloseRound().catch(e => { console.error(e); process.exit(1); });
