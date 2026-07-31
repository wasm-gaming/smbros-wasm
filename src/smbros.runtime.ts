// Typed handle on the runtime Godot exports.
//
// `make build-wasm` writes a pair of runtime variants into dist/smbros/. Each
// pair is one Godot web export: a classic-script glue file (`*.js`), the wasm
// binary next to it, and the audio worklets the glue resolves relative to its
// own `document.currentScript.src`. The `.pck` — the game data — is shared by
// both variants.
//
// Nothing in this file talks to the game; it only describes the Engine object
// Godot generates and picks which variant to boot.

/** Options accepted by Godot's generated `Engine` constructor and `start()`. */
export interface GodotEngineConfig {
  /** Free the cached wasm response after init. Kept on for in-place resets. */
  unloadAfterInit?: boolean;
  canvas?: HTMLCanvasElement | null;
  /** Base path of the runtime, without extension: `<executable>.wasm` is fetched. */
  executable?: string;
  /** URL of the game data pack. */
  mainPack?: string | null;
  /** Locale override, e.g. "es". Falls back to the browser locale when null. */
  locale?: string | null;
  /** 0: none, 1: project resolution, 2: adaptive (follows the element size). */
  canvasResizePolicy?: 0 | 1 | 2;
  /** Godot command-line arguments. */
  args?: string[];
  focusCanvas?: boolean;
  experimentalVK?: boolean;
  serviceWorker?: string;
  /** Directories mounted as IndexedDB-backed storage. `user://` lives in /userfs. */
  persistentPaths?: string[];
  /** Keep files the player drops onto the canvas after the drop is handled. */
  persistentDrops?: boolean;
  gdextensionLibs?: string[];
  fileSizes?: Record<string, number>;
  emscriptenPoolSize?: number;
  godotPoolSize?: number;
  onExecute?: ((path: string, args: string[]) => void) | null;
  onExit?: ((code: number) => void) | null;
  onProgress?: ((current: number, total: number) => void) | null;
  onPrint?: (...args: unknown[]) => void;
  onPrintError?: (...args: unknown[]) => void;
}

export interface GodotEngine {
  /** Load + instantiate the wasm module. `basePath` is required when unloaded. */
  init(basePath?: string): Promise<void>;
  /**
   * Stage a file into the instance's filesystem. Buffers are queued in memory
   * and written during `start()`, so this can be called before `init()`.
   */
  preloadFile(file: string | ArrayBuffer | ArrayBufferView, path?: string): Promise<void>;
  start(override?: GodotEngineConfig): Promise<void>;
  /** `init()` + preload the main pack + `start()`, prepending `--main-pack`. */
  startGame(override?: GodotEngineConfig): Promise<void>;
  copyToFS(path: string, buffer: ArrayBuffer): void;
  requestQuit(): void;
}

export interface GodotEngineConstructor {
  new (config: GodotEngineConfig): GodotEngine;
  load(basePath: string, size?: number): void;
  unload(): void;
  isWebGLAvailable(majorVersion?: number): boolean;
  isSecureContext(): boolean;
  isCrossOriginIsolated(): boolean;
  isSharedArrayBufferAvailable(): boolean;
  isAudioWorkletAvailable(): boolean;
  /** Human-readable list of browser features the build needs but cannot find. */
  getMissingFeatures(options?: { threads?: boolean }): string[];
}

declare global {
  interface Window {
    Engine?: GodotEngineConstructor;
  }
}

/**
 * `user://` on the web platform. Godot maps it to /userfs/<custom_user_dir_name>,
 * and scripts/patch-smbros-project.mjs pins that name so the SDK can write the
 * player's ROM into the directory the game reads it back from.
 */
export const USER_DATA_DIR = '/userfs/SMB1R';

/**
 * Where `ROMVerifier`/`Global` expect the verified cartridge dump to live.
 *
 * The file is staged into the running instance's filesystem on every load
 * rather than persisted: Godot flushes /userfs to IndexedDB only for writes
 * that went through its own FileAccess, so a file put there from JS lives for
 * the session. That is enough — the host supplies the ROM every time anyway,
 * and the expensive artifact (the resource pack the game rips out of it) is
 * written by the game itself and does persist.
 */
export const ROM_INSTALL_PATH = `${USER_DATA_DIR}/baserom.nes`;

/**
 * Secondary drop point for the ROM, passed to the game as `-rom <path>`. If the
 * copy in `user://` is ever rejected, the game's own ROM screen picks this one
 * up from the command line instead of asking the player for a file.
 */
export const ROM_CMDLINE_PATH = '/tmp/baserom.nes';

export type RuntimeVariant = 'threads' | 'nothreads';

export interface RuntimeFiles {
  /** Glue script, loaded with a `<script>` tag so worklet URLs resolve. */
  js: string;
  /** Base path handed to `init()`; `${base}.wasm` is fetched from it. */
  base: string;
  /** Shared game data. Both variants read the same pack. */
  pack: string;
}

const VARIANT_BASENAME: Record<RuntimeVariant, string> = {
  threads: 'smbros.threaded',
  nothreads: 'smbros',
};

/**
 * Threads need `SharedArrayBuffer`, which browsers only hand out to
 * cross-origin isolated pages (COOP/COEP). Everywhere else the single-threaded
 * export is the one that runs.
 */
export function selectVariant(requested: RuntimeVariant | 'auto' = 'auto'): RuntimeVariant {
  if (requested !== 'auto') return requested;
  const isolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
  return isolated ? 'threads' : 'nothreads';
}

export function runtimeFiles(variant: RuntimeVariant, baseUrl: string): RuntimeFiles {
  const name = VARIANT_BASENAME[variant];
  const resolve = (file: string): string => new URL(file, baseUrl).href;
  return {
    js: resolve(`${name}.js`),
    base: resolve(name),
    // The threaded export's own pack is deleted at build time: it is identical
    // to the default one, and 52 MB is not worth shipping twice.
    pack: resolve('smbros.pck'),
  };
}

/**
 * Godot's glue is a classic script that assigns `window.Engine`, and emscripten
 * derives the audio worklet URLs from `document.currentScript.src` — so it has
 * to be loaded through a real `<script>` tag rather than `import()`.
 */
const scriptCache = new Map<string, Promise<GodotEngineConstructor>>();

export function loadGodotRuntime(jsUrl: string): Promise<GodotEngineConstructor> {
  const cached = scriptCache.get(jsUrl);
  if (cached) return cached;

  const pending = new Promise<GodotEngineConstructor>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('smbros: the Godot runtime needs a DOM'));
      return;
    }

    const script = document.createElement('script');
    script.src = jsUrl;
    script.async = true;
    script.addEventListener('load', () => {
      const Engine = window.Engine;
      if (!Engine) {
        reject(new Error(`smbros: ${jsUrl} loaded but did not define window.Engine`));
        return;
      }
      resolve(Engine);
    });
    script.addEventListener('error', () => {
      reject(new Error(`smbros: failed to load the Godot runtime from ${jsUrl}`));
    });
    document.head.appendChild(script);
  });

  scriptCache.set(jsUrl, pending);
  // A failed load must not poison later attempts (a host may retry with a
  // different runtimeBaseUrl).
  pending.catch(() => scriptCache.delete(jsUrl));
  return pending;
}

/**
 * Wipe the game's persisted directory: ripped ROM assets, save files and
 * settings. Emscripten's IDBFS keeps one IndexedDB database per mount point,
 * keyed by absolute path, so the purge is a prefix delete on `/userfs`.
 *
 * Call it on a stopped instance — the running game holds its own in-memory view
 * of the filesystem and will write parts of it back on the next sync.
 */
export function purgeUserData(prefix = USER_DATA_DIR): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const request = indexedDB.open('/userfs');
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('FILE_DATA')) {
        db.close();
        resolve(false);
        return;
      }

      const tx = db.transaction('FILE_DATA', 'readwrite');
      const store = tx.objectStore('FILE_DATA');
      const cursor = store.openKeyCursor();
      let removed = false;

      cursor.onsuccess = () => {
        const handle = cursor.result;
        if (!handle) return;
        if (typeof handle.key === 'string' && handle.key.startsWith(prefix)) {
          store.delete(handle.key);
          removed = true;
        }
        handle.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(removed);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    };
  });
}
