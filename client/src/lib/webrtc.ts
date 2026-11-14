export type RtcConfiguration = RTCConfiguration;

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export async function getRtcConfiguration(): Promise<RtcConfiguration> {
  try {
    const response = await fetch("/api/chat/voice/ice-config", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("ICE configuration unavailable");
    const data = await response.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return { iceServers: data.iceServers as RTCIceServer[] };
    }
  } catch (error) {
    console.warn("Using fallback WebRTC ICE servers:", error);
  }
  return { iceServers: FALLBACK_ICE_SERVERS };
}
