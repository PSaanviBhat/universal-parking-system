/**
 * Runs every backend test suite in order, each in its own process (each suite
 * starts the app on a random port and exits with its own status code).
 *
 * Needs a migrated and seeded database (Phoenix Mall) in DATABASE_URL, plus
 * NODE_ENV=test and ALLOW_SIMULATED_PAYMENTS=true. Locally:
 *   npm run db:seed --workspace=apps/backend      (SEED_RESET=true for a clean slate)
 *   npm test --workspace=apps/backend
 */
import { spawnSync } from 'child_process';
import path from 'path';

// Order matters: suites share the seeded facility. The operator suite expects all
// 20 seeded slots active, and the edge-case suite deactivates one (reassignment).
const SUITES = [
  'test-auth',
  'test-vehicles',
  'test-wallet',
  'test-admin',
  'test-entry',
  'test-exit',
  'test-operator',
  'test-enforcement',
  'test-edge-cases',
];

const tsNodeBin = require.resolve('ts-node/dist/bin.js');
const env = { ...process.env, NODE_ENV: 'test', ALLOW_SIMULATED_PAYMENTS: 'true' };

const results: { suite: string; ok: boolean; seconds: number }[] = [];

for (const suite of SUITES) {
  console.log(`\n━━━ ${suite} ━━━`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [tsNodeBin, '--transpile-only', path.join(__dirname, `${suite}.ts`)], {
    stdio: 'inherit',
    env,
    cwd: path.join(__dirname, '..'),
  });
  results.push({ suite, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('\n━━━ Summary ━━━');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.suite} (${r.seconds}s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} suite(s) failed.` : '\nAll suites passed.');
process.exit(failed ? 1 : 0);
