import type { Chapter } from "./types";

/**
 * Tolerancia (s) al comparar con el inicio de capítulo: tras un seek el
 * elemento <audio> puede quedar unas micras antes del instante pedido.
 */
const CHAPTER_EPSILON = 0.05;

export function currentChapterIndex(chapters: Chapter[], time: number): number {
  if (chapters.length === 0 || !Number.isFinite(time)) return -1;
  const target = time + CHAPTER_EPSILON;
  let low = 0;
  let high = chapters.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const chapter = chapters[mid]!;
    if (chapter.startTime <= target) {
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

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Tramo de reproducción asociado al capítulo `index`. Sin capítulos, el tramo
 * es el libro completo; con índice -1 (antes del primer capítulo) es el
 * preámbulo `[0, primer capítulo)`. `end` es 0 si la duración aún no se conoce.
 */
export function chapterRange(chapters: Chapter[], index: number, duration: number): TimeRange {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (chapters.length === 0) return { start: 0, end: total };

  if (index < 0) {
    const firstStart = chapters[0]!.startTime;
    return firstStart > 0 ? { start: 0, end: firstStart } : { start: 0, end: total };
  }

  const chapter = chapters[Math.min(index, chapters.length - 1)]!;
  const start = Math.max(0, chapter.startTime);
  let end = chapter.endTime ?? chapters[index + 1]?.startTime ?? total;
  if (total > 0) end = Math.min(end, total);
  if (!(end > start)) end = total > start ? total : 0;
  return { start, end };
}
