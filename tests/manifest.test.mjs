import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateManifest } from '@wasm-gaming/engine-specs';

import { manifest } from '../dist/smbros/smbros.manifest.js';
import { SMB1_ROM_BYTES } from '../dist/smbros/smbros.rom.js';
import { ROM_INSTALL_PATH } from '../dist/smbros/smbros.runtime.js';

test('the manifest satisfies the engine contract', () => {
  const result = validateManifest(manifest);
  assert.deepEqual(result.errors ?? [], []);
  assert.equal(result.valid, true);
});

test('dist/manifest.json is in sync with the typed manifest', () => {
  const emitted = JSON.parse(readFileSync(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(emitted, JSON.parse(JSON.stringify(manifest)));
});

test('the ROM asset points at the path the SDK installs to', () => {
  const rom = manifest.assets.find((asset) => asset.key === 'rom');
  assert.ok(rom, 'manifest declares a rom asset');
  assert.equal(rom.required, true);
  assert.equal(rom.mountPath, ROM_INSTALL_PATH);
  assert.equal(rom.validate?.bytes, SMB1_ROM_BYTES);
});

test('artifact paths match what the web export writes', () => {
  assert.equal(manifest.artifacts.js, 'smbros/smbros.js');
  assert.equal(manifest.artifacts.wasm, 'smbros/smbros.wasm');
  assert.equal(manifest.artifacts.data, 'smbros/smbros.pck');
});
