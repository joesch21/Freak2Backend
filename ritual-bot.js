import cron from 'node-cron';
import { closeRoundIfExpired } from './ritual-relayer.js';

const TZ = process.env.TIMEZONE || 'Australia/Sydney';

cron.schedule('0 * * * *', () => closeRoundIfExpired(), { timezone: TZ });

import('./mode-scheduler.js').then(({ default: switchMode }) => {
  cron.schedule('55 23 * * 4', () => switchMode('Jackpot'), { timezone: TZ });
  cron.schedule('5 0 * * 6', () => switchMode('Standard'), { timezone: TZ });
});

console.log('Ritual bot started.');
