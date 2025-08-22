import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';

const app = express();
const ORIGIN = process.env.FRONTEND_URL;
app.use(cors({
  origin: ORIGIN,
  methods: ['GET','POST','OPTIONS'],
  credentials: false,
}));
app.use(express.json());

import gameAbi from './public/freakyFridayGameAbi.json' assert { type: 'json' };
import erc20Abi from './public/erc20Abi.json' assert { type: 'json' };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const gameAddress = process.env.FREAKY_ADDRESS;
const tokenAddress = process.env.GCC_TOKEN || process.env.GCC_ADDRESS;
const gameContract = new ethers.Contract(gameAddress, gameAbi, signer);
const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

function normalizeAddress(addr) {
  try { return ethers.getAddress(addr); } catch (_) { return null; }
}

app.get('/status', async (req, res) => {
  try {
    const [isActive, currentRound, roundStart, duration, entryAmount, roundMode, maxPlayers, participants] = await Promise.all([
      gameContract.isRoundActive(),
      gameContract.currentRound(),
      gameContract.roundStart(),
      gameContract.duration(),
      gameContract.entryAmount(),
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

// Both `/join` and `/relay-entry` paths register a player via the relayer.
// Render will call this handler with CommonJS semantics unless the package
// defines type:module.  The function validates that the caller has
// approved enough GCC to the game contract before forwarding the call to
// `relayedEnter(user)`.  Upon success, the backend returns the transaction
// hash only (no extra metadata) so the frontend can link to BscScan.
app.post(['/relay-entry', '/join'], async (req, res) => {
  try {
    const { user } = req.body;
    const addr = normalizeAddress(user);
    if (!addr) {
      return res.status(400).json({ error: 'Invalid user address' });
    }

    // Ensure the user has approved at least the entry amount to the game contract.
    const [entryAmount, allowance] = await Promise.all([
      gameContract.entryAmount(),
      tokenContract.allowance(addr, gameAddress)
    ]);
    if (allowance < entryAmount) {
      return res.status(400).json({ error: 'User allowance too low for entry' });
    }

    // Relay the entry on behalf of the user.  The relayer wallet pays gas.
    const tx = await gameContract.relayedEnter(addr);
    await tx.wait();
    // Respond with the transaction hash for UI feedback.
    res.json({ txHash: tx.hash });
  } catch (err) {
    const message = err?.error?.message || err?.message || String(err);
    res.status(500).json({ error: message });
  }
});

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

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Freaks2 backend listening on port ${PORT}`);
});
