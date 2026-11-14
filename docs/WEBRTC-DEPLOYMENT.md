# NEXUS calls and screen sharing

NEXUS direct calls use WebRTC media tracks and the authenticated `/api/chat/voice/*` signalling endpoints. The client now includes incoming/outgoing voice and video calls, microphone/camera controls, local and remote audio-level visualizers, and a screen-share control. The Windows Electron build uses Electron's native desktop-capture picker for `getDisplayMedia()`.

## TURN is required for reliable calls

The default STUN server can help peers discover direct network paths, but it cannot relay media when both networks block direct connectivity. Configure a TURN service in the backend environment variable `WEBRTC_ICE_SERVERS` as a JSON array, for example:

```json
[
  {
    "urls": ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
    "username": "YOUR_TURN_USERNAME",
    "credential": "YOUR_TURN_PASSWORD"
  }
]
```

Use real credentials from your TURN provider; do not commit them to GitHub. The API returns this configuration to authenticated clients. The call signalling maps are currently process-local, so run a single backend instance until signalling is moved to shared storage/pub-sub.

## Platform capture support

- Windows desktop: Electron's native display-capture request handler is configured; the OS picker asks the user which screen/window to share.
- Android and iOS: the call UI requests the browser/WebView `getDisplayMedia()` API when present. Native Android MediaProjection and iOS ReplayKit broadcast integration are separate native capabilities and are not supplied merely by adding a web button. If the native WebView does not expose `getDisplayMedia()`, the share button reports that screen capture is unavailable rather than pretending it started.
- Microphone/camera permission prompts are provided by the platform; users must grant them.
