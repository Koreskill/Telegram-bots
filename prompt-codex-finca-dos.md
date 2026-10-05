# Task: edit the "Finca Dos" real-estate video with motion graphics (code-only pipeline)

Work in the current folder. It contains `src.mp4` (the original video). Deliver `finca_dos_sol.mp4`, under 30 MB, plus a short report at the end (see "Report").

## Source video facts
- 854x480 HEVC, 30 fps, 18.02 s, Spanish voice-over by a presenter, burned-in karaoke subtitles at bottom centre (roughly y > 84% of the frame). Never cover them.
- Subject: a tour of "Finca Dos", a private neighbourhood (barrio privado) under development.

## Timeline of the source (seconds)
| t | Content |
|---|---|
| 0-1.5 | Presenter in a car: "Hoy vengo a conocer" |
| 1.5-3.4 | POV drive, entrance gate visible: "el barrio privado" |
| 3.4-4.9 | Drone over the lake. The camera drifts left/down after about 4.4 s |
| 4.9-6.9 | Drone over blue courts (look like padel) and clay courts |
| 6.9-9.4 | Presenter in the car again |
| 9.4-11.9 | Presenter on a synthetic-turf football field ("cancha de césped sintético") |
| 11.9-14.4 | Two fenced clay courts ("mirá dos canchas de...") |
| 14.4-18.0 | Large building in the distance, then "desde arriba un lago", then "una pileta" |

## Edit goal
Keep the original footage and voice. Add a real-estate-appropriate motion-graphics layer:
1. **Intro title** (0.2-2.7 s), bottom-left: "Finca Dos" (bold, white) plus a lime pill "BARRIO PRIVADO". Then a small persistent wordmark pill "FINCA DOS" at top-left.
2. **Amenity chips with coded SVG icons**, top-right, entering when the amenity is shown and then docking as round badges in a rail next to the wordmark:
   - "Ingreso al barrio" 1.8-3.3
   - "Laguna" 3.55-4.85
   - "Canchas de pádel" 5.0-6.85
   - "Cancha de fútbol" + subline "Césped sintético" 10.0-11.9
   - "Dos canchas más" 12.15-14.3
   - "Pileta" 17.2-18.1
3. **Aerial shots**: a "VISTA AÉREA" tag with a blinking red dot from 3.45 to 6.9 s, and an animated outline ring around the lake that draws in around 3.75 s and follows the camera drift, fading out by about 5.1 s.
4. **Progress line** at the top edge that grows along the video, plus a subtle vignette and a light sheen sweep at the cuts (3.4, 4.9, 9.4, 11.9).
5. **End card** (extend the video 2.5 s by freezing the last frame, darkened): "Finca Dos" title, a "BARRIO PRIVADO" pill, and the six badges flying from the rail into a 3x2 grid with labels (Ingreso, Laguna, Pádel, Fútbol, Canchas, Pileta), then a dark CTA pill "Coordiná tu visita →" with an animated border beam.
6. Palette: deep green #0d2b1e, lime #b8f04a, white. Font: Geist (download from https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2). Text must stay legible on a phone.

## Technical approach (required)
- One HTML file with `window.seek(t)`: every value is computed from `t` (no CSS transitions, timers or state). Use closed-form springs and cubic easings. Seeded PRNG only, no `Math.random`.
- Render the overlay at 1920x1080 with a transparent background using Playwright (Chromium, `omit_background=True`) to PNG frames at 30 fps for 20.5 s. Serve the folder over HTTP.
- Composite with ffmpeg (use `imageio-ffmpeg`'s binary, it has no `drawtext`): upscale the footage to 1920x1080 with Lanczos, `setsar=1`, light `unsharp`, extend the tail with `tpad=stop_mode=clone`, convert the overlay with `scale=out_color_matrix=bt709` to avoid colour shifts, encode H.264 BT.709 tv-range with `+faststart`. Choose a CRF that keeps the file under 30 MB (around 25).
- Before the full render, composite the overlay on real source frames (at least t = 1.0, 4.2, 4.7, 5.8, 10.6, 17.6, 19.9) and inspect the contact sheet. Fix anything that overlaps the burned-in subtitles or the presenter's face, or that misses the lake.

## Audio
- Keep the original voice. Add a quiet music bed: Mixkit "Driving Ambition", https://assets.mixkit.co/music/32/32.mp3. Start it so that its big hit (song time 37.66 s) lands at film time 3.5 s (the lake reveal). Keep the voice at least 14 dB above the music, fade in 0.4 s, swell slightly on the end card and fade out at the end.
- Add discreet SFX from Mixkit, placed by each sound's measured peak: `https://assets.mixkit.co/active_storage/sfx/<id>/<id>-preview.mp3` with ids 1117 (soft tick), 2357 (pop), 1490 (whoosh, use `w1490`), 3083 (sparkle). Whoosh when a chip enters, pop when it docks, sparkle on the end card.
- Two-pass `loudnorm` toward -14 LUFS, true peak -1 dBTP. Report the measured result.

## Honesty rules
- Do not invent facts, prices, lot counts, phone numbers, URLs or logos. Only label what is visible or said in the video.
- "Canchas de pádel" is an assumption from the blue courts, and "Dos canchas más" comes from the subtitle. Flag both in the report.
- Do not edit or remove the burned-in subtitles.

## Report (final message, under 200 words)
List: output path and size, duration and resolution, measured LUFS, the voice-vs-music gap, what you verified by looking at frames, and what you could not verify or assumed.
