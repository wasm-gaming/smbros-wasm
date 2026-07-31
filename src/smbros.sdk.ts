import type {
  AssetData,
  EngineConfig,
  EngineEvent,
  EngineInstance,
  InputPreset,
  KeyMap,
} from '@wasm-gaming/engine-specs';
import { manifest } from './smbros.manifest.js';
import { DEFAULT_SMBROS_OPTIONS, type SmbrosOptions } from './smbros.options.js';
import { verifyRom } from './smbros.rom.js';
import {
  loadGodotRuntime,
  purgeUserData,
  ROM_CMDLINE_PATH,
  ROM_INSTALL_PATH,
  runtimeFiles,
  selectVariant,
  type GodotEngine,
  type GodotEngineConfig,
  type RuntimeVariant,
} from './smbros.runtime.js';

export { manifest };

/** Filesystem path the game data is unpacked to, matching Godot's own shell. */
const PACK_FS_PATH = 'smbros.pck';

export type SmbrosInstance = EngineInstance & {
  /** Runtime variant that actually booted. */
  readonly variant: RuntimeVariant;
  /** Host-supplied namespace, normalized. See the note on `purgeStorage`. */
  readonly storageNamespace: string;
  /** The live Godot engine handle, for hosts that need to go below the contract. */
  readonly engine: GodotEngine;
};

export type SmbrosLoadConfig = EngineConfig & {
  romProvider?: () => Promise<AssetData> | AssetData;
  /**
   * Download progress for the runtime and the game data, in bytes. The contract
   * has no event for it and there is ~90 MB to fetch on a cold load, so it is
   * offered as a plain callback.
   */
  onProgress?: (current: number, total: number) => void;
  /** Deprecated alias for `canvasEl`, kept for hosts written against 0.0.x. */
  canvas?: HTMLCanvasElement;
};

function toUint8(x: unknown): Uint8Array | null {
  if (x == null) return null;
  if (typeof x === 'string') return new TextEncoder().encode(x);
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError('asset must be Uint8Array | ArrayBuffer | string');
}

/**
 * A standalone ArrayBuffer holding exactly `bytes`. Godot's preloader keeps
 * whatever object it is handed and copies it into the filesystem later, so a
 * view onto a larger buffer would drop its offset.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function normalizeStorageNamespace(namespace: unknown): string {
  if (typeof namespace !== 'string' || !namespace.trim()) return 'default';
  return (
    namespace
      .split('/')
      .map((segment) => segment.trim().replace(/[^A-Za-z0-9._-]/g, '_'))
      .filter(Boolean)
      .join('/') || 'default'
  );
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function load(config: SmbrosLoadConfig): Promise<SmbrosInstance> {
  const { assets, onEvent, attachTo } = config;

  const emit = (event: EngineEvent): void => {
    try {
      onEvent?.(event);
    } catch {
      // A host callback must not break the engine runtime.
    }
  };

  const requested = (config.options ?? {}) as SmbrosOptions;
  const opts = { ...DEFAULT_SMBROS_OPTIONS, ...stripUndefined(requested) };

  // ------------------------------------------------------------- render target

  const providedCanvas = config.canvasEl ?? config.canvas ?? null;
  if (!providedCanvas && !attachTo) {
    throw new Error('smbros: config.canvasEl or config.attachTo is required');
  }

  const ownsCanvas = providedCanvas === null;
  const canvas = providedCanvas ?? document.createElement('canvas');
  // Godot registers its DOM event handlers against `#${canvas.id}` — an
  // element with no id turns into the selector "#", which throws inside
  // emscripten. The contract puts that id on the SDK, so give the canvas one
  // when the host has not.
  if (!canvas.id) {
    canvas.id = 'smbros-canvas';
  }

  const fit = opts.fit;
  // Godot's policy follows from the fit, unless a host names one explicitly.
  const canvasResizePolicy = requested.canvasResizePolicy ?? (fit === 'window' ? 2 : 0);

  let restoreContainerPosition: (() => void) | null = null;

  if (ownsCanvas) {
    canvas.style.display = 'block';

    if (fit === 'container' && attachTo) {
      // Absolute inside the container, so the canvas takes its size *from* the
      // box and never contributes back to it. That is what keeps the buffer
      // sync below from feeding itself, and what stops an unsized container
      // from collapsing around a canvas that is trying to fill it.
      if (getComputedStyle(attachTo).position === 'static') {
        const previous = attachTo.style.position;
        attachTo.style.position = 'relative';
        restoreContainerPosition = () => {
          attachTo.style.position = previous;
        };
      }
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    } else if (fit === 'native') {
      // No CSS size: an inline one would beat the host stylesheet, and the
      // 256x240 drawing buffer already gives the element an intrinsic size.
      canvas.style.maxWidth = '100%';
      canvas.style.height = 'auto';
    }

    attachTo?.appendChild(canvas);
  }

  if (opts.pixelated) {
    canvas.style.imageRendering = 'pixelated';
  }

  // The drawing buffer is Godot's window. Under policy 0 it adopts whatever is
  // here (and re-adopts it whenever it changes), so matching the buffer to the
  // displayed box is what gives the game a window of the right shape — which
  // is what its own aspect-ratio (keep/expand) and integer-scaling settings
  // act on. Pin it to the native resolution instead and those settings have
  // nothing to work with, because the window is already exactly 256x240.
  canvas.width = manifest.video.baseWidth;
  canvas.height = manifest.video.baseHeight;

  let sizeObserver: ResizeObserver | null = null;
  let syncBuffer: (() => void) | null = null;

  if (fit === 'container') {
    let corrections = 0;
    let windowStart = 0;
    let warnedRunaway = false;

    syncBuffer = (): void => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (width === canvas.width && height === canvas.height) return;

      // A canvas whose box is derived from its own buffer would oscillate here.
      // Bound it rather than let the page thrash.
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        corrections = 0;
      }
      if (++corrections > 8) {
        if (!warnedRunaway) {
          warnedRunaway = true;
          console.warn(
            'smbros: the canvas box keeps changing with its drawing buffer — give the container a size in CSS, or pass options.fit = "native".',
          );
        }
        return;
      }

      canvas.width = width;
      canvas.height = height;
    };

    syncBuffer();
    if (canvas.width <= 1 || canvas.height <= 1) {
      console.warn(
        'smbros: the render target has no size yet; rendering at 256×240 until it does. Give the container a width and height in CSS.',
      );
      canvas.width = manifest.video.baseWidth;
      canvas.height = manifest.video.baseHeight;
    }

    if (typeof ResizeObserver !== 'undefined') {
      sizeObserver = new ResizeObserver(() => syncBuffer?.());
      sizeObserver.observe(canvas);
    }
    // ResizeObserver does not fire when only the device pixel ratio changes
    // (zooming, or dragging the window to a different display).
    window.addEventListener('resize', syncBuffer);
  }
  // Godot's renderer keeps drawing into a canvas that has been detached from
  // the document, so a stale context menu on right-click is the one bit of
  // browser chrome worth suppressing over the viewport.
  const swallowContextMenu = (event: Event): void => event.preventDefault();
  canvas.addEventListener('contextmenu', swallowContextMenu);

  // ---------------------------------------------------------------------- ROM

  let romBytes = toUint8(assets?.rom ?? assets?.data);
  if (!romBytes && config.romProvider) {
    romBytes = toUint8(await config.romProvider());
  }
  if (!romBytes) {
    throw new Error('smbros: no ROM bytes provided — pass assets.rom or romProvider');
  }

  if (opts.verifyRom) {
    const check = await verifyRom(romBytes);
    if (!check.ok) {
      throw new Error(`smbros: ${check.reason}`);
    }
  }

  const rom = romBytes;

  // ------------------------------------------------------------------ runtime

  const variant = selectVariant(opts.variant);
  const baseUrl = opts.runtimeBaseUrl
    ? new URL(opts.runtimeBaseUrl, typeof location === 'undefined' ? undefined : location.href).href
    : new URL('.', import.meta.url).href;
  const files = runtimeFiles(variant, baseUrl);

  const jsUrl = config.jsUrl ?? files.js;
  // Godot derives the binary from a base path rather than a URL, so an explicit
  // wasmUrl override is turned back into one.
  const base = config.wasmUrl ? config.wasmUrl.replace(/\.wasm$/, '') : files.base;

  const Engine = await loadGodotRuntime(jsUrl);

  const missing = Engine.getMissingFeatures({ threads: variant === 'threads' });
  if (missing.length > 0) {
    throw new Error(
      `smbros: this browser is missing ${missing.join(', ')}. ` +
        (variant === 'threads'
          ? 'The threaded runtime needs a cross-origin isolated page (COOP/COEP); serve the page with those headers or pass options.variant = "nothreads".'
          : 'A recent Chrome, Firefox or Safari is required.'),
    );
  }

  const storageNamespace = normalizeStorageNamespace(config.storageNamespace);

  // Set for the duration of a reset, so the relaunch waits for the running
  // instance to actually unwind before a second one is created.
  let onExitHook: (() => void) | null = null;

  const engineConfig: GodotEngineConfig = {
    canvas,
    executable: base,
    mainPack: PACK_FS_PATH,
    locale: opts.locale || null,
    canvasResizePolicy,
    focusCanvas: opts.focusCanvas,
    experimentalVK: opts.experimentalVirtualKeyboard,
    persistentDrops: opts.persistentDrops,
    // `user://` is IndexedDB-backed: the resource pack the game rips out of the
    // ROM survives a reload, so the minute-long first boot happens only once.
    persistentPaths: ['/userfs'],
    onProgress: config.onProgress ?? null,
    onExit: () => {
      emit({ type: 'exit' });
      const hook = onExitHook;
      onExitHook = null;
      hook?.();
    },
  };

  const args = [
    '--main-pack',
    PACK_FS_PATH,
    // Secondary path to the cartridge: only read if the copy already sitting in
    // user:// was not picked up.
    '-rom',
    ROM_CMDLINE_PATH,
    ...(opts.extraArgs ?? []),
  ];

  let engine = new Engine(engineConfig);
  let booted = false;
  let destroyed = false;

  async function boot(fresh = false): Promise<void> {
    // A Godot instance runs once: after it quits, a reset needs a new one.
    if (fresh) engine = new Engine(engineConfig);

    await Promise.all([
      engine.init(base),
      engine.preloadFile(files.pack, PACK_FS_PATH),
      // Staged as buffers, so these are queued in memory and written into the
      // instance's filesystem just before the game's main() runs.
      engine.preloadFile(toArrayBuffer(rom), ROM_INSTALL_PATH),
      engine.preloadFile(toArrayBuffer(rom), ROM_CMDLINE_PATH),
    ]);

    if (destroyed) return;
    await engine.start({ args: [...args] });
    booted = true;
    emit({ type: 'ready' });
  }

  if (opts.autoStart) {
    await boot();
  }

  let inputWarned = false;

  return {
    start(): void {
      if (booted || destroyed) return;
      void boot().catch((err: unknown) => {
        emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      });
    },

    // Godot drives its own main loop through the browser's animation frames and
    // exposes no handle on it, so there is nothing to suspend from out here.
    // The game's pause menu (Escape) is the real pause.
    pause(): void {},
    resume(): void {},

    /**
     * Best-effort power cycle: quit the running instance, wait for it to
     * unwind, then boot a fresh one against the same canvas. The wasm and the
     * pack come back out of the HTTP cache. Hosts that want a guaranteed clean
     * slate should `destroy()` and call `load()` again.
     */
    reset(): void {
      if (destroyed) return;

      booted = false;
      let relaunched = false;
      const relaunch = (): void => {
        if (relaunched || destroyed) return;
        relaunched = true;
        onExitHook = null;
        void boot(true).catch((err: unknown) => {
          emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
        });
      };

      onExitHook = relaunch;
      engine.requestQuit();
      // requestQuit does nothing on an instance that never got as far as
      // running, and a wedged one never reports its exit either.
      setTimeout(relaunch, 500);
    },

    /**
     * The game owns its InputMap and ships a control-remapping screen, so there
     * is no runtime binding for a host to swap. Kept to satisfy the contract.
     */
    setInput(_map: InputPreset | KeyMap): void {
      if (!inputWarned) {
        inputWarned = true;
        console.warn(
          'smbros: input is remapped inside the game (Options → Controls); setInput() has no effect.',
        );
      }
    },

    /**
     * Drops everything the game persisted: the installed ROM, the resource pack
     * ripped from it, saves and settings. Godot keeps a single `user://`
     * directory per export, so this ignores `storageNamespace` and is not a
     * per-game purge. Call it on a destroyed instance.
     */
    async purgeStorage(): Promise<{ data: boolean; settings: boolean }> {
      const removed = await purgeUserData();
      return { data: removed, settings: removed };
    },

    destroy(): void {
      destroyed = true;
      canvas.removeEventListener('contextmenu', swallowContextMenu);
      sizeObserver?.disconnect();
      if (syncBuffer) {
        window.removeEventListener('resize', syncBuffer);
      }
      try {
        engine.requestQuit();
      } catch {
        // Already gone (never started, or the runtime crashed).
      }
      if (ownsCanvas) {
        canvas.remove();
      }
      restoreContainerPosition?.();
    },

    variant,
    storageNamespace,
    get engine(): GodotEngine {
      return engine;
    },
  };
}

export default { manifest, load };
