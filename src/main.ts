import "./styles.css";
import { currentChapterIndex, nextChapterIndex, previousChapterIndex } from "./chapters";
import { fileFromHandle, pickFile, supportsFileSystemAccess } from "./file-access";
import { isFullscreen, requestFullscreen } from "./fullscreen";
import { MediaSessionController } from "./media-session";
import { loadBookMetadata } from "./metadata";
import {
  buildStateRecord,
  getFileHandle,
  getLastBookId,
  isPersistenceAvailable,
  loadBookState,
  saveBookState,
  saveFileHandle,
  setLastBookId,
} from "./persistence";
import { Player, SEEK_BACKWARD, SEEK_FORWARD } from "./player";
import { createInitialState, type AudiobookState, type BookMetadata } from "./types";
import { UI } from "./ui";
import { ThrottledSaver, clamp, formatTime, getBookId, titleFromFilename, toBlobUrl } from "./utils";

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
let scrubbing = false;
let lastPositionSync = 0;
let suppressAutoFullscreen = false;

function tryEnterFullscreen(): void {
  if (suppressAutoFullscreen || isFullscreen()) return;
  void requestFullscreen();
}

const saver = new ThrottledSaver(persistNow, 5000);

function persistNow(): void {
  if (!state.bookId || !state.file) return;
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
    state.genericCover = false;
    ui.setCover(state.coverUrl);
  }

  if (meta.chapters.length > 0) state.chapters = meta.chapters;
  if (meta.duration && meta.duration > 0 && !state.duration) state.duration = meta.duration;

  ui.setBookTitle(state.title);
  ui.setAuthor(state.author);
  ui.renderChapters(state);
  updateChapterFromTime(true);
  ui.renderProgress(player.currentTime, state.duration);
  media.setBook({ title: state.title, author: state.author, coverUrl: state.coverUrl });
  media.setChapter(
    state.currentChapterIndex >= 0
      ? state.chapters[state.currentChapterIndex]?.title
      : undefined,
  );
}

async function openBook(file: File, handle?: FileSystemFileHandle): Promise<void> {
  suppressAutoFullscreen = false;
  tryEnterFullscreen();
  releaseCurrent();

  state.file = file;
  state.bookId = getBookId(file);
  setLastBookId(state.bookId);
  if (handle) void saveFileHandle(state.bookId, handle);
  state.title = titleFromFilename(file.name);
  state.author = undefined;
  state.chapters = [];
  state.currentChapterIndex = -1;
  state.duration = 0;
  state.currentTime = 0;
  state.playbackRate = 1;
  state.playing = false;
  state.canPlay = false;
  state.coverUrl = undefined;
  state.genericCover = true;

  ui.setError(null);
  ui.showPlayer();
  ui.setMenuState({ hasBook: true, canContinue: false });
  ui.setBookTitle(state.title);
  ui.setAuthor(undefined);
  ui.setChapterTitle(undefined);
  ui.setCover(undefined);
  ui.renderRate(1);
  ui.renderPlayState(false);
  ui.renderChapters(state);
  ui.renderProgress(0, 0);

  state.objectUrl = URL.createObjectURL(file);
  player.load(state.objectUrl);

  pendingSaved = await loadBookState(state.bookId);
  media.setBook({ title: state.title });

  void loadBookMetadata(file)
    .then(applyMetadata)
    .catch((error) => console.warn("[plaudio] metadata no disponible", error));
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
      state.currentTime = position;
      ui.showToast(`Resuming from ${formatTime(position, state.duration >= 3600)}`);
    }

    const rate = clamp(saved.playbackRate || 1, 0.5, 3);
    state.playbackRate = rate;
    player.setRate(rate);
    ui.renderRate(rate);
  }

  state.canPlay = true;
  ui.renderProgress(state.currentTime, state.duration);
  updateChapterFromTime(true);
  media.syncPosition();
}

function onTimeUpdate(): void {
  state.currentTime = player.currentTime;
  if (!scrubbing) ui.renderProgress(state.currentTime, state.duration);
  saver.schedule();
  updateChapterFromTime(false);

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

function changeRate(rate: number): void {
  const options = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const next =
    options.find((option) => option === Math.round(rate * 100) / 100) ??
    options.reduce((closest, option) =>
      Math.abs(option - rate) < Math.abs(closest - rate) ? option : closest,
    );
  player.setRate(next);
}

function goToChapter(index: number): void {
  const chapter = state.chapters[index];
  if (!chapter) return;
  player.seekTo(chapter.startTime);
  state.currentTime = chapter.startTime;
  ui.renderProgress(state.currentTime, state.duration);
  updateChapterFromTime(true);
  if (state.playing) saver.schedule();
  else saver.flush();
  media.syncPosition();
}

// --- Event wiring ---------------------------------------------------------

const media = new MediaSessionController(player, {
  onSeekBackward: () => {
    player.seekBy(-SEEK_BACKWARD);
    saver.flush();
    media.syncPosition();
  },
  onSeekForward: () => {
    player.seekBy(SEEK_FORWARD);
    saver.flush();
    media.syncPosition();
  },
  onPrevious: () => goToChapter(previousChapterIndex(state.chapters, state.currentChapterIndex)),
  onNext: () => goToChapter(nextChapterIndex(state.chapters, state.currentChapterIndex)),
});
media.bind();

ui.bind({
  onPick: () => void pickAndOpen(),
  onContinue: () => void continueLastBook(),
  onFiles: (files) => {
    const file = files?.[0];
    if (file) void openBook(file);
  },
  onToggle: () => void togglePlay(),
  onBack: () => {
    player.seekBy(-SEEK_BACKWARD);
    saver.flush();
    media.syncPosition();
  },
  onForward: () => {
    player.seekBy(SEEK_FORWARD);
    saver.flush();
    media.syncPosition();
  },
  onSeekInput: (time) => {
    scrubbing = true;
    ui.renderProgress(state.currentTime, state.duration, time);
  },
  onSeekCommit: (time) => {
    scrubbing = false;
    player.seekTo(time);
    state.currentTime = time;
    ui.renderProgress(state.currentTime, state.duration);
    updateChapterFromTime(true);
    saver.flush();
    media.syncPosition();
  },
  onRate: (rate) => {
    player.setRate(rate);
    state.playbackRate = rate;
    ui.renderRate(rate);
    saver.flush();
    media.syncPosition();
  },
  onChapter: (index) => goToChapter(index),
});

audio.addEventListener("loadedmetadata", onLoadedMetadata);
audio.addEventListener("durationchange", () => {
  if (Number.isFinite(audio.duration) && audio.duration > state.duration) {
    state.duration = audio.duration;
    ui.renderProgress(player.currentTime, state.duration);
  }
});
audio.addEventListener("timeupdate", onTimeUpdate);
audio.addEventListener("ratechange", () => {
  state.playbackRate = audio.playbackRate;
  ui.renderRate(audio.playbackRate);
  saver.schedule();
  media.syncPosition();
});
audio.addEventListener("canplay", () => {
  state.canPlay = true;
});
audio.addEventListener("play", () => {
  state.playing = true;
  ui.renderPlayState(true);
  media.setPlaybackState("playing");
  media.syncPosition();
  tryEnterFullscreen();
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
  state.canPlay = false;
});

document.addEventListener("fullscreenchange", () => {
  if (!isFullscreen()) suppressAutoFullscreen = true;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saver.flush();
});
window.addEventListener("pagehide", () => saver.flush());
window.addEventListener("beforeunload", () => saver.flush());

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  switch (event.key) {
    case " ":
    case "k":
      event.preventDefault();
      void togglePlay();
      break;
    case "ArrowLeft":
      player.seekBy(-5);
      saver.flush();
      break;
    case "ArrowRight":
      player.seekBy(5);
      saver.flush();
      break;
    case "ArrowUp":
      event.preventDefault();
      changeRate(state.playbackRate + 0.25);
      break;
    case "ArrowDown":
      event.preventDefault();
      changeRate(state.playbackRate - 0.25);
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
ui.setMenuState({ hasBook: false, canContinue: Boolean(getLastBookId()) });
void isPersistenceAvailable();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((error) => console.warn("[plaudio] service worker no registrado", error));
  });
}
