interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

type OpenFilePicker = (
  options?: OpenFilePickerOptions,
) => Promise<FileSystemFileHandle[]>;

interface PermissionCapableHandle extends FileSystemFileHandle {
  queryPermission?(descriptor?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export interface PickedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

const AUDIOBOOK_TYPES = [
  {
    description: "Audiobooks",
    accept: {
      "audio/mp4": [".m4b", ".m4a", ".mp4"],
      "video/mp4": [".m4v", ".mov"],
    },
  },
];

export function supportsFileSystemAccess(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function"
  );
}

/** Devuelve el archivo elegido o `null` si el usuario cancela. */
export async function pickFile(): Promise<PickedFile | null> {
  const picker = (globalThis as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (!picker) return null;
  try {
    const handles = await picker({ multiple: false, types: AUDIOBOOK_TYPES });
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    return { file, handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Recupera el archivo de un handle persistido, pidiendo permiso si hace falta. */
export async function fileFromHandle(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    const capable = handle as PermissionCapableHandle;
    const descriptor = { mode: "read" as const };
    if (capable.queryPermission) {
      let permission = await capable.queryPermission(descriptor);
      if (permission !== "granted" && capable.requestPermission) {
        permission = await capable.requestPermission(descriptor);
      }
      if (permission !== "granted") return null;
    }
    return await handle.getFile();
  } catch (error) {
    console.warn("[plaudio] no se pudo recuperar el archivo", error);
    return null;
  }
}
