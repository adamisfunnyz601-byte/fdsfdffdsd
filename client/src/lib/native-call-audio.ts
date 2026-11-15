import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeCallAudioPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const NativeCallAudio = registerPlugin<NativeCallAudioPlugin>("CallAudio");

/**
 * Starts the native microphone foreground service on Android.
 * iOS uses UIBackgroundModes=audio and WebRTC's active AVAudioSession.
 * Browser builds intentionally do nothing.
 */
export async function startNativeCallAudio(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await NativeCallAudio.start();
}

export async function stopNativeCallAudio(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await NativeCallAudio.stop();
}
