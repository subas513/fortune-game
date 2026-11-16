// Manually delete old game rounds (the server also does this by itself every hour).
//   npm run prune-rounds               (keeps the last ROUND_RETENTION_DAYS days, default 30)
//   npm run prune-rounds -- --days 7
import { pruneRounds } from './rounds.js';

const i = process.argv.indexOf('--days');
const days = Number(i > 0 ? process.argv[i + 1] : process.env.ROUND_RETENTION_DAYS ?? 30);
if (!(days >= 1)) { console.error('--days must be at least 1'); process.exit(1); }
const n = await pruneRounds(days);
console.log(n ? `Deleted ${n} rounds older than ${days} days.` : `Nothing older than ${days} days.`);
