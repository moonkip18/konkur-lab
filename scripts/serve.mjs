/**
 * One-click launcher.
 *
 * Serves the built app over http://127.0.0.1 and opens the browser. A local
 * server is not optional here: Chrome denies IndexedDB on file:// URLs (the
 * origin is opaque), so a double-clicked HTML file cannot store a single exam.
 * On localhost the app gets a real origin, so storage, service workers, and
 * offline caching all work.
 *
 * No dependencies -- plain node: builtins only, so it runs with nothing but
 * Node installed.
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const indexFile = join(dist, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const START_PORT = Number(process.env.PORT ?? 5178);
const MAX_PORT_TRIES = 24;

function build() {
  process.stdout.write('Building the app (first run only)...\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.stderr.write('\nBuild failed. Run "npm install" first, then try again.\n');
    process.exit(1);
  }
}

/**
 * Resolves a URL path to a file inside dist, refusing anything that escapes it.
 * Returns null for traversal attempts and for directories.
 */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded === '/' || decoded === '') return indexFile;

  const candidate = normalize(join(dist, decoded));
  if (candidate !== dist && !candidate.startsWith(dist + sep)) return null;
  if (!existsSync(candidate)) return null;

  const stats = statSync(candidate);
  if (stats.isDirectory()) {
    const withIndex = join(candidate, 'index.html');
    return existsSync(withIndex) ? withIndex : null;
  }
  return candidate;
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {});
    child.unref();
  } catch {
    // A failed auto-open is not fatal; the URL is printed either way.
  }
}

function listen(port, attemptsLeft = MAX_PORT_TRIES) {
  const server = createServer((req, res) => {
    const file = resolveFile(req.url ?? '/');

    if (file === null) {
      // Unknown paths fall back to the shell, which is what a single-page app
      // needs. The guard above has already rejected traversal attempts.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const headers = {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The service worker must never be served stale, or an old build sticks.
      'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'no-store',
    };
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    process.stderr.write(`Could not start server: ${error.message}\n`);
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    process.stdout.write(
      [
        '',
        '  Konkur Progress Lab',
        '  -------------------',
        `  ${url}`,
        '',
        '  Your browser should open automatically.',
        '  If it does not, paste the address above into the address bar.',
        '',
        '  Keep this window open while you use the app.',
        '  Close it (or press Ctrl+C) to stop the server.',
        '',
        '  All exam data is stored in this browser, on this device.',
        '',
      ].join('\n'),
    );
    openBrowser(url);
  });
}

if (!existsSync(indexFile)) build();

if (!existsSync(indexFile)) {
  process.stderr.write('dist/index.html is missing and could not be built.\n');
  process.exit(1);
}

listen(START_PORT);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}
