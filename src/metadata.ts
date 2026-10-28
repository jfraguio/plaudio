import { parseMoov, readChapters, type ParsedMoov } from "./mp4/parse";
import type { BookMetadata, Chapter } from "./types";
import { titleFromFilename } from "./utils";

const TITLE_KEYS = ["\u00A9nam", "@sti", "\u00A9alb", "\u00A9@alb"];
const AUTHOR_KEYS = ["\u00A9ART", "aART", "\u00A9aut", "\u00A9wrt", "\u00A9nrt", "\u00A9cpr"];

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function toMetadata(file: File, parsed: ParsedMoov): BookMetadata {
  const { text, freeform } = parsed.ilst;
  return {
    title:
      firstNonEmpty(TITLE_KEYS.map((key) => text[key])) ??
      clean(freeform["TITLE"]) ??
      clean(freeform["\u00A9nam"]) ??
      titleFromFilename(file.name),
    author:
      firstNonEmpty(AUTHOR_KEYS.map((key) => text[key])) ??
      clean(freeform["AUTHOR"]) ??
      clean(freeform["ARTIST"]),
    subtitle: clean(freeform["SUBTITLE"]) ?? clean(text["\u00A9sub"]),
    artwork: parsed.ilst.artwork,
    duration: parsed.duration > 0 ? parsed.duration : undefined,
  };
}

export interface MetadataLoad {
  /** Título, autor, carátula y duración: sólo requiere leer el `moov` (milisegundos). */
  metadata: Promise<BookMetadata>;
  /** Capítulos: requiere además leer los títulos desde `mdat`. Nunca rechaza. */
  chapters: Promise<Chapter[]>;
}

/**
 * Lee metadata y capítulos del contenedor MP4/M4A/M4B en dos fases, para que
 * título y carátula no esperen a los capítulos. Nunca lee el audio.
 */
export function loadBookMetadata(file: File): MetadataLoad {
  const parsed = parseMoov(file);

  const metadata = parsed
    .then((moov) => toMetadata(file, moov))
    .catch((error: unknown) => {
      console.warn("[plaudio] no se pudo leer la metadata", error);
      return { title: titleFromFilename(file.name) } satisfies BookMetadata;
    });

  const chapters = parsed
    .then((moov) => readChapters(file, moov))
    .catch(() => [] as Chapter[]);

  return { metadata, chapters };
}
