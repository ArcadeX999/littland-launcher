package net.littland.app.voice

import java.math.BigInteger
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketException
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * UDP client for the LittlandVoice plugin (voice/PROTOCOL.md). Same protocol
 * as the PC launcher's src/voice/client.js; this one reports platform Bedrock.
 */
class VoiceClient(
    private val host: String,
    private val port: Int,
    private val name: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onStatus(state: State, reason: String?)
        fun onAudio(speaker: Int, sequence: Int, opus: ByteArray)
        fun onPositions(listener: Pose, speakers: List<SpeakerPosition>)
        fun onSpeaker(id: Int, name: String)
        fun onServerState(muted: Boolean, deafened: Boolean, echo: Boolean)
    }

    enum class State { CONNECTING, CONNECTED, DISCONNECTED }

    data class Pose(val x: Float, val y: Float, val z: Float, val yaw: Float, val pitch: Float)
    data class SpeakerPosition(val id: Int, val x: Float, val y: Float, val z: Float)

    private class Session(val id: Int, val key: SecretKeySpec, val distance: Int)

    private val random = SecureRandom()
    private var socket: DatagramSocket? = null
    private var address: InetAddress? = null
    @Volatile private var session: Session? = null
    @Volatile private var keyPair: KeyPair? = null
    @Volatile private var closed = false
    @Volatile private var lastHeard = 0L
    @Volatile private var localState = 0
    private var receiveThread: Thread? = null
    private var timerThread: Thread? = null

    val distance: Int get() = session?.distance ?: 48

    fun start() {
        receiveThread = Thread({
            try {
                // No network yet (phone just woke up, Wi-Fi switching...): keep trying.
                while (address == null && !closed) {
                    try {
                        address = InetAddress.getByName(host)
                    } catch (e: java.net.UnknownHostException) {
                        listener.onStatus(State.CONNECTING, "Sin conexión a internet, reintentando…")
                        Thread.sleep(3000)
                    }
                }
                if (closed) return@Thread
                socket = DatagramSocket()
                handshake()
                receiveLoop()
            } catch (e: Exception) {
                if (!closed) listener.onStatus(State.DISCONNECTED, e.message)
            }
        }, "LittlandVoice-rx").apply { isDaemon = true; start() }

        timerThread = Thread({ timerLoop() }, "LittlandVoice-timer").apply { isDaemon = true; start() }
    }

    fun close() {
        if (closed) return
        sendInner(byteArrayOf(C_BYE))
        closed = true
        socket?.close()
        receiveThread?.interrupt()
        timerThread?.interrupt()
        listener.onStatus(State.DISCONNECTED, null)
    }

    // ---------------------------------------------------------------- handshake

    private fun handshake() {
        session = null
        keyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        listener.onStatus(State.CONNECTING, null)
        sendHello()
    }

    private fun sendHello() {
        val kp = keyPair ?: return
        val nameBytes = name.toByteArray(Charsets.UTF_8)
        val out = ByteBuffer.allocate(2 + 65 + 1 + nameBytes.size + 1)
        out.put(HELLO).put(PROTOCOL_VERSION.toByte())
        out.put(encodePublicKey(kp.public as ECPublicKey))
        out.put(nameBytes.size.toByte()).put(nameBytes)
        out.put(PLATFORM_BEDROCK)
        sendRaw(out.array())
    }

    /** Every 2 s: retry HELLO until welcomed, then PING; re-handshake if the server goes quiet. */
    private fun timerLoop() {
        while (!closed) {
            try {
                Thread.sleep(2000)
            } catch (_: InterruptedException) {
                return
            }
            if (socket == null) continue
            if (session == null) {
                sendHello()
            } else if (System.currentTimeMillis() - lastHeard > 8000) {
                listener.onStatus(State.CONNECTING, "Sin respuesta del servidor de voz")
                handshake()
            } else {
                sendInner(ByteBuffer.allocate(9).put(C_PING).putLong(System.currentTimeMillis()).array())
            }
        }
    }

    // ---------------------------------------------------------------- receive

    private fun receiveLoop() {
        val buffer = ByteArray(2048)
        while (!closed) {
            val packet = DatagramPacket(buffer, buffer.size)
            try {
                socket!!.receive(packet)
            } catch (e: SocketException) {
                return
            }
            try {
                handle(packet.data.copyOfRange(packet.offset, packet.offset + packet.length))
            } catch (_: Exception) {
                // Malformed or forged packet: ignore.
            }
        }
    }

    private fun handle(b: ByteArray) {
        if (b.isEmpty()) return
        when (b[0]) {
            WELCOME -> onWelcome(b)
            ENCRYPTED -> {
                val s = session ?: return
                val buf = ByteBuffer.wrap(b, 1, b.size - 1)
                if (buf.int != s.id) return
                val nonce = ByteArray(12).also { buf.get(it) }
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, s.key, GCMParameterSpec(128, nonce))
                val inner = cipher.doFinal(b, buf.position(), buf.remaining())
                lastHeard = System.currentTimeMillis()
                onInner(ByteBuffer.wrap(inner))
            }
        }
    }

    private fun onWelcome(b: ByteArray) {
        if (session != null) return
        val status = b[1].toInt()
        if (status != OK) {
            val reason = STATUS.getOrElse(status) { "status $status" }
            listener.onStatus(State.CONNECTING, reason)
            if (status == BAD_VERSION || status == DISABLED) close()
            return
        }
        val buf = ByteBuffer.wrap(b, 2, b.size - 2)
        val serverKey = ByteArray(65).also { buf.get(it) }
        val kp = keyPair ?: return
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(kp.private)
        agreement.doPhase(decodePublicKey(serverKey, kp.public as ECPublicKey), true)
        val sha = MessageDigest.getInstance("SHA-256")
        sha.update(agreement.generateSecret())
        sha.update("littland-voice-v1".toByteArray(Charsets.US_ASCII))
        session = Session(buf.int, SecretKeySpec(sha.digest(), "AES"), buf.short.toInt() and 0xFFFF)
        lastHeard = System.currentTimeMillis()
        listener.onStatus(State.CONNECTED, null)
        if (localState != 0) sendInner(byteArrayOf(C_STATE, localState.toByte()))
    }

    private fun onInner(b: ByteBuffer) {
        when (b.get()) {
            S_AUDIO -> {
                val speaker = b.int
                val sequence = b.int
                val opus = ByteArray(b.remaining()).also { b.get(it) }
                listener.onAudio(speaker, sequence, opus)
            }
            S_POSITIONS -> {
                val pose = Pose(b.float, b.float, b.float, b.float, b.float)
                val count = b.get().toInt() and 0xFF
                val speakers = List(count) { SpeakerPosition(b.int, b.float, b.float, b.float) }
                listener.onPositions(pose, speakers)
            }
            S_STATE -> {
                val f = b.get().toInt()
                listener.onServerState(f and 1 != 0, f and 2 != 0, f and 4 != 0)
            }
            S_SPEAKER -> {
                val id = b.int
                val name = ByteArray(b.get().toInt() and 0xFF).also { b.get(it) }
                listener.onSpeaker(id, String(name, Charsets.UTF_8))
            }
            S_BYE -> {
                val reason = ByteArray(b.get().toInt() and 0xFF).also { b.get(it) }
                listener.onStatus(State.CONNECTING, String(reason, Charsets.UTF_8))
                handshake() // e.g. the server restarted: try again
            }
            else -> Unit
        }
    }

    // ---------------------------------------------------------------- send

    fun sendAudio(sequence: Int, opus: ByteArray, length: Int = opus.size) {
        val out = ByteBuffer.allocate(5 + length)
        out.put(C_AUDIO).putInt(sequence).put(opus, 0, length)
        sendInner(out.array())
    }

    /** Mute/deafen chosen in the app. */
    fun setState(muted: Boolean, deafened: Boolean) {
        localState = (if (muted) 1 else 0) or (if (deafened) 2 else 0)
        sendInner(byteArrayOf(C_STATE, localState.toByte()))
    }

    private fun sendInner(inner: ByteArray) {
        val s = session ?: return
        if (closed) return
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, s.key, GCMParameterSpec(128, nonce))
        val body = cipher.doFinal(inner)
        val out = ByteBuffer.allocate(1 + 4 + 12 + body.size)
        out.put(ENCRYPTED).putInt(s.id).put(nonce).put(body)
        sendRaw(out.array())
    }

    private fun sendRaw(data: ByteArray) {
        try {
            socket?.send(DatagramPacket(data, data.size, address, port))
        } catch (_: Exception) {
            // Network hiccup: the timer loop retries / reconnects.
        }
    }

    companion object {
        private const val PROTOCOL_VERSION = 1
        private const val HELLO: Byte = 0x01
        private const val WELCOME: Byte = 0x02
        private const val ENCRYPTED: Byte = 0x10
        private const val C_AUDIO: Byte = 0x20
        private const val C_PING: Byte = 0x21
        private const val C_STATE: Byte = 0x22
        private const val C_BYE: Byte = 0x23
        private const val S_AUDIO: Byte = 0x30
        private const val S_POSITIONS: Byte = 0x31
        private const val S_STATE: Byte = 0x33
        private const val S_SPEAKER: Byte = 0x34
        private const val S_BYE: Byte = 0x35
        private const val PLATFORM_BEDROCK: Byte = 1
        private const val OK = 0
        private const val BAD_VERSION = 3
        private const val DISABLED = 4
        private val STATUS = listOf("OK", "NOT_ONLINE", "ADDRESS_MISMATCH", "BAD_VERSION", "DISABLED")

        const val ECHO_SPEAKER = -1 // 0xFFFFFFFF

        private fun encodePublicKey(key: ECPublicKey): ByteArray {
            val out = ByteArray(65)
            out[0] = 0x04
            copyFixed(key.w.affineX, out, 1)
            copyFixed(key.w.affineY, out, 33)
            return out
        }

        private fun copyFixed(value: BigInteger, out: ByteArray, offset: Int) {
            val raw = value.toByteArray()
            val length = minOf(raw.size, 32)
            System.arraycopy(raw, raw.size - length, out, offset + 32 - length, length)
        }

        private fun decodePublicKey(encoded: ByteArray, sameCurve: ECPublicKey): ECPublicKey {
            val x = BigInteger(1, encoded.copyOfRange(1, 33))
            val y = BigInteger(1, encoded.copyOfRange(33, 65))
            val spec = ECPublicKeySpec(ECPoint(x, y), sameCurve.params)
            return KeyFactory.getInstance("EC").generatePublic(spec) as ECPublicKey
        }
    }
}
