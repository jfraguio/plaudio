import { describe, expect, it } from "vitest";
import { parseIlst } from "./ilst";
import { box, concat, dataBox, fullBox, textItem, u32 } from "./test-boxes";

function buildMoov(items: Uint8Array[]): Uint8Array {
  const ilst = box("ilst", ...items);
  const meta = fullBox("meta", 0, ilst);
  const udta = box("udta", meta);
  return box("moov", udta);
}

describe("parseIlst", () => {
  it("extrae título, autor y carátula", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const moov = buildMoov([
      textItem("\u00A9nam", "The Infinity Machine"),
      textItem("\u00A9ART", "Demis Hassabis"),
      box("covr", dataBox(13, jpeg)),
    ]);

    const data = parseIlst(moov);
    expect(data.text["\u00A9nam"]).toBe("The Infinity Machine");
    expect(data.text["\u00A9ART"]).toBe("Demis Hassabis");
    expect(data.artwork?.mime).toBe("image/jpeg");
    expect(Array.from(data.artwork!.bytes)).toEqual(Array.from(jpeg));
  });

  it("extrae campos libres (----)", () => {
    const mean = fullBox("mean", 0, new Uint8Array([...Buffer.from("com.apple.iTunes")]));
    const name = fullBox("name", 0, new Uint8Array([...Buffer.from("SUBTITLE")]));
    const data = box("data", concat([u32(1), u32(0), new Uint8Array([...Buffer.from("Subtítulo")])]));
    const freeform = box("----", mean, name, data);
    const moov = buildMoov([freeform]);

    const parsed = parseIlst(moov);
    expect(parsed.freeform["SUBTITLE"]).toBe("Subtítulo");
  });

  it("devuelve datos vacíos si no hay ilst", () => {
    const moov = box("moov", box("mvhd", new Uint8Array(8)));
    const parsed = parseIlst(moov);
    expect(parsed.text).toEqual({});
    expect(parsed.artwork).toBeUndefined();
  });
});
