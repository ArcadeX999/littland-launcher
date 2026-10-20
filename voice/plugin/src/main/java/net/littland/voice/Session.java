package net.littland.voice;

import java.net.InetSocketAddress;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.spec.SecretKeySpec;

/** One connected voice client. Shared between the network thread and the scheduler. */
final class Session {
    final int id;
    final UUID player;
    final String name;
    final int platform;
    final SecretKeySpec key;
    volatile InetSocketAddress address;
    volatile long lastSeen = System.currentTimeMillis();

    // Muted/deafened as chosen in the client UI, and as set with /voz.
    volatile boolean clientMuted;
    volatile boolean clientDeafened;
    volatile boolean serverMuted;
    volatile boolean serverDeafened;
    volatile boolean echo;

    /** Speakers whose SPEAKER info this client already received. */
    final Set<Integer> knownSpeakers = ConcurrentHashMap.newKeySet();

    Session(int id, UUID player, String name, int platform, SecretKeySpec key, InetSocketAddress address) {
        this.id = id;
        this.player = player;
        this.name = name;
        this.platform = platform;
        this.key = key;
        this.address = address;
    }

    boolean muted() {
        return clientMuted || serverMuted;
    }

    boolean deafened() {
        return clientDeafened || serverDeafened;
    }

    int stateFlags() {
        int flags = 0;
        if (muted()) flags |= Packets.FLAG_MUTED;
        if (deafened()) flags |= Packets.FLAG_DEAFENED;
        if (echo) flags |= Packets.FLAG_ECHO;
        return flags;
    }
}
