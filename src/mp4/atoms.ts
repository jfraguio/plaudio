export interface BoxInfo {
  type: string;
  start: number;
  size: number;
  headerSize: number;
}

export interface MoovLayout {
  fileSize: number;
  moov: BoxInfo;
  ftyp?: BoxInfo;
  boxes: BoxInfo[];
}

const HEADER_PEEK = 16;

async function readBoxHeader(
  file: Blob,
  pos: number,
): Promise<{ size: number; type: string; headerSize: number } | null> {
  const end = Math.min(pos + HEADER_PEEK, file.size);
  if (end - pos < 8) return null;

  const bytes = new Uint8Array(await file.slice(pos, end).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let size = view.getUint32(0);
  const type = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  let headerSize = 8;

  if (size === 1) {
    if (bytes.byteLength < 16) return null;
    size = Number(view.getBigUint64(8));
    headerSize = 16;
  } else if (size === 0) {
    size = file.size - pos;
  }

  if (!Number.isFinite(size) || size < headerSize) return null;
  return { size, type, headerSize };
}

/**
 * Escanea únicamente las cabeceras de los átomos de nivel superior hasta
 * encontrar `moov`, sin leer el contenido de `mdat`. Imprescindible para
 * archivos de varios GB.
 */
export async function locateMoov(file: Blob): Promise<MoovLayout> {
  const boxes: BoxInfo[] = [];
  let pos = 0;
  let ftyp: BoxInfo | undefined;

  while (pos + 8 <= file.size) {
    const header = await readBoxHeader(file, pos);
    if (!header) break;

    const box: BoxInfo = {
      type: header.type,
      start: pos,
      size: header.size,
      headerSize: header.headerSize,
    };
    boxes.push(box);

    if (box.type === "ftyp" && !ftyp) ftyp = box;
    if (box.type === "moov") {
      return { fileSize: file.size, moov: box, ftyp, boxes };
    }

    pos += box.size;
  }

  throw new Error("MOOV_NOT_FOUND");
}

export function buildDefaultFtyp(): Uint8Array {
  const brands = ["isom", "iso2", "mp41", "M4A ", "M4B "];
  const size = 16 + brands.length * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  bytes.set([0x69, 0x73, 0x6f, 0x6d], 8); // isom
  view.setUint32(12, 512);
  brands.forEach((brand, index) => {
    bytes.set(
      [brand.charCodeAt(0), brand.charCodeAt(1), brand.charCodeAt(2), brand.charCodeAt(3)],
      16 + index * 4,
    );
  });
  return bytes;
}
