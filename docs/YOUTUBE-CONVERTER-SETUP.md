# NEXUS YouTube converter (yt-dlp)

NEXUS runs yt-dlp locally in its existing Node.js server. It does not use a paid conversion API, API credits, a daily provider quota, Docker, or a separate conversion host.

## Runtime requirements

The Enzonic app server must have:
- yt-dlp (current release) available on PATH, or set `YTDLP_PATH` to its executable.
- FFmpeg and FFprobe available on PATH, or set `FFMPEG_LOCATION` to the FFmpeg executable or its containing directory.
- Permission to spawn child processes and write temporary files under the OS temporary directory.

yt-dlp's official documentation recommends FFmpeg/FFprobe for merging separate audio/video streams and post-processing. See [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Enzonic environment variables

These are optional if both tools are already on PATH:

- `YTDLP_PATH`: absolute path to the yt-dlp executable (or simply `yt-dlp`).
- `FFMPEG_LOCATION`: absolute path to ffmpeg, or the directory containing ffmpeg and ffprobe.

After installing the runtime tools, restart/redeploy NEXUS. No API key or conversion-provider account is required.

## Formats and quality

- MP4 and MOV: best available up to 360p, 480p, 720p, 1080p, 1440p, or unrestricted best.
- MP3: 128, 192, 256, or 320 kbps.
- Playlists are disabled; maximum output size is 500 MB; each conversion has an eight-minute timeout; two conversions can run concurrently per app process.

## Storage

- The converted file is written to a unique OS temporary directory, streamed to the requesting browser, and the directory is removed after the response finishes or closes.
- No video/audio file, source URL, conversion job, or download history is written to Neon or Enzonic databases.
- Temporary files are not permanent storage. The host may retain filesystem data briefly until cleanup runs or the process exits.

Only download content you own or are authorised to download, and comply with applicable copyright law and YouTube's terms.
