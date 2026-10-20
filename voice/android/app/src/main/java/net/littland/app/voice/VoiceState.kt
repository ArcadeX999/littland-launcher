package net.littland.app.voice

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Voice state shared by VoiceService (writer) and the UI (reader). */
object VoiceState {
    enum class Status { OFF, CONNECTING, CONNECTED }

    var status by mutableStateOf(Status.OFF)
    /** Human-readable detail, e.g. why it's still connecting. */
    var detail by mutableStateOf<String?>(null)
    var muted by mutableStateOf(false)
    var deafened by mutableStateOf(false)
    var echo by mutableStateOf(false)
    var level by mutableFloatStateOf(-90f)
    var transmitting by mutableStateOf(false)
    var talking by mutableStateOf<List<String>>(emptyList())

    /** The running engine (service or mic test), so the UI can tweak it live. */
    @Volatile var engine: AudioEngine? = null

    fun describe(reason: String?): String? = when (reason) {
        null -> null
        "NOT_ONLINE" -> "Esperando a que entres al servidor en Minecraft…"
        "ADDRESS_MISMATCH" -> "Tu móvil y Minecraft deben usar la misma conexión (misma Wi-Fi o datos)."
        "BAD_VERSION" -> "Actualiza la app de Littland."
        "DISABLED" -> "El chat de voz está desactivado en el servidor."
        else -> reason
    }
}
