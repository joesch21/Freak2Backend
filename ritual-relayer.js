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

// --- CORS ---
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// --- ABI load (no JSON import assertions) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiPath = path.join(__dirname, "public", "freakyFridayGameAbi.json");
if (!fs.existsSync(abiPath)) {
  console.error(`❌ ABI not found at ${abiPath}`);
  process.exit(1);
}
const gameAbi = JSON.parse(fs.readFileSync(abiPath, "utf8"));

// --- Env vars (support both naming styles) ---
const RPC_URL        = process.env.RPC_URL        || process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY    || process.env.RELAYER_KEY;
const FREAKY_ADDRESS = (process.env.FREAKY_ADDRESS || process.env.CONTRACT_ADDRESS || "").trim();
const GCC_ADDRESSCFG = (process.env.GCC_ADDRESS   || "").trim(); // REQUIRED now

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_ADDRESS) {
  console.error("❌ Missing env vars: RPC_URL, PRIVATE_KEY, FREAKY_ADDRESS (or PROVIDER_URL, RELAYER_KEY, CONTRACT_ADDRESS)");
  process.exit(1);
}
if (!ethers.isAddress(GCC_ADDRESSCFG)) {
  console.error("❌ Missing or invalid GCC_ADDRESS env var (must be the GCC token address)");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayer  = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(FREAKY_ADDRESS, gameAbi, relayer);

const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

app.get("/", (_req, res) => res.send("⚡ Freaky Friday Relayer is running"));

// ---- State inspector (uses GCC_ADDRESS from env; no game.gcc() needed) ----
async function inspectState(user) {
  const gameAddr  = await game.getAddress(); // ethers v6
  const tokenAddr = GCC_ADDRESSCFG;

  const token = new ethers.Contract(tokenAddr, ERC20_MIN_ABI, provider);
  const [entry, dec, bal, allow] = await Promise.all([
    game.entryAmount(),
    token.decimals(),
    token.balanceOf(user),
    token.allowance(user, gameAddr),
  ]);

  return { gameAddr, tokenAddr, entry, dec, bal, allow };
}

// Optional public debug helper (disable if you prefer)
app.get("/debug-state", async (req, res) => {
  try {
    const { user } = req.query;
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_USER" });
    const st = await inspectState(user);
    res.json({
      game: st.gameAddr,
      token: st.tokenAddr,
      decimals: st.dec,
      entryRaw: st.entry.toString(),
      entryHuman: ethers.formatUnits(st.entry, st.dec),
      balanceRaw: st.bal.toString(),
      balanceHuman: ethers.formatUnits(st.bal, st.dec),
      allowanceRaw: st.allow.toString(),
      allowanceHuman: ethers.formatUnits(st.allow, st.dec)
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Unified relay handler ----
async function handleRelayEnter(req, res) {
  try {
    const { user } = req.body || {};
    if (!user || !ethers.isAddress(user)) {
      return res.status(400).json({ error: "BAD_REQUEST", detail: "Missing or invalid 'user' address" });
    }

    const st = await inspectState(user);

    // Balance & allowance preflight (prevents vague on-chain revert)
    if (st.bal < st.entry) {
      return res.status(400).json({
        error: "INSUFFICIENT_BALANCE",
        detail: `User has ${ethers.formatUnits(st.bal, st.dec)} GCC, needs ${ethers.formatUnits(st.entry, st.dec)}`
      });
    }
    if (st.allow < st.entry) {
      return res.status(400).json({
        error: "INSUFFICIENT_ALLOWANCE",
        detail: `Approve at least ${ethers.formatUnits(st.entry, st.dec)} GCC to spender=${st.gameAddr}`
      });
    }

    console.log(`🚀 Relaying entry for ${user}`);
    const tx = await game.relayedEnter(user);
    const r  = await tx.wait();
    console.log(`✅ relayedEnter mined: ${r?.hash || tx.hash}`);
    return res.json({ success: true, txHash: r?.hash || tx.hash });

  } catch (err) {
    console.error("❌ Relay failed:", err);
    return res.status(500).json({ error: "RELAY_REVERT", detail: String(err?.message || err) });
  }
}

app.post("/relay-enter", handleRelayEnter);
app.post("/relay-entry", handleRelayEnter);
app.post("/join",        handleRelayEnter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Relayer listening on :${PORT} (contract: ${FREAKY_ADDRESS}, token: ${GCC_ADDRESSCFG})`);
});
