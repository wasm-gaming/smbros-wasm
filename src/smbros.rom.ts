// Cartridge check, ported from the game's own ROMVerifier.
//
// Super Mario Bros. Remastered ships no Nintendo assets. On first boot it reads
// the CHR ROM out of an original Super Mario Bros. (NES) dump the player owns
// and rips its sprites and palettes into a resource pack. The game accepts
// exactly two dumps, identified the way `Scripts/UI/RomVerifier.gd` does it:
//
//   sha256( base64( rom[16 .. 40976] ) )
//
// — the 16-byte iNES header is dropped, the remaining PRG+CHR data is base64'd,
// and the digest is taken over that *text*, not over the raw bytes.
//
// Running the same check in the SDK means a wrong file is rejected in
// milliseconds instead of after a 90 MB runtime download.

/** Size of a headered Super Mario Bros. dump: 16 + 32768 PRG + 8192 CHR. */
export const SMB1_ROM_BYTES = 40976;

/** iNES header length, skipped before hashing. */
const HEADER_BYTES = 16;

/** The dumps `ROMVerifier.VALID_HASHES` accepts. */
export const SMB1_ROM_FINGERPRINTS: readonly string[] = [
  '6a54024d5abe423b53338c9b418e0c2ffd86fed529556348e52ffca6f9b53b1a',
  'c9b34443c0414f3b91ef496d8cfee9fdd72405d673985afa11fb56732c96152b',
];

export interface RomCheck {
  /** True when the dump is one the game can rip its assets from. */
  ok: boolean;
  /** The computed fingerprint, or `null` when the file was too short to hash. */
  fingerprint: string | null;
  /** Why the check failed, ready to show a player. Empty when `ok`. */
  reason: string;
}

function toBase64(bytes: Uint8Array): string {
  // btoa takes a binary string; chunk it so a 40 KB ROM cannot blow the
  // argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The fingerprint the game computes for `rom`, or `null` if there is not even a
 * header's worth of data to hash.
 */
export async function romFingerprint(rom: Uint8Array): Promise<string | null> {
  if (rom.length <= HEADER_BYTES) return null;
  const payload = rom.subarray(HEADER_BYTES, SMB1_ROM_BYTES);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(toBase64(payload)));
  return toHex(digest);
}

/** Run the game's acceptance check without booting the game. */
export async function verifyRom(rom: Uint8Array): Promise<RomCheck> {
  if (rom.length < SMB1_ROM_BYTES) {
    return {
      ok: false,
      fingerprint: await romFingerprint(rom),
      reason:
        `That file is ${rom.length} bytes; an original Super Mario Bros. (NES) ` +
        `dump is ${SMB1_ROM_BYTES}. Archives (.zip/.7z) have to be extracted first.`,
    };
  }

  const fingerprint = await romFingerprint(rom);
  if (fingerprint && SMB1_ROM_FINGERPRINTS.includes(fingerprint)) {
    return { ok: true, fingerprint, reason: '' };
  }

  return {
    ok: false,
    fingerprint,
    reason:
      'That dump is not one the game recognises. It needs an original, ' +
      'unmodified Super Mario Bros. (NES) ROM — the same file the desktop ' +
      'build asks for.',
  };
}
