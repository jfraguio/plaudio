import { describe, expect, it } from "vitest";
import { loadBookMetadata } from "../metadata";
import { parseMoov, readChapters } from "./parse";
import { ascii, box, byteBlob, concat, fullBox, textItem, u32 } from "./test-boxes";

const zeros = (length: number) => new Uint8Array(length);

function tx3g(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  return concat([new Uint8Array([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

function trak(id: number, handler: string, timescale: number, extra: Uint8Array[], stbl: Uint8Array[]) {
  return box(
    "trak",
    fullBox("tkhd", 7, u32(0), u32(0), u32(id), zeros(68)),
    ...extra,
    box(
      "mdia",
      fullBox("mdhd", 0, u32(0), u32(0), u32(timescale), u32(0), zeros(4)),
      fullBox("hdlr", 0, u32(0), ascii(handler), zeros(13)),
      box("minf", box("stbl", ...stbl)),
    ),
  );
}

/**
 * Archivo M4B mínimo: ftyp + mdat (textos de capítulo, opcionalmente separados
 * por relleno) + moov al final, como en los audiolibros reales.
 */
function buildBook(options: {
  titles: string[];
  startsMs: number[];
  durationMs: number;
  gap?: number;
  ilst?: Uint8Array[];
}): Blob {
  const ftyp = box("ftyp", ascii("M4B "), u32(512), ascii("isomM4B "));
  const gap = zeros(options.gap ?? 0);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = ftyp.length + 8;
  for (const title of options.titles) {
    const sample = tx3g(title);
    offsets.push(cursor);
    parts.push(sample, gap);
    cursor += sample.length + gap.length;
  }
  const mdat = box("mdat", ...parts);

  const deltas = options.startsMs.map((start, index) =>
    (options.startsMs[index + 1] ?? options.durationMs) - start,
  );
  const textTrak = trak(2, "text", 1000, [], [
    fullBox("stts", 0, u32(deltas.length), ...deltas.flatMap((delta) => [u32(1), u32(delta)])),
    fullBox("stsc", 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, u32(0), u32(options.titles.length), ...options.titles.map((t) => u32(tx3g(t).length))),
    fullBox("stco", 0, u32(offsets.length), ...offsets.map(u32)),
  ]);
  const audioTrak = trak(1, "soun", 44100, [box("tref", box("chap", u32(2)))], []);
  const udta = options.ilst
    ? [box("udta", fullBox("meta", 0, fullBox("hdlr", 0, u32(0), ascii("mdir"), zeros(13)), box("ilst", ...options.ilst)))]
    : [];
  const moov = box(
    "moov",
    fullBox("mvhd", 0, u32(0), u32(0), u32(1000), u32(options.durationMs), zeros(80)),
    audioTrak,
    textTrak,
    ...udta,
  );
  return byteBlob([ftyp, mdat, moov]);
}

describe("parseMoov + readChapters", () => {
  const titles = ["Prólogo", "Capítulo 1: El inicio", "Epílogo"];
  const startsMs = [0, 90_000, 200_000];

  it("lee títulos y límites de los capítulos desde la pista de texto", async () => {
    const file = buildBook({ titles, startsMs, durationMs: 300_000 });
    const parsed = await parseMoov(file);
    expect(parsed.duration).toBe(300);
    expect(await readChapters(file, parsed)).toEqual([
      { title: "Prólogo", startTime: 0, endTime: 90 },
      { title: "Capítulo 1: El inicio", startTime: 90, endTime: 200 },
      { title: "Epílogo", startTime: 200, endTime: 300 },
    ]);
  });

  it("lee muestras dispersas (más de 1 MiB entre ellas) por separado", async () => {
    const file = buildBook({ titles, startsMs, durationMs: 300_000, gap: 700 * 1024 });
    const chapters = await readChapters(file, await parseMoov(file));
    expect(chapters.map((chapter) => chapter.title)).toEqual(titles);
  });

  it("usa un título genérico si la muestra apunta fuera del archivo", async () => {
    const file = buildBook({ titles: ["Uno"], startsMs: [0], durationMs: 10_000 });
    const parsed = await parseMoov(file);
    parsed.chapterSamples[0]!.offset = file.size + 100;
    const chapters = await readChapters(file, parsed);
    expect(chapters).toEqual([{ title: "Chapter 1", startTime: 0, endTime: 10 }]);
  });
});

describe("loadBookMetadata", () => {
  it("entrega metadata y capítulos por separado", async () => {
    const blob = buildBook({
      titles: ["A", "B"],
      startsMs: [0, 5_000],
      durationMs: 10_000,
      ilst: [textItem("\u00A9nam", "Mi novela"), textItem("\u00A9ART", "Autora")],
    });
    const file = new File([blob], "mi-novela.m4b");
    const load = loadBookMetadata(file);
    expect(await load.metadata).toMatchObject({ title: "Mi novela", author: "Autora", duration: 10 });
    expect((await load.chapters).map((chapter) => chapter.title)).toEqual(["A", "B"]);
  });

  it("degrada al nombre de archivo y sin capítulos si no hay moov", async () => {
    const file = new File([byteBlob([box("mdat", zeros(64))])], "otra_novela.m4b");
    const load = loadBookMetadata(file);
    expect(await load.metadata).toEqual({ title: "otra novela" });
    expect(await load.chapters).toEqual([]);
  });
});
