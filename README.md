# Elite Shooter

A first-person basketball shooting game that runs in the browser. Sink as many shots as you can in 60 seconds.

## Play

It's a static site with no build step — serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000. (Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.)

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Look | Mouse | Drag the screen |
| Move | W A S D / arrow keys | Left stick |
| Shoot | Hold click (or Space) to charge, release to shoot | Hold SHOOT, release |
| Pause | Esc | — |

## Scoring

- 2 points inside the arc, 3 points from beyond it
- +1 bonus for a swish (no rim or backboard)
- Shots released before the buzzer still count

## Layout

- `index.html`, `css/style.css` — page, HUD and menus
- `js/main.js` — game loop, input, ball physics, scoring
- `js/scene.js` — court, hoop, gym and ball visuals (all dimensions in metres)
- `js/audio.js` — synthesized sound effects
- `vendor/` — three.js (MIT)
