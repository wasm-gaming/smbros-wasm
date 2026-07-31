import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  romFingerprint,
  SMB1_ROM_BYTES,
  SMB1_ROM_FINGERPRINTS,
  verifyRom,
} from '../dist/smbros/smbros.rom.js';

/** A stand-in cartridge: right size and header, wrong contents. */
function syntheticRom(bytes = SMB1_ROM_BYTES) {
  const rom = new Uint8Array(bytes);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 0x02, 0x01]); // "NES\x1a", 2 PRG banks, 1 CHR
  for (let i = 16; i < rom.length; i++) {
    rom[i] = (i * 31) % 256;
  }
  return rom;
}

/**
 * The game hashes the base64 *text* of the headerless dump, not its bytes
 * (Marshalls.raw_to_base64(...).sha256_text() in ROMVerifier.gd). Recomputing
 * it here independently is what keeps the port honest.
 */
function expectedFingerprint(rom) {
  const payload = Buffer.from(rom.subarray(16, SMB1_ROM_BYTES));
  return createHash('sha256').update(payload.toString('base64'), 'utf8').digest('hex');
}

test('the fingerprint matches the game\'s base64-then-sha256 scheme', async () => {
  const rom = syntheticRom();
  assert.equal(await romFingerprint(rom), expectedFingerprint(rom));
});

test('only the first 40976 bytes are hashed', async () => {
  const rom = syntheticRom();
  const padded = new Uint8Array(SMB1_ROM_BYTES + 512);
  padded.set(rom);
  padded.fill(0xff, SMB1_ROM_BYTES);

  assert.equal(await romFingerprint(padded), await romFingerprint(rom));
});

test('a file with nothing past the header has no fingerprint', async () => {
  assert.equal(await romFingerprint(new Uint8Array(16)), null);
});

test('an unknown dump is rejected with a reason', async () => {
  const check = await verifyRom(syntheticRom());
  assert.equal(check.ok, false);
  assert.match(check.reason, /not one the game recognises/);
  assert.equal(check.fingerprint?.length, 64);
});

test('a short file is rejected on size before anything else', async () => {
  const check = await verifyRom(syntheticRom(1024));
  assert.equal(check.ok, false);
  assert.match(check.reason, /1024 bytes/);
});

test('the accepted fingerprints are the two hashes ROMVerifier lists', () => {
  assert.equal(SMB1_ROM_FINGERPRINTS.length, 2);
  for (const fingerprint of SMB1_ROM_FINGERPRINTS) {
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
  }
});
