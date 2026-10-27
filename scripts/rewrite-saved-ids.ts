/**
 * Cutover rewrite of saved ids for ONE re-keyed tenant (ISS-2516, run in
 * ISS-2519). Dry run unless --apply is given. See docs/rekey-saved-ids.md.
 *
 *   MONGODB_URI=... npx ts-node -r tsconfig-paths/register \
 *     scripts/rewrite-saved-ids.ts --tenant <uuid> --mapping <file.csv|file.json> [--apply]
 *
 * Prints the report as JSON. On failure prints only the error class and
 * message: never the connection string.
 */
import { readFileSync } from 'fs';
import mongoose from 'mongoose';
import { parseMapping, rewriteSavedIds } from 'src/rekey/rewrite-saved-ids';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = arg('tenant');
  const mappingPath = arg('mapping');
  const dryRun = !process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!tenantId || !mappingPath || !uri) {
    throw new Error(
      'usage: MONGODB_URI=... rewrite-saved-ids --tenant <uuid> --mapping <file> [--apply]',
    );
  }

  const mapping = parseMapping(readFileSync(mappingPath, 'utf8'), mappingPath);
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const db = connection.db;
    const report = await rewriteSavedIds(
      {
        favoriteLists: db.collection('favoriteLists'),
        printableDirectories: db.collection('printableDirectories'),
        redirects: db.collection('redirects'),
      },
      { tenantId, mapping, dryRun },
    );
    console.log(
      JSON.stringify({ database: db.databaseName, ...report }, null, 2),
    );
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  const uri = process.env.MONGODB_URI;
  const message = error instanceof Error ? error.message : String(error);
  const safe = (uri ? message.split(uri).join('***') : message).replace(
    /mongodb(\+srv)?:\/\/\S+/g,
    '***',
  );
  console.error(`${(error as any)?.constructor?.name ?? 'Error'}: ${safe}`);
  process.exit(1);
});
