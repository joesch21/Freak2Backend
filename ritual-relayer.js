import express from "express";
import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ Load ABI without "assert { type: 'json' }"
const gameAbi = JSON.parse(
  fs.readFileSync("./public/freakyFridayGameAbi.json", "utf-8")
);

// Environment config
const PORT = process.env.PORT || 3000;
const PROVIDER_URL = process.env.PROVIDER_URL;
const RELAYER_KEY = process.env.RELAYER_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

if (!PROVIDER_URL || !RELAYER_KEY || !CONTRACT_ADDRESS) {
  console.error("❌ Missing env vars: PROVIDER_URL, RELAYER_KEY, CONTRACT_ADDRESS");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const wallet = new ethers.Wallet(RELAYER_KEY, provider);
const gameContract = new ethers.Contract(CONTRACT_ADDRESS, gameAbi, wallet);

// Health check
app.get("/", (req, res) => {
  res.send("⚡ Freaky Friday Relayer is running");
});

// Relay endpoint
app.post("/relay-enter", async (req, res) => {
  try {
    const { user } = req.body;
    if (!user) return res.status(400).send("Missing user address");

    console.log(`🚀 Relaying entry for ${user}`);
    const tx = await gameContract.relayedEnter(user);
    await tx.wait();

    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("❌ Relay failed:", err);
    res.status(500).send("Relay failed: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Relayer listening on port ${PORT}`);
});
