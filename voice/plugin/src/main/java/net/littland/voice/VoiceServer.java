package net.littland.voice;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.PublicKey;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;
import javax.crypto.spec.SecretKeySpec;

/**
 * UDP voice relay (PROTOCOL.md). Runs its own receive thread; player data
 * comes from snapshots refreshed on the main thread.
 */
final class VoiceServer {
    private static final int MAX_PACKET = 2048;
    private static final long SESSION_TIMEOUT_MS = 10_000;

    private final Logger log;
    private final InetSocketAddress bind;
    private final int distance;
    private final Map<UUID, PlayerSnapshot> players;
    private final Consumer<Session> onConnect;
    private final Consumer<Session> onDisconnect;

    private final Map<Integer, Session> sessionsById = new ConcurrentHashMap<>();
    private final Map<UUID, Session> sessionsByPlayer = new ConcurrentHashMap<>();
    private KeyPair keyPair;
    private DatagramSocket socket;
    private Thread thread;
    private volatile boolean running;

    VoiceServer(Logger log, InetSocketAddress bind, int distance, Map<UUID, PlayerSnapshot> players,
            Consumer<Session> onConnect, Consumer<Session> onDisconnect) {
        this.log = log;
        this.bind = bind;
        this.distance = distance;
        this.players = players;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
    }

    void start() throws IOException, GeneralSecurityException {
        keyPair = Crypto.newKeyPair();
        socket = new DatagramSocket(bind);
        running = true;
        thread = new Thread(this::receiveLoop, "LittlandVoice-UDP");
        thread.setDaemon(true);
        thread.start();
        log.info("Voz escuchando en UDP " + bind.getAddress().getHostAddress() + ":" + bind.getPort());
    }

    void stop() {
        running = false;
        for (Session session : sessionsById.values()) {
            sendBye(session, "El servidor de voz se ha detenido");
        }
        sessionsById.clear();
        sessionsByPlayer.clear();
        if (socket != null) socket.close();
    }

    Session session(UUID player) {
        return sessionsByPlayer.get(player);
    }

    int sessionCount() {
        return sessionsById.size();
    }

    int distance() {
        return distance;
    }

    // ---------------------------------------------------------------- receive

    private void receiveLoop() {
        byte[] buffer = new byte[MAX_PACKET];
        while (running) {
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            try {
                socket.receive(packet);
                handle(packet);
            } catch (SocketException e) {
                if (running) log.log(Level.WARNING, "Error en el socket de voz", e);
            } catch (Exception e) {
                // A malformed packet must never kill the thread.
                log.log(Level.FINE, "Paquete de voz inválido de " + packet.getSocketAddress(), e);
            }
        }
    }

    private void handle(DatagramPacket packet) throws GeneralSecurityException {
        if (packet.getLength() < 1) return;
        InetSocketAddress from = (InetSocketAddress) packet.getSocketAddress();
        ByteBuffer in = ByteBuffer.wrap(packet.getData(), packet.getOffset(), packet.getLength());
        byte type = in.get();
        if (type == Packets.HELLO) {
            handleHello(in, from);
        } else if (type == Packets.ENCRYPTED) {
            handleEncrypted(in, from);
        }
    }

    private void handleHello(ByteBuffer in, InetSocketAddress from) throws GeneralSecurityException {
        int version = in.get() & 0xFF;
        if (version != Packets.PROTOCOL_VERSION) {
            sendWelcomeError(from, Packets.BAD_VERSION);
            return;
        }
        byte[] clientKey = new byte[Crypto.PUBLIC_KEY_LENGTH];
        in.get(clientKey);
        byte[] nameBytes = new byte[in.get() & 0xFF];
        in.get(nameBytes);
        String name = new String(nameBytes, StandardCharsets.UTF_8);
        int platform = in.hasRemaining() ? in.get() & 0xFF : Packets.PLATFORM_JAVA;

        PlayerSnapshot player = findOnline(name);
        if (player == null) {
            sendWelcomeError(from, Packets.NOT_ONLINE);
            return;
        }
        // Offline-mode server: names prove nothing, so the voice packet has to
        // come from the same IP as the player's game connection.
        if (player.address() == null || !player.address().equals(from.getAddress())) {
            sendWelcomeError(from, Packets.ADDRESS_MISMATCH);
            return;
        }

        PublicKey theirs = Crypto.decodePublicKey(clientKey, keyPair.getPublic());
        SecretKeySpec key = Crypto.deriveKey(keyPair, theirs);
        int id;
        do {
            id = Crypto.randomSessionId();
        } while (sessionsById.containsKey(id));

        Session session = new Session(id, player.uuid(), player.name(), platform, key, from);
        Session previous = sessionsByPlayer.put(player.uuid(), session);
        if (previous != null) sessionsById.remove(previous.id);
        sessionsById.put(id, session);

        ByteBuffer out = ByteBuffer.allocate(1 + 1 + Crypto.PUBLIC_KEY_LENGTH + 4 + 2);
        out.put(Packets.WELCOME).put((byte) Packets.OK);
        out.put(Crypto.encodePublicKey(keyPair.getPublic()));
        out.putInt(id).putShort((short) distance);
        sendRaw(from, out.array());
        sendState(session);
        if (previous == null) onConnect.accept(session);
    }

    private void handleEncrypted(ByteBuffer in, InetSocketAddress from) throws GeneralSecurityException {
        Session session = sessionsById.get(in.getInt());
        if (session == null) return;
        // The IP must stay the same; the port may change behind NAT.
        if (!session.address.getAddress().equals(from.getAddress())) return;

        byte[] nonce = new byte[Crypto.NONCE_LENGTH];
        in.get(nonce);
        byte[] plain = Crypto.decrypt(session.key, nonce, in.array(), in.arrayOffset() + in.position(), in.remaining());
        session.address = from;
        session.lastSeen = System.currentTimeMillis();

        ByteBuffer inner = ByteBuffer.wrap(plain);
        byte type = inner.get();
        switch (type) {
            case Packets.C_AUDIO -> relayAudio(session, inner);
            case Packets.C_PING -> {
                ByteBuffer pong = ByteBuffer.allocate(9).put(Packets.S_PONG).putLong(inner.getLong());
                send(session, pong.array());
            }
            case Packets.C_STATE -> {
                int flags = inner.get() & 0xFF;
                session.clientMuted = (flags & Packets.FLAG_MUTED) != 0;
                session.clientDeafened = (flags & Packets.FLAG_DEAFENED) != 0;
                sendState(session);
            }
            case Packets.C_BYE -> disconnect(session, null);
            default -> {
            }
        }
    }

    // ---------------------------------------------------------------- routing

    private void relayAudio(Session speaker, ByteBuffer in) {
        if (speaker.muted()) return;
        PlayerSnapshot from = players.get(speaker.player);
        if (from == null) return;
        int sequence = in.getInt();
        byte[] opus = new byte[in.remaining()];
        in.get(opus);

        ByteBuffer out = ByteBuffer.allocate(1 + 4 + 4 + opus.length);
        out.put(Packets.S_AUDIO).putInt(from.speakerId()).putInt(sequence).put(opus);
        byte[] audio = out.array();

        double maxSq = (double) distance * distance;
        for (Session listener : sessionsById.values()) {
            if (listener == speaker || listener.deafened()) continue;
            PlayerSnapshot to = players.get(listener.player);
            if (to == null || !to.world().equals(from.world()) || to.distanceSquared(from) > maxSq) continue;
            introduce(listener, from);
            send(listener, audio);
        }

        if (speaker.echo && !speaker.deafened()) {
            ByteBuffer echo = ByteBuffer.allocate(1 + 4 + 4 + opus.length);
            echo.put(Packets.S_AUDIO).putInt(Packets.ECHO_SPEAKER).putInt(sequence).put(opus);
            send(speaker, echo.array());
        }
    }

    /** Sends a speaker's name the first time a listener hears them. */
    private void introduce(Session listener, PlayerSnapshot speaker) {
        if (!listener.knownSpeakers.add(speaker.speakerId())) return;
        byte[] name = speaker.name().getBytes(StandardCharsets.UTF_8);
        ByteBuffer out = ByteBuffer.allocate(1 + 4 + 1 + name.length + 1);
        out.put(Packets.S_SPEAKER).putInt(speaker.speakerId()).put((byte) name.length).put(name);
        out.put((byte) (speaker.bedrock() ? Packets.PLATFORM_BEDROCK : Packets.PLATFORM_JAVA));
        send(listener, out.array());
    }

    /** 10×/s: listener pose + nearby speakers' positions, and session expiry. */
    void tick() {
        long now = System.currentTimeMillis();
        double rangeSq = (double) (distance + 8) * (distance + 8);
        for (Session session : sessionsById.values()) {
            PlayerSnapshot self = players.get(session.player);
            if (self == null) {
                disconnect(session, "Has salido del servidor");
                continue;
            }
            if (now - session.lastSeen > SESSION_TIMEOUT_MS) {
                disconnect(session, null);
                continue;
            }

            ByteBuffer out = ByteBuffer.allocate(1 + 20 + 1 + 255 * 16);
            out.put(Packets.S_POSITIONS);
            out.putFloat(self.x()).putFloat(self.y()).putFloat(self.z()).putFloat(self.yaw()).putFloat(self.pitch());
            int countAt = out.position();
            out.put((byte) 0);
            int count = 0;
            if (session.echo) {
                double yaw = Math.toRadians(self.yaw());
                out.putInt(Packets.ECHO_SPEAKER);
                out.putFloat((float) (self.x() - Math.sin(yaw) * 3));
                out.putFloat(self.y());
                out.putFloat((float) (self.z() + Math.cos(yaw) * 3));
                count++;
            }
            for (PlayerSnapshot other : players.values()) {
                if (count >= 255) break;
                if (other.uuid().equals(self.uuid()) || !other.world().equals(self.world())) continue;
                if (other.distanceSquared(self) > rangeSq) continue;
                out.putInt(other.speakerId()).putFloat(other.x()).putFloat(other.y()).putFloat(other.z());
                count++;
            }
            out.put(countAt, (byte) count);
            byte[] packet = new byte[out.position()];
            out.flip().get(packet);
            send(session, packet);
        }
    }

    // ---------------------------------------------------------------- state

    void setServerMuted(Session session, boolean muted) {
        session.serverMuted = muted;
        sendState(session);
    }

    void setServerDeafened(Session session, boolean deafened) {
        session.serverDeafened = deafened;
        sendState(session);
    }

    void setEcho(Session session, boolean echo) {
        session.echo = echo;
        sendState(session);
    }

    void disconnect(UUID player, String reason) {
        Session session = sessionsByPlayer.get(player);
        if (session != null) disconnect(session, reason);
    }

    private void disconnect(Session session, String reason) {
        if (sessionsById.remove(session.id) == null) return;
        sessionsByPlayer.remove(session.player, session);
        if (reason != null) sendBye(session, reason);
        onDisconnect.accept(session);
    }

    private void sendState(Session session) {
        send(session, new byte[] {Packets.S_STATE, (byte) session.stateFlags()});
    }

    private void sendBye(Session session, String reason) {
        byte[] text = reason.getBytes(StandardCharsets.UTF_8);
        ByteBuffer out = ByteBuffer.allocate(2 + Math.min(text.length, 255));
        out.put(Packets.S_BYE).put((byte) Math.min(text.length, 255)).put(text, 0, Math.min(text.length, 255));
        send(session, out.array());
    }

    // ---------------------------------------------------------------- lookup

    /** Exact name, or the same name with a Floodgate prefix (e.g. ".Steve") for Bedrock players. */
    private PlayerSnapshot findOnline(String name) {
        PlayerSnapshot prefixed = null;
        for (PlayerSnapshot p : players.values()) {
            if (p.name().equalsIgnoreCase(name)) return p;
            if (p.bedrock() && p.name().length() == name.length() + 1
                    && p.name().substring(1).equalsIgnoreCase(name)) {
                prefixed = p;
            }
        }
        return prefixed;
    }

    // ---------------------------------------------------------------- send

    private void send(Session session, byte[] inner) {
        try {
            byte[] nonce = Crypto.newNonce();
            byte[] cipher = Crypto.encrypt(session.key, nonce, inner);
            ByteBuffer out = ByteBuffer.allocate(1 + 4 + nonce.length + cipher.length);
            out.put(Packets.ENCRYPTED).putInt(session.id).put(nonce).put(cipher);
            sendRaw(session.address, out.array());
        } catch (GeneralSecurityException e) {
            log.log(Level.WARNING, "No se pudo cifrar un paquete de voz", e);
        }
    }

    private void sendWelcomeError(InetSocketAddress to, int status) {
        sendRaw(to, new byte[] {Packets.WELCOME, (byte) status});
    }

    private void sendRaw(InetSocketAddress to, byte[] data) {
        try {
            socket.send(new DatagramPacket(data, data.length, to));
        } catch (IOException e) {
            if (running) log.log(Level.FINE, "No se pudo enviar a " + to, e);
        }
    }
}
