// Shared by `web-ext lint`, `web-ext build` and `web-ext sign`.
//
// The manifest lives at the repository root, so the source directory is the repository itself and
// everything that is not part of the add-on has to be named here — otherwise the tests, the
// Playwright artefacts and node_modules all end up inside the signed .xpi.

module.exports = {
  ignoreFiles: [
    'node_modules',
    'test',
    'tools',
    'test-results',
    'playwright-report',
    'dist',
    '.github',
    'package.json',
    'package-lock.json',
    'playwright.config.js',
    'web-ext-config.cjs',
    'sign.ps1',
    '*.md'
  ],
  build: {
    overwriteDest: true
  },
  artifactsDir: 'dist'
};
