import { readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import * as ts from 'typescript';

/** Test-only code that `nest build` must not ship. */
const TEST_ONLY = ['src/live/', 'src/common/testing/'];
const ROOT = join(__dirname, '../../..');

function productionFiles(): string[] {
  const configPath = join(ROOT, 'tsconfig.build.json');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error)
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return ts
    .parseJsonConfigFileContent(config, ts.sys, dirname(configPath))
    .fileNames.map((file) => relative(ROOT, file));
}

describe('production build', () => {
  const files = productionFiles();

  it('compiles the app itself', () => {
    expect(files).toContain('src/main.ts');
  });

  it.each(TEST_ONLY)('leaves out %s', (dir) => {
    expect(files.filter((file) => file.startsWith(dir))).toEqual([]);
  });

  it('has no production file importing test-only code', () => {
    const importers = files.filter((file) =>
      /from '[^']*(\/live\/|common\/testing)/.test(
        readFileSync(join(ROOT, file), 'utf8'),
      ),
    );
    expect(importers).toEqual([]);
  });
});
