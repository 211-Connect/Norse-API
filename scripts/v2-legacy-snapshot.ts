/**
 * Writes src/v2/rules/__fixtures__/legacy-snapshot.json: the output of
 * origin/development's rules engine (decide + finalize) on the parity inputs.
 * Run it on the development code, not on the copy under src/v2/rules/legacy:
 *
 *   rm -rf /tmp/dev-rules && mkdir /tmp/dev-rules
 *   git archive origin/development src/v2/rules | tar -x -C /tmp/dev-rules
 *   npx ts-node --transpile-only scripts/v2-legacy-snapshot.ts \
 *     /tmp/dev-rules/src/v2/rules src/v2/rules/__fixtures__/legacy-snapshot.json
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { runCase, snapshotCases } from '../src/v2/rules/legacy/snapshot-inputs';

const [rulesDir, outFile] = process.argv.slice(2);
if (!rulesDir || !outFile) {
  throw new Error('usage: v2-legacy-snapshot.ts <rules dir> <out file>');
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require(resolve(rulesDir, 'engine'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RULES_VERSION } = require(resolve(rulesDir, 'config'));
const cases = snapshotCases();
const rows = Object.fromEntries(cases.map((c) => [c.key, runCase(engine, c)]));
writeFileSync(
  outFile,
  JSON.stringify({ rules_version: RULES_VERSION, count: cases.length, rows }),
);
console.log(`wrote ${cases.length} cases, rules_version ${RULES_VERSION}`);
