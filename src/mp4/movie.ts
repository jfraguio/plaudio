import { childBoxes, findChild, readBox, type RawBox } from "./boxreader";

/**
 * Lectura mínima del `moov`: duración y muestras de la pista de capítulos.
 *
 * Sólo se decodifican las tablas de la pista de capítulos (decenas de
 * entradas). Las de la pista de audio (millones de entradas en un libro
 * largo) nunca se recorren: ése era el coste dominante con MP4Box.
 */

export interface SampleRef {
  /** Posición absoluta de la muestra en el archivo. */
  offset: number;
  size: number;
  /** Instante de presentación en segundos. */
  time: number;
}

export interface MovieInfo {
  /** Duración en segundos según `mvhd` (0 si no se conoce). */
  duration: number;
  /** Muestras de la pista de capítulos `tx3g`/`text`, si existe. */
  chapterSamples: SampleRef[];
}

/** Límite defensivo: ningún audiolibro real tiene tantos capítulos. */
const MAX_CHAPTER_SAMPLES = 10_000;

const TEXT_HANDLERS = new Set(["text", "sbtl", "subt"]);

interface Track {
  id: number;
  handler: string;
  chapterRefs: number[];
  timescale: number;
  stbl?: RawBox;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Número de entradas declarado, acotado a las que caben realmente en la caja. */
function entryCount(view: DataView, box: RawBox, headerBytes: number, entrySize: number): number {
  const declared = view.getUint32(box.contentStart + headerBytes - 4);
  const available = Math.floor((box.end - box.contentStart - headerBytes) / entrySize);
  return Math.max(0, Math.min(declared, available));
}

function readUint64(view: DataView, pos: number): number {
  return Number(view.getBigUint64(pos));
}

function parseMvhdDuration(bytes: Uint8Array, mvhd: RawBox): number {
  const view = viewOf(bytes);
  const version = bytes[mvhd.contentStart];
  const base = mvhd.contentStart + 4;
  const timescale = version === 1 ? view.getUint32(base + 16) : view.getUint32(base + 8);
  const duration = version === 1 ? readUint64(view, base + 20) : view.getUint32(base + 12);
  return timescale > 0 ? duration / timescale : 0;
}

function parseTrack(bytes: Uint8Array, trak: RawBox): Track | undefined {
  const view = viewOf(bytes);
  const tkhd = findChild(bytes, trak, "tkhd");
  const mdia = findChild(bytes, trak, "mdia");
  if (!tkhd || !mdia) return undefined;

  const tkhdVersion = bytes[tkhd.contentStart];
  const id = view.getUint32(tkhd.contentStart + 4 + (tkhdVersion === 1 ? 16 : 8));

  const chapterRefs: number[] = [];
  const tref = findChild(bytes, trak, "tref");
  const chap = tref ? findChild(bytes, tref, "chap") : undefined;
  if (chap) {
    for (let pos = chap.contentStart; pos + 4 <= chap.end; pos += 4) {
      chapterRefs.push(view.getUint32(pos));
    }
  }

  let timescale = 0;
  const mdhd = findChild(bytes, mdia, "mdhd");
  if (mdhd) {
    const version = bytes[mdhd.contentStart];
    timescale = view.getUint32(mdhd.contentStart + 4 + (version === 1 ? 16 : 8));
  }

  const hdlr = findChild(bytes, mdia, "hdlr");
  let handler = "";
  if (hdlr && hdlr.contentStart + 12 <= hdlr.end) {
    const at = hdlr.contentStart + 8;
    handler = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  }

  const minf = findChild(bytes, mdia, "minf");
  const stbl = minf ? findChild(bytes, minf, "stbl") : undefined;
  return { id, handler, chapterRefs, timescale, stbl };
}

/**
 * Pista de capítulos: la de texto referenciada por `tref/chap` de la pista de
 * audio (`chap` puede apuntar también a imágenes, que se descartan); si no hay
 * referencia de texto, la primera pista de texto.
 */
function pickChapterTrack(tracks: Track[]): Track | undefined {
  const isText = (track: Track) => TEXT_HANDLERS.has(track.handler);
  const audio = tracks.find((track) => track.handler === "soun");
  const referenced = (audio?.chapterRefs ?? [])
    .map((id) => tracks.find((track) => track.id === id))
    .find((track) => track !== undefined && isText(track));
  return referenced ?? tracks.find(isText);
}

/** Expande `stsc` + `stco`/`co64` + `stsz` + `stts`/`ctts` a muestras concretas. */
function readSamples(bytes: Uint8Array, stbl: RawBox, timescale: number): SampleRef[] {
  if (timescale <= 0) return [];
  const view = viewOf(bytes);
  const boxes = childBoxes(bytes, stbl);
  const get = (type: string) => boxes.find((box) => box.type === type);

  const stsz = get("stsz");
  const stsc = get("stsc");
  const stts = get("stts");
  const stco = get("stco");
  const co64 = get("co64");
  if (!stsz || !stsc || !stts || (!stco && !co64)) return [];

  // Tamaños.
  const fixedSize = view.getUint32(stsz.contentStart + 4);
  const declaredSamples = view.getUint32(stsz.contentStart + 8);
  const sampleCount = Math.min(
    declaredSamples,
    MAX_CHAPTER_SAMPLES,
    fixedSize === 0 ? entryCount(view, stsz, 12, 4) : declaredSamples,
  );
  const sizeOf = (index: number) =>
    fixedSize !== 0 ? fixedSize : view.getUint32(stsz.contentStart + 12 + index * 4);

  // Offsets de chunk.
  const chunkBox = (co64 ?? stco)!;
  const chunkEntry = co64 ? 8 : 4;
  const chunkCount = entryCount(view, chunkBox, 8, chunkEntry);
  const chunkOffset = (index: number) => {
    const pos = chunkBox.contentStart + 8 + index * chunkEntry;
    return co64 ? readUint64(view, pos) : view.getUint32(pos);
  };

  // Muestras por chunk (tramos).
  const runs: Array<{ firstChunk: number; perChunk: number }> = [];
  const stscCount = entryCount(view, stsc, 8, 12);
  for (let i = 0; i < stscCount; i += 1) {
    const pos = stsc.contentStart + 8 + i * 12;
    runs.push({ firstChunk: view.getUint32(pos), perChunk: view.getUint32(pos + 4) });
  }

  const samples: SampleRef[] = [];
  let runIndex = 0;
  for (let chunk = 1; chunk <= chunkCount && samples.length < sampleCount; chunk += 1) {
    while (runIndex + 1 < runs.length && runs[runIndex + 1]!.firstChunk <= chunk) runIndex += 1;
    const perChunk = runs[runIndex]?.perChunk ?? 0;
    let offset = chunkOffset(chunk - 1);
    for (let i = 0; i < perChunk && samples.length < sampleCount; i += 1) {
      const size = sizeOf(samples.length);
      samples.push({ offset, size, time: 0 });
      offset += size;
    }
  }

  // Tiempos de decodificación.
  let dts = 0;
  let index = 0;
  const sttsCount = entryCount(view, stts, 8, 8);
  for (let i = 0; i < sttsCount && index < samples.length; i += 1) {
    const pos = stts.contentStart + 8 + i * 8;
    const count = view.getUint32(pos);
    const delta = view.getUint32(pos + 4);
    for (let j = 0; j < count && index < samples.length; j += 1) {
      samples[index]!.time = dts;
      dts += delta;
      index += 1;
    }
  }

  // Desfase de presentación (raro en pistas de texto, pero barato de soportar).
  const ctts = get("ctts");
  if (ctts) {
    const signed = bytes[ctts.contentStart] === 1;
    const cttsCount = entryCount(view, ctts, 8, 8);
    index = 0;
    for (let i = 0; i < cttsCount && index < samples.length; i += 1) {
      const pos = ctts.contentStart + 8 + i * 8;
      const count = view.getUint32(pos);
      const shift = signed ? view.getInt32(pos + 4) : view.getUint32(pos + 4);
      for (let j = 0; j < count && index < samples.length; j += 1) {
        samples[index]!.time += shift;
        index += 1;
      }
    }
  }

  for (const sample of samples) sample.time /= timescale;
  return samples;
}

export function parseMovie(moov: Uint8Array): MovieInfo {
  const info: MovieInfo = { duration: 0, chapterSamples: [] };
  const moovBox = readBox(moov, 0);
  if (!moovBox || moovBox.type !== "moov") return info;

  const top = childBoxes(moov, moovBox);
  const mvhd = top.find((box) => box.type === "mvhd");
  try {
    if (mvhd) info.duration = parseMvhdDuration(moov, mvhd);
  } catch {
    /* mvhd truncado: duración desconocida */
  }

  try {
    const tracks = top
      .filter((box) => box.type === "trak")
      .map((trak) => parseTrack(moov, trak))
      .filter((track): track is Track => Boolean(track));
    const chapterTrack = pickChapterTrack(tracks);
    if (chapterTrack?.stbl) {
      info.chapterSamples = readSamples(moov, chapterTrack.stbl, chapterTrack.timescale);
    }
  } catch {
    /* tablas corruptas o truncadas: sin capítulos de pista */
    info.chapterSamples = [];
  }
  return info;
}
