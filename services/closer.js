const { getGameContract } = require('../lib/contract');
const { desiredModeNow } = require('../lib/mode');

async function tryCloseRound(logger = console) {
  const game = getGameContract(false);

  const active = await game.isRoundActive();
  if (!active) {
    logger.info('[close] No active round.');
    return { sent: false, reason: 'inactive' };
  }

  const round = Number(await game.currentRound());
  const start = Number(await game.roundStart());
  const dur   = Number(await game.duration());
  const now   = Math.floor(Date.now() / 1000);
  const left  = start + dur - now;

  logger.info(`[close] round=${round} left=${left}`);

  if (left > 0) {
    return { sent: false, reason: 'too-early', left, round };
  }

  const count = (await game.getParticipants()).length;
  logger.info(`[close] Closing round=${round}, participants=${count}`);

  const tx = await game.checkTimeExpired();
  logger.info(`[close] tx sent: ${tx.hash}`);
  const rcpt = await tx.wait();
  logger.info(`[close] tx confirmed in block ${rcpt.blockNumber}`);

  return { sent: true, hash: tx.hash, round, count };
}

async function syncPrizeMode(logger = console) {
  const game = getGameContract(false);
  const active = await game.isRoundActive();
  if (active) {
    logger.info('[mode] Round active; skip mode change.');
    return;
  }

  const want = desiredModeNow();
  const enumIdx = want === 'Jackpot' ? 1 : 0;

  if (game.getRoundMode) {
    const cur = Number(await game.getRoundMode());
    if (cur === enumIdx) return;
  }

  if (game.setRoundMode) {
    const tx = await game.setRoundMode(enumIdx);
    logger.info(`[mode] Set mode -> ${want}. Tx: ${tx.hash}`);
    await tx.wait();
  } else {
    logger.warn('[mode] setRoundMode not available on this ABI.');
  }
}

module.exports = { tryCloseRound, syncPrizeMode };
