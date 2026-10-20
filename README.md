# Littland Launcher

Launcher de Minecraft Java (Fabric) para el servidor Littland.

- Login con **Microsoft** (premium) o con **nombre de usuario** (no premium).
- Descarga e instala automáticamente **Minecraft**, **Fabric** y **Java** (no hace falta tener Java instalado).
- **Sincroniza los mods** con los de tu servidor cada vez que se pulsa JUGAR: descarga los nuevos, actualiza los cambiados y borra los que sobran.
- **Selector de versión** (1.21.8 a 1.21.11): cada versión tiene su propio modpack y tú eliges cuál es la recomendada.
- **Explorador de mods tipo Modrinth** (botón *Mods*): los jugadores buscan e instalan mods de Fabric para su versión, con dependencias automáticas, activar/desactivar, actualizar y quitar. Los mods del servidor aparecen aparte y no se pueden quitar.
- Entra **directo al server** al abrir el juego.
- Muestra si el server está en línea, los jugadores conectados y el ping.

Los datos del juego se guardan en `%APPDATA%\.littland`.

## 1. Configurar

Edita [launcher.config.json](launcher.config.json):

| Campo | Qué es |
|---|---|
| `serverName` | Nombre que aparece en el launcher |
| `serverAddress` | IP del server (`littland2.holy.gg`). Si no lleva puerto se usa el registro SRV, igual que Minecraft |
| `manifestUrl` | URL pública donde vas a subir el `manifest.json` (ver paso 2) |
| `dataFolder` | Carpeta dentro de `%APPDATA%` (por defecto `.littland`) |
| `links.discord` | Invitación de Discord (ej. `https://discord.gg/xxxx`). Si la pones, aparecen el botón "Unirme al Discord" y el contador de miembros en línea |
| `links.web` | Web del servidor (opcional) |
| `branding.title`, `branding.titleAccent` | Título grande (`LITTLAND`) y la parte dorada (`2`) |
| `branding.subtitle` | Texto pequeño bajo el logo (`MINECRAFT SERVER`) |
| `branding.badge` | Insignia dorada de arriba (ej. temporada). Vacío = oculta |
| `branding.tagline`, `branding.description` | Frase verde y descripción bajo el título |
| `branding.features` | Etiquetas con ✓. Cada una con `text` y `color` (`green`, `cyan` o `gold`) |

El logo es [src/renderer/logo.svg](src/renderer/logo.svg) y el icono de la app es [build/icon.png](build/icon.png) (256×256). Puedes reemplazarlos por los tuyos.

> **No premium:** para que entren jugadores con cuentas offline, el server debe tener `online-mode=false` en `server.properties`. En ese caso es muy recomendable un plugin/mod de login (AuthMe, EasyAuth...) para que nadie use el nombre de otro.

## 2. Publicar los mods (manifest)

> **Uso diario:** cambia los archivos dentro de `modpack/` y ejecuta `npm run publicar`. Ese comando regenera el manifest y lo sube a GitHub Pages (`https://arcadex999.github.io/littland-modpack/`). Acepta los mismos flags que se explican abajo, por ejemplo `npm run publicar -- --default 1.21.11`. Los flags que no pongas conservan su valor anterior.

1. En la carpeta [modpack/](modpack/) hay una subcarpeta por versión de Minecraft. Cada una tiene la estructura de la carpeta del juego del cliente:
   ```
   modpack/
     1.21.8/
       mods/      ← los .jar de mods de CLIENTE para 1.21.8
       config/    ← (opcional) configs que quieras forzar
     1.21.9/mods/
     1.21.10/mods/
     1.21.11/mods/
   ```
   Ya vienen con Fabric API. Los jugadores solo ven en el selector las versiones que tengan carpeta.
2. Genera el manifest indicando la versión recomendada (la que se selecciona por defecto):
   ```bash
   npm run manifest -- modpack --default 1.21.8
   ```
   Opcional: `--managed mods,resourcepacks` (carpetas donde se borran los archivos que no estén en el manifest; por defecto solo `mods`). Para fijar la versión de Fabric Loader o de Java de una versión concreta, crea `modpack/<versión>/version.json` con, por ejemplo, `{ "fabricLoader": "0.19.5" }`. Si no, se usa el último Fabric estable.
3. Sube **toda** la carpeta `modpack/` (con su `manifest.json`) a cualquier hosting de archivos estáticos: GitHub Pages, Cloudflare R2/Pages, tu VPS con nginx... Debe quedar accesible, por ejemplo, en `https://tu-dominio/littland/manifest.json`, y los mods en `https://tu-dominio/littland/1.21.8/mods/...`.
4. Pon esa URL en `manifestUrl`.

### Mods de los jugadores

Por defecto los jugadores pueden instalar sus propios mods desde el explorador. Al generar el manifest puedes:

- **Bloquear mods concretos** (por su *slug* de Modrinth, el final de la URL `modrinth.com/mod/<slug>`):
  ```bash
  npm run manifest -- modpack --default 1.21.8 --blocked xray-mod,freecam
  ```
  Un mod bloqueado no se puede instalar y, si alguien ya lo tenía, el launcher deja de cargarlo.
- **Desactivar los mods de jugadores** por completo con `--no-user-mods`.

Estas restricciones solo se aplican dentro del launcher. Un jugador que use otro launcher puede saltárselas, así que para cosas como el X-ray conviene usar también un anticheat o plugin en el servidor.

**Para actualizar el server a una versión nueva** (por ejemplo, la 1.21.11): crea o completa su carpeta y vuelve a ejecutar el paso 2 con `--default 1.21.11`. Si una versión deja de estar permitida, borra su carpeta. Luego súbelo. Los jugadores reciben los cambios la próxima vez que abran el launcher, **sin reinstalarlo**. Si alguien tenía elegida una versión que ya no está, el launcher pasa a la recomendada.

Al cambiar de versión, el launcher cambia los mods automáticamente. Si el hosting se cae, usa la última copia del manifest que descargó.

## Chat de voz (LittlandVoice)

Chat de voz de proximidad propio: plugin del servidor ([voice/plugin](voice/plugin)) + voz integrada en el launcher. Protocolo en [voice/PROTOCOL.md](voice/PROTOCOL.md).

**En el servidor:**
1. Compila el plugin (`voice\plugin\build.ps1`) y copia `voice/plugin/build/libs/LittlandVoice-*.jar` a `plugins/`.
2. Abre un **puerto UDP** en el hosting y ponlo en `plugins/LittlandVoice/config.yml` (`port`). Ahí también se cambia la distancia de voz (`distance`, 48 bloques por defecto).
3. Activa la voz en el launcher publicando el manifest con ese puerto: `npm run publicar -- --voice-port <puerto>`. Usa `--voice-host <host>` solo si la voz va en otra máquina distinta del juego.

**En el juego:** `/voz silenciar`, `/voz ensordecer`, `/voz eco` (para oírte a ti mismo y probar el sonido 3D) y `/voz estado`. Los admins también tienen `/voz recargar`.

**En el launcher:** Ajustes → Chat de voz, donde se eligen el micrófono, la salida y la sensibilidad, y hay una prueba de micrófono.

**Pruebas locales** (`voice/dev`): `setup.ps1` instala el JDK 21, Gradle y un server Purpur de pruebas en `%LOCALAPPDATA%\LittlandDev`. Después, `run-server.ps1` arranca ese server con el plugin, `node voice/dev/bot/test.js` lanza 19 pruebas automáticas con bots, `node voice/dev/bot/parrot.js` mete un bot "Loro" que repite lo que dices, y `run-launcher.ps1` abre el launcher apuntando al server local.

## App de Android (Bedrock)

[voice/android](voice/android): app "Littland" para los jugadores de Bedrock en el móvil. El botón JUGAR abre Minecraft conectado al server y mantiene el chat de voz en segundo plano. También tiene noticias y un botón de Discord. Usa el mismo plugin y el mismo protocolo que el launcher de PC.

Todo lo lee del repositorio del modpack, así que se cambia sin publicar otra versión de la app:
- **Dirección de Bedrock:** `npm run publicar -- --bedrock-address host:puerto`
- **Servidor de voz:** `npm run publicar -- --voice-port N --voice-host host`. La app necesita el host explícito, porque no resuelve SRV.
- **Discord:** `npm run publicar -- --discord https://discord.gg/...`
- **Noticias:** edita [modpack/news.json](modpack/news.json) (`title`, `date` en formato `AAAA-MM-DD`, `body` y `url` opcional) y luego ejecuta `npm run publicar`.

**Desarrollo** (`voice/dev`): `setup-android.ps1` instala Android Studio y el SDK, y `setup-emulator.ps1` crea el emulador "Littland". Para compilar, usa `voice\android\build.ps1`. Para probar en el emulador contra el server local, arranca `run-server.ps1`, `node voice/dev/serve-modpack.js`, `node voice/dev/bot/standin.js MovilTest` (un bot que hace de jugador de Bedrock) y, opcionalmente, `node voice/dev/bot/parrot.js`, y después ejecuta `run-android-test.ps1`. Pulsando largo en el logo de la app se cambia la URL del manifest para usar un server de pruebas.

## 3. Probar

```bash
npm install
```

```bash
npm start
```

Para probar tu modpack **antes de subirlo**, sírvelo en local y apunta el launcher a él (PowerShell, dos terminales):

```powershell
npx http-server modpack -p 8766
```

```powershell
$env:LITTLAND_MANIFEST_URL="http://127.0.0.1:8766/manifest.json"; npm start
```

## 4. Crear el instalador para tus jugadores

```bash
npm run dist
```

Genera `dist/Littland-Launcher-Setup-<versión>.exe`. Ese es el archivo que compartes.

### Actualizar el launcher (se actualiza solo)

Los launchers instalados buscan versiones nuevas en [GitHub Releases](https://github.com/ArcadeX999/littland-launcher/releases) al abrirse y cada hora. La descargan en segundo plano y muestran un botón dorado **REINICIAR**. Si no lo pulsan, la actualización se instala al cerrar el launcher.

Para publicar una versión nueva (por ejemplo, tras cambiar la IP, los textos o el Discord en `launcher.config.json`):

```bash
npm run release
```

Sube la versión (1.0.0 → 1.0.1), genera el instalador y te dice qué 3 archivos de `dist/` subir a una nueva release en GitHub (`.exe`, `.exe.blockmap` y `latest.yml`). Para cambiar solo mods **no** hace falta: usa `npm run publicar`.

Como el `.exe` no está firmado, Windows SmartScreen puede mostrar "Windows protegió su PC" la primera vez (los jugadores deben pulsar *Más información → Ejecutar de todas formas*). Para evitarlo hace falta un certificado de firma de código.

## Estructura

```
src/main.js             Proceso principal de Electron (ventana + IPC)
src/preload.js          Puente seguro entre la interfaz y el núcleo
src/renderer/           Interfaz (HTML/CSS/JS)
src/core/accounts.js    Cuentas Microsoft (msmc) y offline
src/core/modsync.js     Lectura del manifest y sincronización de archivos
src/core/java.js        Descarga de Java (Eclipse Temurin)
src/core/fabric.js      Instalación del perfil de Fabric
src/core/launch.js      Flujo completo de arranque (minecraft-launcher-core)
src/core/status.js      Ping al server (jugadores en línea)
tools/generate-manifest.js
```
