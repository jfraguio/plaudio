import { describe, expect, it } from "vitest";
import { buildDefaultFtyp, locateMoov } from "./atoms";
import { ascii, box, byteBlob } from "./test-boxes";

function moovWith(payload: Uint8Array): Uint8Array {
  return box("moov", payload);
}

describe("locateMoov", () => {
  it("encuentra el moov aunque esté detrás de un mdat enorme", async () => {
    const ftyp = box("ftyp", ascii("isom"));
    const mdatPayload = new Uint8Array(1024 * 512);
    const mdat = box("mdat", mdatPayload);
    const moov = moovWith(ascii("contenido"));
    const file = byteBlob([ftyp, mdat, moov]);

    const layout = await locateMoov(file);
    expect(layout.moov.start).toBe(ftyp.length + mdat.length);
    expect(layout.moov.size).toBe(moov.length);
    expect(layout.ftyp?.start).toBe(0);
  });

  it("encuentra el moov al principio (faststart)", async () => {
    const ftyp = box("ftyp", ascii("isom"));
    const moov = moovWith(ascii("contenido"));
    const file = byteBlob([ftyp, moov, box("mdat", new Uint8Array(16))]);
    const layout = await locateMoov(file);
    expect(layout.moov.start).toBe(ftyp.length);
  });

  it("lanza si no hay moov", async () => {
    const file = byteBlob([box("ftyp", ascii("isom")), box("mdat", new Uint8Array(8))]);
    await expect(locateMoov(file)).rejects.toThrow("MOOV_NOT_FOUND");
  });
});

describe("buildDefaultFtyp", () => {
  it("genera un ftyp válido", () => {
    const bytes = buildDefaultFtyp();
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0)).toBe(bytes.length);
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe("ftyp");
  });
});
