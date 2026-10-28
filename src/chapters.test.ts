import { describe, expect, it } from "vitest";
import {
  chapterRange,
  currentChapterIndex,
  nextChapterIndex,
  previousChapterIndex,
} from "./chapters";
import type { Chapter } from "./types";

const chapters: Chapter[] = [
  { title: "Uno", startTime: 0 },
  { title: "Dos", startTime: 100 },
  { title: "Tres", startTime: 250 },
];

describe("currentChapterIndex", () => {
  it("devuelve -1 sin capítulos", () => {
    expect(currentChapterIndex([], 50)).toBe(-1);
  });

  it("encuentra el capítulo correcto en los límites", () => {
    expect(currentChapterIndex(chapters, 0)).toBe(0);
    expect(currentChapterIndex(chapters, 99.9)).toBe(0);
    expect(currentChapterIndex(chapters, 100)).toBe(1);
    expect(currentChapterIndex(chapters, 249)).toBe(1);
    expect(currentChapterIndex(chapters, 250)).toBe(2);
    expect(currentChapterIndex(chapters, 9999)).toBe(2);
  });

  it("tolera imprecisiones mínimas tras un seek al inicio de capítulo", () => {
    expect(currentChapterIndex(chapters, 99.99999)).toBe(1);
    expect(currentChapterIndex(chapters, 99.9)).toBe(0);
  });

  it("ignora tiempos inválidos", () => {
    expect(currentChapterIndex(chapters, Number.NaN)).toBe(-1);
  });
});

describe("navegación", () => {
  it("avanza y retrocede capítulos con límites", () => {
    expect(previousChapterIndex(chapters, 0)).toBe(0);
    expect(previousChapterIndex(chapters, 2)).toBe(1);
    expect(nextChapterIndex(chapters, -1)).toBe(0);
    expect(nextChapterIndex(chapters, 2)).toBe(2);
    expect(nextChapterIndex([], 0)).toBe(-1);
  });
});

describe("chapterRange", () => {
  it("usa el libro completo sin capítulos", () => {
    expect(chapterRange([], -1, 500)).toEqual({ start: 0, end: 500 });
    expect(chapterRange([], -1, Number.NaN)).toEqual({ start: 0, end: 0 });
  });

  it("acota cada capítulo con el inicio del siguiente o la duración", () => {
    expect(chapterRange(chapters, 0, 400)).toEqual({ start: 0, end: 100 });
    expect(chapterRange(chapters, 1, 400)).toEqual({ start: 100, end: 250 });
    expect(chapterRange(chapters, 2, 400)).toEqual({ start: 250, end: 400 });
  });

  it("prefiere endTime y lo limita a la duración", () => {
    const withEnd: Chapter[] = [
      { title: "A", startTime: 0, endTime: 90 },
      { title: "B", startTime: 90, endTime: 999 },
    ];
    expect(chapterRange(withEnd, 0, 300)).toEqual({ start: 0, end: 90 });
    expect(chapterRange(withEnd, 1, 300)).toEqual({ start: 90, end: 300 });
  });

  it("trata el tramo previo al primer capítulo como preámbulo", () => {
    const late: Chapter[] = [{ title: "A", startTime: 30 }];
    expect(chapterRange(late, -1, 300)).toEqual({ start: 0, end: 30 });
  });

  it("devuelve end 0 en el último capítulo si no hay duración", () => {
    expect(chapterRange(chapters, 2, 0)).toEqual({ start: 250, end: 0 });
  });
});
