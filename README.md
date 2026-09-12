# Focus Timer

A Chrome extension that makes time on distracting sites **visible** instead of blocking it.
It shows a small clock on the page while you're on a watched site, and quietly reminds
you every few minutes. Nothing is ever blocked, and nothing needs to be dismissed.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Pin the ⏱ icon so the popup is one click away

Everything is configured from that popup — no reinstalling, no editing files.

## How it works

**The timer.** While you're on a watched site, a large translucent clock shows how long
the current session has lasted. **Drag it anywhere** with the mouse and it stays there,
on every watched site, across reloads and restarts. Time only accumulates while the tab
is visible *and* the browser window is focused, so a tab left open in the background
doesn't inflate the count.

Only the clock itself takes mouse input (so it can be dragged) — everything else the
extension draws ignores clicks completely. The digits keep a dark outline, so they stay
readable on white and dark pages even with the backdrop turned right down.

**Sessions.** A session starts when you arrive at a watched site. If you leave and come
back within the grace window (1 minute by default), the timer picks up where it left
off instead of starting over. Stay away longer and it resets to zero. Each watched
pattern keeps its own independent timer.

**Reminders.** Every 5 minutes (configurable) the edges of the screen swell with a soft
red glow and a large card names how long you've been there. The glow breathes twice
rather than flashing — impossible to miss, but not jarring — and everything fades out on
its own after 5 seconds. Nothing is blocked and nothing needs dismissing; you can keep
clicking straight through it the whole time. Three styles are available:

- **Red glow on screen edges** (default) — a vignette that leaves the middle of the page clear
- **Full screen wash** — the same glow plus a tint across the whole viewport
- **Card only** — just the card, no screen effect

With `prefers-reduced-motion` set, the glow holds steady instead of pulsing.

**Badge.** The extension icon shows the current session's minutes for the active tab.

## Watched site patterns

Patterns are precise on purpose — you can watch a single subdomain, or a single Discord
server, without watching the whole site.

| Pattern | Matches |
| --- | --- |
| `reddit.com` | `reddit.com` and `www.reddit.com`, any page |
| `*.reddit.com` | the domain and every subdomain |
| `old.reddit.com` | that subdomain only |
| `discord.com/channels/12345` | one Discord server (and every channel in it) |
| `youtube.com/watch` | video pages only, not the home page or subscriptions |
| `youtube.com/@*` | `*` works as a wildcard anywhere |
| `example.com/a?b=1` | query strings are matched too |

Notes:

- The scheme is optional — `https://x.com/` and `x.com` behave the same.
- A path is a prefix match that stops at a boundary, so `/channels/12` does **not**
  match `/channels/123`.
- When several patterns match the same page, the most specific one wins, and only that
  one's timer runs.
- The popup's **Use current site** / **Use current page** buttons prefill the box from
  the tab you're on — handy for grabbing a Discord server URL.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Enabled | on | Master switch; off hides every timer |
| Session grace | 1 min | How long you can be away before the timer resets |
| Remind me every | 5 min | Reminder interval; `0` turns reminders off |
| Reminder duration | 5 sec | How long the banner stays up |
| Timer position | top right | Six presets, or **Custom** — set by dragging the timer |
| Timer size | large | Small (20px), Medium (28px) or Large (38px) digits |
| Backdrop opacity | 85% | Fades the plate behind the digits, never the digits themselves |
| Reminder effect | edge glow | Edge glow, full screen wash, or card only |

Per-pattern checkboxes pause a site without deleting it. `↺` resets one timer, and
**Reset all timers** clears them all.

Dragging the timer switches **Timer position** to *Custom*; picking any preset corner
afterwards discards the dragged spot. The position is stored as a fraction of the window
in each axis, so the clock keeps its relative place when you resize the window.

## Files

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest |
| `src/background.js` | Service worker: owns all session state, timing and reminders |
| `src/content.js` | The on-page overlay, and the 1/second heartbeat that drives timing |
| `src/common.js` | Pattern matching, settings defaults, formatting |
| `src/popup.*` | The configuration popup |

Settings live in `chrome.storage.sync` (they follow your Chrome profile); live session
timers live in `chrome.storage.local`.
