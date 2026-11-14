# Configure Google sign-in for NEXUS

Google sign-in is implemented using OpenID Connect with PKCE, state and nonce checks. It requires OAuth credentials in the hosted backend environment; never put the client secret in the web app or GitHub source.

## Required backend environment variables

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_REDIRECT_BASE_URL` — the public HTTPS origin serving the NEXUS API, for example `https://nexus.is-a.bot` if that domain is pointed at the backend.

## Google Cloud Console

1. Create an OAuth client ID of type **Web application**.
2. Add the exact authorised redirect URI `https://YOUR_PUBLIC_API_ORIGIN/api/auth/oauth/google/callback`.
3. Add the public NEXUS origin to the authorised JavaScript origins if using the same origin for the UI.
4. Add the client ID and secret to the backend's secret/environment settings.
5. Restart/redeploy the backend, then test sign-in in a private browser session.

The callback creates a NEXUS account on first sign-in and links subsequent logins by the provider's stable subject identifier. Existing username/password accounts are not automatically merged by email. Users should contact the account owner before linking identities to an existing account.
