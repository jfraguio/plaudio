import type { Artwork } from "../types";
import { childBoxes, findChild, readBox, readBoxes, type RawBox } from "./boxreader";

export interface IlstData {
  text: Record<string, string>;
  freeform: Record<string, string>;
  artwork?: Artwork;
}

function metaChildrenStart(bytes: Uint8Array, meta: RawBox): number {
  // `meta` es FullBox en MP4 estándar (4 bytes version/flags) y no lo es en QT.
  if (meta.contentStart + 4 <= meta.end) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(meta.contentStart) === 0) return meta.contentStart + 4;
  }
  return meta.contentStart;
}

function decodeText(payload: Uint8Array): string {
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) end -= 1;
  return new TextDecoder("utf-8").decode(payload.subarray(0, end));
}

function mimeFromDataType(dataType: number): string | undefined {
  switch (dataType) {
    case 13:
      return "image/jpeg";
    case 14:
      return "image/png";
    case 27:
      return "image/bmp";
    default:
      return undefined;
  }
}

function mimeFromMagic(payload: Uint8Array): string {
  if (payload[0] === 0xff && payload[1] === 0xd8) return "image/jpeg";
  if (payload[0] === 0x89 && payload[1] === 0x50) return "image/png";
  if (payload[0] === 0x47 && payload[1] === 0x49) return "image/gif";
  if (payload[0] === 0x42 && payload[1] === 0x4d) return "image/bmp";
  return "image/jpeg";
}

function parseIlstBox(bytes: Uint8Array, ilst: RawBox, data: IlstData): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (const item of readBoxes(bytes, ilst.contentStart, ilst.end)) {
    const children = childBoxes(bytes, item);
    const dataBox = children.find((box) => box.type === "data");

    if (item.type === "----") {
      const nameBox = children.find((box) => box.type === "name");
      if (nameBox && dataBox) {
        const name = decodeText(bytes.subarray(nameBox.contentStart + 4, nameBox.end));
        const value = decodeText(bytes.subarray(dataBox.contentStart + 8, dataBox.end));
        if (name) data.freeform[name] = value;
      }
      continue;
    }

    if (!dataBox) continue;

    const dataType = view.getUint32(dataBox.contentStart);
    const payload = bytes.subarray(dataBox.contentStart + 8, dataBox.end);

    if (item.type === "covr") {
      if (!data.artwork) {
        data.artwork = {
          bytes: payload.slice(),
          mime: mimeFromDataType(dataType) ?? mimeFromMagic(payload),
        };
      }
      continue;
    }

    if (dataType === 1 || dataType === 0 || dataType === 21) {
      data.text[item.type] = decodeText(payload);
    }
  }
}

/**
 * Extrae la metadata estilo iTunes (`udta/meta/ilst`) del buffer del `moov`,
 * que MP4Box no expone en esta versión.
 */
export function parseIlst(moov: Uint8Array): IlstData {
  const data: IlstData = { text: {}, freeform: {} };

  const moovBox = readBox(moov, 0);
  if (!moovBox) return data;

  const topBoxes = readBoxes(moov, moovBox.contentStart, moovBox.end);
  const candidates: RawBox[] = [];

  const moovUdta = topBoxes.find((box) => box.type === "udta");
  if (moovUdta) candidates.push(moovUdta);

  for (const trak of topBoxes.filter((box) => box.type === "trak")) {
    const trakUdta = findChild(moov, trak, "udta");
    if (trakUdta) candidates.push(trakUdta);
  }

  for (const udta of candidates) {
    const meta = findChild(moov, udta, "meta");
    if (!meta) continue;
    const ilst = readBoxes(moov, metaChildrenStart(moov, meta), meta.end).find(
      (box) => box.type === "ilst",
    );
    if (ilst) {
      parseIlstBox(moov, ilst, data);
      if (Object.keys(data.text).length > 0 || data.artwork) break;
    }
  }

  return data;
}
