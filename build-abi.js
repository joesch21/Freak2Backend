// build-abi.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiDir = path.join(__dirname, "public");
const abiFile = path.join(abiDir, "freakyFridayGameAbi.json");

if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir, { recursive: true });

if (fs.existsSync(abiFile)) {
  console.log("✅ ABI present:", abiFile);
  process.exit(0);
} else {
  console.error("❌ ABI missing. Place freakyFridayGameAbi.json in /public before deploy.");
  process.exit(1);
}
