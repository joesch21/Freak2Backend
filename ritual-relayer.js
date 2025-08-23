require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const abiPath = path.join(__dirname, 'public', 'freakyFridayGameAbi.json');
const gameAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

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

async function getParticipants() {
  return await game.getParticipants();
}

async function isRoundActive() {
  return await game.isRoundActive();
}

async function roundStart() {
  return await game.roundStart();
}

async function duration() {
  return await game.duration();
}

async function checkTimeExpired() {
  return await game.checkTimeExpired({ value: CLOSE_TIP });
}

async function setRoundMode(mode) {
  return await game.setRoundMode(mode);
}

async function closeRoundIfExpired() {
  try {
    const [active, start, dur] = await Promise.all([
      isRoundActive(),
      roundStart(),
      duration(),
    ]);
    console.log(`isRoundActive=${active} roundStart=${start} duration=${dur}`);
    const now = Math.floor(Date.now() / 1000);
    if (active && now >= Number(start) + Number(dur)) {
      console.log('Closing round…');
      const tx = await checkTimeExpired();
      console.log(`Close tx: ${tx.hash}`);
      await tx.wait();
    }
  } catch (err) {
    await logInsufficientFunds(err);
    console.error('closeRoundIfExpired error:', err.shortMessage || err.message || err);
  }
}

module.exports = {
  provider,
  signer,
  getParticipants,
  isRoundActive,
  roundStart,
  duration,
  checkTimeExpired,
  setRoundMode,
  closeRoundIfExpired,
};
