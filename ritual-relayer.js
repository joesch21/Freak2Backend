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

const FRONTEND_URL = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiPath = path.join(__dirname, "public", "freakyFridayGameAbi.json");
const gameAbi = JSON.parse(fs.readFileSync(abiPath, "utf8"));

const RPC_URL        = process.env.RPC_URL || "https://bsc-dataseed.binance.org/";
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FREAKY_ADDRESS = (process.env.FREAKY_ADDRESS || "").trim();
const GCC_ADDRESSCFG = (process.env.GCC_ADDRESS || "").trim();

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_ADDRESS) {
  console.error("❌ Missing RPC_URL, PRIVATE_KEY, or FREAKY_ADDRESS");
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

app.get("/", (_req, res) => res.send("⚡ Freaky Friday Relayer running"));
// Optional health for Render
app.get("/health", (_req, res) => res.json({ ok: true, contract: FREAKY_ADDRESS }));

async function inspectState(user) {
  const gameAddr  = game.target;              // ethers v6
  const tokenAddr = await game.gcc();
  const token     = new ethers.Contract(tokenAddr, ERC20_MIN_ABI, provider);

  const [entry, dec, bal, allow] = await Promise.all([
    game.entryAmount(),
    token.decimals(),
    token.balanceOf(user),
    token.allowance(user, gameAddr),
  ]);
  return { gameAddr, tokenAddr, entry, dec, bal, allow };
}

app.get("/debug-state", async (req, res) => {
  try {
    const { user } = req.query;
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_USER" });
    const st = await inspectState(user);
    res.json({
      game: st.gameAddr, token: st.tokenAddr, decimals: st.dec,
      entryRaw: st.entry.toString(), entryHuman: ethers.formatUnits(st.entry, st.dec),
      balanceHuman: ethers.formatUnits(st.bal, st.dec),
      allowanceHuman: ethers.formatUnits(st.allow, st.dec),
      gccEnvMatch: GCC_ADDRESSCFG ? (GCC_ADDRESSCFG.toLowerCase() === st.tokenAddr.toLowerCase()) : "no-env"
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get("/dry-run", async (req, res) => {
  try {
    const { user } = req.query;
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_USER" });
    const st = await inspectState(user);
    if (st.bal < st.entry) return res.status(400).json({ error: "INSUFFICIENT_BALANCE" });
    if (st.allow < st.entry) return res.status(400).json({ error: "INSUFFICIENT_ALLOWANCE" });
    return res.json({ ok: true, entry: ethers.formatUnits(st.entry, st.dec) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

async function handleRelayEnter(req, res) {
  try {
    const { user } = req.body || {};
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_REQUEST" });

    const st = await inspectState(user);
    if (GCC_ADDRESSCFG && st.tokenAddr.toLowerCase() !== GCC_ADDRESSCFG.toLowerCase()) {
      return res.status(500).json({ error: "GAME_TOKEN_MISMATCH", detail: `game.gcc()=${st.tokenAddr}` });
    }
    if (st.bal < st.entry) return res.status(400).json({ error: "INSUFFICIENT_BALANCE" });
    if (st.allow < st.entry) return res.status(400).json({ error: "INSUFFICIENT_ALLOWANCE" });

    console.log(`🚀 Relaying entry for ${user}`);
    const tx = await game.relayedEnter(user);
    const r  = await tx.wait();
    const hash = r?.hash || tx.hash;
    console.log(`✅ relayedEnter mined: ${hash}`);
    return res.json({ success: true, enterTxHash: hash });
  } catch (err) {
    console.error("❌ Relay failed:", err);
    return res.status(500).json({ error: "RELAY_REVERT", detail: String(err?.message || err) });
  }
}

app.post("/join", handleRelayEnter);
app.post("/relay-enter", handleRelayEnter);
app.post("/relay-entry", handleRelayEnter);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Relayer listening on :${PORT} (contract: ${FREAKY_ADDRESS})`));

