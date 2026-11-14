# NEXUS passkeys

NEXUS passkeys use WebAuthn with challenge verification, RP ID/origin validation, stored public keys, and authenticator signature-counter updates. Passkey registration is available from Settings; sign-in is available from the login screen after entering the account username.

## Required backend settings

- `WEBAUTHN_ORIGIN` — exact public HTTPS origin of the NEXUS page, e.g. `https://nexus.is-a.bot`.
- `WEBAUTHN_RP_ID` — hostname only, e.g. `nexus.is-a.bot` (no scheme or path).

The RP ID must be valid for the configured origin. For local development, the server defaults to `http://localhost:5000`. Native Capacitor shells may require platform-specific associated-domain / Android Digital Asset Links configuration; browser WebAuthn support does not automatically mean native WebViews can invoke platform passkeys.

Credentials are stored as a credential ID, public key, counter and authenticator transports. Private keys remain with the authenticator and are never stored by NEXUS.
