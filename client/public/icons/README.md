# NEXUS managed icons

Super Owners can replace every shared sidebar icon from Moderation → Super Owner · Website Icon Studio. Upload a transparent PNG; NEXUS scales it proportionally into a centred 256×256 canvas and publishes it to the configured GitHub branch. Each icon has an individual Revert action that removes its override and restores the Lucide fallback.

## Sidebar icons

- `net-proxy.png`
- `messages.png`
- `history.png`
- `updates.png`
- `youtube-tools.png`
- `block-blast.png`
- `shop.png`
- `galaxy-subscription.png`
- `settings.png`
- `moderation.png`
- `admin-console.png`
- `gs-gifts.png`
- `profile.png`
- `sign-out.png`
- `gift.png`
- `workspace.png`
- `menu.png`
- `close.png`

## Brand icons

- `client/public/nexus-icon.png` — app logo, sidebar/top bar and install icon
- `client/public/favicon.png` — browser favicon

The icon studio is restricted by a server-side check to accounts whose database role is exactly `super_owner`. GitHub credentials remain server-side in `GITHUB_TOKEN`.
