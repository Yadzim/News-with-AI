import { fetchAndProcessNews, type FetchProgress } from "./fetcher.js";

export type FetchJobState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  added: number;
  error: string | null;
  cancelled: boolean;
  progress: FetchProgress | null;
};

const DEFAULT_MAX_PER_FEED = 5;

let current: Promise<number> | null = null;
let controller: AbortController | null = null;

let state: FetchJobState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  added: 0,
  error: null,
  cancelled: false,
  progress: null,
};

export function getFetchJobState(): FetchJobState {
  return { ...state, progress: state.progress ? { ...state.progress } : null };
}

export function isFetchRunning(): boolean {
  return state.running;
}

/**
 * Fetch’ni ishga tushiradi. Allaqachon ishlab turgan bo‘lsa yangisini
 * boshlamaydi — o‘sha ishlayotgan jarayonning promise’ini qaytaradi.
 * Shu tufayli cron va admin tugmasi bir vaqtda Gemini kvotasini ikki
 * baravar sarflay olmaydi.
 */
export function startFetch(maxPerFeed = DEFAULT_MAX_PER_FEED): {
  started: boolean;
  promise: Promise<number>;
} {
  if (current) return { started: false, promise: current };

  controller = new AbortController();
  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    added: 0,
    error: null,
    cancelled: false,
    progress: null,
  };

  const promise = fetchAndProcessNews({
    maxPerFeed,
    signal: controller.signal,
    onProgress: (progress) => {
      state.progress = progress;
      state.added = progress.added;
    },
  })
    .then((added) => {
      state.added = added;
      return added;
    })
    .catch((err: unknown) => {
      state.error = err instanceof Error ? err.message : String(err);
      console.error("Fetch job xatosi:", err);
      return 0;
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      state.cancelled = Boolean(controller?.signal.aborted);
      current = null;
      controller = null;
    });

  current = promise;
  return { started: true, promise };
}

export function cancelFetch(): boolean {
  if (!current || !controller) return false;
  controller.abort();
  return true;
}
