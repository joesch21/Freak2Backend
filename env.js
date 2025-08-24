// Environment helper for relayer scripts
// Normalizes variable names and ensures required values are present

export function getEnv() {
  const RPC_URL = process.env.RPC_URL || process.env.RPC || '';
  const FREAKY_CONTRACT = process.env.FREAKY_CONTRACT || process.env.FREAKY_ADDRESS || '';

  // Accept both PRIVATE_KEY and RELAYER_PK for backwards compatibility
  let PK = (process.env.PRIVATE_KEY || process.env.RELAYER_PK || '').trim();

  // Strip accidental quotes / whitespace / 0x duplication
  PK = PK.replace(/^['"]|['"]$/g, '').trim();
  if (PK && !PK.startsWith('0x')) PK = '0x' + PK;

  const missing = [];
  if (!RPC_URL) missing.push('RPC_URL');
  if (!FREAKY_CONTRACT) missing.push('FREAKY_CONTRACT');
  if (!PK) missing.push('PRIVATE_KEY|RELAYER_PK');

  return { RPC_URL, FREAKY_CONTRACT, PK, missing };
}

