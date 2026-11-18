import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Post-build integrity check. Guards the two claims the README makes that are
 * easy to break silently: the service worker precaches the whole shell, and no
 * third-party origin is referenced anywhere in the output.
 */
const dist = resolve('dist');
const errors = [];
const notes = [];

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);
const rel = (f) => f.slice(dist.length + 1).replace(/\\/g, '/');
const byName = (suffix) => files.filter((f) => rel(f).endsWith(suffix));

// 1. Required shell files.
for (const required of ['index.html', 'sw.js', 'manifest.webmanifest', 'favicon.svg']) {
  if (!existsSync(join(dist, required))) errors.push(`missing ${required}`);
}

// 2. The service worker must precache the entry point.
const swPath = byName('sw.js')[0];
if (swPath) {
  const sw = readFileSync(swPath, 'utf8');
  if (!sw.includes('index.html')) {
    errors.push('service worker does not precache index.html');
  }
  if (!/precacheAndRoute|precache/.test(sw)) {
    errors.push('service worker does not precache anything');
  }
  const swDir = rel(swPath).split('/').slice(0, -1).join('/');
  // Workbox emits unquoted object keys: {url:"index.html",revision:"..."}
  const referenced = [...sw.matchAll(/[{,]url:"([^"]+)"/g)].map((m) => m[1]);
  for (const url of new Set(referenced)) {
    if (!existsSync(join(dist, url))) errors.push(`service worker precaches missing file: ${url}`);
  }
  notes.push(`service worker precaches ${new Set(referenced).size} entries`);
}

// 3. No third-party resource loads.
//
// A blanket URL grep is useless here: React, Dexie, and Workbox all embed
// documentation links inside error message strings. What matters is whether the
// browser would actually fetch something off-origin, so this only inspects
// resource-loading constructs.
const RESOURCE_LOADERS = [
  /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi, // HTML/SVG asset attributes
  /@import\s+(?:url\()?["']?(https?:\/\/[^"'\s)]+)/gi, // CSS imports
  /url\(\s*["']?(https?:\/\/[^"')]+)/gi, // CSS url()
  /\bfetch\(\s*["'`](https?:\/\/[^"'`]+)/gi, // runtime fetch
  /new\s+WebSocket\(\s*["'`](https?:\/\/[^"'`]+)/gi,
  /navigator\.sendBeacon\(\s*[^,)]*,\s*["'`](https?:\/\/[^"'`]+)/gi,
  /importScripts\(\s*["'](https?:\/\/[^"']+)/gi,
];

for (const file of files) {
  if (!/\.(js|css|html|webmanifest|svg)$/.test(file)) continue;
  const contents = readFileSync(file, 'utf8');
  const hits = [];
  for (const pattern of RESOURCE_LOADERS) {
    for (const match of contents.matchAll(pattern)) hits.push(match[1]);
  }
  if (hits.length > 0) {
    errors.push(`${rel(file)} loads third-party resources: ${[...new Set(hits)].join(', ')}`);
  }
}

// Fonts must be system fonts: an @font-face pointing anywhere would be an
// external request at first paint.
const cssFiles = byName('.css');
for (const file of cssFiles) {
  if (/@font-face/.test(readFileSync(file, 'utf8'))) {
    errors.push(`${rel(file)} declares @font-face; expected system fonts only`);
  }
}

// 4. The entry HTML must reference the built bundle.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!/<script[^>]+src="[^"]*\.js"/.test(html)) errors.push('index.html has no script tag');
if (!/<link[^>]+stylesheet/.test(html)) errors.push('index.html has no stylesheet link');

// The boot notice is dev-template scaffolding; it must not survive into a
// production build, where main.tsx removes it anyway and dead markup is just
// bloat in the precache.
if (html.includes('boot-notice')) {
  errors.push('index.html still contains the dev boot notice');
}

// 5. Total precached size, so a runaway bundle is visible.
const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
notes.push(`dist total ${(total / 1024).toFixed(1)} KiB across ${files.length} files`);

for (const note of notes) console.log(`  ok  ${note}`);
if (errors.length > 0) {
  console.error('\nBuild integrity check failed:');
  for (const e of errors) console.error(`  FAIL ${e}`);
  process.exit(1);
}
console.log('\nBuild integrity check passed.');
