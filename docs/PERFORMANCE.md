# Performance and smoothness pass

Goal: the website should feel smooth on any phone, including cheap Android phones.
Measured with Chrome on a simulated Pixel 5 with the CPU slowed down 6x (`tests` were run before and after).

## Results

| What | Before | After |
|---|---|---|
| Rendering work while scrolling the Home page (3 s) | 198 ms | 48 ms |
| Rendering work while scrolling Community (3 s) | 254 ms | 48 ms |
| Skill Galaxy frame rate (slow phone) | ~43 fps | ~54 fps |
| First paint of a page when its data is slow | blank until scripts ran | top bar + tab bar + placeholders at ~120 ms |
| Database queries per page load (logged in) | 1 per file (CSS, JS, fonts, icons...) | 0 for files |

## What changed and why

**1. Animations only use `transform` and `opacity`.**
The browser can move and fade a layer on the graphics chip without redrawing it. Animating `box-shadow`, `width`,
`height` or `background-position` makes the browser repaint pixels on every frame (60 times a second).
- LIVE dot: the pulsing ring was a growing `box-shadow` → now a small circle that scales and fades.
- Loading placeholders: the shimmer moved `background-position` → now a highlight that slides with `transform`.
- Progress bars (Insights, Community, badges): grew by changing `width` → now slide in with `translateX`.

**2. No frosted-glass blur on phones.** `backdrop-filter: blur()` on the top bar and tab bar forces the phone to blur
everything behind them again on every scrolled frame. That was the main cause of scroll stutter. Phones now get an
almost solid bar (94% opaque). Laptops with a mouse still get the blur.

**3. Page transitions.** Every page is a separate HTML file, so moving between pages used to blink (the tab bar
disappeared and came back). Now:
- `@view-transition { navigation: auto; }` makes Chrome/Safari cross-fade between pages; the top bar and tab bar keep their place.
- The app shell (top bar, menu, tab bar) is drawn as soon as `app.js` runs, *before* the login check answers.
- The page script is loaded with `blocking="render"`, so the first frame of a page already contains the shell.

**4. Touch-friendly feedback.** Hover effects (cards lifting up) are only applied on devices with a mouse
(`@media (hover: hover)`), because on a phone the hover "sticks" after a tap. Buttons and cards shrink slightly
while pressed instead. The grey tap flash on Android is removed.

**5. Skill Galaxy.**
- The frame loop stops when the galaxy is off screen, when the tab is hidden, or (with "reduce motion") when nothing moves.
- The still background stars are on their own canvas behind the moving one, drawn once instead of copied every frame.
- Adaptive quality: if the phone's frames are slow, the canvas draws with fewer pixels (2x → 1.5x → 1x) until it is smooth.
- The canvas is not re-created every time the phone's address bar slides (height uses `svh` and the size is compared first).

**6. Server.**
- Static files (HTML, CSS, JS, fonts) are served *before* the session middleware, so they no longer wait for a database query.
- gzip compression (`compression` package), except for the live event stream (it must not be buffered).
- Cache headers: fonts and icons are cached for a year, CSS/JS for 10 minutes, HTML is always re-checked.

## Bugs found and fixed during the audit

| Where | Bug | Fix |
|---|---|---|
| Lessons | "Lesson plan" and "Cancel" used `e.currentTarget` after `await`; it is `null` by then, so the button crashed and stayed disabled | Keep the button in a variable first |
| Lessons | Typing in the search re-created every card with the entrance animation on each key press (and category chips rebuilt the search box) | Debounced filter, animation only on first show, chips update in place |
| Lessons | A live update scrolled the page back to the top | Scroll position kept |
| Lessons, Swaps | One tap on Cancel / Decline did it at once | Tap twice ("Tap again to cancel") |
| Chat | The same message could appear twice (the 5-second check and "Send" both added it) | Messages are tracked by id |
| Chat | Pressing Enter quickly sent twice; Enter while a phone keyboard was composing a word sent the message | `sending` flag and `isComposing` check |
| Chat | A new message pulled you to the bottom while you were reading older ones; "Load older" jumped | Follow only when near the bottom; keep position |
| Reviews, profile, skills | Double tap sent the form twice | Button disabled while sending |
| Home, Browse, Swaps, Messages, Notifications, Community | A failed request left the grey placeholders forever | Friendly error message |
| Swaps | Every action flashed the whole list into placeholders | List updates in place |
| Workspace | On a 360 px phone the milestone rows were wider than the screen | Status menu moves under the title on narrow screens |
| Toasts | Several toasts stacked on top of each other | A new toast replaces the old one |
| Bell | The unread count updated only every 30 s | Also updates on live notices and after "Mark all as read" |

Known, not changed: `tests/mobile.test.js` "weekly leaderboard" can fail after running `npm test` many times
without `npm run db:reset`, because earlier test teachers fill this week's board.
