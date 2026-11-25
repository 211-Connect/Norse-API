import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * The gateway strips `/norse-api/v1`, so callers reach the legacy `/<route>`.
 * A route declared `@Version('1')` or `version: '1'` alone answers only at
 * `/v1/<route>` and 404s through the gateway (Norse dev e2e area-search,
 * 2026-11-20).
 */
describe('v1 routes keep the legacy path', () => {
  it.each(controllerFiles(join(__dirname, '../..')))(
    '%s declares no bare version 1',
    (file) => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/@Version\(\s*'1'\s*\)/);
      // The controller form: `@Controller({ path, version: '1' })`.
      expect(source).not.toMatch(/\bversion:\s*'1'/);
    },
  );
});
