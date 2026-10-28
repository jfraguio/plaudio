import { describe, expect, it } from "vitest";
import { parseMovie } from "./movie";
import { ascii, box, concat, fullBox, u32 } from "./test-boxes";

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

const zeros = (length: number) => new Uint8Array(length);

function mvhd(timescale: number, duration: number, version: 0 | 1 = 0): Uint8Array {
  return version === 1
    ? fullBox("mvhd", 1 << 24, u64(0), u64(0), u32(timescale), u64(duration), zeros(80))
    : fullBox("mvhd", 0, u32(0), u32(0), u32(timescale), u32(duration), zeros(80));
}

interface TrakSpec {
  id: number;
  handler: string;
  timescale: number;
  chapRefs?: number[];
  stbl?: Uint8Array[];
}

function trak(spec: TrakSpec): Uint8Array {
  const tkhd = fullBox("tkhd", 7, u32(0), u32(0), u32(spec.id), u32(0), u32(0), zeros(60));
  const tref = spec.chapRefs ? [box("tref", box("chap", ...spec.chapRefs.map(u32)))] : [];
  const mdhd = fullBox("mdhd", 0, u32(0), u32(0), u32(spec.timescale), u32(0), zeros(4));
  const hdlr = fullBox("hdlr", 0, u32(0), ascii(spec.handler), zeros(13));
  const minf = box("minf", box("stbl", ...(spec.stbl ?? [])));
  return box("trak", tkhd, ...tref, box("mdia", mdhd, hdlr, minf));
}

const stts = (...entries: Array<[number, number]>) =>
  fullBox("stts", 0, u32(entries.length), ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]));
const stsc = (...entries: Array<[number, number]>) =>
  fullBox("stsc", 0, u32(entries.length), ...entries.flatMap(([first, perChunk]) => [u32(first), u32(perChunk), u32(1)]));
const stsz = (...sizes: number[]) => fullBox("stsz", 0, u32(0), u32(sizes.length), ...sizes.map(u32));
const stco = (...offsets: number[]) => fullBox("stco", 0, u32(offsets.length), ...offsets.map(u32));
const co64 = (...offsets: number[]) => fullBox("co64", 0, u32(offsets.length), ...offsets.map(u64));

/** Pista de audio con tablas que nunca deben recorrerse. */
function audioTrak(chapRefs?: number[]): Uint8Array {
  return trak({
    id: 1,
    handler: "soun",
    timescale: 44100,
    chapRefs,
    stbl: [stts([1000, 1024]), stsc([1, 10]), stsz(...Array(5).fill(300)), stco(9999)],
  });
}

const moov = (...children: Uint8Array[]) => box("moov", ...children);

describe("parseMovie", () => {
  it("lee la duración de mvhd v0 y v1", () => {
    expect(parseMovie(moov(mvhd(1000, 54_388_840))).duration).toBeCloseTo(54_388.84);
    expect(parseMovie(moov(mvhd(600, 6_000_000_000, 1))).duration).toBe(10_000_000);
  });

  it("expande stsc/stco/stsz/stts de la pista referenciada por tref/chap", () => {
    const text = trak({
      id: 2,
      handler: "text",
      timescale: 1000,
      stbl: [
        stts([2, 60_000], [1, 30_000]),
        // chunk 1: 2 muestras; chunks 2+: 1 muestra
        stsc([1, 2], [2, 1]),
        stsz(10, 20, 30),
        stco(500, 900),
      ],
    });
    const info = parseMovie(moov(mvhd(1000, 150_000), audioTrak([2]), text));
    expect(info.chapterSamples).toEqual([
      { offset: 500, size: 10, time: 0 },
      { offset: 510, size: 20, time: 60 },
      { offset: 900, size: 30, time: 120 },
    ]);
  });

  it("soporta offsets de 64 bits (co64)", () => {
    const text = trak({
      id: 2,
      handler: "text",
      timescale: 1,
      stbl: [stts([1, 1]), stsc([1, 1]), stsz(12), co64(5_000_000_000)],
    });
    const info = parseMovie(moov(mvhd(1, 1), audioTrak([2]), text));
    expect(info.chapterSamples[0]?.offset).toBe(5_000_000_000);
  });

  it("ignora referencias chap a pistas de imagen y elige la de texto", () => {
    const image = trak({
      id: 2,
      handler: "vide",
      timescale: 1,
      stbl: [stts([1, 1]), stsc([1, 1]), stsz(4000), stco(100)],
    });
    const text = trak({
      id: 3,
      handler: "text",
      timescale: 1,
      stbl: [stts([1, 1]), stsc([1, 1]), stsz(7), stco(200)],
    });
    const info = parseMovie(moov(mvhd(1, 1), audioTrak([2, 3]), image, text));
    expect(info.chapterSamples).toEqual([{ offset: 200, size: 7, time: 0 }]);
  });

  it("sin tref usa la primera pista de texto", () => {
    const text = trak({
      id: 5,
      handler: "text",
      timescale: 10,
      stbl: [stts([2, 50]), stsc([1, 1]), stsz(3, 4), stco(10, 20)],
    });
    const info = parseMovie(moov(mvhd(10, 100), audioTrak(), text));
    expect(info.chapterSamples.map((sample) => sample.time)).toEqual([0, 5]);
  });

  it("aplica el desfase de ctts", () => {
    const text = trak({
      id: 2,
      handler: "text",
      timescale: 1,
      stbl: [
        stts([2, 10]),
        fullBox("ctts", 0, u32(1), u32(2), u32(3)),
        stsc([1, 1]),
        stsz(1, 1),
        stco(0, 1),
      ],
    });
    const info = parseMovie(moov(mvhd(1, 20), audioTrak([2]), text));
    expect(info.chapterSamples.map((sample) => sample.time)).toEqual([3, 13]);
  });

  it("no hay capítulos si sólo existe la pista de audio", () => {
    expect(parseMovie(moov(mvhd(1, 1), audioTrak())).chapterSamples).toEqual([]);
  });

  it("acota tablas truncadas sin lanzar", () => {
    // stsz declara 1000 muestras pero sólo trae 2.
    const truncated = fullBox("stsz", 0, u32(0), u32(1000), u32(5), u32(6));
    const text = trak({
      id: 2,
      handler: "text",
      timescale: 1,
      stbl: [stts([1000, 1]), stsc([1, 1000]), truncated, stco(0)],
    });
    const info = parseMovie(moov(mvhd(1, 1), audioTrak([2]), text));
    expect(info.chapterSamples).toHaveLength(2);
  });

  it("tolera entradas corruptas", () => {
    expect(parseMovie(new Uint8Array([1, 2, 3]))).toEqual({ duration: 0, chapterSamples: [] });
    expect(parseMovie(concat([u32(16), ascii("free"), zeros(8)])).chapterSamples).toEqual([]);
    const broken = box("moov", mvhd(1, 1), box("trak", box("tkhd", zeros(2))));
    expect(() => parseMovie(broken)).not.toThrow();
  });
});
