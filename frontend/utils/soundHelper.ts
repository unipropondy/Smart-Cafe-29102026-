import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";

let isAudioModeSet = false;

// Helper to convert Uint8Array to base64
function uint8ToBase64(arr: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";
  const len = arr.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = arr[i];
    const b2 = i + 1 < len ? arr[i + 1] : 0;
    const b3 = i + 2 < len ? arr[i + 2] : 0;

    const enc1 = b1 >> 2;
    const enc2 = ((b1 & 3) << 4) | (b2 >> 4);
    const enc3 = i + 1 < len ? (((b2 & 15) << 2) | (b3 >> 6)) : 64;
    const enc4 = i + 2 < len ? (b3 & 63) : 64;

    base64 += chars.charAt(enc1) +
              chars.charAt(enc2) +
              (enc3 === 64 ? "=" : chars.charAt(enc3)) +
              (enc4 === 64 ? "=" : chars.charAt(enc4));
  }
  return base64;
}

// Generate a valid PCM 8-bit mono WAV file programmatically
function generateChimeWav(): string {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const duration = 0.4;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Uint8Array(44 + numSamples);

  // RIFF Header
  buffer[0] = 0x52; buffer[1] = 0x49; buffer[2] = 0x46; buffer[3] = 0x46; // "RIFF"
  const fileSize = 36 + numSamples;
  buffer[4] = fileSize & 0xff;
  buffer[5] = (fileSize >> 8) & 0xff;
  buffer[6] = (fileSize >> 16) & 0xff;
  buffer[7] = (fileSize >> 24) & 0xff;

  buffer[8] = 0x57; buffer[9] = 0x41; buffer[10] = 0x56; buffer[11] = 0x45; // "WAVE"
  buffer[12] = 0x66; buffer[13] = 0x6d; buffer[14] = 0x74; buffer[15] = 0x20; // "fmt "

  // Format chunk size (16)
  buffer[16] = 16; buffer[17] = 0; buffer[18] = 0; buffer[19] = 0;
  buffer[20] = 1; buffer[21] = 0; // Type PCM = 1
  buffer[22] = numChannels; buffer[23] = 0;

  // Sample Rate
  buffer[24] = sampleRate & 0xff;
  buffer[25] = (sampleRate >> 8) & 0xff;
  buffer[26] = (sampleRate >> 16) & 0xff;
  buffer[27] = (sampleRate >> 24) & 0xff;

  // Byte Rate
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  buffer[28] = byteRate & 0xff;
  buffer[29] = (byteRate >> 8) & 0xff;
  buffer[30] = (byteRate >> 16) & 0xff;
  buffer[31] = (byteRate >> 24) & 0xff;

  buffer[32] = 1; buffer[33] = 0; // Block align
  buffer[34] = bitsPerSample; buffer[35] = 0; // Bits per sample

  buffer[36] = 0x64; buffer[37] = 0x61; buffer[38] = 0x74; buffer[39] = 0x61; // "data"
  buffer[40] = numSamples & 0xff;
  buffer[41] = (numSamples >> 8) & 0xff;
  buffer[42] = (numSamples >> 16) & 0xff;
  buffer[43] = (numSamples >> 24) & 0xff;

  // Synthesize E5 -> B5 chime with quick decay
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq1 = 659.25; // E5
    const freq2 = 987.77; // B5

    const decay1 = Math.exp(-12 * t);
    const decay2 = Math.exp(-6 * (t - 0.08)) * (t >= 0.08 ? 1 : 0);

    const wave = 0.5 * Math.sin(2 * Math.PI * freq1 * t) * decay1 +
                 0.5 * Math.sin(2 * Math.PI * freq2 * (t - 0.08)) * decay2;

    const sample = Math.floor((wave + 1.0) * 127.5);
    buffer[44 + i] = Math.max(0, Math.min(255, sample));
  }

  return uint8ToBase64(buffer);
}

/**
 * Plays a clean chime/pop sound whenever a new order or notification arrives.
 */
export async function playNotificationSound() {
  try {
    const settings = useGeneralSettingsStore.getState().settings;
    if (settings && settings.enableNotificationSound === false) {
      return;
    }
    if (Platform.OS === "web") {
      // 🎹 Web: Use Web Audio API synthesis for zero latency and zero download dependencies
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      const playNote = (time: number, freq: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, time);

        // Quick attack and quick decay
        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        osc.start(time);
        osc.stop(time + duration);
      };

      const now = ctx.currentTime;
      // High double chime pop (E5 -> B5)
      playNote(now, 659.25, 0.15);
      playNote(now + 0.08, 987.77, 0.25);
    } else {
      // 📱 Native Android/iOS: Use local file generation for 100% offline-first reliable playback
      const { Audio } = require("expo-av");

      if (!isAudioModeSet) {
        try {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            allowsRecordingIOS: false,
          });
          isAudioModeSet = true;
        } catch (_) {}
      }

      const localUri = FileSystem.cacheDirectory + "chime_v2.wav";
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (!fileInfo.exists) {
        const base64Data = generateChimeWav();
        await FileSystem.writeAsStringAsync(localUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: localUri },
        { shouldPlay: true, volume: 1.0 }
      );

      if (sound) {
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (status.didJustFinish) {
            sound.unloadAsync().catch(() => {});
          }
        });
      }
    }
  } catch (err) {
    console.warn("[SoundHelper] Failed to play notification sound:", err);
  }
}
