# NEXUS YouTube converter service

The NEXUS web page and API are included in the app. Conversion is performed by a separate, operator-controlled Cobalt instance; NEXUS does not download, buffer, cache, or store media bytes. Only the source URL is sent to Cobalt and a temporary download URL is returned to the browser.

## Why a separate service is required

Cobalt's maintainers say hosted instances are not a public API for third-party apps. Run your own instance or obtain explicit permission from an instance owner. See the [Cobalt run-an-instance guide](https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md) and [API documentation](https://github.com/imputnet/cobalt/blob/main/docs/api.md).

## Deploy Cobalt

1. Deploy the official Cobalt Docker image on a separate Docker-capable host with a public HTTPS hostname, for example `cobalt.example.com`.
2. Configure its public `API_URL` to that exact HTTPS origin.
3. Enable API-key authentication. Create a `keys.json` file on the Cobalt host:
   ```json
   {
     "GENERATE-A-NEW-UUID-V4-KEY": {
       "name": "NEXUS",
       "limit": 10
     }
   }
   ```
   Generate a real key with `node -e "console.log(crypto.randomUUID())"`. Do not use the placeholder.
4. Configure Cobalt with `API_AUTH_REQUIRED=1`, `API_KEY_URL=file:///keys.json`, and mount that file read-only into the container. Put TLS in front of the service; do not expose an unauthenticated Cobalt API to the internet.
5. In Enzonic's NEXUS environment variables, set:
   - `COBALT_API_URL=https://cobalt.example.com/`
   - `COBALT_API_KEY=` the exact UUID key generated for NEXUS.
6. Restart/redeploy NEXUS. The YouTube Tools page will then be able to convert supported public videos.

The official Docker image and port are documented in Cobalt's sample compose file: [official docker-compose example](https://github.com/imputnet/cobalt/blob/main/docs/examples/docker-compose.example.yml).

## Storage and privacy

- No video or audio bytes are uploaded to NEXUS.
- No video/audio files, URLs, or conversion jobs are written to Neon or Enzonic databases.
- NEXUS returns Cobalt's temporary download URL directly to the browser.
- The separate Cobalt instance processes the media in its own service environment. Review its storage, logging, and retention settings separately.
- Conversion is intended only for content the user owns or is authorised to download. Users must follow copyright law and YouTube's terms.
