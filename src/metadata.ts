import { parseMp4 } from "./mp4/parse";
import type { BookMetadata } from "./types";
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

/**
 * Lee metadata, carátula y capítulos del contenedor MP4/M4A/M4B leyendo
 * únicamente el átomo `moov` y los samples de la pista de capítulos.
 */
export async function loadBookMetadata(file: File): Promise<BookMetadata> {
  try {
    const parsed = await parseMp4(file);
    const text = parsed.ilst.text;
    const freeform = parsed.ilst.freeform;

    const title =
      firstNonEmpty(TITLE_KEYS.map((key) => text[key])) ??
      clean(freeform["TITLE"]) ??
      clean(freeform["\u00A9nam"]) ??
      titleFromFilename(file.name);

    const author =
      firstNonEmpty(AUTHOR_KEYS.map((key) => text[key])) ??
      clean(freeform["AUTHOR"]) ??
      clean(freeform["ARTIST"]);

    const subtitle =
      clean(freeform["SUBTITLE"]) ?? clean(text["\u00A9sub"]) ?? undefined;

    return {
      title,
      author,
      subtitle,
      artwork: parsed.ilst.artwork,
      duration: parsed.duration > 0 ? parsed.duration : undefined,
      chapters: parsed.chapters,
    };
  } catch (error) {
    console.warn("[plaudio] no se pudo leer la metadata", error);
    return { title: titleFromFilename(file.name), chapters: [] };
  }
}
