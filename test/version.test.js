/**
 * The add-on's version lives in manifest.json — that is the one Firefox installs against and the
 * one AMO refuses to accept twice. package.json carries a version of its own, and upstream let the
 * two drift three patch releases apart, which makes it impossible to tell from a checkout which
 * version you are actually holding.
 *
 * Keep them equal, and fail here rather than after an upload has already been rejected.
 */

const fs = require('fs');
const path = require('path');

const readJson = file => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));

describe('version', () => {
  const manifest = readJson('manifest.json');
  const npmPackage = readJson('package.json');

  it('is the same in manifest.json and package.json', () => {
    expect(npmPackage.version).toBe(manifest.version);
  });

  it('is the same in package-lock.json, so npm ci does not undo the alignment', () => {
    const lock = readJson('package-lock.json');

    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].version).toBe(manifest.version);
  });

  it('is a plain three-part version, as AMO expects', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
