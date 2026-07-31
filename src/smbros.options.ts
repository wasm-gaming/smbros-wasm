import type { JSONSchema } from '@wasm-gaming/engine-specs';

/**
 * Everything a host can set on `load()`.
 *
 * Unlike an emulator core, a Godot export reads its configuration once, when
 * the runtime boots: the values below are baked into the `Engine` config or the
 * command line and cannot be changed on a running instance. In-game settings
 * (video scaling, audio levels, controls, resource packs, language) belong to
 * the game itself and live in its own pause/settings menus — this catalog only
 * covers the boot-time surface the browser owns.
 *
 * The catalog is the single source of truth: the manifest's options schema and
 * the defaults are both derived from it.
 */

interface OptionSpecBase {
  /** Option key, as used in `EngineConfig.options` and the manifest schema. */
  key: string;
  label: string;
  description: string;
}

export type SmbrosOptionSpec = OptionSpecBase &
  (
    | { type: 'boolean'; default: boolean }
    | { type: 'enum'; default: string; values: Array<{ value: string; label: string }> }
  );

/** Translations the game ships (`Global.lang_codes`). */
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Browser default' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'pl', label: 'Polski' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ru', label: 'Русский' },
  { value: 'jp', label: '日本語' },
  { value: 'fil', label: 'Filipino' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ga', label: 'Gaeilge' },
];

export const SMBROS_ENGINE_OPTIONS: SmbrosOptionSpec[] = [
  {
    key: 'fit',
    label: 'Canvas fit',
    description:
      "How the picture is sized. 'container' renders at the size of the element the game is mounted in, which is what makes the game's own aspect-ratio and scaling settings behave the way they do on the desktop build. 'native' pins the render to 256×240 and lets host CSS scale it. 'window' hands sizing to Godot, which fills the browser window and positions the canvas absolutely — only correct on a page that is nothing but the game.",
    type: 'enum',
    default: 'container',
    values: [
      { value: 'container', label: 'Fill the container' },
      { value: 'native', label: 'Native 256×240' },
      { value: 'window', label: 'Fill the browser window' },
    ],
  },
  {
    key: 'variant',
    label: 'Runtime variant',
    description:
      'Which web export to boot. The threaded build needs a cross-origin isolated page (COOP/COEP headers); auto falls back to the single-threaded build when it is not.',
    type: 'enum',
    default: 'auto',
    values: [
      { value: 'auto', label: 'Auto' },
      { value: 'threads', label: 'Threaded' },
      { value: 'nothreads', label: 'Single-threaded' },
    ],
  },
  {
    key: 'locale',
    label: 'Language',
    description: 'Locale the game starts in. Empty follows the browser.',
    type: 'enum',
    default: '',
    values: LANGUAGES,
  },
  {
    key: 'pixelated',
    label: 'Crisp pixels',
    description:
      'Render the 256×240 picture with nearest-neighbour upscaling (image-rendering: pixelated) instead of the browser default smoothing.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'focusCanvas',
    label: 'Focus on start',
    description: 'Give the canvas keyboard focus as soon as the game starts.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'persistentDrops',
    label: 'Keep dropped files',
    description:
      'Keep files the player drags onto the canvas in persistent storage. Lets resource packs be installed by drag-and-drop.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'experimentalVirtualKeyboard',
    label: 'Virtual keyboard',
    description: "Godot's experimental on-screen keyboard, for text entry on touch devices.",
    type: 'boolean',
    default: false,
  },
  {
    key: 'verifyRom',
    label: 'Verify the ROM',
    description:
      'Check the supplied dump against the hashes the game accepts before booting, so a wrong file fails immediately instead of at the ROM screen.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'autoStart',
    label: 'Start on load',
    description:
      'Boot the game as part of load(). Turn it off to stage everything and defer the runtime download to the first start() call.',
    type: 'boolean',
    default: true,
  },
];

/** How the SDK reconciles the render size with the page. */
export type SmbrosFit = 'container' | 'native' | 'window';

export interface SmbrosOptions {
  fit?: SmbrosFit;
  variant?: 'auto' | 'threads' | 'nothreads';
  locale?: string;
  pixelated?: boolean;
  focusCanvas?: boolean;
  persistentDrops?: boolean;
  experimentalVirtualKeyboard?: boolean;
  verifyRom?: boolean;
  autoStart?: boolean;
  /** 0: host owns the box (default), 1: Godot writes the game's window size, 2: fill the browser window. */
  canvasResizePolicy?: 0 | 1 | 2;
  /** Where the exported runtime files live. Defaults to this package's dist/smbros/. */
  runtimeBaseUrl?: string;
  /** Name of the file the player picked, shown in host UI and logs. */
  romFileName?: string;
  /** Alias for `romFileName`, for hosts that report the picked name here. */
  fileName?: string;
  /** Extra Godot command-line arguments, appended after the SDK's own. */
  extraArgs?: string[];
}

export const DEFAULT_SMBROS_OPTIONS: Required<
  Pick<
    SmbrosOptions,
    | 'fit'
    | 'variant'
    | 'locale'
    | 'pixelated'
    | 'focusCanvas'
    | 'persistentDrops'
    | 'experimentalVirtualKeyboard'
    | 'verifyRom'
    | 'autoStart'
    | 'canvasResizePolicy'
    | 'romFileName'
  >
> = {
  fit: 'container',
  variant: 'auto',
  locale: '',
  pixelated: true,
  focusCanvas: true,
  persistentDrops: false,
  experimentalVirtualKeyboard: false,
  verifyRom: true,
  autoStart: true,
  canvasResizePolicy: 0,
  romFileName: 'baserom.nes',
};

function schemaForOption(option: SmbrosOptionSpec): JSONSchema {
  if (option.type === 'boolean') {
    return {
      type: 'boolean',
      default: option.default,
      title: option.label,
      description: option.description,
    };
  }

  return {
    type: 'string',
    enum: option.values.map((value) => value.value),
    default: option.default,
    title: option.label,
    description: option.description,
    'x-labels': Object.fromEntries(option.values.map((value) => [value.value, value.label])),
  };
}

export const SMBROS_OPTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(SMBROS_ENGINE_OPTIONS.map((option) => [option.key, schemaForOption(option)])),
    canvasResizePolicy: {
      type: 'integer',
      enum: [0, 1, 2],
      title: 'Canvas resize policy',
      description:
        "Godot's own policy, normally derived from `fit` (0 for container/native, 2 for window) and only worth setting to override that. 0: Godot adopts the canvas' drawing buffer as its window size. 1: Godot writes the game window size onto the canvas as an inline CSS size. 2: Godot positions the canvas absolutely and fills the browser window.",
    },
    runtimeBaseUrl: {
      type: 'string',
      description:
        'Directory holding the exported runtime (smbros.js/.wasm/.pck). Defaults to the dist/smbros/ folder shipped next to this SDK.',
    },
    romFileName: {
      type: 'string',
      default: 'baserom.nes',
      description: 'Name of the ROM file the player supplied. Display only.',
    },
    fileName: {
      type: 'string',
      description: 'Alias for romFileName, accepted for hosts that report the picked file name here.',
    },
    extraArgs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Additional Godot command-line arguments, appended after the ones the SDK passes.',
    },
  },
};
