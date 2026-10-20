package net.littland.voice;

/** Packet type and status constants from PROTOCOL.md. */
final class Packets {
    static final int PROTOCOL_VERSION = 1;

    // Plaintext handshake
    static final byte HELLO = 0x01;
    static final byte WELCOME = 0x02;
    static final byte ENCRYPTED = 0x10;

    // Client -> server (inner)
    static final byte C_AUDIO = 0x20;
    static final byte C_PING = 0x21;
    static final byte C_STATE = 0x22;
    static final byte C_BYE = 0x23;

    // Server -> client (inner)
    static final byte S_AUDIO = 0x30;
    static final byte S_POSITIONS = 0x31;
    static final byte S_PONG = 0x32;
    static final byte S_STATE = 0x33;
    static final byte S_SPEAKER = 0x34;
    static final byte S_BYE = 0x35;

    // WELCOME status
    static final int OK = 0;
    static final int NOT_ONLINE = 1;
    static final int ADDRESS_MISMATCH = 2;
    static final int BAD_VERSION = 3;
    static final int DISABLED = 4;

    // STATE flags
    static final int FLAG_MUTED = 1;
    static final int FLAG_DEAFENED = 1 << 1;
    static final int FLAG_ECHO = 1 << 2;

    static final int ECHO_SPEAKER = 0xFFFFFFFF;

    static final int PLATFORM_JAVA = 0;
    static final int PLATFORM_BEDROCK = 1;

    private Packets() {
    }
}
