import { createFile, type Movie, type Sample } from "mp4box";
import type { Chapter } from "../types";
import { buildDefaultFtyp, locateMoov, type MoovLayout } from "./atoms";
import { readBoxes, type RawBox } from "./boxreader";
import { parseIlst, type IlstData } from "./ilst";

export interface ParsedMp4 {
  duration: number;
  chapters: Chapter[];
  ilst: IlstData;
  chapterTrackId?: number;
  codec?: string;
}

const MAX_CHAPTER_SAMPLE_BYTES = 128 * 1024;

function withSilencedConsole<T>(fn: () => T): T {
  const original = { error: console.error, warn: console.warn, log: console.log };
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    console.log = original.log;
  }
}

async function readBytes(file: Blob, start: number, size: number): Promise<Uint8Array> {
  const buffer = await file.slice(start, start + size).arrayBuffer();
  return new Uint8Array(buffer);
}

async function parseWithMp4box(
  file: Blob,
  layout: MoovLayout,
  moovBytes: Uint8Array,
): Promise<{ movie: Movie; iso: ReturnType<typeof createFile> }> {
  let header: Uint8Array;
  if (layout.ftyp) {
    header = await readBytes(file, layout.ftyp.start, layout.ftyp.size);
  } else {
    header = buildDefaultFtyp();
  }

  const combined = new Uint8Array(header.byteLength + moovBytes.byteLength);
  combined.set(header, 0);
  combined.set(moovBytes, header.byteLength);

  const buffer = combined.buffer as ArrayBuffer & { fileStart: number };
  buffer.fileStart = 0;

  const iso = createFile();
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MOOV_PARSE_TIMEOUT")), 20000);
    iso.onReady = (info: Movie) => {
      clearTimeout(timeout);
      resolve({ movie: info, iso });
    };
    iso.onError = () => {
      /* MP4Box avisa de cajas no reconocidas (p. ej. ilst); se ignora. */
    };
    try {
      withSilencedConsole(() => {
        iso.appendBuffer(buffer as never, true);
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function findChapterTrackId(movie: Movie): number | undefined {
  const audio = movie.audioTracks[0] ?? movie.tracks.find((track) => track.type === "audio");
  const reference = audio?.references?.find((ref) => ref.type === "chap");
  if (reference) {
    const ids = Array.from(reference.track_ids as ArrayLike<number>);
    if (ids.length > 0) return ids[0];
  }
  const textTrack = movie.tracks.find((track) => track.codec === "text");
  return textTrack?.id;
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

async function readChaptersFromSamples(
  file: Blob,
  iso: ReturnType<typeof createFile>,
  trackId: number,
  duration: number,
): Promise<Chapter[]> {
  let samples: Sample[];
  try {
    samples = iso.getTrackSamplesInfo(trackId);
  } catch {
    return [];
  }
  if (!samples || samples.length === 0) return [];

  const chapters: Chapter[] = [];
  for (const sample of samples) {
    const startTime = sample.timescale > 0 ? sample.cts / sample.timescale : 0;
    let title = "";
    if (sample.size > 0 && sample.size <= MAX_CHAPTER_SAMPLE_BYTES) {
      try {
        const bytes = await readBytes(file, sample.offset, sample.size);
        title = decodeTx3g(bytes).trim();
      } catch {
        /* título no disponible */
      }
    }
    chapters.push({ title, startTime });
  }

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
      const title = decodeTx3gBytes(moov.subarray(pos, pos + length));
      pos += length;
      chapters.push({ title: title || `Chapter ${i + 1}`, startTime: start / 10_000_000 });
    }
    chapters.sort((a, b) => a.startTime - b.startTime);
    return chapters;
  } catch {
    return [];
  }
}

function decodeTx3gBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).trim();
}

export async function parseMp4(file: Blob): Promise<ParsedMp4> {
  const layout = await locateMoov(file);
  const moovBytes = await readBytes(file, layout.moov.start, layout.moov.size);
  const ilst = parseIlst(moovBytes);

  let movie: Movie | undefined;
  let iso: ReturnType<typeof createFile> | undefined;
  try {
    const parsed = await parseWithMp4box(file, layout, moovBytes);
    movie = parsed.movie;
    iso = parsed.iso;
  } catch (error) {
    console.warn("[plaudio] no se pudo parsear el moov con MP4Box", error);
  }

  let duration = 0;
  let chapterTrackId: number | undefined;
  let chapters: Chapter[] = [];

  if (movie && iso) {
    duration = movie.timescale > 0 ? movie.duration / movie.timescale : 0;
    chapterTrackId = findChapterTrackId(movie);
    if (chapterTrackId !== undefined) {
      chapters = await readChaptersFromSamples(file, iso, chapterTrackId, duration);
    }
  }

  if (chapters.length === 0) {
    chapters = parseChpl(moovBytes);
    if (chapters.length > 0 && duration > 0) {
      chapters[chapters.length - 1]!.endTime = duration;
    }
  }

  return {
    duration,
    chapters,
    ilst,
    chapterTrackId,
    codec: movie?.audioTracks[0]?.codec,
  };
}
