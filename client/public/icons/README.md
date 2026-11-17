# NEXUS replaceable icons

Replace the SVG files in this folder to change the matching icons in the NEXUS sidebar. Keep the filename exactly the same; no code changes are needed. If a file is missing or invalid, NEXUS automatically falls back to its original Lucide icon.

## Sidebar icon filenames

| File name | Used for |
|---|---|
| `net-proxy.svg` | Net Proxy |
| `messages.svg` | Messages / chat |
| `history.svg` | History |
| `updates.svg` | Update Logs |
| `youtube-tools.svg` | YouTube Tools |
| `block-blast.svg` | Block Blast |
| `shop.svg` | Shop |
| `galaxy-subscription.svg` | GS / Galaxy Subscription |
| `settings.svg` | Settings |
| `moderation.svg` | Moderation |
| `admin-console.svg` | Admin Console |
| `gs-gifts.svg` | GS Gift Links |
| `profile.svg` | Open my profile |
| `sign-out.svg` | Sign out |
| `gift.svg` | Floating gift button |
| `workspace.svg` | Personal Workspace card |
| `menu.svg` | Mobile menu |
| `close.svg` | Close mobile menu |

## App branding files

The main app logo is currently `client/public/nexus-icon.svg`. That same file is used in the sidebar, top bar, browser favicon and mobile home-screen icon. Replace that file to change the NEXUS logo everywhere. Keep its name, or update the references in `client/index.html` and `client/public/manifest.webmanifest` if you rename it.

## Image requirements

- Use **SVG** files, not a screenshot pasted into an SVG wrapper.
- Keep a square `viewBox="0 0 24 24"` (or another square viewBox).
- Use a transparent background.
- Keep the actual symbol centred with a little padding.
- Recommended stroke width: 1.8–2.2 for outline icons.
- Use `stroke="currentColor"` if the icon should inherit the UI colour. For fixed brand colours, use explicit hex colours.
- Keep the exact lowercase filename from the table.

Example minimal SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

After replacing a file, commit/push it and redeploy NEXUS. The browser may cache old icons; hard-refresh if one does not change immediately.
