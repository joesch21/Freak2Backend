import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, './public/freakyFridayGameAbi.json'), 'utf8'));

const app = express();

app.get('/health', async (_req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const c = new ethers.Contract(process.env.FREAKY_ADDRESS, abi, provider);
    const [chainId, active] = await Promise.all([
      provider.getNetwork().then(n => n.chainId),
      c.isRoundActive()
    ]);
    res.json({
      ok: true,
      contract: process.env.FREAKY_ADDRESS,
      chainId,
      isRoundActive: active
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Health on :${port}`));
