# Mobile scrolling and slider review — 28 October 2026

## Confirmed evidence

- With a synthetic photo in a 390×844 Chromium mobile context, a trusted vertical touch swipe starting on the Warmth fader changed its value from 0 to 88 and created an undo entry while page scroll stayed at 0. The vertical native slider's full 44×100 px hit area uses `touch-action:none`, so its adjustment axis conflicts with page scrolling.
- An ignored, CSS-only two-column horizontal prototype fit the Colour page in the same 390×1218 overall screenshot height. It is not a complete fix: a vertical swipe starting at 20% or 80% of the track scrolled the page by 55 px but also changed Warmth from 0 to −65/+65. Native Chromium dispatched `input` before the browser's `pointercancel`. `change` can arrive after `touchend`; a guard must handle long gestures and cancellation without altering recipe/history or interrupting tap, drag, mouse, keyboard and assistive access.
- Prototype screens, touch traces and temporary harnesses are gitignored under `analysis/photo-check/`. Only generated media was used. These are desktop-browser mobile emulation results, not physical iPhone or Android evidence.

## Direction under evaluation

A two-column horizontal mobile layout keeps native range inputs, preserving the familiar tap and sideways-drag model and making vertical page scrolling a different axis. At narrow widths, each track is shorter than a single full-width slider; translated labels, landscape, font scaling, the 44px hit targets and screen-reader semantics need verification. Desktop faders remain vertical. A scroll-safe gesture guard is necessary in addition to CSS: suppress pending native edits while touch intent is undecided, discard them on scrolling, and apply a deliberate tap/drag with one undo checkpoint. Preserve live feedback, per-file ownership, recipe values and camera/export behavior.

Native horizontal ranges already use `touch-action:pan-y`, but that does not by itself prevent the initial value jump observed above. A camera control and video timeline have separate implementations and should be evaluated independently rather than silently changed. Mobile tab/navigation redesign and broader scrolling reduction remain proposals for discussion; this task focuses first on accidental edits.

Authoritative references: [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) describes browser `pointercancel` when a pan is taken over; [W3C slider guidance](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) calls for physical touch-assistive-technology testing. These references do not establish iPhone-specific event ordering.

## Checkpoint and next action

- [x] Read handoff, maintenance, implementation plan and i18n glossary; preserved stashes, user media and unrelated `editor/.idea/`. Current branch `codex/mobile-scroll-safe-controls`.
- [x] Reproduce vertical fader conflict and the less obvious native horizontal touch-start jump, using synthetic media. Share 390px prototype with the user and ask their preferred approach; no answer yet. Proceeding with horizontal controls as the stated working assumption.
- [ ] Finish independent prototype and real Chromium gesture/undo/cancellation tests before integrating a guard. Explicitly verify slow (>500 ms) scrolls, delayed change, diagonal takeover, tap, drag returning to its start, keyboard, mouse, assistive changes and switching files. Review native iOS event-ordering limitations honestly.
- [ ] Review 320/390/landscape and EN/zh-HK/ja layouts; implement only validated changes, run production tests and WebKit checks, and update this checkpoint. Mobile CSS is currently an uncommitted work in progress; separate gesture prototype is ignored and is not yet production-ready.
- [ ] Do not merge, publish, release, bump versions, install an APK or clear app data without appropriate authorization.
