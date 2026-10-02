import type { Player } from "./player";

export interface MediaSessionCallbacks {
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

interface BookInfo {
  title: string;
  author?: string;
  coverUrl?: string;
}

export class MediaSessionController {
  private title = "Plaudio";
  private author?: string;
  private chapter?: string;
  private artwork: MediaImage[] = [];

  constructor(
    private readonly player: Player,
    private readonly callbacks: MediaSessionCallbacks,
  ) {}

  private get session(): MediaSession | undefined {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return undefined;
    return navigator.mediaSession;
  }

  bind(): void {
    const session = this.session;
    if (!session) return;

    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* acción no soportada por el navegador */
      }
    };

    set("play", () => void this.player.play());
    set("pause", () => this.player.pause());
    set("stop", () => this.player.pause());
    set("seekbackward", () => this.callbacks.onSeekBackward());
    set("seekforward", () => this.callbacks.onSeekForward());
    set("previoustrack", () => this.callbacks.onPrevious());
    set("nexttrack", () => this.callbacks.onNext());
    set("seekto", (details) => {
      const time = details.seekTime;
      if (typeof time === "number") this.player.seekTo(time);
    });
  }

  setBook(info: BookInfo): void {
    this.title = info.title || "Plaudio";
    this.author = info.author;
    this.artwork = info.coverUrl
      ? [{ src: info.coverUrl, sizes: "512x512", type: "image/jpeg" }]
      : [];
    this.updateMetadata();
  }

  setChapter(title?: string): void {
    this.chapter = title;
    this.updateMetadata();
  }

  private updateMetadata(): void {
    const session = this.session;
    if (!session) return;
    try {
      session.metadata = new MediaMetadata({
        title: this.title,
        artist: this.author ?? "",
        album: this.chapter ?? "",
        artwork: this.artwork,
      });
    } catch {
      /* MediaMetadata no disponible */
    }
  }

  setPlaybackState(state: "playing" | "paused" | "none"): void {
    const session = this.session;
    if (!session) return;
    try {
      session.playbackState = state;
    } catch {
      /* ignore */
    }
  }

  syncPosition(): void {
    const session = this.session;
    if (!session) return;
    const duration = this.player.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const position = Math.min(Math.max(this.player.currentTime, 0), duration);
    try {
      session.setPositionState({
        duration,
        playbackRate: this.player.audio.playbackRate,
        position,
      });
    } catch {
      /* valores transitorios inválidos */
    }
  }
}
