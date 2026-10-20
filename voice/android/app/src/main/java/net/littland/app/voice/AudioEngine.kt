package net.littland.app.voice

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import org.concentus.OpusApplication
import org.concentus.OpusDecoder
import org.concentus.OpusEncoder
import org.concentus.OpusSignal
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Microphone -> voice activity detection -> Opus -> [send], and received Opus ->
 * per-speaker adaptive jitter buffer -> positional stereo mix -> speaker.
 * Mirrors the PC launcher's src/renderer/voice.js + voice-worklet.js.
 */
class AudioEngine(private val send: (sequence: Int, opus: ByteArray, length: Int) -> Unit) {

    // Tunables shared with the UI (any thread).
    @Volatile var threshold = -50f // dBFS needed to start sending
    @Volatile var micGain = 1f
    @Volatile var volume = 1f
    @Volatile var muted = false
    @Volatile var deafened = false
    @Volatile var distance = 48
    /** (dBFS, transmitting) every 20 ms, for the level meter. */
    @Volatile var onLevel: ((Float, Boolean) -> Unit)? = null

    /** Counters for the debug log. */
    @Volatile var sentPackets = 0
    @Volatile var receivedPackets = 0
    @Volatile var capturedFrames = 0 // 20 ms frames read from the mic (should be 50/s)
    @Volatile var encodeNanos = 0L // total time spent in Opus encoding

    private val streams = HashMap<Int, Stream>()
    private fun timedEncode(encoder: OpusEncoder, frame: ShortArray, packet: ByteArray): Int {
        val start = System.nanoTime()
        val n = encoder.encode(frame, 0, FRAME, packet, 0, packet.size)
        encodeNanos += System.nanoTime() - start
        return n
    }

    private val sendCounted: (Int, ByteArray, Int) -> Unit = { seq, opus, len ->
        if (len > 0) sentPackets++
        send(seq, opus, len)
    }
    @Volatile private var pose = VoiceClient.Pose(0f, 0f, 0f, 0f, 0f)
    @Volatile private var running = false
    private var captureThread: Thread? = null
    private var mixThread: Thread? = null

    fun start() {
        if (running) return
        running = true
        // Opus is plain Java: Android only compiles it to fast code after it has run a while
        // (the first packets took ~20 ms each, the whole 20 ms budget). Warm it up on spare
        // time while the player is still opening Minecraft.
        Thread({
            val silence = ShortArray(FRAME)
            val packet = ByteArray(1275)
            val encoder = OpusEncoder(RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP).apply { complexity = 5 }
            val decoder = OpusDecoder(RATE, 1)
            val pcm = ShortArray(FRAME)
            repeat(250) {
                // A little noise so the encoder exercises its real code paths, not just silence.
                for (i in silence.indices) silence[i] = ((i * 7919 + it * 104729) % 2001 - 1000).toShort()
                val n = encoder.encode(silence, 0, FRAME, packet, 0, packet.size)
                decoder.decode(packet, 0, n, pcm, 0, FRAME, false)
            }
        }, "LittlandVoice-warmup").apply { priority = Thread.MIN_PRIORITY; isDaemon = true; start() }
        captureThread = Thread(::captureLoop, "LittlandVoice-mic").apply { priority = Thread.MAX_PRIORITY; start() }
        mixThread = Thread(::mixLoop, "LittlandVoice-out").apply { priority = Thread.MAX_PRIORITY; start() }
    }

    fun stop() {
        running = false
        captureThread?.join(500)
        mixThread?.join(500)
        synchronized(streams) { streams.clear() }
    }

    // ---------------------------------------------------------------- capture

    /** An audio failure must not crash the app (and Minecraft's voice with it): report it instead. */
    @Volatile var onError: ((String) -> Unit)? = null

    private inline fun guarded(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            android.util.Log.e("LittlandVoice", "Fallo en $what", e)
            onError?.invoke("No se pudo usar la $what: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission") // checked by the activity before starting the service
    private fun captureLoop() = guarded("entrada de micrófono") { captureLoopUnguarded() }

    @SuppressLint("MissingPermission")
    private fun captureLoopUnguarded() {
        val minBuffer = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, max(minBuffer, FRAME * 2 * 4),
        )
        val session = record.audioSessionId
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(session)?.enabled = true
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(session)?.enabled = true
        if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(session)?.enabled = true

        val encoder = OpusEncoder(RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP).apply {
            bitrate = 24000
            complexity = 5 // phones: good quality without heating up
            signalType = OpusSignal.OPUS_SIGNAL_VOICE
        }
        val packet = ByteArray(1275)
        val preroll = ArrayDeque<ShortArray>()
        var sequence = 0
        var hangover = 0
        var talking = false

        record.startRecording()
        try {
            while (running) {
                val frame = ShortArray(FRAME)
                var read = 0
                while (read < FRAME && running) {
                    val n = record.read(frame, read, FRAME - read)
                    if (n <= 0) break
                    read += n
                }
                if (read < FRAME) continue
                capturedFrames++

                var sum = 0.0
                val gain = micGain
                for (i in 0 until FRAME) {
                    val v = (frame[i] * gain).coerceIn(-32768f, 32767f)
                    frame[i] = v.toInt().toShort()
                    val f = v / 32768f
                    sum += f * f
                }
                val db = (10 * log10(sum / FRAME + 1e-12)).toFloat()
                if (db > threshold) hangover = HANGOVER_FRAMES else if (hangover > 0) hangover--
                val now = hangover > 0 && !muted
                onLevel?.invoke(db, now)

                if (now) {
                    // Speech onsets are quiet: also send the 60 ms before detection.
                    if (!talking) while (preroll.isNotEmpty()) {
                        sendCounted(sequence++, packet, timedEncode(encoder, preroll.removeFirst(), packet))
                    }
                    sendCounted(sequence++, packet, timedEncode(encoder, frame, packet))
                } else {
                    preroll.addLast(frame)
                    if (preroll.size > PREROLL_FRAMES) preroll.removeFirst()
                    if (talking) sendCounted(sequence++, packet, 0) // "stopped talking"
                }
                talking = now
            }
        } finally {
            record.stop()
            record.release()
        }
    }

    // ---------------------------------------------------------------- receive

    fun onAudio(speaker: Int, opus: ByteArray) {
        if (opus.isNotEmpty()) receivedPackets++
        if (deafened) return
        val stream = synchronized(streams) { streams.getOrPut(speaker) { Stream() } }
        stream.receive(opus)
    }

    fun onPositions(listener: VoiceClient.Pose, speakers: List<VoiceClient.SpeakerPosition>) {
        pose = listener
        synchronized(streams) {
            for (p in speakers) streams.getOrPut(p.id) { Stream() }.position = p
        }
    }

    /** Names of whoever is talking right now (for the UI). */
    fun talking(names: Map<Int, String>): List<String> {
        val now = System.nanoTime()
        return synchronized(streams) {
            streams.filter { now - it.value.lastAudio < 400_000_000 }
                .map { (id, _) -> if (id == VoiceClient.ECHO_SPEAKER) "Eco (tú)" else names[id] ?: "…" }
        }
    }

    /** One speaker: Opus decoder + adaptive jitter buffer (see voice-worklet.js). */
    private class Stream {
        private val decoder = OpusDecoder(RATE, 1)
        private val queue = ArrayDeque<ShortArray>()
        private var buffering = true
        private var ended = false
        private var lastArrival = 0L
        private var peakJitter = 0.0
        @Volatile var position: VoiceClient.SpeakerPosition? = null
        @Volatile var lastAudio = 0L

        private val target: Int
            get() = min(MAX_TARGET, max(MIN_TARGET, ceil(peakJitter / 0.02).toInt() + 1))

        @Synchronized
        fun receive(opus: ByteArray) {
            if (opus.isEmpty()) { // speaker stopped talking: the silence isn't jitter
                ended = true
                lastArrival = 0
                lastAudio = 0
                return
            }
            val now = System.nanoTime()
            if (lastArrival != 0L) {
                val jitter = abs((now - lastArrival) / 1e9 - 0.02)
                peakJitter = max(jitter, peakJitter * 0.997)
            }
            lastArrival = now
            lastAudio = now
            ended = false
            val pcm = ShortArray(FRAME)
            val n = try {
                decoder.decode(opus, 0, opus.size, pcm, 0, FRAME, false)
            } catch (_: Exception) {
                return
            }
            if (n <= 0) return
            queue.addLast(pcm)
            val t = target
            if (queue.size > t + SLACK) repeat(queue.size - t) { queue.removeFirst() }
        }

        /** Next 20 ms for the mixer, or null while (re)buffering / silent. */
        @Synchronized
        fun next(): ShortArray? {
            if (buffering) {
                if (queue.size < target) return null
                buffering = false
            }
            val frame = queue.removeFirstOrNull()
            if (frame == null) buffering = true
            return frame
        }
    }

    // ---------------------------------------------------------------- mix

    /** Low-latency output when the device offers it, otherwise a normal one. */
    private fun createTrack(): AudioTrack {
        fun build(lowLatency: Boolean) = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build(),
            )
            .setBufferSizeInBytes(
                max(AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT), FRAME * 4 * 3),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .apply { if (lowLatency) setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY) }
            .build()
        return try {
            build(lowLatency = true)
        } catch (_: UnsupportedOperationException) {
            build(lowLatency = false)
        }
    }

    private fun mixLoop() = guarded("salida de audio") {
        val track = createTrack()
        val mix = FloatArray(FRAME * 2)
        val out = ShortArray(FRAME * 2)
        track.play()
        try {
            while (running) {
                mix.fill(0f)
                val snapshot = synchronized(streams) { streams.values.toList() }
                for (s in snapshot) {
                    val frame = s.next() ?: continue
                    val (left, right) = spatialGains(s.position)
                    for (i in 0 until FRAME) {
                        val v = frame[i] / 32768f
                        mix[2 * i] += v * left
                        mix[2 * i + 1] += v * right
                    }
                }
                val vol = volume
                for (i in mix.indices) out[i] = (mix[i] * vol * 32767f).coerceIn(-32768f, 32767f).toInt().toShort()
                track.write(out, 0, out.size) // blocks: paces the loop at 20 ms
            }
        } finally {
            track.stop()
            track.release()
        }
    }

    /**
     * Linear distance falloff (like the launcher's PannerNode) and equal-power
     * left/right panning from the speaker's angle relative to where we look.
     * Minecraft: yaw 0 looks toward +Z, 90 toward -X.
     */
    private fun spatialGains(p: VoiceClient.SpeakerPosition?): Pair<Float, Float> {
        if (p == null) return 0.7f to 0.7f
        val me = pose
        val dx = p.x - me.x
        val dy = p.y - me.y
        val dz = p.z - me.z
        val dist = sqrt(dx * dx + dy * dy + dz * dz)
        val gain = when {
            dist <= REF_DISTANCE -> 1f
            dist >= distance -> 0f
            else -> 1f - (dist - REF_DISTANCE) / (distance - REF_DISTANCE)
        }
        val yaw = Math.toRadians(me.yaw.toDouble())
        // Speaker direction in listener space: forward = (-sin yaw, cos yaw), right = (-cos yaw, -sin yaw).
        val forward = -sin(yaw) * dx + cos(yaw) * dz
        val right = -cos(yaw) * dx - sin(yaw) * dz
        val azimuth = atan2(right, forward) // 0 = in front, +90° = right
        val pan = sin(azimuth).toFloat() // -1 left .. +1 right
        val angle = (pan + 1) * Math.PI / 4 // equal-power
        val behind = if (forward < 0) 0.85f else 1f // slightly duller from behind
        return (gain * behind * cos(angle).toFloat()) to (gain * behind * sin(angle).toFloat())
    }

    companion object {
        const val RATE = 48000
        const val FRAME = 960 // 20 ms
        private const val HANGOVER_FRAMES = 15
        private const val PREROLL_FRAMES = 3
        private const val MIN_TARGET = 2
        private const val MAX_TARGET = 10
        private const val SLACK = 4
        private const val REF_DISTANCE = 2f
    }
}
