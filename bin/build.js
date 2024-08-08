// build.js
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    outfile: 'build/server.js',
    platform: 'node',
    target: ['node14'],
    format: 'cjs',
    loader: { '.ts': 'ts' },
    tsconfig: 'tsconfig.json', // Path to your tsconfig.json
  })
  .catch(() => process.exit(1));
