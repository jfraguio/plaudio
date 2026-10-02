import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThrottledSaver,
  clamp,
  formatTime,
  getBookId,
  titleFromFilename,
} from "./utils";

describe("getBookId", () => {
  it("combina nombre, tamaño y fecha", () => {
    const id = getBookId({ name: "libro.m4b", size: 123, lastModified: 456 });
    expect(id).toBe("libro.m4b:123:456");
  });
});

describe("formatTime", () => {
  it("usa MM:SS por debajo de una hora", () => {
    expect(formatTime(83)).toBe("01:23");
  });

  it("usa HH:MM:SS a partir de una hora", () => {
    expect(formatTime(5447)).toBe("01:30:47");
  });

  it("fuerza horas cuando se pide", () => {
    expect(formatTime(83, true)).toBe("00:01:23");
  });

  it("devuelve --:-- para valores no finitos o negativos", () => {
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("--:--");
    expect(formatTime(-1)).toBe("--:--");
    expect(formatTime(Number.NaN)).toBe("--:--");
  });
});

describe("titleFromFilename", () => {
  it("quita la extensión y normaliza separadores", () => {
    expect(titleFromFilename("The-Infinity-Machine-Demis-Hassabis-A.m4b")).toBe(
      "The Infinity Machine Demis Hassabis A",
    );
    expect(titleFromFilename("mi_libro.mp4")).toBe("mi libro");
  });
});

describe("clamp", () => {
  it("limita al rango", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 10)).toBe(2);
  });
});

describe("ThrottledSaver", () => {
  afterEach(() => vi.useRealTimers());

  it("ejecuta inmediatamente si ha pasado el intervalo", () => {
    const fn = vi.fn();
    const saver = new ThrottledSaver(fn, 5000);
    saver.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("agrupa llamadas seguidas y ejecuta al vencer el intervalo", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const saver = new ThrottledSaver(fn, 5000);
    saver.schedule();
    saver.schedule();
    fn.mockClear();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush fuerza la ejecución pendiente", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const saver = new ThrottledSaver(fn, 5000);
    saver.schedule();
    fn.mockClear();
    saver.schedule();
    saver.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
