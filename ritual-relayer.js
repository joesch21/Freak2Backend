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

// --- ABI load ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiPath = path.join(__dirname, "public", "freakyFridayGameAbi.json");
if (!fs.existsSync(abiPath)) {
  console.error(`❌ ABI not found at ${abiPath}`);
  process.exit(1);
}
const gameAbi = JSON.parse(fs.readFileSync(abiPath, "utf8"));

// --- Env vars ---
const RPC_URL        = process.env.RPC_URL        || process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY    || process.env.RELAYER_KEY;
const FREAKY_ADDRESS = (process.env.FREAKY_ADDRESS || process.env.CONTRACT_ADDRESS || "").trim();
const GCC_ADDRESS    = (process.env.GCC_ADDRESS   || "").trim();

if (!RPC_URL || !PRIVATE_KEY || !FREAKY_ADDRESS) {
  console.error("❌ Missing env vars: RPC_URL, PRIVATE_KEY, FREAKY_ADDRESS");
  process.exit(1);
}
if (!ethers.isAddress(GCC_ADDRESS)) {
  console.error("❌ Missing/invalid GCC_ADDRESS");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayer  = new ethers.Wallet(PRIVATE_KEY, provider);
const game     = new ethers.Contract(FREAKY_ADDRESS, gameAbi, relayer);

const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
];
const gcc = new ethers.Contract(GCC_ADDRESS, ERC20_MIN_ABI, provider);
const gccWrite = new ethers.Contract(GCC_ADDRESS, ERC20_MIN_ABI, relayer);

app.get("/", (_req, res) => res.send("⚡ Freaky Friday Relayer is running"));

async function loadState(user) {
  const [dec, entry, bal, allow, relBal] = await Promise.all([
    gcc.decimals(),
    game.entryAmount(),
    gcc.balanceOf(user),
    gcc.allowance(user, await game.getAddress()),
    gcc.balanceOf(relayer.address)
  ]);
  return { dec, entry, bal, allow, relBal };
}

// Debug: show numbers
app.get("/debug-state", async (req, res) => {
  try {
    const { user } = req.query;
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_USER" });
    const st = await loadState(user);
    res.json({
      game: await game.getAddress(),
      token: GCC_ADDRESS,
      decimals: st.dec,
      entryRaw: st.entry.toString(),
      entryHuman: ethers.formatUnits(st.entry, st.dec),
      balanceHuman: ethers.formatUnits(st.bal, st.dec),
      allowanceHuman: ethers.formatUnits(st.allow, st.dec),
      relayerBalanceHuman: ethers.formatUnits(st.relBal, st.dec)
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Dry-run: simulate revert reason (no gas spent)
app.get("/dry-run", async (req, res) => {
  try {
    const { user } = req.query;
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: "BAD_USER" });

    // Encode call data for relayedEnter(user)
    const iface = new ethers.Interface(gameAbi);
    const data  = iface.encodeFunctionData("relayedEnter", [user]);
    const call  = {
      to: await game.getAddress(),
      from: relayer.address, // who would send it
      data
    };

    // provider.call returns revert data without sending a tx
    try {
      const ret = await provider.call(call);
      return res.json({ ok: true, ret });
    } catch (err) {
      // Decode standard Error(string)
      let decoded;
      try {
        decoded = iface.parseError(err?.data || err?.error?.data);
      } catch {}
      return res.status(200).json({
        ok: false,
        reason: err?.reason || decoded?.name || "reverted",
        data: (err?.data || err?.error?.data || "").toString()
      });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Relay with preflight + rich logging
async function handleRelayEnter(req, res) {
  try {
    const { user } = req.body || {};
    if (!user || !ethers.isAddress(user)) {
      return res.status(400).json({ error: "BAD_REQUEST", detail: "Missing or invalid 'user' address" });
    }

    const st = await loadState(user);
    const entryH = ethers.formatUnits(st.entry, st.dec);
    const balH   = ethers.formatUnits(st.bal, st.dec);
    const alwH   = ethers.formatUnits(st.allow, st.dec);
    const relH   = ethers.formatUnits(st.relBal, st.dec);

    console.log(`🔎 Preflight for ${user}`);
    console.log(`   entry=${entryH} GCC, balance=${balH}, allowance=${alwH}, relayerBal=${relH}`);

    if (st.bal < st.entry) {
      return res.status(400).json({
        error: "INSUFFICIENT_BALANCE",
        detail: `User has ${balH} GCC, needs ${entryH}`
      });
    }
    if (st.allow < st.entry) {
      return res.status(400).json({
        error: "INSUFFICIENT_ALLOWANCE",
        detail: `Approve at least ${entryH} GCC to spender=${await game.getAddress()}`
      });
    }
    if (st.relBal < st.entry) {
      return res.status(400).json({
        error: "RELAYER_INSUFFICIENT_GCC",
        detail: `Relayer has ${relH} GCC, needs ≥ ${entryH} for the refund`
      });
    }

    // Try a dry-run first to surface revert reason clearly
    try {
      await provider.call({
        to: await game.getAddress(),
        from: relayer.address,
        data: new ethers.Interface(gameAbi).encodeFunctionData("relayedEnter", [user])
      });
    } catch (err) {
      console.error("🧪 Dry-run revert:", err?.reason || err?.message || err);
      return res.status(500).json({
        error: "DRY_RUN_REVERT",
        reason: err?.reason || "execution reverted",
        data: (err?.data || err?.error?.data || "").toString()
      });
    }

    console.log(`🚀 Relaying entry for ${user}`);
    const tx = await game.relayedEnter(user);
    const r  = await tx.wait();
    console.log(`✅ relayedEnter mined: ${r?.hash || tx.hash}`);

    // Send refund
    console.log(`↩️  Refunding gross ${entryH} GCC to ${user}`);
    const refundTx = await gccWrite.transfer(user, st.entry);
    await refundTx.wait();
    console.log(`✅ Refund transfer hash: ${refundTx.hash}`);

    return res.json({
      success: true,
      enterTxHash: r?.hash || tx.hash,
      refundTxHash: refundTx.hash
    });

  } catch (err) {
    console.error("❌ Relay failed:", err);
    return res.status(500).json({ error: "RELAY_REVERT", detail: String(err?.message || err) });
  }
}

app.post("/relay-enter", handleRelayEnter);
app.post("/relay-entry", handleRelayEnter);
app.post("/join",        handleRelayEnter);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Relayer listening on :${PORT} (contract: ${FREAKY_ADDRESS}, token: ${GCC_ADDRESS})`);
});
