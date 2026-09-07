# Blot on iOS

The `ios/` directory is a native wrapper around the exact same `app/` the
website and the Android APK ship: a WKWebView serving the bundle on the fixed
origin `blot://localhost`, with no networking code of its own.

## Build it

You need a Mac with Xcode 15 or newer. The Xcode project is generated, not
checked in:

```
brew install xcodegen
cd ios
xcodegen generate
open Blot.xcodeproj
```

Before you press run: in the project's Signing & Capabilities tab, pick your
own team under "Team" (a free Apple ID works). Xcode may ask you to change
the bundle identifier if `io.github.munzzyy.blot` is already claimed under
another team; any unique id is fine for a personal build. With a free Apple
ID, Xcode signs a personal build that runs on your own device for 7 days at
a time; App Store or TestFlight distribution needs a paid developer account,
and Blot is not published there today.

First launch on the device: iOS will refuse to open an app from an
unrecognized developer. Go to Settings > General > VPN & Device Management,
find your Apple ID under "Developer App," and tap Trust. This is a one-time
step per signing certificate, not per build.

CI builds the wrapper for the iOS simulator on every push and fails if a
permission prompt or an App Transport Security exception ever appears in the
built Info.plist. What CI cannot do is run it on physical hardware, so treat
device behavior, VoiceOver included, as verified by people, not by the
pipeline.

## What is different from Android, honestly

- **The network guarantee is weaker.** The Android manifest ships with no
  `uses-permission` entries at all, so the OS itself refuses every connection
  Blot could try to open; that is checked in CI by dumping the built APK's
  permissions. iOS has no permission that removes networking from an app.
  What holds the line instead is that the wrapper contains no networking
  code of its own, plus the meta Content-Security-Policy `index.html`
  carries, which bounds what the page itself can fetch (no network origins,
  no `unsafe-eval`). That CSP is a page-level fetch policy, not an
  OS-level guarantee, and it does not reach WebRTC; Blot ships no WebRTC
  code either, so the claim here is "no code paths plus CSP," not "the OS
  prevents it."
- **No share-in intake.** Android's `MainActivity` accepts a PDF handed to it
  through `ACTION_SEND` or `ACTION_VIEW` and streams it into the page over a
  one-shot token; the iOS wrapper has no equivalent, so a document reaches
  Blot only through the in-page file picker. A proper share extension /
  document-provider integration is future work, not shipped here.
- **Save and Share go through the OS share sheet, not straight to
  Downloads.** A `WKScriptMessageHandler` (`webkit.messageHandlers.save`)
  takes the finished export as base64, writes it to a temp file, and
  presents `UIActivityViewController`, which includes "Save to Files"
  alongside every other share target on the device. That is a real hand-off,
  not a browser download: the app never claims "Downloaded," only that the
  share sheet is open, because the OS decides where the file actually lands
  from there. A build shipped without this bridge fails loudly instead of
  pretending the export left the app; see `app/js/platform.js` and the
  `blot:` case in `app/js/main.js`'s `deliver()`.
- **App-switcher privacy works the same way, differently, and covers
  less.** Android sets `FLAG_SECURE` because an in-progress redaction can
  hold an unredacted page; that also blocks screenshots and screen
  recording. The iOS wrapper covers the window with a blur shield the
  moment the app leaves the foreground, so the app-switcher thumbnail shows
  the shield, not the page. iOS has no equivalent to `FLAG_SECURE`:
  screenshots and screen recording of the unlocked app remain possible: the
  shield only ever covered the switcher case.
- **Accessibility.** Dynamic Type reaches the page the way Android's
  `textZoom` does, via `webView.pageZoom`, recomputed live whenever the
  system text-size setting changes (not just read once at launch).
  VoiceOver reads the same web content Safari would, since it is the same
  DOM; nothing in the wrapper changes that. What has NOT been verified on
  physical hardware: VoiceOver's behavior through `SFSafariViewController`
  hand-offs, and Dynamic Type at the largest accessibility sizes. Check
  both if you build this yourself.
- **Backups.** The WebKit data directory is excluded from iCloud and local
  device backups at launch (`URLResourceValues.isExcludedFromBackup`),
  matching Android's `allowBackup="false"`. Blot does not persist a
  document between sessions either way; what this actually protects is the
  one stored preference (language) and any leftover WebKit cache data.

- **The web view sits inside the safe area, not full-bleed.** The page's
  own `viewport-fit=cover` plus `env(safe-area-inset-bottom)` padding
  (`app/css/app.css`) is right for Safari's full-bleed handling of a Home
  Screen install, but the wrapper renders in every orientation the app
  supports, including two landscape ones where the notch sits on a side
  edge; matching that correctly on every edge is what the safe area
  guide already does for free. What was actually wrong before was the
  letterbox color: `systemBackground` instead of the app's own paper
  color, now fixed.

## No hosted copy yet

There is no hosted `app/` deployment to install from Safari right now, so
"Add to Home Screen" is not an available path today. The wrapper you build
yourself, or the Android APK, are the only ways to run Blot outside a local
dev server at the moment.

## One rule for maintainers

`blot://localhost` is the storage origin for whatever the page keeps in
`localStorage` (today, just the language preference) and for the service
worker's cache when the web build runs there. Renaming the scheme or the
host resets that; not user data loss the way it would be for an app that
actually persists documents, but still not a change to make without a
reason.
