// build-abi.js for Freaks2Backend
// This script converts our JSON ABI definitions into ES module files.  The
// front‑end and backend both import these modules to get typed ABI arrays.
const fs = require('fs');

const files = [
  { json: './public/freakyFridayGameAbi.json', out: './public/freakyFridayGameAbi.js' },
  { json: './public/erc20Abi.json', out: './public/erc20Abi.js' }
];

files.forEach(({ json, out }) => {
  const abi = JSON.parse(fs.readFileSync(json, 'utf8'));
  const js  = `module.exports = ${JSON.stringify(abi, null, 2)};\n`;
  fs.writeFileSync(out, js);
  console.log('✅ Generated', out);
});