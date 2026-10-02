# Plaudio — Especificación funcional y técnica (v2.0)

**Versión:** 2.0
**Tipo de aplicación:** PWA 100 % frontend
**Plataforma principal:** Android / navegador móvil (Chrome). Se soporta también escritorio.
**Hosting:** GitHub Pages / sitio estático (subpath configurable)
**Backend:** ninguno

> **Nota de esta revisión (v2.0).** Este documento reescribe la v1.0 corrigiendo
> problemas de formato (bloques de código mal cerrados que mezclaban secciones),
> completando los huecos detectados y añadiendo el análisis técnico del caso real
> de uso: audiolibros **`.m4b` de varios cientos de MB / GB con capítulos embebidos**.
> Los cambios respecto a v1.0 se marcan con **「NUEVO」** o **「CORREGIDO」**.

---

## 0. Análisis de la v1.0: problemas detectados y decisiones

### 0.1 Problemas de la especificación original

1. **Formato incompleto.** La sección 4 declaraba `.mp4` como prioritario y `.m4a`
   como opcional, pero **no mencionaba `.m4b`**, que es precisamente el contenedor
   estándar de audiolibros con capítulos (y el del archivo de prueba). El fichero
   de prueba es `The-Infinity-Machine…​.m4b` con 26 capítulos. `.m4b` **debe ser
   formato de primera clase**.
2. **Markdown roto.** En v1.0 las secciones 4–52 estaban dentro de bloques de
   código sin cerrar, mezclando diagramas con prosa. Reescrito por completo.
3. **Parsing MP4 sin estrategia concreta.** Decía "usar MP4Box.js" pero no explicaba
   que **no se puede volcar el archivo entero** en el parser. Falta la estrategia de
   localizar el átomo `moov` mediante `Blob.slice()` y alimentar al parser solo con
   esa región.
4. **Formatos de capítulos no enumerados.** Un MP4 puede guardar capítulos de formas
   distintas: pista de texto QuickTime (`text`/`tx3g` + `tref/chap`), caja Nero
   `chpl`, `udta/meta`, o simplemente no tenerlos. La degradación progresiva debe
   cubrir todos los casos.
5. **Riesgos de Media Session no contemplados.** `setPositionState()` **lanza
   excepción** si `position > duration` o `duration` no es finito; hay que blindar
   las llamadas con `try/catch` y clampear valores.
6. **`duration` no fiable.** En algunos archivos `audio.duration` es `Infinity` o
   `NaN` hasta que hay suficiente buffer. El cálculo del capítulo actual y de la
   barra deben funcionar igualmente.
7. **Identificador del libro.** `name:size:lastModified` es razonable, pero hay que
   documentar colisiones (dos copias distintas con igual nombre/tamaño/fecha) y el
   versionado del esquema de IndexedDB.
8. **No había plan de tests ni de verificación offline** más allá de los criterios
   de aceptación.
9. **Accesibilidad incompleta.** Faltaban teclado, foco visible, `role`, anuncios
   `aria-live` para el cambio de capítulo y el estado de carga.
10. **Persistencia de la velocidad "para ese audiolibro"** no aclaraba el caso de
    que Media Session debe reflejarla y de que al restaurar hay que aplicar la
    velocidad **tras** tener metadata.

### 0.2 Decisiones de implementación (resumen)

- **Stack:** Vite + TypeScript + APIs Web estándar. Sin framework de UI.
- **Dependencia runtime mínima:** `mp4box` (MP4Box.js) para leer `moov`. Nada más.
- **Sin CDN en producción:** todo empaquetado en el build; el Service Worker
  precachea el app shell.
- **Sin framework de estado:** un objeto `AppState` mutable + funciones de render.
- **PWA:** manifest + Service Worker propio (precache del app shell, sin runtime
  dependencies extra).
- **Estrategia de lectura:** escaneo de átomos de nivel superior leyendo solo
  cabeceras de 16 bytes; se localiza `moov` (que puede estar al principio o al
  final) y se hace `slice()` únicamente de esa región.

### 0.3 Datos del archivo de prueba (medidos con `ffprobe`)

| Propiedad | Valor |
|---|---|
| Nombre | `The-Infinity-Machine-Demis-Hassabis-A.m4b` |
| Tamaño | 864 664 702 B (≈ 824 MiB) |
| Contenedor | `mov,mp4,m4a,3gp,3g2,mj2` (`isom`, compatible `M4B M4A`) |
| Audio | AAC-LC (`mp4a.40.2`), 44.1 kHz, estéreo, ~125 kbps |
| Duración | 54 388.84 s (≈ 15 h 06 min) |
| Capítulos | 26, en pista de texto (`tx3g`), títulos tipo `Chapter 1: Destiny` |
| Carátula | JPEG `mjpeg` 2400×2400 embebida (`attached_pic`) |
| `moov` | **al final** del archivo, offset 853 826 276, tamaño 10 838 426 B |

Conclusión: el parser **nunca** debe leer los 824 MiB; basta con leer ~10.8 MiB
del final para metadata + capítulos + carátula.

---

## 1. Objetivo

**Plaudio** es un reproductor minimalista de audiolibros almacenados localmente en
el dispositivo del usuario.

Permite seleccionar un archivo de audiolibro desde el sistema de archivos,
reproducirlo directamente en el navegador y recordar automáticamente el punto
exacto de reproducción.

Plaudio funciona como **PWA instalable**, de forma que puede usarse en Android como
una app convencional y continuar reproduciendo audio con la pantalla bloqueada.

Debe ser:

- 100 % frontend.
- Sin backend, sin autenticación, sin cuentas.
- Sin almacenamiento en la nube ni subida del audio a Internet.
- Mobile-first, minimalista, instalable como PWA y utilizable offline.
- Capaz de reproducir archivos de **1 GB o más** sin cargarlos completos en memoria.

Principio rector: *abrir un audiolibro, escucharlo, cerrar, volver mañana y
continuar exactamente donde lo dejaste.*

---

## 2. Formatos soportados 「CORREGIDO」

Formatos de primera clase:

```text
.m4b   → audiolibro con capítulos (caso principal)
.mp4   → audio/vídeo MP4 (se usa la pista de audio)
.m4a   → audio MP4
```

También se aceptan si el navegador soporta el códec:

```text
.m4v
.mov
```

`<input type="file">`:

```html
<input
  id="file-input"
  type="file"
  accept=".m4b,.m4a,.mp4,.m4v,.mov,audio/mp4,audio/x-m4a,audio/m4b,video/mp4"
/>
```

**Detección de códec:** no es responsabilidad de Plaudio convertir codecs
incompatibles. Si el navegador no puede reproducir el archivo (error
`MEDIA_ERR_SRC_NOT_SUPPORTED` / `MEDIA_ERR_DECODE`), se muestra
"No se puede reproducir este archivo" y se ofrece elegir otro.

> Nota técnica: en Android/Chrome, AAC-LC, MP3, Opus y FLAC (según versión) se
> reproducen. `.m4b` es un MP4 con AAC, por lo que se reproduce como audio normal.

---

## 3. Fuera del alcance (V1)

- backend, usuarios, login, sincronización, almacenamiento cloud;
- biblioteca remota, streaming desde Internet, subida de archivos;
- DRM; transcripción; subtítulos; sincronización palabra por palabra;
- temporizador de apagado; recomendaciones; estadísticas;
- reproducción desde URL; edición de metadata; conversión de formatos.

La arquitectura debe permitir añadir posteriormente subtítulos o transcripción
sincronizada sin rehacer el reproductor (los tiempos y capítulos ya están
modelados).

---

## 4. Arquitectura general

```text
┌──────────────────────────────────────────────┐
│                 Plaudio PWA                   │
│                                               │
│  UI (main.ts / ui.ts)                         │
│  Audio Player (<audio> + player.ts)           │
│  MP4 Parsing (chapters / metadata / artwork)  │
│  Media Session (media-session.ts)             │
│  Persistence (IndexedDB, persistence.ts)      │
│  Service Worker (precache app shell)          │
└───────────────────┬──────────────────────────┘
                    │ File API (Blob.slice / createObjectURL)
                    ▼
        ┌───────────────────────────┐
        │ Archivo local MP4/M4A/M4B  │
        │ del dispositivo            │
        └───────────────────────────┘
```

No hay comunicación con servidores salvo la descarga inicial de los recursos
estáticos de la propia app.

### 4.1 Flujo de apertura (secuencia)

```text
Seleccionar archivo
      │
      ▼
getBookId(file) ──► IndexedDB.load(id)  ──► ¿posición/velocidad previas?
      │                                            │
      ▼                                            │
URL.createObjectURL(file) ──► audio.src            │
      │                                            │
      ▼                                            │
"loadedmetadata" ──► audio.currentTime = min(pos, duration) ◄┘
      │                 audio.playbackRate = rate
      ▼
UI lista + "Continuando desde HH:MM:SS"
      │
      ├─► (async, en paralelo) parseBookMetadata(file) ──► título/autor/carátula/capítulos
      │
      ▼
Play
```

---

## 5. Gestión de archivos grandes 「CORREGIDO」

Requisito crítico. Plaudio debe manejar audiolibros de 500 MB, 1 GB, 2 GB o más
sin cargar el archivo completo en memoria.

**Prohibido:**

- `FileReader.readAsArrayBuffer(file)` sobre el archivo completo.
- `await file.arrayBuffer()` sobre el archivo completo.
- Copiar el audiolibro a IndexedDB / Cache Storage / localStorage.

**Permitido y recomendado:**

- `URL.createObjectURL(file)` como `src` del `<audio>`; el navegador lee del disco
  solo las regiones necesarias al reproducir.
- `file.slice(start, end).arrayBuffer()` para leer **regiones pequeñas** con fines
  de análisis (p. ej. el átomo `moov`).

Al sustituir o cerrar un audiolibro:

```ts
URL.revokeObjectURL(objectUrl);
```

### 5.1 Localización incremental del `moov`

El átomo `moov` puede estar al principio (`faststart`) o al final. Para no leer
todo el archivo:

1. Leer cabeceras de 16 bytes de los átomos de nivel superior
   (`ftyp`, `free`, `mdat`, `moov`, …) usando `file.slice(pos, pos + 16)`.
2. Del tamaño (`u32` big-endian; si `size == 1`, usar `u64`; si `size == 0`, se
   extiende hasta el final) avanzar al siguiente átomo **sin leer su contenido**.
3. Al encontrar `moov`, hacer `file.slice(moovStart, moovStart + moovSize)` y
   pasar esos bytes a MP4Box.js.

En el archivo de prueba esto supone leer 3 cabeceras + 10.8 MB del `moov`,
en lugar de 824 MB.

Implementación de referencia del escaneo en `src/mp4/atoms.ts`.

---

## 6. Selección del audiolibro

Pantalla inicial con una acción principal: **Abrir audiolibro**.

```ts
const file = input.files?.[0];
if (!file) return;
const objectUrl = URL.createObjectURL(file);
state.file = file;
state.objectUrl = objectUrl;
audio.src = objectUrl;
```

---

## 7. Reproductor de audio

Motor: `<audio preload="metadata">`. UI personalizada (controles nativos ocultos,
pero el elemento permanece accesible).

Funciones obligatorias:

- Play / Pause.
- Seek (tocar y arrastrar).
- Retroceder 15 s, avanzar 30 s.
- Velocidad.

```ts
const SEEK_BACKWARD = 15; // s
const SEEK_FORWARD = 30;  // s
```

Propiedades:

- `audio.preservesPitch = true` (por defecto) para que la voz no cambie de tono al
  variar la velocidad.
- `preload="metadata"` para no descargar el archivo entero.

---

## 8. Interfaz principal

Una única pantalla, **tema oscuro**, con el aspecto de un reproductor de audiolibros
tipo iOS: carátula grande, tipografía clara y un único acento cálido (ámbar).

```text
              PLAUDIO

        ┌───────────────────┐
        │                   │
        │      COVER        │
        │                   │
        └───────────────────┘

          Título del libro
            Autor del libro
      Capítulo 3 · El desierto enseña

     ━━━━━━━━━●━━━━━━━━━━━━━━━
     12:06                  -18:24

          (↶)   ( ▶/⏸ )   (↷)
          15              30

      1.25×         |        ☰
     Velocidad               Capítulos
```

Detalles del diseño:

- Fondo casi negro con un sutil halo cálido en la parte superior.
- Carátula cuadrada, esquinas redondeadas y sombra suave.
- Título grande en blanco; autor y capítulo en grises.
- Barra de progreso blanca con indicador circular; a la izquierda el tiempo
  transcurrido y a la derecha el **tiempo restante** con signo negativo (`-18:24`).
- Botón central de play/pausa circular con anillo y halo ámbar; a los lados,
  saltos circulares `↶15` y `30↷` con el número en el centro.
- Fila inferior con dos controles separados por un divisor vertical:
  **Velocidad** (valor + etiqueta, selector nativo superpuesto) y **Capítulos**
  (icono de lista + etiqueta).

Se evita cualquier elemento no estrictamente necesario. Estados de la UI:

- **Sin libro:** marca + lema + botón "Abrir audiolibro".
- **Cargando:** indicador discreto.
- **Listo:** reproductor.
- **Error:** mensaje + botón para reintentar.

---

## 9. Barra de progreso

Muestra posición actual, duración total y barra. Formato:

- `HH:MM:SS` si la duración ≥ 1 h.
- `MM:SS` si la duración < 1 h.

Si la duración aún no es válida (finito, > 0), mostrar `--:--` y deshabilitar el
seek hasta disponer de metadata.

---

## 10. Seek

- Tocar la barra y arrastrar el indicador.
- Actualización optimista de la UI mientras se arrastra; se aplica
  `audio.currentTime` al soltar (o en cada movimiento, con `input`).
- Tras el seek, persistir inmediatamente la posición.
- Teclado: `←`/`→` (±5 s), `Espacio` (play/pause), `M` (mute), `↑`/`↓` (velocidad).

```ts
audio.currentTime = newPosition;
```

---

## 11. Saltos rápidos

```ts
audio.currentTime = Math.max(0, audio.currentTime - SEEK_BACKWARD);
audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + SEEK_FORWARD);
```

---

## 12. Velocidad de reproducción

Valores mínimos: `0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×`.

```ts
audio.playbackRate = rate;
```

- Se persiste por audiolibro.
- Se actualiza en Media Session (`setPositionState({ playbackRate })`).
- Se mantiene `preservesPitch`.
- Al restaurar, se aplica tras `loadedmetadata`.

---

## 13. Identificación del audiolibro

No usar solo el nombre. Identificador barato (sin hashear GB):

```ts
export function getBookId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
```

**Limitación documentada:** dos archivos distintos con idéntico nombre/tamaño/fecha
compartirían progreso. Es un compromiso aceptado en V1 para evitar leer el archivo
completo. 「NUEVO」

---

## 14. Persistencia (IndexedDB)

IndexedDB es el almacén principal. `localStorage` solo podría usarse para un flag
trivial (p. ej. tema), nunca para el progreso.

Esquema:

```ts
interface AudiobookState {
  id: string;
  filename: string;
  position: number;      // segundos
  playbackRate: number;
  duration?: number;     // segundos
  title?: string;
  author?: string;
  schemaVersion: number; // para migraciones futuras
  updatedAt: number;     // epoch ms
}
```

- Base de datos: `plaudio`, versión 1.
- Object store: `audiobooks`, keyPath `id`.
- Migraciones mediante `onupgradeneeded` y `schemaVersion`.

Ejemplo:

```json
{
  "id": "The-Infinity-Machine-Demis-Hassabis-A.m4b:864664702:1780000000000",
  "filename": "The-Infinity-Machine-Demis-Hassabis-A.m4b",
  "position": 12483.42,
  "playbackRate": 1.25,
  "duration": 54388.84,
  "title": "The Infinity Machine",
  "author": "Demis Hassabis",
  "schemaVersion": 1,
  "updatedAt": 1790953200000
}
```

---

## 15. Guardado del progreso

Guardar automáticamente:

- cada ~5 s durante la reproducción (`timeupdate` + throttle);
- al pausar;
- al hacer seek;
- al cambiar de capítulo;
- al modificar la velocidad;
- al cambiar `visibilityState`;
- en `pagehide`/`beforeunload` (best effort).

**Throttling:** máximo una escritura cada 5 s durante reproducción continua; las
acciones puntuales (pausa, seek, cambio de velocidad, capítulo) fuerzan escritura
inmediata. Implementado con un `ThrottledSaver` con `flush()`.

Nunca escribir a IndexedDB en cada `timeupdate` (≈4/s).

---

## 16. Recuperación del progreso

Al seleccionar un archivo:

1. calcular `bookId`;
2. consultar IndexedDB;
3. cargar el audio (`objectURL`);
4. esperar `loadedmetadata`;
5. restaurar posición;
6. restaurar velocidad;
7. actualizar la UI.

```ts
const restoredPosition = Number.isFinite(saved?.position)
  ? Math.min(saved.position, audio.duration)
  : 0;
audio.currentTime = Math.max(0, restoredPosition);
audio.playbackRate = saved?.playbackRate ?? 1;
```

Si `saved` es inválido/corrupto, empezar desde 0. Mostrar brevemente
"Continuando desde HH:MM:SS" solo si `restoredPosition > 5 s`.

「NUEVO」 Si `audio.duration` es `Infinity`/`NaN`, restaurar cuando se resuelva
(un listener de `durationchange`) o usar la duración guardada como cota superior.

---

## 17. Reanudación entre sesiones

No se persisten permisos ni `FileSystemFileHandle` en V1. Flujo aceptado:

```text
Abrir Plaudio → Seleccionar libro.m4b → "Continuando desde 04:37:12" → Play
```

---

## 18. Capítulos

Modelo interno:

```ts
interface Chapter {
  title: string;
  startTime: number;
  endTime?: number;
}
```

### 18.1 Formatos de capítulos soportados (degradación progresiva) 「NUEVO」

1. **Pista de capítulos QuickTime** (caso del `.m4b` de prueba): una pista de texto
   (`text`/`tx3g`), referenciada desde `tref/chap` de la pista de audio, con un
   sample por capítulo y título en el `textSample`. Es la estrategia preferente.
2. **Caja Nero `chpl`** dentro de `udta`.
3. **`udta/meta/ilst`** sin capítulos → se ocultan.
4. Sin capítulos → se oculta el selector; la reproducción sigue igual.

Regla de oro: **no encontrar capítulos jamás impide reproducir.**

### 18.2 Estrategia de parsing

- Localizar `moov` (sección 5.1) y parsear con MP4Box.js alimentándolo **solo** con
  los bytes del `moov`.
- De `moov`: `mvhd` (duración), pistas de audio, pista de capítulos, `udta`/`meta`
  (título, autor, `covr`).
- Construir `Chapter[]` ordenado por `startTime`; si la última no tiene `endTime`,
  usar la duración total.
- Si MP4Box falla o no hay capítulos, intentar el parser ligero propio de `chpl` /
  chapter track; si todo falla, `chapters = []`.

### 18.3 Capítulo actual

```ts
function currentChapterIndex(chapters: Chapter[], t: number): number {
  // búsqueda binaria: mayor startTime <= t
  let lo = 0, hi = chapters.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chapters[mid].startTime <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}
```

Se actualiza automáticamente al cambiar de capítulo; si cambia, se actualiza la UI,
Media Session y se persiste.

### 18.4 Navegación

Lista (bottom sheet) con `NN · Título · HH:MM:SS`. Pulsar:

```ts
audio.currentTime = chapter.startTime;
```

`previoustrack` / `nexttrack` de Media Session navegan al capítulo anterior/siguiente.

---

## 19. Carátula y metadata 「COMPLETADO」

Prioridad para la portada:

1. Artwork embebido (`covr` en `udta/meta/ilst`) → `Blob` → `URL.createObjectURL`,
   revocando el anterior.
2. Imagen genérica de Plaudio.

Metadata a extraer: título (`©nam`), autor/artista (`©ART`/`©art`/`aART`),
álbum (`©alb`), y como respaldo `SUBTITLE`/`PUBLISHER` de tags de formato.

- Si no hay título: nombre del archivo sin extensión, reemplazando `_`/`-` por
  espacios y colapsando espacios.
- La ausencia de artwork/metadata nunca afecta a la reproducción.
- **Seguridad:** todo texto se inserta con `textContent`; nunca `innerHTML`. El
  artwork se valida como `Blob` con tipo de imagen conocido; si no, se descarta.

---

## 20. Reproducción en segundo plano

El audio debe continuar cuando el usuario cambia de app, de pestaña, la PWA pasa a
segundo plano o se bloquea la pantalla.

- **No** añadir ningún listener de `visibilitychange` que pause.
- `visibilitychange` solo se usa para persistir.
- En Android, la reproducción en segundo plano depende del navegador; como PWA
  instalada con `<audio>` y Media Session es el escenario soportado.

---

## 21. Media Session API

```ts
if ("mediaSession" in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: bookTitle,
    artist: author,
    album: currentChapterTitle,
    artwork: [{ src: coverUrl, sizes: "512x512", type: "image/jpeg" }],
  });
}
```

- Registrar `play`, `pause`, `seekbackward`, `seekforward`, `previoustrack`,
  `nexttrack`, `seekto`, `stop` **cuando estén disponibles**, envueltos en
  `try/catch` (algunos navegadores lanzan al registrar acciones no soportadas).
- `seekbackward` → −15 s; `seekforward` → +30 s; `previoustrack`/`nexttrack` →
  capítulo anterior/siguiente.
- Actualizar metadata al cambiar de capítulo (con throttling para no recrear el
  objeto en cada tick).

### 21.1 `setPositionState` 「CORREGIDO」

```ts
function safeSetPositionState(): void {
  if (!("mediaSession" in navigator)) return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  const pos = Math.min(Math.max(audio.currentTime, 0), d);
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate,
      position: pos,
    });
  } catch {
    /* ignorar */
  }
}
```

Se llama en `timeupdate` (throttled), `ratechange`, `seeked` y `play`.

---

## 22. PWA

Incluir manifest, Service Worker e iconos.

```json
{
  "name": "Plaudio",
  "short_name": "Plaudio",
  "description": "Tus audiolibros, sin complicaciones.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#111111",
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "./icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- `start_url` y `scope` relativos para soportar subpath (`/plaudio/`).
- Registro del SW con `import.meta.env.BASE_URL`.

---

## 23. Service Worker

Precachea **solo el app shell**:

- `index.html`, JS, CSS, manifest, iconos, librería MP4Box empaquetada.

**No** cachea MP4/M4A/M4B. El audiolibro nunca entra en Cache Storage (además, los
`objectURL` no son cacheables por diseño).

Estrategia:

- Navegación (`request.mode === "navigate"`): *network-first* con fallback a caché.
- Estáticos: *cache-first* con actualización en segundo plano.
- `skipWaiting()` + `clients.claim()` para actualizaciones inmediatas.
- Limpieza de cachés de versiones anteriores en `activate`.

---

## 24. Offline

Una vez instalada/cargada:

```text
Modo avión → Abrir Plaudio → Seleccionar archivo local → Reproducir
```

debe funcionar. Todas las dependencias forman parte del build; **sin CDN**.

---

## 25. Despliegue estático / GitHub Pages

- `base: "./"` en Vite para que las rutas funcionen bajo subpath
  (`https://usuario.github.io/plaudio/` o `https://fraguio.com/plaudio/`).
- No asumir `/` como raíz; usar rutas relativas.
- El SW se registra en `scope: "./"`.
- Script de build genera carpeta `dist/` lista para publicar.

---

## 26. Stack tecnológico y estructura

Stack: **TypeScript + HTML + CSS + APIs Web**. Vite como build. Sin React/Vue/etc.

```text
plaudio/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       ├── icon-512.png
│       └── icon-maskable-512.png
└── src/
    ├── main.ts            # bootstrap, wiring de eventos
    ├── player.ts          # Player: <audio> wrapper
    ├── ui.ts              # render de la interfaz
    ├── state.ts           # AppState y helpers
    ├── persistence.ts     # IndexedDB
    ├── media-session.ts   # Media Session API
    ├── metadata.ts        # orquesta metadata + artwork
    ├── chapters.ts        # modelo, búsqueda, navegación
    ├── types.ts           # interfaces compartidas
    ├── utils.ts           # formatTime, getBookId, throttle, clamp
    ├── mp4/
    │   ├── atoms.ts       # escaneo de átomos de nivel superior
    │   └── parse.ts       # MP4Box sobre el moov (+ fallback)
    └── styles.css
```

Separación estricta de responsabilidades.

---

## 27. Módulos y contrato

| Módulo | Responsabilidad |
|---|---|
| **Player** | `play`, `pause`, `seek`, `seekBy`, `setRate`, `duration`, `currentTime` |
| **Persistence** | abrir IndexedDB; `load(id)`, `save(state)`; tolerante a fallos |
| **Metadata** | orquestar parsing; título, autor, artwork (Blob URL) |
| **Chapters** | `Chapter[]`; `currentIndex(chapters, t)`; `next`/`prev` |
| **MediaSession** | metadata, action handlers, `setPositionState` seguro |
| **UI** | pintar estado; eventos de usuario; `aria-*`; `textContent` |

### 27.1 Estado de aplicación

```ts
interface AppState {
  file?: File;
  objectUrl?: string;
  bookId?: string;

  title?: string;
  author?: string;
  coverUrl?: string;

  duration: number;
  currentTime: number;

  playbackRate: number;
  playing: boolean;
  canPlay: boolean;

  chapters: Chapter[];
  currentChapterIndex: number; // -1 si no hay
}
```

Sin librería global de estado.

---

## 28. UX

### 28.1 Sin libro

```text
              PLAUDIO

   Tus audiolibros,
   sin complicaciones.

        [ Abrir audiolibro ]
```

### 28.2 Al restaurar

Mostrar brevemente "Continuando desde 04:37:12". Nunca un diálogo
"Sí/No": la restauración es automática. El usuario puede mover la barra al inicio.

---

## 29. Accesibilidad 「COMPLETADO」

- Todos los controles con `aria-label` descriptivo.
- Áreas táctiles ≥ 44 × 44 px.
- Foco visible; navegación completa por teclado; atajos (sección 10).
- `role="slider"`/`aria-valuenow` en la barra de progreso, o input `range`
  estilizado (preferible por accesibilidad nativa).
- Región `aria-live="polite"` para cambios de capítulo y estado de carga.
- Respetar `prefers-reduced-motion`.
- Contraste suficiente en claro y oscuro.

---

## 30. Modo oscuro

Automático con `@media (prefers-color-scheme: dark)`. Sin selector manual en V1.

---

## 31. Diseño visual

Principios: mucho espacio vacío, tipografía limpia, pocos controles, jerarquía
clara, animaciones discretas, sin gradientes llamativos ni sombras excesivas, sin
navegación compleja. Sensación de "abrir un libro y escuchar".

Paleta neutra en claro/oscuro; un único color de acento sobrio.

---

## 32. Privacidad

Todo local. El audiolibro: no se sube, no se sincroniza, no se transmite, no se
analiza remotamente, no se copia a GitHub, no sale del dispositivo. Sin telemetría
ni analytics.

---

## 33. Seguridad

- Nunca ejecutar contenido embebido en el MP4.
- Tratar la metadata como no confiable: insertar siempre con `textContent`.
- No renderizar HTML/URLs de la metadata.
- Validar el artwork como blob de imagen; descartar el resto.
- No `eval`, no `new Function`, sin scripts remotos.

---

## 34. Gestión de errores

| Situación | Comportamiento |
|---|---|
| Archivo no reproducible | "No se puede reproducir este archivo." + elegir otro |
| Sin capítulos | Ocultar selector; reproducir igual |
| Metadata corrupta | Ignorar; usar nombre de archivo |
| Progreso corrupto | Ignorar; empezar de cero |
| IndexedDB no disponible | Reproductor funciona sin persistencia |
| Media Session no disponible | App funciona normalmente |
| Artwork no extraíble | Imagen genérica |
| `duration` no finita | UI en `--:--` hasta que se resuelva |

Filosofía: lo accesorio (capítulos, metadata, artwork, IndexedDB, Media Session)
**nunca** bloquea la reproducción.

---

## 35. Rendimiento

- Apertura rápida; poco JS inicial.
- Cero procesamiento completo de archivos gigantes.
- Cero copias innecesarias del MP4 (solo `moov` y carátula).
- Mínimas escrituras en IndexedDB (throttling).
- Mínimo consumo de batería.
- Parsing de metadata en `requestIdleCallback`/async tras `loadedmetadata`, sin
  bloquear el hilo principal (trocear el parseo si hiciera falta).

---

## 36. Tests 「NUEVO」

- **Unitarios (Vitest):**
  - `getBookId`, `formatTime`, `clamp`, `ThrottledSaver`.
  - `currentChapterIndex` (búsqueda binaria, límites).
  - Escaneo de átomos con `ftyp`/`mdat`/`moov` y `moov` al final.
  - Parser de metadata con un fixture pequeño de `moov` extraído del `.m4b`.
- **Manuales (checklist de aceptación, sección 38):** apertura, reproducción,
  segundo plano, lock screen, offline, restauración.

---

## 37. Orden de implementación

1. Proyecto base (Vite + TS).
2. PWA (manifest + SW).
3. Selector de archivo + Object URL.
4. `<audio>` + Play/Pause.
5. Barra de progreso + Seek.
6. −15 / +30.
7. Velocidad.
8. Identificador del libro.
9. IndexedDB + persistencia + restauración.
10. Media Session + segundo plano.
11. Parsing de `moov` (átomos).
12. Metadata + artwork.
13. Capítulos + navegación.
14. Offline.
15. Modo oscuro.
16. Accesibilidad.
17. Pulido visual.
18. Tests.

---

## 38. Criterios de aceptación

| ID | Criterio |
|---|---|
| CA-01 | Abrir Plaudio desde Chrome en Android |
| CA-02 | Instalar Plaudio como PWA |
| CA-03 | Seleccionar un `.m4b`/`.mp4`/`.m4a` local de ~1 GB |
| CA-04 | El archivo no se copia completo a memoria ni a IndexedDB |
| CA-05 | Reproducir y pausar |
| CA-06 | Moverse a cualquier punto |
| CA-07 | Retroceder 15 s |
| CA-08 | Avanzar 30 s |
| CA-09 | Cambiar la velocidad entre 0,75× y 2× |
| CA-10 | Guarda automáticamente la posición |
| CA-11 | Cerrar completamente la app |
| CA-12 | Volver a abrirla |
| CA-13 | Seleccionar el mismo archivo |
| CA-14 | Reconoce el audiolibro |
| CA-15 | Recupera automáticamente la posición |
| CA-16 | Recupera también la velocidad |
| CA-17 | El audio sigue al cambiar de app |
| CA-18 | El audio continúa con la pantalla bloqueada |
| CA-19 | Pausar/reanudar desde los controles multimedia |
| CA-20 | La pantalla bloqueada muestra el título (si Media Session disponible) |
| CA-21 | Si hay capítulos compatibles, se muestran |
| CA-22 | Pulsar un capítulo salta a él |
| CA-23 | Muestra automáticamente el capítulo actual |
| CA-24 | Sin capítulos, la reproducción sigue funcionando |
| CA-25 | Sin artwork, se muestra la imagen genérica |
| CA-26 | Funciona sin Internet tras instalarse/cachearse |
| CA-27 | El audiolibro nunca se transmite fuera del dispositivo |

---

## 39. Prioridades de producto

1. Reproducción fiable.
2. No cargar archivos enormes en RAM.
3. Guardar correctamente el progreso.
4. Reproducción con pantalla bloqueada.
5. Facilidad de uso.
6. Capítulos.
7. Metadata.
8. Artwork.
9. Detalles visuales.

---

## 40. Riesgos y mitigaciones (análisis) 「NUEVO」

| Riesgo | Mitigación |
|---|---|
| `moov` al final en archivos grandes | Escaneo de cabeceras de átomos; `slice` solo del `moov` |
| Capítulos en formatos dispares | Degradación progresiva (chapter track → chpl → nada) |
| Media Session lanza excepciones | `try/catch` + clampeo de valores |
| `duration` = `Infinity` | Reintentar en `durationchange`; UI tolerante |
| Codec no soportado | Mensaje claro + elegir otro archivo |
| SW sirve versión antigua | `skipWaiting`/`clients.claim` + limpieza de caché |
| Pérdida de progreso al cerrar | `pagehide` + throttle con `flush()` |
| Subpath en GitHub Pages | `base: "./"`, rutas relativas, `scope: "./"` |

---

## 41. Principio final

Plaudio no debe convertirse en Spotify, Audible ni una biblioteca multimedia.
Debe hacer muy pocas cosas, pero hacerlas extremadamente bien:

**Abrir un audiolibro. Escucharlo. Cerrar. Volver mañana y continuar exactamente
donde lo dejaste.**
