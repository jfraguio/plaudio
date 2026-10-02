import type { Chapter } from "./types";

export function currentChapterIndex(chapters: Chapter[], time: number): number {
  if (chapters.length === 0 || !Number.isFinite(time)) return -1;
  let low = 0;
  let high = chapters.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const chapter = chapters[mid]!;
    if (chapter.startTime <= time) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

export function nextChapterIndex(chapters: Chapter[], current: number): number {
  if (chapters.length === 0) return -1;
  if (current < 0) return 0;
  return Math.min(current + 1, chapters.length - 1);
}

export function previousChapterIndex(chapters: Chapter[], current: number): number {
  if (chapters.length === 0) return -1;
  if (current <= 0) return 0;
  return current - 1;
}

export function chapterLabel(index: number, chapter: Chapter, forceHours = true): string {
  const number = String(index + 1).padStart(2, "0");
  return `${number} · ${chapter.title} · ${formatChapterTime(chapter.startTime, forceHours)}`;
}

function formatChapterTime(seconds: number, forceHours: boolean): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0 || forceHours) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
