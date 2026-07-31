#!/usr/bin/env node
// Make an upstream Super Mario Bros. Remastered checkout exportable to the web.
//
// The game targets Windows and Linux, so a handful of things it takes for
// granted do not exist in a browser build. Every edit below is confined to that
// gap — nothing here changes gameplay:
//
//   1. GDExtensions (godotgif, discord-rpc-gd) ship no wasm binary, and Godot
//      refuses to load an extension with no library for the target platform.
//      Both are removed, along with the one call site that would then fail to
//      compile (GifManager, used for animated resource-pack icons).
//   2. Editor plugins are disabled. `--import`/`--export-release` still
//      instantiate them, and mod_loader's export plugin rewrites the packed
//      output. None of them are needed to export.
//   3. The ModLoader autoloads are dropped: they resolve their mod directory
//      from OS.get_executable_path(), which is empty on web, and a browser has
//      no folder to drop mods into. Set KEEP_MOD_LOADER=1 to leave them in.
//   4. Discord rich presence is switched off through its existing project
//      setting, so DiscordManager takes the stub path it already has.
//   5. `custom_user_dir_name` is pinned to the value Godot would derive anyway
//      ("SMB1R"), because the SDK writes the player's ROM straight into that
//      directory (/userfs/SMB1R) before the game boots.
//   6. Two Web export presets are appended, mirroring the desktop presets'
//      include_filter so the audio (*.bgm/*.mp3) and text assets that live
//      outside Godot's resource system still make it into the pack.
//
// Idempotent: the build script resets the checkout before calling this.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('usage: patch-smbros-project.mjs <upstream-checkout>');
  process.exit(1);
}

/** Kept in sync with USER_DATA_DIR in src/smbros.runtime.ts. */
const USER_DIR_NAME = 'SMB1R';

/** Assets the desktop presets ship outside Godot's resource system. */
const INCLUDE_FILTER = '*.bgm, *.mp3, *.txt, *.fnt';

const changes = [];
const read = (rel) => readFileSync(join(srcDir, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(srcDir, rel), text);

// -------------------------------------------------------------- extensions --

const GDEXTENSIONS = [
  'godotgif/godotgif.gdextension',
  'addons/discord-rpc-gd/bin/discord-rpc-gd.gdextension',
];

for (const rel of GDEXTENSIONS) {
  const path = join(srcDir, rel);
  if (existsSync(path)) {
    rmSync(path);
    rmSync(`${path}.uid`, { force: true });
    changes.push(`removed ${rel}`);
  }
}

// GifManager is a class the godotgif extension registers. With the extension
// gone the identifier no longer resolves, and an unresolved identifier is a
// parse error in GDScript — the whole script would fail to load, not just this
// branch. Resource packs with an animated icon simply render without one.
{
  const rel = 'Scripts/Parts/ResourcePackLoader.gd';
  const before = read(rel);
  const after = before.replace(
    /^(\t*)container\.icon = GifManager\.animated_texture_from_file\(.*\)$/m,
    '$1# godotgif has no web binary, so animated pack icons render as no icon.\n$1container.icon = null',
  );
  if (after !== before) {
    write(rel, after);
    changes.push(`stubbed GifManager in ${rel}`);
  }
}

// ---------------------------------------------------------- project.godot --

{
  const rel = 'project.godot';
  let text = read(rel);

  const discord = text.replace(/^use_discord=true$/m, 'use_discord=false');
  if (discord !== text) {
    text = discord;
    changes.push('project.godot: use_discord=false');
  }

  if (!/^config\/custom_user_dir_name=/m.test(text)) {
    text = text.replace(
      /^config\/use_custom_user_dir=true$/m,
      `config/use_custom_user_dir=true\nconfig/custom_user_dir_name="${USER_DIR_NAME}"`,
    );
    changes.push(`project.godot: custom_user_dir_name="${USER_DIR_NAME}"`);
  }

  const plugins = text.replace(/^enabled=PackedStringArray\(.*\)$/m, 'enabled=PackedStringArray()');
  if (plugins !== text) {
    text = plugins;
    changes.push('project.godot: disabled editor plugins');
  }

  if (process.env.KEEP_MOD_LOADER !== '1') {
    const withoutModLoader = text.replace(/^ModLoader(Store)?="\*res:\/\/addons\/mod_loader\/.*\n/gm, '');
    if (withoutModLoader !== text) {
      text = withoutModLoader;
      changes.push('project.godot: removed ModLoader autoloads');
    }
  }

  write(rel, text);
}

// -------------------------------------------------------------- export presets --

const templates = {
  nothreads: process.env.WEB_TEMPLATE_NOTHREADS ?? '',
  threads: process.env.WEB_TEMPLATE_THREADS ?? '',
};

function preset(index, { name, threadSupport, template }) {
  return `
[preset.${index}]

name="${name}"
platform="Web"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter="${INCLUDE_FILTER}"
exclude_filter=""
export_path=""
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=0

[preset.${index}.options]

custom_template/debug=""
custom_template/release="${template}"
variant/extensions_support=false
variant/thread_support=${threadSupport}
texture_format/s3tc_bptc=true
texture_format/etc2_astc=true
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
progressive_web_app/ensure_cross_origin_isolation_headers=true
`;
}

{
  const rel = 'export_presets.cfg';
  let text = read(rel);

  // Drop any Web presets already present upstream so ours are the only ones,
  // then append after the highest remaining index.
  const indices = [...text.matchAll(/^\[preset\.(\d+)\]$/gm)].map((m) => Number(m[1]));
  let next = indices.length ? Math.max(...indices) + 1 : 0;

  text = text.trimEnd() + '\n';
  text += preset(next, {
    name: 'Web',
    threadSupport: false,
    template: templates.nothreads,
  });
  text += preset(next + 1, {
    name: 'Web Threaded',
    threadSupport: true,
    template: templates.threads,
  });

  write(rel, text);
  changes.push(`export_presets.cfg: added "Web" (preset.${next}) and "Web Threaded" (preset.${next + 1})`);
}

// ------------------------------------------------------------------ verify --

// A leftover reference to an extension class is a parse error at runtime, not
// an export failure, so it would only surface as a blank screen in the browser.
{
  let leftovers = '';
  try {
    leftovers = execFileSync(
      'grep',
      ['-rIl', '--include=*.gd', '--include=*.tscn', '-e', 'GifManager', '-e', 'DiscordRPC.new', srcDir],
      { encoding: 'utf8' },
    ).trim();
  } catch (err) {
    // grep exits 1 when it matches nothing, which is the outcome we want.
    if (err.status !== 1) throw err;
  }
  if (leftovers) {
    console.error('[patch] unresolved GDExtension references remain:\n' + leftovers);
    process.exit(1);
  }
}

for (const change of changes) {
  console.log(`[patch] ${change}`);
}
