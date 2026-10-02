import { clamp } from "./utils";

export const SEEK_BACKWARD = 15;
export const SEEK_FORWARD = 30;

export class Player {
  constructor(readonly audio: HTMLAudioElement) {}

  load(url: string): void {
    this.audio.src = url;
    this.audio.load();
  }

  async play(): Promise<void> {
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  async toggle(): Promise<void> {
    if (this.audio.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  seekTo(time: number): void {
    const duration = this.audio.duration;
    if (Number.isFinite(duration) && duration > 0) {
      this.audio.currentTime = clamp(time, 0, duration);
    } else {
      this.audio.currentTime = Math.max(0, time);
    }
  }

  seekBy(delta: number): void {
    this.seekTo(this.audio.currentTime + delta);
  }

  setRate(rate: number): void {
    this.audio.playbackRate = rate;
  }

  get duration(): number {
    return this.audio.duration;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get paused(): boolean {
    return this.audio.paused;
  }
}
