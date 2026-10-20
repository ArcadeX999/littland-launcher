package net.littland.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import net.littland.app.MainActivity
import net.littland.app.R

/**
 * Foreground service (type microphone) that keeps the voice chat running while
 * Minecraft is in front: Android only lets a visible app or a foreground
 * service use the microphone.
 */
class VoiceService : Service() {
    private var client: VoiceClient? = null
    private var engine: AudioEngine? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val names = HashMap<Int, String>()
    private var uiTicker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopVoice()
            ACTION_TOGGLE_MUTE -> setMuted(!VoiceState.muted)
            else -> startVoice(
                intent?.getStringExtra(EXTRA_HOST) ?: return START_NOT_STICKY,
                intent.getIntExtra(EXTRA_PORT, 24454),
                intent.getStringExtra(EXTRA_NAME) ?: return START_NOT_STICKY,
                intent.getFloatExtra(EXTRA_THRESHOLD, -50f),
            )
        }
        return START_NOT_STICKY
    }

    private fun startVoice(host: String, port: Int, name: String, threshold: Float) {
        startForeground(NOTIFICATION_ID, notification("Conectando…"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        if (client != null) return
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "littland:voice").apply { acquire(6 * 60 * 60 * 1000L) }

        val engine = AudioEngine { seq, opus, len -> client?.sendAudio(seq, opus, len) }.also {
            it.threshold = threshold
            it.muted = VoiceState.muted
            it.onLevel = { db, tx ->
                VoiceState.level = db
                VoiceState.transmitting = tx
            }
            it.onError = { message -> VoiceState.detail = message }
        }
        this.engine = engine
        VoiceState.engine = engine
        // Start the mic now, while the app is still in front: Android 14+ won't let a
        // background app start recording later (when the player has opened Minecraft).
        engine.start()

        client = VoiceClient(host, port, name, object : VoiceClient.Listener {
            override fun onStatus(state: VoiceClient.State, reason: String?) {
                VoiceState.detail = VoiceState.describe(reason)
                when (state) {
                    VoiceClient.State.CONNECTED -> {
                        VoiceState.status = VoiceState.Status.CONNECTED
                        engine.distance = client?.distance ?: 48
                        updateNotification()
                    }
                    VoiceClient.State.CONNECTING -> {
                        VoiceState.status = VoiceState.Status.CONNECTING
                        updateNotification()
                    }
                    VoiceClient.State.DISCONNECTED -> Unit
                }
            }

            override fun onAudio(speaker: Int, sequence: Int, opus: ByteArray) = engine.onAudio(speaker, opus)
            override fun onPositions(listener: VoiceClient.Pose, speakers: List<VoiceClient.SpeakerPosition>) =
                engine.onPositions(listener, speakers)

            override fun onSpeaker(id: Int, name: String) {
                synchronized(names) { names[id] = name }
            }

            override fun onServerState(muted: Boolean, deafened: Boolean, echo: Boolean) {
                VoiceState.muted = muted
                VoiceState.deafened = deafened
                VoiceState.echo = echo
                engine.muted = muted
                engine.deafened = deafened
                updateNotification()
            }
        }).also { it.start() }

        uiTicker = Thread {
            var ticks = 0
            while (client != null) {
                VoiceState.talking = engine.talking(synchronized(names) { HashMap(names) })
                if (++ticks % 20 == 0) { // every 5 s, for `adb logcat -s LittlandVoice`
                    val encodeMs = if (engine.sentPackets > 0) engine.encodeNanos / 1e6 / engine.sentPackets else 0.0
                    android.util.Log.i(
                        "LittlandVoice",
                        "estado=${VoiceState.status} ${VoiceState.detail ?: ""} capturados=${engine.capturedFrames} " +
                            "enviados=${engine.sentPackets} recibidos=${engine.receivedPackets} " +
                            "opus=${"%.2f".format(encodeMs)}ms/paquete nivel=${VoiceState.level.toInt()}dB",
                    )
                }
                try {
                    Thread.sleep(250)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.apply { isDaemon = true; start() }
    }

    private fun setMuted(muted: Boolean) {
        VoiceState.muted = muted
        engine?.muted = muted
        client?.setState(muted, VoiceState.deafened)
        updateNotification()
    }

    private fun stopVoice() {
        client?.close()
        client = null
        uiTicker?.interrupt()
        engine?.stop()
        engine = null
        VoiceState.engine = null
        VoiceState.status = VoiceState.Status.OFF
        VoiceState.detail = null
        VoiceState.talking = emptyList()
        wakeLock?.takeIf { it.isHeld }?.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (client != null) stopVoice()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- notification

    private fun updateNotification() {
        val text = when {
            VoiceState.status == VoiceState.Status.CONNECTING -> VoiceState.detail ?: "Conectando…"
            VoiceState.muted -> "🔇 Micrófono silenciado"
            else -> "🎤 Chat de voz activo"
        }
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Chat de voz", NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        fun action(action: String, request: Int) = PendingIntent.getService(
            this, request, Intent(this, VoiceService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Littland Voice")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, if (VoiceState.muted) "Activar micro" else "Silenciar", action(ACTION_TOGGLE_MUTE, 1)).build())
            .addAction(Notification.Action.Builder(null, "Desconectar", action(ACTION_STOP, 2)).build())
            .build()
    }

    companion object {
        private const val CHANNEL = "voice"
        private const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "net.littland.app.STOP"
        const val ACTION_TOGGLE_MUTE = "net.littland.app.TOGGLE_MUTE"
        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_NAME = "name"
        const val EXTRA_THRESHOLD = "threshold"

        fun start(context: Context, host: String, port: Int, name: String, threshold: Float) {
            context.startForegroundService(
                Intent(context, VoiceService::class.java)
                    .putExtra(EXTRA_HOST, host).putExtra(EXTRA_PORT, port)
                    .putExtra(EXTRA_NAME, name).putExtra(EXTRA_THRESHOLD, threshold),
            )
        }

        fun stop(context: Context) {
            context.startService(Intent(context, VoiceService::class.java).setAction(ACTION_STOP))
        }

        fun toggleMute(context: Context) {
            context.startService(Intent(context, VoiceService::class.java).setAction(ACTION_TOGGLE_MUTE))
        }
    }
}
