import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'node:child_process';

// Default: every 15 minutes so you don’t miss short rounds
const schedule = process.env.CRON_SCHEDULE || '*/15 * * * *';

console.log('Cron schedule:', schedule);
cron.schedule(schedule, () => {
  exec('node ritual-relayer.js', (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) console.error(err);
  });
});
