export interface RawBox {
  type: string;
  start: number;
  size: number;
  contentStart: number;
  end: number;
}

export function fourcc(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!, bytes[pos + 3]!);
}

export function readBox(bytes: Uint8Array, pos: number): RawBox | null {
  if (pos + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(pos);
  const type = fourcc(bytes, pos + 4);
  let contentStart = pos + 8;
  if (size === 1) {
    if (pos + 16 > bytes.length) return null;
    size = Number(view.getBigUint64(pos + 8));
    contentStart = pos + 16;
  } else if (size === 0) {
    size = bytes.length - pos;
  }
  if (size < contentStart - pos) return null;
  const end = Math.min(pos + size, bytes.length);
  return { type, start: pos, size, contentStart, end };
}

export function readBoxes(bytes: Uint8Array, start: number, end: number): RawBox[] {
  const result: RawBox[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const box = readBox(bytes, pos);
    if (!box) break;
    result.push(box);
    if (box.end <= pos) break;
    pos = box.end;
  }
  return result;
}

export function childBoxes(bytes: Uint8Array, parent: RawBox): RawBox[] {
  return readBoxes(bytes, parent.contentStart, parent.end);
}

export function findChild(
  bytes: Uint8Array,
  parent: RawBox,
  type: string,
): RawBox | undefined {
  return childBoxes(bytes, parent).find((box) => box.type === type);
}
