import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const METRICS_SRC_DIR = join(__dirname);
const DOC_PATH = join(__dirname, '..', '..', 'docs', 'metrics.md');

function declaredMetricNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(METRICS_SRC_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
    const source = readFileSync(join(METRICS_SRC_DIR, file), 'utf8');
    for (const match of source.matchAll(/name: '(norse_[a-z0-9_]+)'/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('docs/metrics.md', () => {
  it('only names metrics that exist in src/metrics', () => {
    const declared = declaredMetricNames();
    const documented = new Set(
      readFileSync(DOC_PATH, 'utf8').match(/norse_[a-z0-9_]+/g) ?? [],
    );

    expect(declared.size).toBeGreaterThan(0);
    const unknown = [...documented].filter(
      (name) =>
        !declared.has(name) &&
        !['_total', '_bucket', '_sum', '_count', '_created'].some(
          (suffix) =>
            name.endsWith(suffix) &&
            declared.has(name.slice(0, -suffix.length)),
        ),
    );

    expect(unknown).toEqual([]);
  });
});
