import type { AppState } from "./types";
import { formatTime } from "./utils";

const genericCoverSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" fill="#151515"/>' +
  '<g fill="none" stroke="#f2f2f0" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M120 156c44-18 96-18 136 10v206c-40-28-92-28-136-10z"/>' +
  '<path d="M392 156c-44-18-96-18-136 10v206c40-28 92-28 136-10z"/>' +
  "</g></svg>";

export const GENERIC_COVER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  genericCoverSvg,
)}`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} no encontrado`);
  return node as T;
}

export interface UIHandlers {
  onPick: () => void;
  onContinue: () => void;
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
  private readonly menuButton = el<HTMLButtonElement>("menu-button");
  private readonly menu = el<HTMLElement>("app-menu");
  private readonly menuOpen = el<HTMLButtonElement>("menu-open");
  private readonly menuContinue = el<HTMLButtonElement>("menu-continue");
  private readonly menuInfo = el<HTMLButtonElement>("menu-info");
  private readonly infoDialog = el<HTMLDialogElement>("info-dialog");
  private readonly infoClose = el<HTMLButtonElement>("info-close");

  private handlers?: UIHandlers;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  bind(handlers: UIHandlers): void {
    this.handlers = handlers;

    const pick = () => {
      this.closeMenu();
      handlers.onPick();
    };
    this.openButton.addEventListener("click", pick);
    this.menuOpen.addEventListener("click", pick);
    this.menuContinue.addEventListener("click", () => {
      this.closeMenu();
      handlers.onContinue();
    });
    this.menuInfo.addEventListener("click", () => {
      this.closeMenu();
      this.infoDialog.showModal();
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
      handlers.onSeekInput(Number(this.seek.value));
    });
    this.seek.addEventListener("change", () => {
      handlers.onSeekCommit(Number(this.seek.value));
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

  renderProgress(current: number, duration: number, preview?: number): void {
    const hasDuration = Number.isFinite(duration) && duration > 0;
    this.seek.disabled = !hasDuration;
    const value = hasDuration
      ? Math.min(Math.max(preview ?? current, 0), duration)
      : Math.max(preview ?? current, 0);

    if (hasDuration) {
      this.seek.max = String(Math.floor(duration));
      this.seek.value = String(Math.floor(value));
      const percent = duration > 0 ? (value / duration) * 100 : 0;
      this.seek.style.setProperty("--progress", `${percent}%`);
      this.timeRemaining.textContent = `-${formatTime(Math.max(0, duration - value), true)}`;
    } else {
      this.seek.value = "0";
      this.seek.style.setProperty("--progress", "0%");
      this.timeRemaining.textContent = "--:--";
    }

    this.timeCurrent.textContent = formatTime(value, hasDuration && duration >= 3600);
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
    this.menuOpen.focus();
  }

  closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.menuButton.setAttribute("aria-expanded", "false");
  }

  setMenuState(params: { hasBook: boolean; canContinue: boolean }): void {
    this.menuOpen.hidden = !params.hasBook;
    this.menuContinue.hidden = !params.canContinue;
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
