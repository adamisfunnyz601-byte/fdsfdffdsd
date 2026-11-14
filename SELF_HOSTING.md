# NEXUS self-hosting (Windows)

This runs the existing Express server on your Windows PC and uses your existing Neon database. It is a **self-hosted test setup**, not managed 24/7 hosting.

## Requirements
- Windows 10/11
- Node.js 22 LTS (install from https://nodejs.org/)
- Git (or download the repository ZIP)
- A Neon PostgreSQL connection string

## Start the server
1. Open PowerShell in the repository folder.
2. Run:
   `powershell -ExecutionPolicy Bypass -File .\scripts\start-self-hosted.ps1`
3. Paste the Neon connection string when prompted. It is only assigned to this PowerShell process and is not written into the repository.
4. Wait for the build. The local server should be available at http://localhost:5000.
5. Keep the PowerShell window and PC running.

## Optional public access (Tailscale Funnel)
Tailscale Funnel can publish a local HTTP service over HTTPS without router port-forwarding. It is available on Tailscale plans, but has usage/bandwidth limits and is not a substitute for production hosting.
1. Install Tailscale from https://tailscale.com/download/windows and sign in.
2. Confirm the local NEXUS server is running on port 5000.
3. Open a second PowerShell window and run `tailscale funnel 5000`.
4. Follow any approval prompt. Copy the HTTPS `*.ts.net` URL it prints.
5. Anyone with that public URL can reach the app. Do not share it until you have reviewed the app's security.

## Important limitations
- The PC must remain powered on, awake, and connected to the internet.
- The current app uses an in-memory session store, so signing users in again may be necessary after a server restart. This is not suitable for multiple server instances.
- Use a strong, unique SESSION_SECRET. The startup script generates one each time it starts.
- Do not commit DATABASE_URL, session secrets, OAuth secrets, or other credentials.
- This exposes a service to the public internet if Funnel is enabled. Only use it for testing until authentication, session storage, and server security have been reviewed.
- Native Android/iOS builds currently have a build-time API URL fallback. After creating a Funnel URL, configure the mobile build's VITE_API_BASE_URL to that HTTPS URL and rebuild the apps. Do not put the Neon connection string in any client app.
