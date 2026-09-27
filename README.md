# Carnatic Flute Lessons

A static, dependency-free multi-page site for Carnatic flute lessons. It works
opened directly via `file://` or on any static host (e.g. GitHub Pages) — no
build step, no external CDNs, no server required.

## Project structure

```
index.html        Landing page — lists lessons as cards, links to basics.html
basics.html        "Basics" lesson: posture/tone, Sarali & Janta Varisai,
                    Alankaras & the 7 talas, first Geetham/Varnam/Kriti,
                    a daily practice checklist, and embedded tala metronomes
style.css           Shared stylesheet (nav bar, cards, swara notation tables,
                    responsive layout) used by every page
tala-player.js      Reusable "Tala Metronome" widget (Web Audio API click
                    track + synced on-screen beat highlight), embedded via
                    `TalaPlayer.init(elementId, options)`
```

## Adding a new lesson page

1. Copy `basics.html` as a starting template (or start from `index.html`'s
   `<head>`/nav) and save it as e.g. `newlesson.html` in the repo root.
2. Keep the shared assets linked exactly as in the existing pages:
   ```html
   <link rel="stylesheet" href="style.css" />
   <script src="tala-player.js"></script>
   ```
   (Load `tala-player.js` in the `<head>`, or anywhere before your inline
   `TalaPlayer.init(...)` calls, since the widget is instantiated synchronously.)
3. Use `<section class="lesson-section">` blocks with headings for content,
   and `<table class="swara-table">` for swara notation (renders in
   monospace).
4. To embed a metronome, add a container and initialize it:
   ```html
   <div id="my-metronome"></div>
   <script>
     TalaPlayer.init("my-metronome", {
       title: "Tala Metronome — Adi Tala",
       groups: [4, 2, 2],   // beat groups (anga sizes)
       bpm: 60,
       presetKey: "adi"      // "adi" | "rupaka" | "triputa" | "custom"
     });
   </script>
   ```
5. Add a nav link to the new page in **both** `index.html` and `basics.html`
   (and any other existing lesson pages), following the existing
   `<nav class="site-nav"><ul><li><a href="...">` pattern, and add a card for
   it on `index.html`'s lesson grid.

## Notes on notation

Swara/sahitya notation throughout the lessons is simplified for teaching
purposes — always cross-check against your teacher's notation for the
authoritative version of a piece.
