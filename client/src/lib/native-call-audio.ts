import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeCallAudioPlugin {
  start(options?: { name?: string }): Promise<void>;
  stop(): Promise<void>;
}

interface NativeCallKitPlugin {
  start(options: { callId: string; name: string }): Promise<void>;
  stop(): Promise<void>;
}

const NativeCallAudio = registerPlugin<NativeCallAudioPlugin>("CallAudio");
const NativeCallKit = registerPlugin<NativeCallKitPlugin>("NexusCallKit");

/**
 * Starts the OS-level ongoing-call surface in the native app.
 * Android uses a microphone foreground service notification; iOS uses CallKit.
 * Browser builds intentionally do nothing.
 */
export async function startNativeCallAudio(name = "NEXUS call"): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === "android") {
    await NativeCallAudio.start({ name });
  } else if (platform === "ios") {
    const callId = `nexus-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await NativeCallKit.start({ callId, name });
  }
}

export async function stopNativeCallAudio(): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === "android") await NativeCallAudio.stop();
  else if (platform === "ios") await NativeCallKit.stop();
}
