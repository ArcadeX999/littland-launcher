# Littland Launcher 1.1.0 — versión de prueba para admins

Esta versión añade **LittlandVoice**, el chat de voz de proximidad propio de Littland: dentro del juego, cifrado y con sonido 3D, sin mods ni Discord.

> ⚠️ Es una **versión de prueba**. Los launchers de los jugadores no se actualizan a ella; solo la tiene quien la instale desde aquí.

## Archivos

| Archivo | Para qué |
|---|---|
| `Littland-Launcher-Setup-1.1.0.exe` | Launcher con chat de voz. Instálalo encima del que tengas. |
| `LittlandVoice-1.0.0.jar` | Plugin de voz para el servidor (Paper/Purpur 1.21.x). |

## Poner la voz en el servidor

1. Copia `LittlandVoice-1.0.0.jar` en la carpeta `plugins/` y reinicia el servidor.
2. En el panel del hosting, pide o añade un **puerto UDP extra** para la voz.
3. En `plugins/LittlandVoice/config.yml`, pon ese número en `port:` y ejecuta `/voz recargar` (o reinicia el servidor).
4. En la consola debe aparecer `Voz escuchando en UDP 0.0.0.0:<puerto>`.
5. Pásale el número del puerto a quien mantiene el launcher, que activa la voz con `npm run publicar -- --voice-port <puerto> --voice-host <host>`.

Hasta que se haga el paso 5, el launcher no se conecta a la voz.

## Probarla

1. Entra con el launcher 1.1.0 y pulsa **JUGAR**.
2. Arriba debe aparecer **"🎤 Voz conectada"**, y en el juego, "🎤 Chat de voz conectado" sobre la barra de objetos.
3. Escribe **`/voz eco`**: te oirás a ti mismo delante, pasando por el servidor. Así se prueban el micrófono y el sonido 3D. Repite el comando para quitarlo.
4. Con otro admin, acercaos y alejaos: la voz debe bajar con la distancia y dejar de oírse a unos 48 bloques.

En el launcher, en **⚙ Ajustes → Chat de voz**, se eligen el micrófono, la salida y la sensibilidad, y hay una prueba de micrófono.

## Comandos

| Comando | Qué hace |
|---|---|
| `/voz estado` | Muestra si estás conectado y cuántos hay en la voz. |
| `/voz silenciar` | Apaga o enciende tu micrófono. |
| `/voz ensordecer` | Deja de oír a los demás, o vuelve a oírlos. |
| `/voz eco` | Prueba de eco. |
| `/voz recargar` | (Admins) Recarga `config.yml`. |

## Si algo falla

- **"Conectando voz…" sin terminar**: el puerto UDP no está abierto o no coincide con el de `config.yml`.
- **No se oye a nadie**: revisa el micrófono y la salida en Ajustes y prueba `/voz eco`.
- **Se oye ruido de fondo todo el rato**: sube la sensibilidad en Ajustes, poniendo la marca dorada por encima de la barra en silencio.
- La consola del launcher (botón **>_**) muestra los mensajes `[Voz]` con los detalles.
