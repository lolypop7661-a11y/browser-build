# Browsery for iPhone

A native SwiftUI version of Browsery, built from the iPhone boards in Claude Design (Marea, dark space).

## Run it on your Mac

1. Install **Xcode** from the Mac App Store (free, version 16 or newer).
2. Open `Browsery.xcodeproj`.
3. At the top of the Xcode window, pick a simulator such as **iPhone 16 Pro**.
4. Press **Run** (⌘R). The simulator opens with Browsery in it.

## Put it on your own iPhone

1. Plug your iPhone into the Mac and tap **Trust** on the phone.
2. In Xcode, click **Browsery** in the left sidebar, then **Signing & Capabilities**.
3. Under **Team**, choose **Add an Account…** and sign in with your Apple ID, then pick your name.
4. If Xcode says the bundle identifier is taken, change `app.browsery.ios` to something unique, like `app.browsery.yourname`.
5. Pick your iPhone at the top of the window and press **Run**.
6. The first time, on the iPhone go to **Settings › General › VPN & Device Management**, tap your Apple ID and tap **Trust**. On iOS 16 or newer, also turn on **Settings › Privacy & Security › Developer Mode**.

With a free Apple ID the app keeps working for 7 days, then just press Run again.

## What's inside

- `BrowseryApp.swift`: app entry, palette choice (space vs Chill), panels
- `Browser.swift`: tabs (normal and private), WKWebView, HTTPS upgrade, downloads, session restore
- `BottomBar.swift`: address pill with progress line, suggestions, toolbar
- `NewTabView.swift`, `TabsView.swift`, `MenuSheet.swift`, `SettingsView.swift`, `GroqView.swift`: the six screens
- `Shield.swift`: Privacy shield content rules, Reader and Night Shift scripts
- `Groq.swift`, `Speech.swift`: Hey Groq with your own key (kept in the Keychain) and tap to talk
- `Store.swift`: settings, bookmarks, history, favourites

Requires iOS 17 or newer.
