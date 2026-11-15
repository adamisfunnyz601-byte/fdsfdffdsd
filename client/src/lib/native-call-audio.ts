import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeCallKitPlugin {
  start(options: { callId: string; name: string; video?: boolean }): Promise<void>;
  stop(): Promise<void>;
}

const NativeCallKit = registerPlugin<NativeCallKitPlugin>("NexusCallKit");

/** Starts the OS-level ongoing-call surface in the native app. */
export async function startNativeCallAudio(name = "NEXUS call", video = false): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") {
    const callId = `nexus-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await NativeCallKit.start({ callId, name, video });
  }
}

/** Stops the OS-level ongoing-call surface. */
export async function stopNativeCallAudio(): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") await NativeCallKit.stop();
}
