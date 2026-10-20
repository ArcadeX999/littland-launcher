package net.littland.voice;

import java.net.InetAddress;
import java.util.UUID;

/**
 * Immutable copy of what the voice thread needs to know about an online
 * player. Taken on the main thread every 2 ticks so the network thread never
 * touches the Bukkit API.
 */
record PlayerSnapshot(
        UUID uuid,
        String name,
        int speakerId,
        InetAddress address,
        UUID world,
        float x,
        float y,
        float z,
        float yaw,
        float pitch,
        boolean bedrock) {

    double distanceSquared(PlayerSnapshot other) {
        double dx = x - other.x;
        double dy = y - other.y;
        double dz = z - other.z;
        return dx * dx + dy * dy + dz * dz;
    }
}
