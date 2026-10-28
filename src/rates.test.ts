import { describe, expect, it } from "vitest";
import { DEFAULT_RATE, PLAYBACK_RATES, nearestRate, stepRate } from "./rates";

describe("nearestRate", () => {
  it("conserva velocidades disponibles", () => {
    for (const rate of PLAYBACK_RATES) expect(nearestRate(rate)).toBe(rate);
  });

  it("ajusta velocidades fuera de la lista a la más cercana", () => {
    expect(nearestRate(2)).toBe(1.5);
    expect(nearestRate(0.5)).toBe(0.8);
    expect(nearestRate(1.04)).toBe(1);
    expect(nearestRate(1.1000000001)).toBe(1.1);
  });

  it("usa la velocidad por defecto con valores inválidos", () => {
    expect(nearestRate(Number.NaN)).toBe(DEFAULT_RATE);
    expect(nearestRate(0)).toBe(DEFAULT_RATE);
    expect(nearestRate(-1)).toBe(DEFAULT_RATE);
  });
});

describe("stepRate", () => {
  it("sube y baja un paso", () => {
    expect(stepRate(1, 1)).toBe(1.1);
    expect(stepRate(1, -1)).toBe(0.9);
  });

  it("no se sale de los extremos", () => {
    expect(stepRate(1.5, 1)).toBe(1.5);
    expect(stepRate(0.8, -1)).toBe(0.8);
  });

  it("parte de la velocidad más cercana si la actual no está en la lista", () => {
    expect(stepRate(1.04, 1)).toBe(1.1);
  });
});
