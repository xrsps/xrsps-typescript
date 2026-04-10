# 10.7 — Audio (`src/client/audio/`)

XRSPS ships with both music and sound effects. Both run on top of the Web Audio API, but the source format (OGG Vorbis for music, decoded PCM for sound effects) requires some WASM glue to decode in the browser.

## Web Audio and `audioContext.ts`

`audioContext.ts` exposes a lazily-constructed `AudioContext` (or `webkitAudioContext` on Safari) plus a helper to resume it on the first user gesture. Browsers block autoplay, so the login screen's first click is what kicks it alive. If you call anything audio-related before the context is resumed, the call silently no-ops.

The module also creates two shared `GainNode`s — one for music, one for SFX — routed separately into the destination. The volume sliders in the sidebar write into these gains.

## `MusicSystem` (`src/client/audio/MusicSystem.ts`)

Plays background music tracks. OSRS music lives in the cache as OGG Vorbis blobs (and some older midi-ish tracks that have been re-encoded). `MusicSystem`:

- Loads the Vorbis data for the requested track ID via the cache.
- Decodes it through `VorbisWasm` (a WASM wrapper for a Vorbis decoder) into PCM samples.
- Wraps the PCM in an `AudioBufferSourceNode` connected to the music gain.
- Handles crossfades between tracks and the "music unlock" state shown in the music tab of the UI.

Track transitions come from two places:

1. Server packets — `MUSIC_PLAY` and `MUSIC_UNLOCK` opcodes.
2. Local UI — clicking a track in the music tab.

The login music transition (`src/client/login/LoginMusicTransition.ts`) coordinates the cross-over from the login theme to the in-game track when the player logs in.

### `OggBuilder.ts`

Some tracks are delivered as raw Vorbis packets rather than a complete OGG container. `OggBuilder` wraps them in valid OGG pages so `VorbisWasm` can stream them as a regular OGG file. This exists because the cache format historically stored just the packets; wrapping them in OGG is cheaper than writing a custom Vorbis streamer.

## `VorbisWasm.ts`

Thin wrapper around `@wasm-audio-decoders/ogg-vorbis`. Initialized at boot (see `src/index.tsx`). Exposes a single `decode(arrayBuffer): Promise<DecodedAudio>` method used by `MusicSystem`.

It's a _streaming_ decoder internally but here it's used as a one-shot — call `decode`, get all samples back. That's fine for OSRS-length tracks (a few minutes) and keeps the code simple.

## `SoundEffectSystem` (`src/client/audio/SoundEffectSystem.ts`)

Owns sound effect playback. Each SFX:

- Is looked up by a numeric sound ID in the cache (`SoundEffectLoader` in `src/rs/audio/`).
- Is decoded into PCM at load time and cached in memory.
- Is played by wrapping the PCM in a short-lived `AudioBufferSourceNode` and connecting it to the SFX gain.
- Respects a voice limit so a hundred simultaneous dings don't blow out the audio thread.

The server tells the client to play an SFX via a `SOUND_EFFECT` packet; the client also plays its own SFX locally for interface feedback (button clicks, inventory sounds, etc.).

### Spatial attenuation

3D positional sounds fall back on distance-based attenuation rather than full HRTF panning. `playAt(position)` scales the gain by a distance curve centered on the local player's position. If you need true 3D audio, you'd add a `PannerNode` per voice — not done today because OSRS sounds are functionally mono.

## `resample.ts`

Some cached audio samples are at unusual sample rates (11025 Hz, 22050 Hz). `resample.ts` does linear resampling to the `AudioContext` sample rate (usually 44100 or 48000). Linear is good enough for OSRS — nobody will complain about the harmonic distortion of a "ding".

## `music/`

This subdirectory holds the pre-built music manifest: which track IDs map to which song names, unlock regions, etc. Populated during the cache build process and consumed by the music tab UI.

## Gotchas

- **First click unlocks audio.** Before the user clicks anywhere, the `AudioContext` is suspended and no audio will play. This is why the login button also implicitly "unlocks" audio — we call `context.resume()` there.
- **Firefox and `decodeAudioData` edge cases.** We decode via WASM Vorbis instead of `context.decodeAudioData` because the browser's native decoder rejects some OSRS-origin OGGs. Keep WASM as the path of truth.
- **Volume is per-gain.** Don't set volume on individual `AudioBufferSourceNode`s — set the music or SFX gain so the slider works.

---

## Canonical facts

- **Audio context helper**: `src/client/audio/audioContext.ts`.
- **Music system**: `src/client/audio/MusicSystem.ts`.
- **Sound effect system**: `src/client/audio/SoundEffectSystem.ts`.
- **Vorbis WASM wrapper**: `src/client/audio/VorbisWasm.ts`.
- **OGG page builder**: `src/client/audio/OggBuilder.ts`.
- **Resampler**: `src/client/audio/resample.ts`.
- **Sound effect cache loader**: `src/rs/audio/SoundEffectLoader.ts`.
- **Login music transition**: `src/client/login/LoginMusicTransition.ts`.
- **Server packets**: `MUSIC_PLAY`, `MUSIC_UNLOCK`, `SOUND_EFFECT` (see `src/shared/packets/ServerPacketId.ts`).
- **Required WASM module**: `@wasm-audio-decoders/ogg-vorbis`.
