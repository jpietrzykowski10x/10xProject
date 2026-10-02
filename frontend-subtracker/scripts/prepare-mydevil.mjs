// Assembles the MyDevil deploy package in .mydevil/ from an existing production build.
// Run via `npm run prepare-mydevil`. MyDevil only starts an entry file named app.js/app.mjs,
// so the server bundle is flattened into the package root with server.mjs renamed to
// app.mjs, and the browser assets go to public/ (src/server.ts looks there first).
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist', 'frontend-subtracker');
const out = join(root, '.mydevil');

await rm(out, { recursive: true, force: true });
await mkdir(out);
await cp(join(dist, 'server'), out, { recursive: true });
await rename(join(out, 'server.mjs'), join(out, 'app.mjs'));
await cp(join(dist, 'browser'), join(out, 'public'), { recursive: true });
await cp(join(root, 'package.json'), join(out, 'package.json'));
await cp(join(root, 'package-lock.json'), join(out, 'package-lock.json'));

console.log(`MyDevil package ready: ${out} (entry: app.mjs)`);
