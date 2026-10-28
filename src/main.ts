import "./styles.css";
import {
  chapterRange,
  currentChapterIndex,
  nextChapterIndex,
  previousChapterIndex,
} from "./chapters";
import { fileFromHandle, pickFile, supportsFileSystemAccess } from "./file-access";
import { MediaSessionController } from "./media-session";
import { loadBookMetadata } from "./metadata";
import {
  buildStateRecord,
  getFileHandle,
  getLastBookId,
  loadBookState,
  saveBookState,
  saveFileHandle,
  setLastBookId,
} from "./persistence";
import { Player, SEEK_BACKWARD, SEEK_FORWARD } from "./player";
import { DEFAULT_RATE, nearestRate, stepRate } from "./rates";
import {
  createInitialState,
  type AudiobookState,
  type BookMetadata,
  type Chapter,
} from "./types";
import { UI, type BookSummary } from "./ui";
import {
  ThrottledSaver,
  formatTime,
  getBookId,
  listenedPercent,
  titleFromFilename,
  toBlobUrl,
} from "./utils";

const audio = document.createElement("audio");
audio.preload = "metadata";
if ("preservesPitch" in audio) {
  (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
}
audio.hidden = true;
document.body.append(audio);

const player = new Player(audio);
const ui = new UI();
const state = createInitialState();

let pendingSaved: AudiobookState | undefined;
/** Último libro persistido; se usa en portada (Continue / Info) sin libro abierto. */
let lastSaved: AudiobookState | undefined;
let scrubbing = false;
let lastPositionSync = 0;

let loadGeneration = 0;
let fileReady = false;
let metadataReady = false;

const saver = new ThrottledSaver(persistNow, 5000);

function syncLoading(): void {
  ui.setLoading(!fileReady || !metadataReady);
}

function persistNow(): void {
  // Hasta `loadedmetadata` no se ha aplicado la posición guardada: guardar ahora la pisaría con 0.
  if (!state.bookId || !state.file || !fileReady) return;
  const duration = Number.isFinite(player.duration) ? player.duration : state.duration;
  void saveBookState(
    buildStateRecord({
      id: state.bookId,
      filename: state.file.name,
      position: player.currentTime,
      playbackRate: state.playbackRate,
      duration: duration > 0 ? duration : undefined,
      title: state.title,
      author: state.author,
    }),
  );
}

function releaseCurrent(): void {
  saver.cancel();
  if (state.bookId) persistNow();
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = undefined;
  }
  if (state.coverUrl) {
    URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = undefined;
  }
  audio.removeAttribute("src");
  audio.load();
}

/** Pinta la barra de progreso acotada al capítulo actual. */
function renderProgress(preview?: number): void {
  const range = chapterRange(state.chapters, state.currentChapterIndex, state.duration);
  ui.renderProgress(range, player.currentTime, preview);
}

function bookSummary(): BookSummary | null {
  if (state.bookId) {
    const position = player.currentTime;
    return {
      title: state.title,
      author: state.author,
      position,
      duration: state.duration,
      percent: listenedPercent(position, state.duration),
      chapterIndex: state.currentChapterIndex,
      chapterCount: state.chapters.length,
    };
  }
  if (lastSaved) {
    const duration = lastSaved.duration ?? 0;
    return {
      title: lastSaved.title ?? titleFromFilename(lastSaved.filename),
      author: lastSaved.author,
      position: lastSaved.position,
      duration,
      percent: listenedPercent(lastSaved.position, duration),
      chapterIndex: -1,
      chapterCount: 0,
    };
  }
  return null;
}

function updateChapterFromTime(force: boolean): void {
  const index = currentChapterIndex(state.chapters, player.currentTime);
  if (index === state.currentChapterIndex && !force) return;
  state.currentChapterIndex = index;
  ui.updateCurrentChapter(index);
  const chapter = index >= 0 ? state.chapters[index] : undefined;
  ui.setChapterTitle(chapter?.title);
  media.setChapter(chapter?.title);
  if (!force) saver.schedule();
}

function applyMetadata(meta: BookMetadata): void {
  if (meta.title) state.title = meta.title;
  state.author = meta.author;

  if (meta.artwork) {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = toBlobUrl(meta.artwork.bytes, meta.artwork.mime);
    ui.setCover(state.coverUrl);
  }

  if (meta.duration && meta.duration > 0 && !state.duration) state.duration = meta.duration;

  ui.setBookTitle(state.title);
  ui.setAuthor(state.author);
  renderProgress();
  media.setBook({
    title: state.title,
    author: state.author,
    cover: state.coverUrl && meta.artwork ? { src: state.coverUrl, type: meta.artwork.mime } : undefined,
  });
}

function applyChapters(chapters: Chapter[]): void {
  if (chapters.length === 0) return;
  state.chapters = chapters;
  ui.renderChapters(state);
  updateChapterFromTime(true);
  renderProgress();
}

async function openBook(file: File, handle?: FileSystemFileHandle): Promise<void> {
  releaseCurrent();

  const generation = ++loadGeneration;
  pendingSaved = undefined;
  fileReady = false;
  metadataReady = false;
  syncLoading();

  state.file = file;
  state.bookId = getBookId(file);
  setLastBookId(state.bookId);
  if (handle) void saveFileHandle(state.bookId, handle);
  state.title = titleFromFilename(file.name);
  state.author = undefined;
  state.chapters = [];
  state.currentChapterIndex = -1;
  state.duration = 0;
  state.playbackRate = DEFAULT_RATE;
  state.playing = false;
  state.coverUrl = undefined;

  ui.setError(null);
  ui.showPlayer();
  ui.setMenuState({ hasBook: true });
  ui.setBookTitle(state.title);
  ui.setAuthor(undefined);
  ui.setChapterTitle(undefined);
  ui.setCover(undefined);
  ui.renderRate(DEFAULT_RATE);
  ui.renderPlayState(false);
  ui.renderChapters(state);
  renderProgress();

  state.objectUrl = URL.createObjectURL(file);
  player.load(state.objectUrl);
  media.setBook({ title: state.title });

  // Metadata y progreso guardado se leen en paralelo; cada resultado se
  // descarta si entretanto se ha abierto otro libro.
  const isCurrent = () => generation === loadGeneration;
  const load = loadBookMetadata(file);
  void load.metadata.then((meta) => {
    if (!isCurrent()) return;
    try {
      applyMetadata(meta);
    } finally {
      metadataReady = true;
      syncLoading();
    }
  });
  void load.chapters.then((chapters) => {
    if (isCurrent()) applyChapters(chapters);
  });

  const saved = await loadBookState(state.bookId);
  if (isCurrent()) pendingSaved = saved;
}

async function pickAndOpen(): Promise<void> {
  if (supportsFileSystemAccess()) {
    try {
      const picked = await pickFile();
      if (picked) {
        await openBook(picked.file, picked.handle);
      }
      return;
    } catch (error) {
      console.warn("[plaudio] el selector de archivos falló", error);
    }
  }
  ui.openFileDialog();
}

async function continueLastBook(): Promise<void> {
  const id = getLastBookId();
  if (!id) return;

  const handle = await getFileHandle(id);
  if (handle) {
    const file = await fileFromHandle(handle);
    if (file) {
      await openBook(file, handle);
      return;
    }
  }

  const saved = await loadBookState(id);
  if (saved?.filename) {
    ui.showToast(`Select “${saved.filename}” to continue`);
  }
  ui.openFileDialog();
}

function onLoadedMetadata(): void {
  const duration = player.duration;
  state.duration = Number.isFinite(duration) && duration > 0 ? duration : state.duration;

  if (pendingSaved) {
    const saved = pendingSaved;
    pendingSaved = undefined;

    let position = saved.position;
    if (state.duration > 0) position = Math.min(position, state.duration);
    position = Math.max(0, position);

    if (position > 5) {
      player.seekTo(position);
      ui.showToast(`Resuming from ${formatTime(position, state.duration >= 3600)}`);
    }

    setRate(saved.playbackRate);
  }

  fileReady = true;
  syncLoading();
  updateChapterFromTime(true);
  renderProgress();
  media.syncPosition();
}

function onTimeUpdate(): void {
  updateChapterFromTime(false);
  if (!scrubbing) renderProgress();
  if (ui.infoOpen) ui.renderBookSummary(bookSummary());
  saver.schedule();

  const now = Date.now();
  if (now - lastPositionSync > 1000) {
    lastPositionSync = now;
    media.syncPosition();
  }
}

async function togglePlay(): Promise<void> {
  if (!state.objectUrl) return;
  try {
    await player.toggle();
  } catch (error) {
    console.warn("[plaudio] play() rechazado", error);
    ui.setError("This file can't be played.");
  }
}

/** Aplica una velocidad de la lista; `ratechange` actualiza estado, UI y persistencia. */
function setRate(rate: number): void {
  player.setRate(nearestRate(rate));
}

function seekBy(delta: number): void {
  player.seekBy(delta);
  saver.flush();
  media.syncPosition();
}

function goToChapter(index: number): void {
  const chapter = state.chapters[index];
  if (!chapter) return;
  player.seekTo(chapter.startTime);
  updateChapterFromTime(true);
  renderProgress();
  if (state.playing) saver.schedule();
  else saver.flush();
  media.syncPosition();
}

// --- Event wiring ---------------------------------------------------------

const media = new MediaSessionController(player, {
  onSeekBackward: () => seekBy(-SEEK_BACKWARD),
  onSeekForward: () => seekBy(SEEK_FORWARD),
  onPrevious: () => goToChapter(previousChapterIndex(state.chapters, state.currentChapterIndex)),
  onNext: () => goToChapter(nextChapterIndex(state.chapters, state.currentChapterIndex)),
});
media.bind();

ui.bind({
  onPick: () => void pickAndOpen(),
  onContinue: () => void continueLastBook(),
  onInfo: () => ui.openInfo(bookSummary()),
  onFiles: (files) => {
    const file = files?.[0];
    if (file) void openBook(file);
  },
  onToggle: () => void togglePlay(),
  onBack: () => seekBy(-SEEK_BACKWARD),
  onForward: () => seekBy(SEEK_FORWARD),
  onSeekInput: (time) => {
    scrubbing = true;
    renderProgress(time);
  },
  onSeekCommit: (time) => {
    scrubbing = false;
    player.seekTo(time);
    updateChapterFromTime(true);
    renderProgress();
    saver.flush();
    media.syncPosition();
  },
  onRate: (rate) => setRate(rate),
  onChapter: (index) => goToChapter(index),
});

audio.addEventListener("loadedmetadata", onLoadedMetadata);
audio.addEventListener("durationchange", () => {
  if (Number.isFinite(audio.duration) && audio.duration > state.duration) {
    state.duration = audio.duration;
    renderProgress();
  }
});
audio.addEventListener("timeupdate", onTimeUpdate);
audio.addEventListener("ratechange", () => {
  state.playbackRate = audio.playbackRate;
  ui.renderRate(audio.playbackRate);
  saver.flush();
  media.syncPosition();
});
audio.addEventListener("play", () => {
  state.playing = true;
  ui.renderPlayState(true);
  media.setPlaybackState("playing");
  media.syncPosition();
});
audio.addEventListener("pause", () => {
  state.playing = false;
  ui.renderPlayState(false);
  media.setPlaybackState("paused");
  saver.flush();
  media.syncPosition();
});
audio.addEventListener("ended", () => {
  state.playing = false;
  ui.renderPlayState(false);
  media.setPlaybackState("paused");
  saver.flush();
});
audio.addEventListener("error", () => {
  const code = audio.error?.code;
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
    ui.setError("This file can't be played.");
  } else if (code) {
    ui.setError("Playback error.");
  }
  fileReady = true;
  syncLoading();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saver.flush();
});
window.addEventListener("pagehide", () => saver.flush());

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!state.objectUrl || ui.dialogOpen) return;
  const target = event.target as HTMLElement | null;
  if (target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)) {
    return;
  }

  switch (event.key) {
    case " ":
      // Un botón enfocado se activa con espacio de forma nativa.
      if (target?.tagName === "BUTTON") return;
      event.preventDefault();
      if (!event.repeat) void togglePlay();
      break;
    case "k":
      if (!event.repeat) void togglePlay();
      break;
    case "ArrowLeft":
      event.preventDefault();
      seekBy(-5);
      break;
    case "ArrowRight":
      event.preventDefault();
      seekBy(5);
      break;
    case "ArrowUp":
      event.preventDefault();
      setRate(stepRate(state.playbackRate, 1));
      break;
    case "ArrowDown":
      event.preventDefault();
      setRate(stepRate(state.playbackRate, -1));
      break;
    case "m":
      audio.muted = !audio.muted;
      break;
    default:
      break;
  }
});

ui.showEmpty();
ui.setCover(undefined);
ui.setMenuState({ hasBook: false });
ui.setCanContinue(Boolean(getLastBookId()));
void (async () => {
  const id = getLastBookId();
  if (!id) return;
  lastSaved = await loadBookState(id);
  if (lastSaved && !state.bookId) {
    ui.setCanContinue(true, lastSaved.title ?? lastSaved.filename);
  }
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((error) => console.warn("[plaudio] service worker no registrado", error));
  });
}
