package net.littland.voice;

import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

public final class LittlandVoice extends JavaPlugin implements Listener {
    private final Map<UUID, PlayerSnapshot> snapshots = new ConcurrentHashMap<>();
    private final Map<UUID, Integer> speakerIds = new ConcurrentHashMap<>();
    private final AtomicInteger nextSpeakerId = new AtomicInteger(1);
    private VoiceServer server;
    private BukkitTask snapshotTask;
    private BukkitTask tickTask;
    private Method floodgateCheck;
    private Object floodgateApi;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        hookFloodgate();
        getServer().getPluginManager().registerEvents(this, this);
        startVoice();
    }

    @Override
    public void onDisable() {
        stopVoice();
    }

    private void startVoice() {
        String host = getConfig().getString("bind-address", "0.0.0.0");
        int port = getConfig().getInt("port", 24454);
        int distance = Math.max(4, Math.min(256, getConfig().getInt("distance", 48)));
        server = new VoiceServer(getLogger(), new InetSocketAddress(host, port), distance, snapshots,
                session -> Bukkit.getScheduler().runTask(this, () -> onVoiceConnect(session)),
                session -> Bukkit.getScheduler().runTask(this, () -> onVoiceDisconnect(session)));
        try {
            server.start();
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "No se pudo abrir el puerto de voz UDP " + port
                    + ". ¿Está libre y abierto en el hosting?", e);
            server = null;
            return;
        }
        snapshotTask = Bukkit.getScheduler().runTaskTimer(this, this::refreshSnapshots, 1L, 2L);
        tickTask = Bukkit.getScheduler().runTaskTimerAsynchronously(this, () -> server.tick(), 2L, 2L);
    }

    private void stopVoice() {
        if (snapshotTask != null) snapshotTask.cancel();
        if (tickTask != null) tickTask.cancel();
        if (server != null) server.stop();
        server = null;
    }

    // ---------------------------------------------------------------- snapshots

    /** Main thread: copy what the voice thread needs from every online player. */
    private void refreshSnapshots() {
        Set<UUID> online = new HashSet<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            UUID id = p.getUniqueId();
            online.add(id);
            Location l = p.getLocation();
            InetSocketAddress addr = p.getAddress();
            int speakerId = speakerIds.computeIfAbsent(id, k -> nextSpeakerId.getAndIncrement());
            snapshots.put(id, new PlayerSnapshot(id, p.getName(), speakerId,
                    addr == null ? null : addr.getAddress(), l.getWorld().getUID(),
                    (float) l.getX(), (float) (l.getY() + p.getEyeHeight()), (float) l.getZ(),
                    l.getYaw(), l.getPitch(), isBedrock(id)));
        }
        snapshots.keySet().retainAll(online);
    }

    /** Floodgate is optional: detect Bedrock players through it when present. */
    private void hookFloodgate() {
        try {
            Class<?> api = Class.forName("org.geysermc.floodgate.api.FloodgateApi");
            floodgateApi = api.getMethod("getInstance").invoke(null);
            floodgateCheck = api.getMethod("isFloodgatePlayer", UUID.class);
            getLogger().info("Floodgate detectado: los jugadores de Bedrock podrán usar la voz.");
        } catch (ReflectiveOperationException | LinkageError e) {
            floodgateApi = null;
        }
    }

    private boolean isBedrock(UUID id) {
        if (floodgateApi == null) return false;
        try {
            return (boolean) floodgateCheck.invoke(floodgateApi, id);
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- events

    private void onVoiceConnect(Session session) {
        Player p = Bukkit.getPlayer(session.player);
        if (p != null) p.sendActionBar(Component.text("🎤 Chat de voz conectado", NamedTextColor.GREEN));
    }

    private void onVoiceDisconnect(Session session) {
        Player p = Bukkit.getPlayer(session.player);
        if (p != null) p.sendActionBar(Component.text("Chat de voz desconectado", NamedTextColor.GRAY));
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        if (server == null || !getConfig().getBoolean("join-hint", true)) return;
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline() || server == null || server.session(player.getUniqueId()) != null) return;
            player.sendMessage(Component.text(isBedrock(player.getUniqueId())
                    ? "🎤 Este servidor tiene chat de voz. Descarga la app Littland para usarlo."
                    : "🎤 Este servidor tiene chat de voz. Entra con el Littland Launcher para usarlo.",
                    NamedTextColor.YELLOW));
        }, 20L * 20);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        if (server != null) server.disconnect(event.getPlayer().getUniqueId(), "Has salido del servidor");
    }

    // ---------------------------------------------------------------- /voz

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase() : "estado";
        if (sub.equals("recargar")) {
            if (!sender.hasPermission("littland.voice.admin")) {
                sender.sendMessage(Component.text("No tienes permiso.", NamedTextColor.RED));
                return true;
            }
            stopVoice();
            reloadConfig();
            startVoice();
            sender.sendMessage(Component.text(server != null ? "Voz recargada." : "No se pudo iniciar la voz, revisa la consola.",
                    server != null ? NamedTextColor.GREEN : NamedTextColor.RED));
            return true;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Voz: " + (server == null ? "detenida" : server.sessionCount() + " conectados"));
            return true;
        }
        Session session = server == null ? null : server.session(player.getUniqueId());
        if (session == null) {
            player.sendMessage(Component.text("No tienes el chat de voz conectado. Entra con el Littland Launcher.",
                    NamedTextColor.YELLOW));
            return true;
        }
        switch (sub) {
            case "silenciar", "mute" -> {
                server.setServerMuted(session, !session.serverMuted);
                player.sendActionBar(Component.text(session.serverMuted ? "🔇 Micrófono silenciado" : "🎤 Micrófono activado",
                        session.serverMuted ? NamedTextColor.RED : NamedTextColor.GREEN));
            }
            case "ensordecer", "deafen" -> {
                server.setServerDeafened(session, !session.serverDeafened);
                player.sendActionBar(Component.text(session.serverDeafened ? "🔈 No oyes a nadie" : "🔊 Vuelves a oír a todos",
                        session.serverDeafened ? NamedTextColor.RED : NamedTextColor.GREEN));
            }
            case "eco", "echo" -> {
                server.setEcho(session, !session.echo);
                player.sendMessage(Component.text(session.echo
                        ? "Prueba de eco activada: habla y te oirás a ti mismo delante de ti. Repite /voz eco para quitarla."
                        : "Prueba de eco desactivada.", NamedTextColor.AQUA));
            }
            default -> player.sendMessage(Component.text("🎤 Voz conectada" + (session.muted() ? " · silenciado" : "")
                    + (session.deafened() ? " · ensordecido" : "") + " · alcance " + server.distance()
                    + " bloques · " + server.sessionCount() + " conectados", NamedTextColor.GREEN));
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length != 1) return List.of();
        List<String> options = sender.hasPermission("littland.voice.admin")
                ? List.of("silenciar", "ensordecer", "eco", "estado", "recargar")
                : List.of("silenciar", "ensordecer", "eco", "estado");
        return options.stream().filter(o -> o.startsWith(args[0].toLowerCase())).toList();
    }
}
