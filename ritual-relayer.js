import 'dotenv/config';
import { ethers } from 'ethers';
import gameAbi from './public/freakyFridayGameAbi.json' assert { type: 'json' };

const {
  RPC_URL,
  PRIVATE_KEY,
  FREAKY_CONTRACT,
  FREAKY_ADDRESS,
  CLOSE_TIP = '100000000000000000',
} = process.env;

const CONTRACT = (FREAKY_ADDRESS || FREAKY_CONTRACT || '0x2a37F0325bcA2B71cF7f2189796Fb9BC1dEBc9C9').trim();

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT) {
  console.error('Missing RPC_URL, PRIVATE_KEY, or contract address');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(CONTRACT, gameAbi, signer);

async function logInsufficientFunds(err) {
  if (err?.code === 'INSUFFICIENT_FUNDS') {
    const bal = await provider.getBalance(signer.address).catch(() => null);
    console.error(
      `INSUFFICIENT_FUNDS: ${signer.address} balance=${bal ? ethers.formatEther(bal) : 'unknown'} BNB`
    );
  }
}

export async function closeRoundIfExpired() {
  try {
    const [active, start, duration] = await Promise.all([
      game.isRoundActive(),
      game.roundStart(),
      game.duration(),
    ]);
    console.log(`isRoundActive=${active} roundStart=${start} duration=${duration}`);
    const now = Math.floor(Date.now() / 1000);
    if (active && now >= Number(start) + Number(duration)) {
      console.log('Closing round…');
      const tx = await game.checkTimeExpired({ value: CLOSE_TIP });
      console.log(`Close tx: ${tx.hash}`);
      await tx.wait();
    }
  } catch (err) {
    await logInsufficientFunds(err);
    console.error('closeRoundIfExpired error:', err.shortMessage || err.message || err);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

(async () => {
  try {
    const net = await provider.getNetwork();
    console.log(`Connected to chain ${net.chainId} contract ${CONTRACT}`);
  } catch (err) {
    console.error('Network error:', err.message || err);
    process.exit(1);
  }

  while (true) {
    await closeRoundIfExpired();
    await new Promise((r) => setTimeout(r, 30000));
  }
})();
