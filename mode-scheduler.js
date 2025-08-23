require('dotenv').config();
const { DateTime } = require('luxon');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const abiPath = path.join(__dirname, 'public', 'freakyFridayGameAbi.json');
const gameAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

const { RPC_URL, PRIVATE_KEY, FREAKY_CONTRACT, FREAKY_ADDRESS } = process.env;
const CONTRACT = (FREAKY_ADDRESS || FREAKY_CONTRACT || '0x2a37F0325bcA2B71cF7f2189796Fb9BC1dEBc9C9').trim();

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(CONTRACT, gameAbi, signer);

async function switchMode(target) {
  try {
    const active = await game.isRoundActive();
    if (active) {
      console.log('Round active, skipping mode switch');
      return;
    }

    let desired = target;
    if (!desired) {
      const tz = process.env.TIMEZONE || 'Australia/Sydney';
      const now = DateTime.now().setZone(tz);
      desired = now.weekday === 5 ? 'Jackpot' : 'Standard';
    }

    if (!game.setRoundMode) {
      console.log('Contract lacks setRoundMode');
      return;
    }

    const modeVal = desired === 'Jackpot' ? 1 : 0;
    const current = await (game.getRoundMode ? game.getRoundMode() : game.roundMode());
    if (Number(current) === modeVal) {
      console.log(`Mode already ${desired}`);
      return;
    }

    const tx = await game.setRoundMode(modeVal);
    console.log(`Switching mode to ${desired}, tx: ${tx.hash}`);
    await tx.wait();
  } catch (err) {
    console.error('mode switch error:', err.reason || err.message || err);
  }
}

module.exports = switchMode;
