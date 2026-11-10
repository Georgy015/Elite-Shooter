# Elite Shooter

A basketball shooting game that runs in the browser. You watch your shooter from behind and work through 30 levels, each with a target score and a time limit.

## Play

It's a static site with no build step — serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000. (Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.)

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Aim | Mouse | Drag the screen |
| Shoot | Hold click (or Space) to charge, release to shoot | Hold SHOOT, release |
| Pause | Esc | — |

## How it plays

- Each level puts you on one or more shooting spots. Line up the hoop and a green zone appears on the power bar; release inside it and the shot is on target.
- From an angle you can aim at the backboard square instead for a bank shot.
- Scoring: 2 points inside the arc, 3 beyond it, +1 for a swish, +2 for a bank shot.
- Beat the target before time runs out to advance. Points above the target carry over as a head start on the next level (capped at half of that level's target).
- Every fifth level is a bonus level: no target, double points.
- Difficulty rises through distance, a narrower green zone, a faster power bar, changing spots and a starting aim that is slightly off.
- Progress is saved in the browser.

## Layout

- `index.html`, `css/style.css` — page, HUD and menus
- `js/main.js` — game loop, input, aiming, ball physics, scoring, level flow
- `js/levels.js` — the 30 level definitions and difficulty curve
- `js/player.js` — the shooter model and its jump-shot animation
- `js/scene.js` — court, hoop, gym and ball visuals (all dimensions in metres)
- `js/audio.js` — synthesized sound effects
- `vendor/` — three.js (MIT)
