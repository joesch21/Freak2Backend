import fs from 'fs';

const files = [
  { json: './public/freakyFridayGameAbi.json', out: './public/freakyFridayGameAbi.js' },
  { json: './public/erc20Abi.json', out: './public/erc20Abi.js' }
];

for (const { json, out } of files) {
  const abi = JSON.parse(fs.readFileSync(json, 'utf8'));
  const js  = `export default ${JSON.stringify(abi, null, 2)};\n`;
  fs.writeFileSync(out, js);
  console.log('✅ Generated', out);
}
