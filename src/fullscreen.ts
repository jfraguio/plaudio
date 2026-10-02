type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function isFullscreen(): boolean {
  const doc = document as WebkitDocument;
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);
}

/**
 * Intenta entrar en pantalla completa. Debe invocarse desde un gesto del
 * usuario; si el navegador lo bloquea, se ignora silenciosamente.
 */
export async function requestFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;

  const element = document.documentElement as WebkitElement;
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen({ navigationUI: "hide" });
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    } else {
      return false;
    }
    return isFullscreen();
  } catch (error) {
    console.warn("[plaudio] no se pudo entrar en pantalla completa", error);
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const doc = document as WebkitDocument;
  try {
    if (doc.exitFullscreen) {
      await doc.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
  } catch (error) {
    console.warn("[plaudio] no se pudo salir de pantalla completa", error);
  }
}

/** Alterna pantalla completa. Devuelve el estado resultante. */
export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return requestFullscreen();
}
