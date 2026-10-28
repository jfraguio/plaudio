import type { Chapter } from "../types";
import { locateMoov } from "./atoms";
import { readBoxes, type RawBox } from "./boxreader";
import { parseIlst, type IlstData } from "./ilst";
import { parseMovie, type SampleRef } from "./movie";

export interface ParsedMoov {
  /** Duración en segundos (0 si no se conoce). */
  duration: number;
  ilst: IlstData;
  chapterSamples: SampleRef[];
  /** Bytes del `moov`, necesarios para el fallback de capítulos `chpl`. */
  moov: Uint8Array;
}

const MAX_CHAPTER_SAMPLE_BYTES = 128 * 1024;
/** Si todas las muestras de capítulo caben en este tramo, se leen de una vez. */
const MAX_COALESCED_READ = 1024 * 1024;

async function readBytes(file: Blob, start: number, size: number): Promise<Uint8Array> {
  const buffer = await file.slice(start, start + size).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Fase rápida: localiza y lee el `moov`, y extrae metadata, duración y la
 * ubicación de los títulos de capítulo. No lee nada de `mdat`.
 */
export async function parseMoov(file: Blob): Promise<ParsedMoov> {
  const layout = await locateMoov(file);
  const moov = await readBytes(file, layout.moov.start, layout.moov.size);
  const movie = parseMovie(moov);
  return {
    duration: movie.duration,
    ilst: parseIlst(moov),
    chapterSamples: movie.chapterSamples,
    moov,
  };
}

/** Fase lenta: lee los títulos de capítulo (pista `tx3g` o, si no hay, `chpl`). */
export async function readChapters(file: Blob, parsed: ParsedMoov): Promise<Chapter[]> {
  let chapters = await readChaptersFromSamples(file, parsed.chapterSamples, parsed.duration);
  if (chapters.length === 0) {
    chapters = parseChpl(parsed.moov);
    if (chapters.length > 0 && parsed.duration > 0) {
      chapters[chapters.length - 1]!.endTime = parsed.duration;
    }
  }
  return chapters;
}

function decodeTx3g(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let payload = bytes;
  if (bytes.length >= 2) {
    const length = (bytes[0]! << 8) | bytes[1]!;
    if (length > 0 && length <= bytes.length - 2) payload = bytes.subarray(2, 2 + length);
  }
  if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(payload.subarray(2));
  }
  if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(payload.subarray(2));
  }
  return new TextDecoder("utf-8").decode(payload);
}

/** Lee los textos de las muestras: una sola lectura si están juntas, si no en paralelo. */
async function readSampleTitles(file: Blob, samples: SampleRef[]): Promise<string[]> {
  const readable = samples.map(
    (sample) =>
      sample.size > 0 &&
      sample.size <= MAX_CHAPTER_SAMPLE_BYTES &&
      sample.offset + sample.size <= file.size,
  );
  const indices = samples.map((_, index) => index).filter((index) => readable[index]);
  if (indices.length === 0) return samples.map(() => "");

  const start = Math.min(...indices.map((index) => samples[index]!.offset));
  const end = Math.max(...indices.map((index) => samples[index]!.offset + samples[index]!.size));

  if (end - start <= MAX_COALESCED_READ) {
    const block = await readBytes(file, start, end - start);
    return samples.map((sample, index) =>
      readable[index]
        ? decodeTx3g(block.subarray(sample.offset - start, sample.offset - start + sample.size)).trim()
        : "",
    );
  }

  return Promise.all(
    samples.map(async (sample, index) => {
      if (!readable[index]) return "";
      try {
        return decodeTx3g(await readBytes(file, sample.offset, sample.size)).trim();
      } catch {
        return "";
      }
    }),
  );
}

async function readChaptersFromSamples(
  file: Blob,
  samples: SampleRef[],
  duration: number,
): Promise<Chapter[]> {
  if (samples.length === 0) return [];

  let titles: string[];
  try {
    titles = await readSampleTitles(file, samples);
  } catch {
    titles = samples.map(() => "");
  }

  const chapters: Chapter[] = samples.map((sample, index) => ({
    title: titles[index] ?? "",
    startTime: Math.max(0, sample.time),
  }));
  chapters.sort((a, b) => a.startTime - b.startTime);
  chapters.forEach((chapter, index) => {
    const next = chapters[index + 1];
    if (next) chapter.endTime = next.startTime;
    else if (duration > 0) chapter.endTime = duration;
    if (!chapter.title) chapter.title = `Chapter ${index + 1}`;
  });
  return chapters;
}

function parseChpl(moov: Uint8Array): Chapter[] {
  const moovBox = readBoxes(moov, 0, moov.length)[0];
  if (!moovBox) return [];
  const findChpl = (boxes: RawBox[]): RawBox | undefined => {
    for (const box of boxes) {
      if (box.type === "chpl") return box;
      if (box.type === "udta" || box.type === "trak" || box.type === "mdia" || box.type === "moov") {
        const nested = readBoxes(moov, box.contentStart, box.end);
        const found = findChpl(nested);
        if (found) return found;
      }
    }
    return undefined;
  };

  const chpl = findChpl([moovBox]);
  if (!chpl) return [];

  try {
    const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    let pos = chpl.contentStart;
    const version = moov[pos] ?? 0;
    pos += 4; // version + flags
    let count: number;
    if (version > 0) {
      count = view.getUint32(pos);
      pos += 4;
    } else {
      count = moov[pos] ?? 0;
      pos += 1;
    }
    const chapters: Chapter[] = [];
    for (let i = 0; i < count && pos + 9 <= chpl.end; i += 1) {
      const start = Number(view.getBigUint64(pos));
      pos += 8;
      const length = moov[pos] ?? 0;
      pos += 1;
      const title = new TextDecoder("utf-8").decode(moov.subarray(pos, pos + length)).trim();
      pos += length;
      chapters.push({ title: title || `Chapter ${i + 1}`, startTime: start / 10_000_000 });
    }
    chapters.sort((a, b) => a.startTime - b.startTime);
    return chapters;
  } catch {
    return [];
  }
}
