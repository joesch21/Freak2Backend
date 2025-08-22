import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

// --- CORS (allow your frontend) ---
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// --- Resolve path to ABI JSON (no JSON import assertions needed) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiPath = path.join(__dirname, "public", "freakyFridayGameAbi.json");

if (!fs.existsSync(abiPath)) {
  console.error(`❌ ABI not found at ${abiPath}. Make sure the file exists or adjust build-abi.js.`);
  process.exit(1);
}
const gameAbi = JSON.parse(fs.readFileSync(abiPath, "utf8"));

// --- Env fallbacks (support both naming styles) ---
const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.RELAYER_KEY;
const FREAKY_ADDRESS = (process.env.FREAKY_ADDRESS || process.env.CONTRACT_ADDRESS || "").trim();

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_ADDRESS) {
  console.error(
    "❌ Missing env vars. Need RPC_URL, PRIVATE_KEY, FREAKY_ADDRESS (or PROVIDER_URL, RELAYER_KEY, CONTRACT_ADDRESS)"
  );
  process.exit(1);
}

console.log(`🔗 Using contract: ${FREAKY_ADDRESS}`);

// --- Ethers setup ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayer = new ethers.Wallet(PRIVATE_KEY, provider);
const game = new ethers.Contract(FREAKY_ADDRESS, gameAbi, relayer);

app.get("/", (_req, res) => {
  res.send("⚡ Freaky Friday Relayer is running");
});

// --- Single handler used by all supported endpoints ---
async function handleRelayEnter(req, res) {
  try {
    const { user } = req.body || {};
    if (!user || !ethers.isAddress(user)) {
      return res.status(400).json({ error: "Invalid or missing 'user' address" });
    }

    console.log(`🚀 Relaying entry for ${user}`);
    const tx = await game.relayedEnter(user);
    const r = await tx.wait();
    console.log(`✅ relayedEnter mined: ${r?.hash || tx.hash}`);

    return res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("❌ Relay failed:", err);
    return res.status(500).json({ error: "Relay failed", detail: String(err?.message || err) });
  }
}

// Support any of these paths (frontends sometimes differ)
app.post("/relay-enter", handleRelayEnter);
app.post("/relay-entry", handleRelayEnter);
app.post("/join", handleRelayEnter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Relayer listening on :${PORT} (contract: ${FREAKY_ADDRESS})`);
});
