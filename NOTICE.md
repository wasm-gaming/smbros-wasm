# Notices

## Two licences, two sets of files

**This repository's own code** — `src/`, `scripts/`, `tests/`, the Makefile and
the configuration around them — is MIT licensed. See [LICENSE](LICENSE).

**The game** is [Super Mario Bros. Remastered](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public)
by JHDev2006 and contributors, licensed **GPL-3.0**. None of it is vendored
here: `make build-wasm` checks out a pinned upstream revision at build time.

Everything that build writes into `dist/smbros/` (`smbros.wasm`,
`smbros.threaded.wasm`, `smbros.pck`, the Godot glue and worklets) is a
compiled form of that GPL-3.0 source, and stays GPL-3.0. If you distribute
those files — on a Release, a CDN or a website you ship to others — the GPL's
obligations travel with them: recipients are entitled to the corresponding
source, which means the upstream revision recorded in `UPSTREAM_REF` **plus**
the patches in `scripts/patch-smbros-project.mjs` that were applied to it.

The Godot engine runtime linked into those binaries is
[Godot](https://github.com/godotengine/godot), MIT licensed, © Juan Linietsky,
Ariel Manzur and contributors.

## Nintendo assets

Super Mario Bros. is a trademark of Nintendo. Nintendo is not affiliated with,
and has not endorsed, this project or the upstream game.

No Nintendo code, graphics, audio or ROM data is contained in this repository,
in anything it builds, or in anything it publishes. The game reads the
character ROM out of a Super Mario Bros. (NES) cartridge dump that the *player*
supplies at runtime and converts it into a local resource pack, in the player's
own browser storage. That file never leaves the player's machine: the SDK
stages it directly into the WebAssembly instance's in-memory filesystem.

Do not commit ROM files to this repository. `.gitignore` refuses the common
extensions, but that is a safety net, not permission.

## Upstream

If you are packaging this for anyone else, keep the credit intact: the game is
years of work by JHDev2006 and its contributors, and it is worth playing on the
desktop builds it was designed for.

- Game: https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public
- Releases: https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public/releases
