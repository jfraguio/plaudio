import { describe, expect, it } from "vitest";
import {
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
