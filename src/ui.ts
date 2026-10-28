import type { TimeRange } from "./chapters";
import { DEFAULT_RATE, PLAYBACK_RATES } from "./rates";
import type { AppState } from "./types";
import { formatTime } from "./utils";

const genericCoverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="cover-gold" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#fbe28f"/>
      <stop offset="0.42" stop-color="#f0bd5c"/>
      <stop offset="0.74" stop-color="#d99a2e"/>
      <stop offset="1" stop-color="#b9791a"/>
    </linearGradient>
    <linearGradient id="cover-gold-tri" x1="0.2" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7d67d"/>
      <stop offset="0.55" stop-color="#e5a93c"/>
      <stop offset="1" stop-color="#c07f1b"/>
    </linearGradient>
    <radialGradient id="cover-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e8a24a" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#e8a24a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#151515"/>
  <ellipse cx="256" cy="256" rx="196" ry="196" fill="url(#cover-glow)"/>
  <g transform="translate(256 256) scale(0.86) translate(-256 -256)">
    <rect x="92" y="108" width="176" height="296" rx="64" fill="url(#cover-gold)"/>
    <path d="M398.1 242.1 Q420 256 398.1 269.9 L323.9 317.1 Q302 331 302 305 L302 207 Q302 181 323.9 194.9 Z" fill="url(#cover-gold-tri)"/>
  </g>
</svg>`;

export const GENERIC_COVER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  genericCoverSvg,
)}`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} no encontrado`);
  return node as T;
}

export interface BookSummary {
  title: string;
  author?: string;
  position: number;
  duration: number;
  percent: number;
  chapterIndex: number;
  chapterCount: number;
}

export interface UIHandlers {
  onPick: () => void;
  onContinue: () => void;
  onInfo: () => void;
  onFiles: (files: FileList | null) => void;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  onSeekInput: (time: number) => void;
  onSeekCommit: (time: number) => void;
  onRate: (rate: number) => void;
  onChapter: (index: number) => void;
}

export class UI {
  private readonly emptyState = el<HTMLElement>("empty-state");
  private readonly playerSection = el<HTMLElement>("player");
  private readonly cover = el<HTMLImageElement>("cover");
  private readonly coverLoading = el<HTMLElement>("cover-loading");
  private readonly bookTitle = el<HTMLElement>("book-title");
  private readonly bookAuthor = el<HTMLElement>("book-author");
  private readonly chapterTitle = el<HTMLElement>("chapter-title");
  private readonly timeCurrent = el<HTMLElement>("time-current");
  private readonly timeRemaining = el<HTMLElement>("time-remaining");
  private readonly seek = el<HTMLInputElement>("seek");
  private readonly playButton = el<HTMLButtonElement>("play");
  private readonly backButton = el<HTMLButtonElement>("back");
  private readonly forwardButton = el<HTMLButtonElement>("forward");
  private readonly rate = el<HTMLSelectElement>("rate");
  private readonly rateValue = el<HTMLElement>("rate-value");
  private readonly chaptersButton = el<HTMLButtonElement>("chapters-button");
  private readonly chaptersPlaceholder = el<HTMLElement>("chapters-placeholder");
  private readonly chaptersDialog = el<HTMLDialogElement>("chapters-dialog");
  private readonly chaptersList = el<HTMLOListElement>("chapters-list");
  private readonly chaptersClose = el<HTMLButtonElement>("chapters-close");
  private readonly error = el<HTMLElement>("error");
  private readonly toast = el<HTMLElement>("toast");
  private readonly fileInput = el<HTMLInputElement>("file-input");
  private readonly openButton = el<HTMLButtonElement>("open-button");
  private readonly continueButton = el<HTMLButtonElement>("continue-button");
  private readonly menuButton = el<HTMLButtonElement>("menu-button");
  private readonly menu = el<HTMLElement>("app-menu");
  private readonly menuOpen = el<HTMLButtonElement>("menu-open");
  private readonly menuInfo = el<HTMLButtonElement>("menu-info");
  private readonly infoDialog = el<HTMLDialogElement>("info-dialog");
  private readonly infoClose = el<HTMLButtonElement>("info-close");
  private readonly infoBook = el<HTMLElement>("info-book");
  private readonly infoBookTitle = el<HTMLElement>("info-book-title");
  private readonly infoBookAuthor = el<HTMLElement>("info-book-author");
  private readonly infoPercent = el<HTMLElement>("info-percent");
  private readonly infoBarFill = el<HTMLElement>("info-bar-fill");
  private readonly infoPosition = el<HTMLElement>("info-position");

  private handlers?: UIHandlers;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Inicio absoluto (s) del tramo que representa la barra de progreso. */
  private rangeStart = 0;

  constructor() {
    this.rate.replaceChildren(
      ...PLAYBACK_RATES.map((rate) => new Option(`${rate}×`, String(rate))),
    );
    this.renderRate(DEFAULT_RATE);
  }

  bind(handlers: UIHandlers): void {
    this.handlers = handlers;

    const pick = () => {
      this.closeMenu();
      handlers.onPick();
    };
    this.openButton.addEventListener("click", pick);
    this.menuOpen.addEventListener("click", pick);
    this.continueButton.addEventListener("click", () => handlers.onContinue());
    this.menuInfo.addEventListener("click", () => {
      this.closeMenu();
      handlers.onInfo();
    });
    this.infoClose.addEventListener("click", () => this.infoDialog.close());
    this.infoDialog.addEventListener("click", (event) => {
      if (event.target === this.infoDialog) this.infoDialog.close();
    });
    this.fileInput.addEventListener("change", () => {
      handlers.onFiles(this.fileInput.files);
      this.fileInput.value = "";
    });

    this.menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });
    document.addEventListener("click", (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node)) {
        this.closeMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.menu.hidden) this.closeMenu();
    });

    this.playButton.addEventListener("click", () => handlers.onToggle());
    this.backButton.addEventListener("click", () => handlers.onBack());
    this.forwardButton.addEventListener("click", () => handlers.onForward());

    this.seek.addEventListener("input", () => {
      handlers.onSeekInput(this.rangeStart + Number(this.seek.value));
    });
    this.seek.addEventListener("change", () => {
      handlers.onSeekCommit(this.rangeStart + Number(this.seek.value));
    });

    this.rate.addEventListener("change", () => handlers.onRate(Number(this.rate.value)));

    this.chaptersButton.addEventListener("click", () => this.openChapters());
    this.chaptersClose.addEventListener("click", () => this.chaptersDialog.close());
    this.chaptersDialog.addEventListener("click", (event) => {
      if (event.target === this.chaptersDialog) this.chaptersDialog.close();
    });
  }

  showEmpty(): void {
    this.emptyState.hidden = false;
    this.playerSection.hidden = true;
  }

  showPlayer(): void {
    this.emptyState.hidden = true;
    this.playerSection.hidden = false;
  }

  setCover(url: string | undefined): void {
    this.cover.src = url ?? GENERIC_COVER;
  }

  setLoading(active: boolean): void {
    this.coverLoading.hidden = !active;
  }

  setBookTitle(title: string): void {
    this.bookTitle.textContent = title;
  }

  setAuthor(author: string | undefined): void {
    this.bookAuthor.textContent = author ?? "";
    this.bookAuthor.hidden = !author;
  }

  setChapterTitle(title: string | undefined): void {
    this.chapterTitle.textContent = title ?? "";
  }

  /**
   * Pinta la barra y los tiempos relativos al tramo `range` (normalmente el
   * capítulo actual). `current` y `preview` son tiempos absolutos del libro.
   */
  renderProgress(range: TimeRange, current: number, preview?: number): void {
    const length = range.end - range.start;
    const hasLength = Number.isFinite(length) && length > 0;
    const elapsed = Math.max((preview ?? current) - range.start, 0);
    this.rangeStart = range.start;
    this.seek.disabled = !hasLength;

    if (hasLength) {
      const value = Math.min(elapsed, length);
      this.seek.max = String(length);
      this.seek.value = String(value);
      this.seek.style.setProperty("--progress", `${(value / length) * 100}%`);
      const forceHours = length >= 3600;
      this.timeCurrent.textContent = formatTime(value, forceHours);
      this.timeRemaining.textContent = `-${formatTime(length - value, forceHours)}`;
    } else {
      this.seek.value = "0";
      this.seek.style.setProperty("--progress", "0%");
      this.timeCurrent.textContent = formatTime(elapsed);
      this.timeRemaining.textContent = "--:--";
    }
  }

  renderPlayState(playing: boolean): void {
    this.playButton.classList.toggle("is-playing", playing);
    this.playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  toggleMenu(): void {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  openMenu(): void {
    this.menu.hidden = false;
    this.menuButton.setAttribute("aria-expanded", "true");
    this.menu.querySelector<HTMLButtonElement>(".menu-item:not([hidden])")?.focus();
  }

  closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.menuButton.setAttribute("aria-expanded", "false");
  }

  setMenuState(params: { hasBook: boolean }): void {
    this.menuOpen.hidden = !params.hasBook;
  }

  setCanContinue(canContinue: boolean, title?: string): void {
    this.continueButton.hidden = !canContinue;
    if (title) this.continueButton.title = title;
    else this.continueButton.removeAttribute("title");
  }

  get infoOpen(): boolean {
    return this.infoDialog.open;
  }

  get dialogOpen(): boolean {
    return this.infoDialog.open || this.chaptersDialog.open;
  }

  openInfo(summary: BookSummary | null): void {
    this.renderBookSummary(summary);
    if (this.infoDialog.open) return;
    if (typeof this.infoDialog.showModal === "function") this.infoDialog.showModal();
    else this.infoDialog.setAttribute("open", "");
  }

  renderBookSummary(summary: BookSummary | null): void {
    this.infoBook.hidden = !summary;
    if (!summary) return;

    this.infoBookTitle.textContent = summary.title;
    this.infoBookAuthor.textContent = summary.author ?? "";
    this.infoBookAuthor.hidden = !summary.author;
    this.infoPercent.textContent = `${summary.percent}%`;
    this.infoBarFill.style.width = `${summary.percent}%`;

    const forceHours = summary.duration >= 3600;
    const parts: string[] = [];
    if (summary.duration > 0) {
      parts.push(
        `${formatTime(summary.position, forceHours)} / ${formatTime(summary.duration, forceHours)}`,
      );
    }
    if (summary.chapterCount > 0 && summary.chapterIndex >= 0) {
      parts.push(`Chapter ${summary.chapterIndex + 1} of ${summary.chapterCount}`);
    }
    this.infoPosition.textContent = parts.join(" · ");
    this.infoPosition.hidden = parts.length === 0;
  }

  openFileDialog(): void {
    this.fileInput.click();
  }

  renderRate(rate: number): void {
    this.rate.value = String(rate);
    this.rateValue.textContent = `${Number(rate)}×`;
  }

  renderChapters(state: AppState): void {
    const hasChapters = state.chapters.length > 0;
    this.chaptersButton.hidden = !hasChapters;
    this.chaptersPlaceholder.hidden = hasChapters;
    if (!hasChapters) {
      if (this.chaptersDialog.open) this.chaptersDialog.close();
      this.chaptersList.replaceChildren();
      return;
    }

    const forceHours = state.duration >= 3600;
    const fragment = document.createDocumentFragment();
    state.chapters.forEach((chapter, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-item";
      if (index === state.currentChapterIndex) button.setAttribute("aria-current", "true");

      const label = document.createElement("span");
      label.className = "chapter-label";
      label.textContent = `${String(index + 1).padStart(2, "0")} · ${chapter.title}`;

      const time = document.createElement("span");
      time.className = "chapter-time";
      time.textContent = formatTime(chapter.startTime, forceHours);

      button.append(label, time);
      button.addEventListener("click", () => {
        this.handlers?.onChapter(index);
        this.chaptersDialog.close();
      });
      li.append(button);
      fragment.append(li);
    });
    this.chaptersList.replaceChildren(fragment);
  }

  updateCurrentChapter(index: number): void {
    const items = this.chaptersList.querySelectorAll<HTMLButtonElement>(".chapter-item");
    items.forEach((item, itemIndex) => {
      if (itemIndex === index) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
  }

  openChapters(): void {
    if (typeof this.chaptersDialog.showModal === "function") {
      if (!this.chaptersDialog.open) this.chaptersDialog.showModal();
    } else {
      this.chaptersDialog.setAttribute("open", "");
    }
  }

  setError(message: string | null): void {
    if (message) {
      this.error.textContent = message;
      this.error.hidden = false;
    } else {
      this.error.hidden = true;
      this.error.textContent = "";
    }
  }

  showToast(message: string, durationMs = 3200): void {
    this.toast.textContent = message;
    this.toast.classList.add("visible");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove("visible");
      this.toastTimer = null;
    }, durationMs);
  }
}
