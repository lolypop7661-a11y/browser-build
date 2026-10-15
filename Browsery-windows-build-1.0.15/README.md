# Browsery Desktop

A real Electron desktop browser with Chromium webpage rendering, a looping Saturn new-tab background, draggable tabs, persistent settings, native downloads, and a restrained dark interface.

## Run the ready desktop app

Double-click **Browsery** on your desktop, or **Open Browsery.lnk** in `outputs/`.

The executable is:

`outputs/Browsery-win32-x64/Browsery.exe`

The entire `Browsery-win32-x64` folder is the portable application. Keep the folder together when moving it to another location.

Opening Browsery again brings its existing window to the front.

## Search reliability

Browsery paints its search page before waiting for network requests. Web results,
images, and Groq overviews load independently. Successful web searches are cached
in memory for 90 seconds; image searches for five minutes.

If DuckDuckGo's public search endpoint is blocked or too slow, Browsery tries
Mwmbl's public search API. The active provider is labeled above the results.
Mwmbl returns a finite collection which Browsery paginates locally, without
repeated API requests. Its result dataset is attributed in the search UI under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/);
see [Mwmbl's terms](https://mwmbl.org/terms) before commercial distribution.
Provider errors show Retry and alternate search links inside Browsery.

## Groq credentials

In Settings → AI Overview, save your Groq key once. A **Saved on this device** card
replaces the password field after Browsery verifies encrypted storage. Choose
**Change key** to replace it. The same key powers AI Overview and Analyze with
Groq for your device. It is not embedded in the executable, shared with
other people, or removed by appearance resets and application updates.

Packaged builds use a stable profile outside the application: `%APPDATA%\Browsery`
on Windows and `~/Library/Application Support/Browsery` on macOS. Credentials remain
encrypted there; status messages never return the plaintext key to the UI.

When sharing Browsery, each recipient saves their own Groq key once. Do not add
API keys to source, build settings, DMGs, archives, or the application bundle.
Never send your browser profile or encrypted credential file with the app. For a
shared AI service, keep the provider key in an authenticated backend with usage
limits instead of distributing it to clients. Revoke keys posted in chat and
create a replacement directly in your Groq account.

macOS uses the system Keychain. Allow its prompt yourself if one appears. A
consistent Developer ID signature is needed for reliable app identity across
updates; unsigned or changing signatures can cause additional Keychain prompts.
Browsery does not fall back to plaintext storage when secure storage fails.

## Hey Groq knows Browsery

Hey Groq is Browsery's built-in assistant. Besides general questions, it can
answer "where is the search bar?", "how do I make it use less RAM?" or "what
does Focus Mode do?" with the real button names and steps. Its knowledge lives
in `electron/browsery-knowledge.cjs`, written from the source code; update that
file when a button, setting, shortcut or extension changes. The panel has
example question chips to get started.

With each question the renderer sends a small state summary: selected
settings, installed extension names, tab counts, and (outside private sessions)
the current tab's title and hostname. Full URLs, search text, cookies,
passwords and history are never included. The main process re-validates every
field against an allowlist and caps the summary at about 1,500 characters
before it is sent to Groq as a separate system message.

## Development

```bash
pnpm install
pnpm dev
```

In another terminal, run `pnpm desktop`.

## Build the Windows desktop app

```bash
pnpm package:win
```

The packaged application is written to `outputs/Browsery-win32-x64/`. Packaging verifies that the Electron runtime files required for startup are present.

## Build macOS DMGs

A real DMG must be built on macOS. The Windows executable cannot be renamed into
a Mac application. Copy the clean source project to a Mac with Node.js 24 and
pnpm, then run:

```bash
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm package:mac
```

This prepares separate Apple Silicon (`arm64`) and Intel (`x64`) disk images.
Files appear in `outputs/macos/` as
`Browsery-1.0.0-macOS-arm64-unnotarized.dmg` and
`Browsery-1.0.0-macOS-x64-unnotarized.dmg`.
Use the image matching the recipient's Mac. The default build is for private
testing, not a signed/notarized public release. For normal outside distribution,
use `pnpm package:mac:signed` with your own Apple Developer ID and notarization
credentials supplied securely in the build environment. Do not disable Gatekeeper
to work around an untrusted build.

Only the compiled frontend and desktop runtime modules are included. API keys,
profiles, development dependencies, and the Windows-only Proton automation
executable are excluded. macOS Keychain, website rendering, audio, downloads and
first-launch behavior still need testing on a real Mac before sending a release.

If you do not own a Mac, the included `.github/workflows/macos-dmg.yml` can run
on a GitHub-hosted macOS runner after you add this clean project to your own
repository. In GitHub, choose Actions → **Build macOS DMGs (private test)** →
**Run workflow**, then download the **Browsery-macOS-unnotarized** artifact.
It is manual-only, uses no Groq or Apple secrets, and does not publish a release.
Repository access, Actions permissions and runner billing remain under your
control. The workflow has not been run from this Windows workspace.

## Main interactions

- Drag tabs to reorder; add, close, and switch tabs.
- Type a URL or search query into either address field and press Enter to load it in Chromium.
- Open Downloads or Settings from the toolbar.
- Switch among seven settings categories; controls save as you change them.
- Settings are saved in local app storage and restored the next time the browser opens.
- Real file downloads from webpages appear in the downloads drawer.
- Click the avatar to shift the visual theme.

## Extensions

The puzzle-piece button opens 20 built-in extensions. Each adds something the
base browser does not have; none of them just change settings. They ship inside
Browsery, so nothing is downloaded or run from the web.

- **Reading:** Night Shift (dark mode for bright sites), Reader View, Read Aloud, Page Outline
- **Media:** Pop-out Video, Video Speed, Image Grabber, Snapshot, Color Picker
- **Cleanup:** Cookie Pop-up Killer, Element Zapper, JSON Viewer
- **Productivity:** Focus Mode, Site Notes, Clipboard Clips, Time Tracker, Auto Refresh
- **Tools:** Password Generator, Link Inspector, Zoom Memory

Code lives in `src/extensions/`: `catalog.js` (definitions and automatic page
hooks), `scripts.js` (code run inside pages), `host.js` (runs installed
extensions and stores their settings), and `tools.jsx` (panels). Anything a
page script returns is treated as untrusted and rendered as text.

## Memory and GPU use

Inactive tabs unload after 30 minutes by default (Settings → Browser → Unload
inactive tabs), freeing their page process; they reload where you left off.
Pinned tabs, tabs playing sound and auto-refreshing tabs stay loaded.
Decorative animations play once instead of looping, closed panels stop
rendering, and panels no longer blur the video behind them. Audio processing
sleeps whenever nothing is audible or Browsery is hidden.

## Space cockpit and click motion

The browser chrome, floating new-tab console, shortcut dock and drawers share the
space-cockpit design system in `src/cockpit.css`. The original Saturn video still
loops; the UI remains real HTML controls, not the generated design image.

The default **Monochrome** palette uses black, white and neutral grays throughout
the browser chrome and Browsery search. Saturn plays from the exact original MP4,
with its natural color and no scene overlay. Settings → Customize → **Saturn tilt**
adjusts the angle from −45° to +45° (default −24°), live and across restarts.
Brightness and contrast at 50% preserve the original film. **Background scenery**
can optionally enable the spatial overlay; in Original Saturn mode its WebGL
renderer is not mounted, so no invisible scene runs behind the video.

`src/motion.js` exports reusable `springPresets`, `useSpringInteraction`,
`useSpringPresence` and `useClickFeedback`. Fast controls use a light underdamped
spring; panels use a heavier, gentler spring. Presses compress immediately and
release from their current position/velocity, including interrupted interactions.

- Settings → Spatial UI → **Click energy** controls corona size and intensity;
  set it to zero to disable click bursts. **Try a click** previews the result.
- **Low-power mode** and OS reduced motion disable burst effects and spring travel.
- There is one event-delegated click layer, no React state updates per click,
  at most six bursts, and a 600ms cleanup deadline. Effects animate transform and
  opacity only and disappear on blur, hiding, or unmount. Springs stop when settled.
- The native cursor is unchanged. No new pointer-tracking loop is added, and
  native webpage containers never inherit animated transforms or filters.
- Feedback applies to Browsery controls, not arbitrary third-party webpages.
- Windows contrast themes are respected by default. To choose Browsery's own
  palette instead, turn off **Customize → Use Windows contrast theme**. This does
  not change Windows settings. Use `will-change` only on active animated surfaces;
  avoid permanent GPU promotion of whole pages and large animated shadows.

## Proton VPN

The shield button opens **Use Proton VPN** with real setup instructions. On
Windows, **Connect Proton** opens the installed, signed Proton application and
targets its actual Connect button. **Open Proton** only opens/restores its window.
Install the [official Proton Windows app](https://protonvpn.com/download-windows)
and sign in there first. Confirm the connection in Proton before browsing.
Leave split tunneling off, or ensure Browsery is not excluded. Browsery uses the
system network connection; it does not create a tunnel or independently verify
Proton's connection status. No invented server, IP, ping or encryption metrics
are shown, and the old non-functional Auto-VPN toggle has been removed.

Automatic Proton Connect is currently Windows-only. On a Mac, use Proton's
official macOS app to connect; the Windows helper is not included in the DMG.

Manual setup has a separate Windows Settings helper. Its trusted main-frame IPC
opens only the fixed `ms-settings:network-vpn` URI, never a renderer-provided URL
or command. WireGuard configurations belong in the official WireGuard client,
not Windows' built-in VPN form. VPN passwords/private keys are never requested
by Browsery or sent to Groq.
