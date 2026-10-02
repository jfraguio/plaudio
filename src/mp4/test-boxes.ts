export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

export function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0) & 0xff));
}

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const content = concat(payload);
  return concat([u32(8 + content.length), ascii(type), content]);
}

export function fullBox(type: string, versionFlags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, concat([u32(versionFlags), ...payload]));
}

export function dataBox(dataType: number, content: Uint8Array): Uint8Array {
  return box("data", concat([u32(dataType), u32(0), content]));
}

export function textItem(type: string, value: string): Uint8Array {
  return box(type, dataBox(1, ascii(value)));
}

export function byteBlob(parts: Uint8Array[]): Blob {
  const bytes = concat(parts);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer]);
}
