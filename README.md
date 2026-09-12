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

**The timer.** While you're on a watched site, a small pill shows how long the current
session has lasted. Time only accumulates while the tab is visible *and* the browser
window is focused, so a tab left open in the background doesn't inflate the count.

**Sessions.** A session starts when you arrive at a watched site. If you leave and come
back within the grace window (1 minute by default), the timer picks up where it left
off instead of starting over. Stay away longer and it resets to zero. Each watched
pattern keeps its own independent timer.

**Reminders.** Every 5 minutes (configurable) a small banner appears saying how long
you've been there. It disappears on its own after 5 seconds. It never blocks the page —
the overlay ignores clicks entirely, so you can keep using the site underneath it.

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
| Timer position | top right | Any of the six screen corners/edges |

Per-pattern checkboxes pause a site without deleting it. `↺` resets one timer, and
**Reset all timers** clears them all.

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
