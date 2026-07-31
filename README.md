# @wasm-gaming/smbros-wasm

[![Build](https://github.com/wasm-gaming/smbros-wasm/actions/workflows/build.yml/badge.svg)](https://github.com/wasm-gaming/smbros-wasm/actions/workflows/build.yml)
[![Release](https://github.com/wasm-gaming/smbros-wasm/actions/workflows/release.yml/badge.svg)](https://github.com/wasm-gaming/smbros-wasm/actions/workflows/release.yml)

[Super Mario Bros. Remastered](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public)
(Godot 4) exported to WebAssembly and packaged as a wasm-gaming engine SDK.

This subproject follows the same engine-package approach as jgenesis-wasm:

- typed `manifest`
- typed `options`
- `load(config)` engine SDK surface
- Makefile-driven build (`build-sdk`, `build-wasm`, `preview`)

Nothing from the game lives in this repo. `make build-wasm` checks out a pinned
upstream revision, applies the web-compatibility patches in
[scripts/patch-smbros-project.mjs](scripts/patch-smbros-project.mjs), and runs
Godot's web exporter over it.

> **You need your own Super Mario Bros. (NES) ROM.** The game ships no Nintendo
> assets: it reads the CHR ROM out of a cartridge dump the player owns and rips
> its sprites and palettes into a resource pack on first boot. No ROM is
> included here, and none ever will be.

## Contract surface

```js
import { manifest, load } from '@wasm-gaming/smbros-wasm';

const engine = await load({
  attachTo: containerEl,      // or canvasEl: someCanvas
  assets: { rom: romBytes },  // an original Super Mario Bros. (NES) dump
  options: { locale: 'es' },
  onProgress: (current, total) => { /* ~90 MB on a cold load */ },
  onEvent: (e) => { /* ready | error | exit */ },
});

engine.start();
engine.reset();
await engine.purgeStorage();
engine.destroy();
```

### How the ROM reaches the game

The game asks for a cartridge on a screen of its own, driven by a native file
dialog and drag-and-drop — neither of which a host page can feed. So the SDK
puts the file where the game already looks, before it boots:

1. `verifyRom()` runs the game's own acceptance check (SHA-256 over the base64
   of the headerless dump, the two hashes `ROMVerifier.gd` lists) so a wrong
   file is rejected in milliseconds instead of after a 90 MB download.
2. The bytes are staged into the instance's filesystem at
   `/userfs/SMB1R/baserom.nes` — that is `user://baserom.nes`, exactly where
   `Global.check_for_rom()` reads it from.
3. The same bytes are staged at `/tmp/baserom.nes` and passed as `-rom
   /tmp/baserom.nes`, the command-line path the game's ROM screen accepts. If
   the first copy is ever rejected, this one keeps the player off the manual
   ROM screen.

The pack the game rips out of the ROM is written by the game itself, so it
lands in IndexedDB and survives a reload — the slow first boot happens once.

### Options

Everything a host can set is declared once in
[src/smbros.options.ts](src/smbros.options.ts); the manifest's options schema and
the defaults are derived from that catalog.

A Godot export reads its configuration at boot, so every option is a boot-time
one: `variant`, `locale`, `canvasResizePolicy`, `focusCanvas`, `pixelated`,
`persistentDrops`, `experimentalVirtualKeyboard`, `verifyRom`, `autoStart`,
`runtimeBaseUrl`, `extraArgs`. Video scaling, audio levels, controls, resource
packs and language have in-game menus, which is where a player changes them —
this package deliberately does not put a second settings overlay on top.

### Sizing: `options.fit`

A canvas has two sizes — the **box** it occupies on the page and the **drawing
buffer** it renders into — and for a Godot export the drawing buffer *is* the
game's window. `fit` decides how the SDK reconciles them.

**`'container'` (default)** — the box comes from the host's CSS, and the SDK
keeps the drawing buffer matched to it (times the device pixel ratio, via a
`ResizeObserver`). Godot therefore gets a window the same shape as the element
it was mounted in, and the game's own video settings behave as they do on the
desktop build: **aspect ratio** (`keep` letterboxes, `expand` widens the view)
and **integer/fractional scaling** both act on the difference between 256×240
and the window. Give the container a size:

```css
#game-root { width: 100vw; height: 100vh; }
```

An unsized container renders nothing — the SDK warns when it sees one.

**`'native'`** — the buffer is pinned at 256×240 and the SDK writes no CSS
size, so host CSS scales a fixed-resolution picture (`image-rendering:
pixelated`, on by default, keeps that upscale crisp). Simple and cheap, but the
game's window is then already exactly 256:240, so its aspect-ratio and scaling
settings have nothing left to do.

**`'window'`** — hands sizing to Godot's own adaptive policy, which fills the
browser window and sets `position: absolute; top: 0; left: 0` on the canvas.
Right for a page that is nothing but the game (the stock shell at
`dist/original/index.html` works this way), wrong inside a host container: it
takes the canvas out of flow, the container collapses to 0×0, and an
`overflow: hidden` there clips the game away entirely while the audio keeps
playing.

Pointer input survives all three — Godot maps coordinates through the canvas'
bounding rect, so a CSS-scaled canvas still clicks in the right place.

### Contract notes

Where the contract and a Godot export do not line up exactly:

| Method | Behaviour |
| --- | --- |
| `start()` | No-op after `load()` unless `options.autoStart` is `false`, which defers the runtime download to the first call. |
| `pause()` / `resume()` | No-ops. Godot drives its own main loop through the browser and exposes no handle on it; the game's pause menu (Escape) is the real pause. |
| `reset()` | Best-effort power cycle: quits the instance, waits for it to unwind, boots a fresh one against the same canvas. The wasm and pack come back from the HTTP cache. For a guaranteed clean slate, `destroy()` and `load()` again. |
| `setInput()` | No-op with a warning. The game owns its InputMap and ships a remapping screen. |
| `purgeStorage()` | Drops the whole `user://` directory: installed ROM, ripped assets, saves, settings. Godot keeps one user directory per export, so this ignores `storageNamespace`. Call it on a destroyed instance. |
| `saveState()` / `loadState()` | Not implemented; `capabilities.saveStates` is `false`. The game has its own save files. |

## Build

```bash
make build        # web export + SDK
make build-sdk    # TS only
make build-wasm   # exports the Godot project (downloads Godot on first run)
make preview      # serves dist/ with COOP/COEP
make test         # typecheck + node test runner
```

The first `make build-wasm` downloads the pinned Godot editor and export
templates (~1.4 GB) into `.tmp/toolchain/`, clones the game into
`.tmp/smbros-src/`, and imports its ~3700 resources. Later runs reuse all of it;
`make clean-all` throws it away.

Pins live at the top of the [Makefile](Makefile) and can be overridden:

```bash
make build-wasm UPSTREAM_REF=main GODOT_VERSION=4.6.3-stable VARIANTS=nothreads
make build-wasm-docker      # same export inside Debian, for CI parity
```

### What the patches change

Godot refuses to load a GDExtension with no library for the target platform,
and neither of the game's two extensions has a web binary. The patch script
removes them and the single call site that would then fail to compile, disables
the editor plugins (they run during `--import`/`--export-release`), drops the
ModLoader autoloads (they resolve mod folders from
`OS.get_executable_path()`, which is empty on web), switches off Discord rich
presence through its existing project setting, pins `custom_user_dir_name` to
the value Godot derives anyway, and appends the two Web export presets — with
the desktop presets' `include_filter`, so the `*.bgm`/`*.mp3` audio that lives
outside Godot's resource system still makes it into the pack.

Everything else is stock. The game's own rendering method is already
`gl_compatibility`, so nothing about the renderer had to change.

### dist/ layout

`make build-wasm` writes two runtime variants that share one 52 MB data pack:

- `dist/smbros/smbros.js` + `smbros.wasm` — single-threaded, runs anywhere
- `dist/smbros/smbros.threaded.js` + `smbros.threaded.wasm` — needs a
  cross-origin isolated page (COOP/COEP)
- `dist/smbros/smbros.pck` — the game data, shared by both
- `dist/smbros/*.audio.worklet.js` — resolved by the glue relative to its own
  script URL, which is why the SDK loads it with a `<script>` tag
- `dist/original/index.html` — the stock Godot page, kept reachable

`make build-sdk` then adds the compiled SDK next to them, plus:

- `dist/demo/` — the shared template, copied verbatim from
  `@wasm-gaming/engine-specs/demo`
- `dist/index.html` — the page shell that wires that template to this SDK
- `dist/theme.nes.css` — the overworld skin
- `dist/demo.js` — compiled from `src/demo/demo.ts`

The SDK picks the runtime pair automatically: threaded when
`crossOriginIsolated === true`, single-threaded otherwise. `make preview` sends
the isolation headers, `make preview.single` does not, so both paths are
testable locally.

## npm

Only the SDK is published. The runtime artifacts are ~90 MB and are a build of
GPL-3.0 game code, so they belong on a GitHub Release rather than in a package
tarball — point the SDK at them with `options.runtimeBaseUrl`, or per-file with
`jsUrl`/`wasmUrl`.

## Licensing

- This packaging code (`src/`, `scripts/`, `tests/`) is MIT — see [LICENSE](LICENSE).
- The game is **GPL-3.0**. Anything `make build-wasm` produces in `dist/smbros/`
  is a build of that source and stays GPL-3.0; if you distribute those files,
  the GPL's source requirements apply. See [NOTICE.md](NOTICE.md).
- Super Mario Bros. is a trademark of Nintendo, which is not affiliated with
  this project. No Nintendo code or assets are contained in, or distributed
  with, this repository.
