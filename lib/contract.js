// CommonJS
const { readFileSync } = require('fs');
const { join } = require('path');
const { ethers } = require('ethers');

const abi = JSON.parse(readFileSync(join(__dirname, '..', 'abi', 'freakyFridayGameAbi.json'), 'utf8'));

function getProvider() {
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error('RPC_URL missing');
  return new ethers.JsonRpcProvider(rpc);
}

function getSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY missing');
  return new ethers.Wallet(pk, getProvider());
}

function getGameContract(readOnly = false) {
  const addr = process.env.FREAKY_ADDRESS;
  if (!addr) throw new Error('FREAKY_ADDRESS missing');
  const providerOrSigner = readOnly ? getProvider() : getSigner();
  return new ethers.Contract(addr, abi, providerOrSigner);
}

module.exports = { getProvider, getSigner, getGameContract };
