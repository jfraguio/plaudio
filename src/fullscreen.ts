type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
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
