// Typed side of the demo page.
//
// The shared template (dist/demo/, copied from @wasm-gaming/engine-specs) is
// plain JS and gets wired up in index.html, which is its documented
// integration point. Everything that benefits from type checking lives here and
// is handed to the page on `window.SMBROS`: the SDK itself, plus the ROM check
// so a wrong file is rejected in the launcher instead of at the game's own ROM
// screen after a 90 MB download.
import sdk from '@wasm-gaming/smbros-wasm';
import { SMB1_ROM_BYTES, verifyRom, type RomCheck } from '@wasm-gaming/smbros-wasm/rom';

declare global {
  interface Window {
    /** Convention the shared template's sdk.js looks for. */
    SDK?: typeof sdk;
    SMBROS?: {
      sdk: typeof sdk;
      manifest: typeof sdk.manifest;
      romBytes: number;
      checkRom(bytes: ArrayBuffer | Uint8Array): Promise<RomCheck>;
    };
  }
}

window.SDK = sdk;
window.SMBROS = {
  sdk,
  manifest: sdk.manifest,
  romBytes: SMB1_ROM_BYTES,
  checkRom: (bytes) => verifyRom(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
};

// Mirrors the SDK's own runtime selection: the threaded export needs a
// cross-origin isolated page, so `make preview` and `make preview.single` show
// different values here.
const runtime = document.getElementById('runtime');
if (runtime) {
  runtime.textContent = window.crossOriginIsolated === true ? 'threaded' : 'single-threaded';
}
