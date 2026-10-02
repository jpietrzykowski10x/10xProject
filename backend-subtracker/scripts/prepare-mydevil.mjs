// Assembles the MyDevil deploy package in .mydevil/ from an existing `nest build`.
// Run via `npm run prepare-mydevil`. MyDevil only starts an entry file named app.js/app.mjs,
// so dist/ is flattened into the package root with main.js renamed to app.js.
// package.json travels along so Node keeps treating the files as ESM ("type": "module").
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = join(root, '.mydevil');

await rm(out, { recursive: true, force: true });
await mkdir(out);
await cp(join(root, 'dist'), out, { recursive: true });
await rename(join(out, 'main.js'), join(out, 'app.js'));
await rename(join(out, 'main.js.map'), join(out, 'app.js.map'));
await cp(join(root, 'package.json'), join(out, 'package.json'));
await cp(join(root, 'package-lock.json'), join(out, 'package-lock.json'));

console.log(`MyDevil package ready: ${out} (entry: app.js)`);
