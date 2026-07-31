import type { EngineManifest } from '@wasm-gaming/engine-specs';
import { SMBROS_OPTIONS_SCHEMA } from './smbros.options.js';
import { SMB1_ROM_BYTES } from './smbros.rom.js';
import { ROM_INSTALL_PATH } from './smbros.runtime.js';

export const manifest: EngineManifest = {
  id: 'smbros',
  version: '0.1.0',
  name: 'Super Mario Bros. Remastered (WebAssembly)',
  description:
    "JHDev2006's Godot 4 remake of Super Mario Bros., The Lost Levels, Super Mario Bros. Special and All Night Nippon, exported to WebAssembly. Ships no Nintendo assets: the player supplies an original NES cartridge dump and the game rips its graphics from it on first boot.",
  artifacts: {
    wasm: 'smbros/smbros.wasm',
    js: 'smbros/smbros.js',
    data: 'smbros/smbros.pck',
  },
  assets: [
    {
      key: 'rom',
      mountPath: ROM_INSTALL_PATH,
      required: true,
      accept: ['.nes'],
      validate: { bytes: SMB1_ROM_BYTES },
      description:
        'An original Super Mario Bros. (NES) ROM. Written into the game\'s user:// directory before boot; the game verifies it and rips its sprites and palettes into a resource pack the first time it runs.',
    },
  ],
  // Player 1 defaults from the project's InputMap. The game has its own control
  // remapping screen, which is what actually rebinds these at runtime.
  input: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    jump: 'KeyZ',
    run: 'KeyX',
    dropItem: 'ShiftLeft',
    pause: 'Escape',
  },
  // 256×240 with square pixels, the way the desktop build opens (1024×960).
  video: { baseWidth: 256, baseHeight: 240, aspect: '16:15' },
  options: SMBROS_OPTIONS_SCHEMA,
  capabilities: { saveStates: false, sram: true, coreSelectable: false },
};

export default manifest;
