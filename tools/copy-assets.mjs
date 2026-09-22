// Copies highlight.js' published files into lib/, which the extension imports at runtime.
//
// lib/ is deliberately empty in the repository: the release workflow copies these four files in
// before packaging, so what ships is byte-identical to highlight.js' own distribution and a
// reviewer can verify it with `npm ci` and `diff` rather than reproducing a build.
//
// That leaves a working copy — and anything built or signed from one — without them, so
// src/hljs-init.js fails to resolve its imports and hljs never reaches the page. Run this before
// loading the extension as a temporary add-on, or before signing.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/@highlightjs/cdn-assets/es');
const into = resolve(root, 'lib');

const FILES = [
  ['core.min.js', 'core.min.js'],
  ['languages/xml.min.js', 'xml.min.js'],
  ['languages/http.min.js', 'http.min.js'],
  ['languages/properties.min.js', 'properties.min.js']
];

if (!existsSync(from)) {
  console.error('@highlightjs/cdn-assets is not installed. Run `npm ci` first.');
  process.exit(1);
}

mkdirSync(into, { recursive: true });

for (const [source, target] of FILES) {
  copyFileSync(resolve(from, source), resolve(into, target));
  console.log(`lib/${target}`);
}
