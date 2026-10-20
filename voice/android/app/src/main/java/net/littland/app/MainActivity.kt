@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class) // combinedClickable

package net.littland.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.littland.app.voice.AudioEngine
import net.littland.app.voice.VoiceService
import net.littland.app.voice.VoiceState

// Littland palette (same as the PC launcher's style.css).
private val Bg = Color(0xFF070D08)
private val Panel = Color(0xFF102012)
private val Border = Color(0xFF2F5A37)
private val TextColor = Color(0xFFE9F2E6)
private val Muted = Color(0xFF8FA391)
private val Accent = Color(0xFF6FD64A)
private val AccentDeep = Color(0xFF1F5C12)
private val Gold = Color(0xFFF7C234)
private val Danger = Color(0xFFEF4444)
private val Purple = Color(0xFF6670F5)
private val PurpleDeep = Color(0xFF3B44B8)
private val Mono = FontFamily.Monospace

class MainActivity : ComponentActivity() {
    private var pendingPlay: (() -> Unit)? = null

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) pendingPlay?.invoke()
        else Toast.makeText(this, "Sin micrófono no hay chat de voz", Toast.LENGTH_LONG).show()
        pendingPlay = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyDebugExtras()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Bg, surface = Panel)) {
                Screen(onPlay = ::withMicPermission)
            }
        }
    }

    /**
     * Debug builds only: configure from the command line for automated tests, e.g.
     * adb shell am start -n net.littland.app/.MainActivity --es manifestUrl http://10.0.2.2:8766/manifest.json
     *   --es gamertag MovilTest --ef threshold -80
     */
    private fun applyDebugExtras() {
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        val prefs = getSharedPreferences("littland", Context.MODE_PRIVATE).edit()
        intent.getStringExtra("manifestUrl")?.let { ServerConfig.setManifestUrl(this, it) }
        intent.getStringExtra("gamertag")?.let { prefs.putString("gamertag", it) }
        if (intent.hasExtra("threshold")) prefs.putFloat("threshold", intent.getFloatExtra("threshold", -50f))
        prefs.apply()
        // --ez autoVoice true: start the voice right away (there's no Minecraft in the emulator).
        if (intent.getBooleanExtra("autoVoice", false)) {
            val saved = getSharedPreferences("littland", Context.MODE_PRIVATE)
            Thread {
                val cfg = ServerConfig.load(this)
                VoiceService.start(
                    this, cfg.voiceHost, cfg.voicePort,
                    saved.getString("gamertag", "") ?: "", saved.getFloat("threshold", -50f),
                )
            }.start()
        }
    }

    /** Asks for the microphone (and notifications, for the voice notice) before [action]. */
    private fun withMicPermission(action: () -> Unit) {
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) action() else {
            pendingPlay = action
            permissions.launch(needed.toTypedArray())
        }
    }
}

@Composable
private fun Screen(onPlay: (() -> Unit) -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("littland", Context.MODE_PRIVATE) }
    var gamertag by remember { mutableStateOf(prefs.getString("gamertag", "") ?: "") }
    var voiceOn by remember { mutableStateOf(prefs.getBoolean("voice", true)) }
    var threshold by remember { mutableStateOf(prefs.getFloat("threshold", -50f)) }
    var config by remember { mutableStateOf<ServerConfig?>(null) }
    var testing by remember { mutableStateOf(false) }
    var devDialog by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var voiceExpanded by remember { mutableStateOf(false) }
    var news by remember { mutableStateOf<List<ServerConfig.News>?>(null) }

    LaunchedEffect(reload) {
        config = null
        Thread {
            config = ServerConfig.load(context)
            news = ServerConfig.loadNews(context)
        }.start()
    }

    // Mic test: a local engine that plays your own voice back.
    DisposableEffect(testing) {
        var test: AudioEngine? = null
        if (testing) {
            lateinit var engine: AudioEngine
            engine = AudioEngine { _, opus, len -> engine.onAudio(-2, opus.copyOf(len)) }
            engine.threshold = threshold
            engine.onLevel = { db, tx -> VoiceState.level = db; VoiceState.transmitting = tx }
            engine.start()
            VoiceState.engine = engine
            test = engine
        }
        onDispose {
            test?.stop()
            if (VoiceState.engine === test) VoiceState.engine = null
        }
    }

    val live = VoiceState.status != VoiceState.Status.OFF

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0E1F0F), Bg))),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Header (long-press the logo: test-server settings)
            Image(
                painterResource(R.drawable.ic_launcher), null,
                Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .border(3.dp, Color.Black, RoundedCornerShape(6.dp))
                    .combinedClickable(onClick = {}, onLongClick = { devDialog = true }),
            )
            Spacer(Modifier.height(14.dp))
            Text(
                buildAnnotatedString {
                    append("LITTLAND ")
                    withStyle(SpanStyle(color = Gold, shadow = Shadow(Color(0xFF7A5306), Offset(0f, 8f)))) { append("2") }
                },
                style = TextStyle(
                    fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 40.sp, letterSpacing = 4.sp,
                    color = TextColor, shadow = Shadow(AccentDeep, Offset(0f, 8f)),
                ),
            )
            Text(
                "MINECRAFT SERVER · BEDROCK", color = Accent, fontFamily = Mono, fontSize = 11.sp,
                letterSpacing = 3.sp, modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(24.dp))

            PanelBox {
                Label("TU GAMERTAG DE XBOX")
                OutlinedTextField(
                    value = gamertag,
                    onValueChange = {
                        gamertag = it.take(16)
                        prefs.edit().putString("gamertag", gamertag).apply()
                    },
                    singleLine = true,
                    enabled = !live,
                    placeholder = { Text("El mismo nombre que usas en Minecraft") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent, unfocusedBorderColor = Border,
                        focusedTextColor = TextColor, unfocusedTextColor = TextColor,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(14.dp))
            PanelBox {
                // Collapsed: one line with the status. Tap to open the settings.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { voiceExpanded = !voiceExpanded },
                ) {
                    Text("🎤 CHAT DE VOZ", color = Accent, fontFamily = Mono, fontWeight = FontWeight.Bold,
                        fontSize = 13.sp, letterSpacing = 2.sp)
                    Text(
                        "  ·  " + voiceStatusText(config), color = voiceStatusColor(), fontSize = 12.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                    )
                    Text(if (voiceExpanded) "▴" else "▾", color = Muted, fontSize = 18.sp)
                }
                if (VoiceState.talking.isNotEmpty()) {
                    Text("🔊 " + VoiceState.talking.joinToString(", "), color = Accent, fontSize = 13.sp,
                        modifier = Modifier.padding(top = 8.dp))
                }

                AnimatedVisibility(visible = voiceExpanded) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                            Text("Conectar el chat de voz al jugar", color = TextColor, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            Switch(
                                checked = voiceOn,
                                enabled = !live,
                                onCheckedChange = {
                                    voiceOn = it
                                    prefs.edit().putBoolean("voice", it).apply()
                                },
                                colors = SwitchDefaults.colors(
                                    checkedTrackColor = AccentDeep, checkedThumbColor = Accent,
                                    // Locked while the voice is running, but still clearly "on".
                                    disabledCheckedTrackColor = AccentDeep, disabledCheckedThumbColor = Accent.copy(alpha = 0.6f),
                                ),
                            )
                        }

                        Spacer(Modifier.height(8.dp))
                        Text("Sensibilidad: transmite por encima de ${threshold.toInt()} dB", color = Muted, fontSize = 12.sp)
                        LevelMeter(threshold, active = live || testing)
                        Slider(
                            value = threshold,
                            onValueChange = {
                                threshold = it
                                VoiceState.engine?.threshold = it
                            },
                            onValueChangeFinished = { prefs.edit().putFloat("threshold", threshold).apply() },
                            valueRange = -80f..-20f,
                            colors = SliderDefaults.colors(thumbColor = Gold, activeTrackColor = Accent, inactiveTrackColor = Border),
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            if (live) {
                                SmallButton(if (VoiceState.muted) "🔇 ACTIVAR MICRO" else "🎤 SILENCIAR", Modifier.weight(1f)) {
                                    VoiceService.toggleMute(context)
                                }
                                SmallButton("DESCONECTAR", Modifier.weight(1f)) { VoiceService.stop(context) }
                            } else {
                                SmallButton(if (testing) "DETENER PRUEBA" else "PROBAR MICRÓFONO", Modifier.fillMaxWidth()) {
                                    if (testing) testing = false else onPlay { testing = true }
                                }
                            }
                        }
                        Text(
                            "Usa auriculares: si no, los demás oirán el sonido del juego por tu micrófono.",
                            color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
            PlayButton(enabled = gamertag.isNotBlank() && config != null) {
                testing = false
                val cfg = config ?: return@PlayButton
                val launch = {
                    if (voiceOn && cfg.voiceEnabled && !live) {
                        VoiceService.start(context, cfg.voiceHost, cfg.voicePort, gamertag.trim(), threshold)
                    }
                    openMinecraft(context, cfg)
                }
                if (voiceOn && cfg.voiceEnabled) onPlay(launch) else launch()
            }
            Text(
                config?.let { "${it.bedrockHost}:${it.bedrockPort}" } ?: "Cargando servidor…",
                color = Muted, fontFamily = Mono, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp),
            )

            config?.discordUrl?.let { url ->
                Spacer(Modifier.height(18.dp))
                BlockButton("UNIRME AL DISCORD", Purple, PurpleDeep, height = 52.dp, fontSize = 16.sp) {
                    openLink(context, url)
                }
            }

            Spacer(Modifier.height(28.dp))
            NewsSection(news) { openLink(context, it) }
        }
    }

    if (devDialog) DevDialog(context, onClose = { devDialog = false; reload++ })
}

@Composable
private fun voiceStatusText(config: ServerConfig?): String = when {
    config != null && !config.voiceEnabled -> "El servidor aún no tiene chat de voz"
    VoiceState.status == VoiceState.Status.CONNECTED ->
        if (VoiceState.muted) "Conectado · micrófono silenciado" else "Conectado"
    VoiceState.status == VoiceState.Status.CONNECTING -> VoiceState.detail ?: "Conectando…"
    else -> "Se activa al pulsar JUGAR"
}

@Composable
private fun voiceStatusColor(): Color = when (VoiceState.status) {
    VoiceState.Status.CONNECTED -> if (VoiceState.muted) Danger else Accent
    VoiceState.Status.CONNECTING -> Gold
    else -> Muted
}

/** Opens Minecraft Bedrock straight into the server. */
private fun openMinecraft(context: Context, cfg: ServerConfig) {
    val uri = Uri.parse("minecraft://connect/?serverUrl=${cfg.bedrockHost}&serverPort=${cfg.bedrockPort}")
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No se encontró Minecraft en este móvil", Toast.LENGTH_LONG).show()
    }
}

// ---------------------------------------------------------------- widgets

@Composable
private fun PanelBox(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Panel)
            .border(2.dp, Border, RoundedCornerShape(12.dp))
            .padding(16.dp),
    ) { content() }
}

@Composable
private fun Label(text: String) {
    Text(text, color = Accent, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 13.sp,
        letterSpacing = 2.sp, modifier = Modifier.padding(bottom = 8.dp))
}

@Composable
private fun LevelMeter(threshold: Float, active: Boolean) {
    val level = if (active) VoiceState.level else -90f
    fun pct(db: Float) = ((db + 80f) / 60f).coerceIn(0f, 1f)
    Box(
        Modifier
            .padding(top = 6.dp)
            .fillMaxWidth()
            .height(12.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(Color(0xFF050805))
            .border(1.dp, Border, RoundedCornerShape(3.dp)),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(pct(level))
                .background(if (active && VoiceState.transmitting) Accent else Muted),
        )
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(pct(threshold))
                .padding(start = 0.dp),
            contentAlignment = Alignment.CenterEnd,
        ) { Box(Modifier.width(3.dp).fillMaxHeight().background(Gold)) }
    }
}

@Composable
private fun SmallButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.border(2.dp, Color.Black, RoundedCornerShape(6.dp)),
        shape = RoundedCornerShape(6.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F3523), contentColor = TextColor),
    ) { Text(text, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.sp) }
}

/** The big green JUGAR button. */
@Composable
private fun PlayButton(enabled: Boolean, onClick: () -> Unit) =
    BlockButton("⛏  JUGAR", Color(0xFF5FC038), AccentDeep, enabled = enabled, onClick = onClick)

/** Chunky 3D block button, like the ones on the Littland website. */
@Composable
private fun BlockButton(
    text: String,
    color: Color,
    deep: Color,
    enabled: Boolean = true,
    height: androidx.compose.ui.unit.Dp = 64.dp,
    fontSize: androidx.compose.ui.unit.TextUnit = 24.sp,
    onClick: () -> Unit,
) {
    Box(Modifier.fillMaxWidth().height(height + 6.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(height)
                .offset(y = 6.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(deep),
        )
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier
                .fillMaxWidth()
                .height(height)
                .border(3.dp, Color.Black, RoundedCornerShape(8.dp)),
            shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = color, contentColor = Color.White,
                disabledContainerColor = Color(0xFF2E4A30), disabledContentColor = Muted,
            ),
        ) {
            Text(text, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = fontSize, letterSpacing = 4.sp,
                style = TextStyle(shadow = Shadow(Color(0x66000000), Offset(0f, 4f))))
        }
    }
}

@Composable
private fun NewsSection(news: List<ServerConfig.News>?, onOpen: (String) -> Unit) {
    Text(
        "📰 NOTICIAS", color = Gold, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 15.sp,
        letterSpacing = 3.sp, modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
    )
    when {
        news == null -> Text("Cargando…", color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth())
        news.isEmpty() -> Text("No hay noticias por ahora.", color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth())
        else -> news.forEach { item ->
            var open by remember(item) { mutableStateOf(false) }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 10.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Panel)
                    .border(1.dp, Border, RoundedCornerShape(10.dp))
                    .clickable { open = !open }
                    .padding(14.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(item.title, color = TextColor, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Text(formatDate(item.date), color = Muted, fontFamily = Mono, fontSize = 11.sp)
                }
                Text(
                    item.body, color = Color(0xFFCFDCCC), fontSize = 13.sp, lineHeight = 18.sp,
                    maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp),
                )
                if (open && item.url != null) {
                    Text("Ver más →", color = Accent, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                        modifier = Modifier.padding(top = 8.dp).clickable { onOpen(item.url) })
                }
            }
        }
    }
}

/** "2026-10-20" -> "20/10/2026". */
private fun formatDate(date: String): String =
    date.split("-").takeIf { it.size == 3 }?.reversed()?.joinToString("/") ?: date

private fun openLink(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show()
    }
}

@Composable
private fun DevDialog(context: Context, onClose: () -> Unit) {
    var url by remember { mutableStateOf(ServerConfig.manifestUrl(context)) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Servidor de pruebas") },
        text = {
            Column {
                Text("URL del manifest (vacío = Littland):", fontSize = 13.sp)
                OutlinedTextField(value = url, onValueChange = { url = it }, singleLine = true)
                Text(
                    "Emulador: http://10.0.2.2:8766/manifest.json · Móvil: http://IP-DE-TU-PC:8766/manifest.json",
                    fontSize = 11.sp, color = Muted, textAlign = TextAlign.Start,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                ServerConfig.setManifestUrl(context, url.takeIf { it != ServerConfig.DEFAULT_MANIFEST })
                onClose()
            }) { Text("Guardar") }
        },
        dismissButton = {
            TextButton(onClick = {
                ServerConfig.setManifestUrl(context, null)
                onClose()
            }) { Text("Usar Littland") }
        },
    )
}
