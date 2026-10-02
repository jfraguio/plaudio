export interface BookIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export function getBookId(file: BookIdentity): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function formatTime(seconds: number, forceHours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0 || forceHours) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function titleFromFilename(name: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const spaced = withoutExt
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.length > 0 ? spaced : name;
}

export class ThrottledSaver {
  private lastRun = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fn: () => void,
    private readonly intervalMs = 5000,
  ) {}

  schedule(): void {
    const now = Date.now();
    const elapsed = now - this.lastRun;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.intervalMs - elapsed);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastRun = Date.now();
    try {
      this.fn();
    } catch (error) {
      console.warn("[plaudio] no se pudo guardar el progreso", error);
    }
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export async function arrayBufferFrom(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
}

export function toBlobUrl(bytes: Uint8Array, mime: string): string {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buffer], { type: mime }));
}
