// check.js (run with: node check.js 0xYOURWALLET)
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = process.env.RPC_URL || "https://bsc-dataseed.binance.org/";
const GAME = "0x2608f724dec63dEa893BC5380FF0e77E5C446480";
const ABI = JSON.parse(fs.readFileSync("./public/freakyFridayGameAbi.json", "utf8"));

const erc20Min = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const user = process.argv[2];
if (!user) throw new Error("Provide user address, e.g. node check.js 0x...");

const provider = new ethers.JsonRpcProvider(RPC_URL);

const game = new ethers.Contract(GAME, ABI, provider);
const tokenAddr = await game.gcc();
const token = new ethers.Contract(tokenAddr, erc20Min, provider);

const [dec, entry, bal, allow] = await Promise.all([
  token.decimals(),
  game.entryAmount(),
  token.balanceOf(user),
  token.allowance(user, await game.getAddress())
]);

console.log({
  token: tokenAddr,
  decimals: dec,
  entryRaw: entry.toString(),
  entryHuman: ethers.formatUnits(entry, dec),
  balanceHuman: ethers.formatUnits(bal, dec),
  allowanceHuman: ethers.formatUnits(allow, dec)
});
