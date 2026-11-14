# NEXUS audio message format 1 (.namaf1)

NEXUS voice messages use the `.namaf1` filename extension ("NEXUS audio message, format 1").

## Compatibility contract

A `.namaf1` file contains the original audio file bytes unchanged. It does **not** wrap the audio in a proprietary container or encrypt it. The audio stream remains a standard format selected by the recording device, normally WebM/Opus, MP4/AAC, or Ogg/Opus.

- The actual codec/container is identified by the file signature and the original media MIME type.
- NEXUS stores the attachment as a standard base64 data URL and records the message media type as `audio/namaf1`.
- NEXUS players read the original data URL and use the browser's native audio decoder.
- The NEXUS download uses `.namaf1`. A second download uses the original standard extension (for example `.webm`, `.m4a`, or `.ogg`) for media players that require a recognised extension.

## Why the extension is not a new codec

A new extension alone cannot make an audio codec universally playable. Keeping the original audio bytes intact means compatible players can inspect the file signature; renaming/exporting to the standard extension provides the broadest compatibility. NEXUS never claims every third-party player recognises `.namaf1` automatically.

## Current limits

- Chat attachments are limited to 8 MiB.
- Recording format depends on MediaRecorder support on the device/browser.
- Playback of any particular codec depends on the platform's installed/browser decoder.
- The current recorder uses the device microphone; it does not yet provide background recording.
