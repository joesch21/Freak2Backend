/*
  ritual-relayer.js

  This Express server wraps calls to the on‑chain FreakyFridayAuto contract.  It
  exposes endpoints for joining a round via the relayer, checking the current
  round status, closing an expired round, and performing batch refunds on
  behalf of participants.

  To run the server:

    $ npm install
    $ cp .env.example .env  # fill in RPC_URL, PRIVATE_KEY, FREAKY_ADDRESS, GCC_ADDRESS
    $ npm start

  See README.md for endpoint documentation.
*/

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { ethers } = require('ethers');

const app = express();
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// Load ABIs.  These are generated from the JSON files in ./public by build-abi.js.
const gameAbi = require('./public/freakyFridayGameAbi.json');
const erc20Abi = require('./public/erc20Abi.json');

// Initialise provider and signer
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Construct contract instances
const gameAddress = process.env.FREAKY_ADDRESS;
const tokenAddress = process.env.GCC_TOKEN || process.env.GCC_ADDRESS;
const gameContract = new ethers.Contract(gameAddress, gameAbi, signer);
const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

// Utility: ensure an address is checksummed
function normalizeAddress(addr) {
  try { return ethers.getAddress(addr); } catch (_) { return null; }
}

// GET /status
// Returns current round state and configuration.
app.get('/status', async (req, res) => {
  try {
    const [isActive, currentRound, roundStart, duration, entryAmount, roundMode, maxPlayers, participants] = await Promise.all([
      gameContract.isRoundActive(),
      gameContract.currentRound(),
      gameContract.roundStart(),
      gameContract.duration(),
      gameContract.entryAmount(),
      // prefer explicit getter; fallback to public variable
      gameContract.getRoundMode ? gameContract.getRoundMode() : gameContract.roundMode(),
      gameContract.maxPlayers(),
      gameContract.getParticipants()
    ]);
    res.json({
      roundActive: Boolean(isActive),
      currentRound: currentRound.toString(),
      roundStart: roundStart.toString(),
      duration: duration.toString(),
      entryAmount: entryAmount.toString(),
      roundMode: Number(roundMode),
      maxPlayers: maxPlayers.toString(),
      participantCount: participants.length,
      participants
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /relay-entry
// Body: { user: "0x..." }
// Registers a user for the current round.  Requires that the user has
// approved the contract for at least entryAmount GCC.  The relayer pays gas.
app.post('/relay-entry', async (req, res) => {
  try {
    const { user } = req.body;
    const addr = normalizeAddress(user);
    if (!addr) {
      return res.status(400).json({ error: 'Invalid user address' });
    }
    // Check token allowance
    const [entryAmount, allowance] = await Promise.all([
      gameContract.entryAmount(),
      tokenContract.allowance(addr, gameAddress)
    ]);
    if (allowance < entryAmount) {
      return res.status(400).json({ error: 'User allowance too low for entry' });
    }
    // Call relayedEnter using the relayer signer
    const tx = await gameContract.relayedEnter(addr);
    await tx.wait();
    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    // Extract revert reason if present
    let message = err?.error?.message || err?.message || String(err);
    res.status(500).json({ error: message });
  }
});

// POST /check-expired
// Attempts to close the current round if duration has elapsed.  Anyone can call
// this endpoint.  If the round is not active or not yet expired, returns an error.
app.post('/check-expired', async (req, res) => {
  try {
    const [isActive, start, duration] = await Promise.all([
      gameContract.isRoundActive(),
      gameContract.roundStart(),
      gameContract.duration()
    ]);
    if (!isActive) {
      return res.status(400).json({ error: 'Round is not active' });
    }
    const now = Math.floor(Date.now() / 1000);
    if (now < Number(start) + Number(duration)) {
      return res.status(400).json({ error: 'Round has not expired yet' });
    }
    const tx = await gameContract.checkTimeExpired();
    await tx.wait();
    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /batch-refund
// Body: { round: <number>, users: ["0x...", ...], maxCount?: <number> }
// Allows the relayer to refund multiple users after a Standard round has closed.
app.post('/batch-refund', async (req, res) => {
  try {
    const { round, users, maxCount } = req.body;
    if (typeof round !== 'number' && typeof round !== 'string') {
      return res.status(400).json({ error: 'round is required' });
    }
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'users array is required' });
    }
    const normalized = users.map(normalizeAddress).filter(Boolean);
    const max = maxCount || normalized.length;
    const tx = await gameContract.batchClaimRefunds(round, normalized, max);
    await tx.wait();
    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Freaks2 backend listening on port ${PORT}`);
});