# LittlandVoice protocol v1

Proximity voice chat for Littland. The server plugin (`voice/plugin`) is the
voice relay; clients are the PC launcher (Java players) and the Android app
(Bedrock players). Everything travels over **one UDP port**.

All integers are big-endian. Floats are IEEE-754 32-bit.

## Audio

- Opus, 48 kHz, mono, 20 ms frames (960 samples), ~24 kbit/s.
- Raw Opus packets (no Ogg container).
- An AUDIO packet with an empty payload means "stopped talking".

## Handshake (plaintext)

The client connects once the player is in the game. If the player isn't
online yet the server answers `NOT_ONLINE` and the client retries every 2 s.

```
C→S HELLO    0x01  u8 protocolVersion (=1)
                   u8[65] client P-256 public key (uncompressed)
                   u8 nameLength, utf8 name
                   u8 platform (0 = Java PC, 1 = Bedrock Android)

S→C WELCOME  0x02  u8 status
                   if status == OK:
                     u8[65] server P-256 public key
                     u32 sessionId
                     u16 distance (blocks)
```

Status codes: `0 OK`, `1 NOT_ONLINE` (player not in game), `2 ADDRESS_MISMATCH`
(voice packet doesn't come from the player's game IP), `3 BAD_VERSION`,
`4 DISABLED` (voice off or player banned from voice).

**Authentication.** The server accepts a HELLO for player *name* only if that
player is online and the packet's source IP equals the player's game
connection IP. Bedrock players (Floodgate) may send their name with or
without the Floodgate prefix.

**Key.** `key = SHA-256(ECDH(clientPriv, serverPub) || "littland-voice-v1")`,
used as an AES-256-GCM key in both directions.

## Encrypted packets

```
0x10  u32 sessionId
      u8[12] nonce (random per packet)
      AES-256-GCM( inner packet ) incl. 16-byte tag
```

Inner packets start with a type byte.

### Client → server

| Type | Name | Payload |
|---|---|---|
| `0x20` | AUDIO | u32 sequence, opus bytes (empty = stopped talking) |
| `0x21` | PING | u64 client time (ms). Send every 2 s; the session expires after 10 s of silence |
| `0x22` | STATE | u8 flags: bit0 muted, bit1 deafened (set from the client UI) |
| `0x23` | BYE | – |

### Server → client

| Type | Name | Payload |
|---|---|---|
| `0x30` | AUDIO | u32 speakerId, u32 sequence, opus bytes |
| `0x31` | POSITIONS | f32 x, f32 y, f32 z, f32 yaw, f32 pitch (listener), u8 count, then per speaker: u32 speakerId, f32 x, f32 y, f32 z. Sent 10×/s, only speakers within range |
| `0x32` | PONG | u64 echoed client time |
| `0x33` | STATE | u8 flags: bit0 muted, bit1 deafened, bit2 echo test (authoritative; also changed by `/voz` commands) |
| `0x34` | SPEAKER | u32 speakerId, u8 nameLength, utf8 name, u8 platform |
| `0x35` | BYE | u8 reasonLength, utf8 reason |

Coordinates are Minecraft world coordinates (X east, Y up, Z south).
Yaw/pitch are Minecraft degrees (yaw 0 = facing south, 90 = west).

## Echo test

`/voz eco` makes the server send your own audio back to you as speaker
`0xFFFFFFFF`, placed 3 blocks in front of you, to check the microphone,
the network and 3D audio end to end.
