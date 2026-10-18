# Replay clips — the permanent replay set

Every beta game (`beta/freeze3.html`, `beta/copy.html`, `beta/groove.html`) is tested by replaying these
recordings through the game's own logic (`beta/lib/*-game.js`): `node test/replay_all.mjs`.

## Format (play-recording)

```
{ when, v:1, src, w, h, fps, detector,
  frames:[ { t, lShoulder:[x,y,conf], rShoulder, lElbow, rElbow, lWrist, rWrist, nose, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle } ] }
```

x, y are normalized 0..1 of the **un-mirrored camera image** (y down); conf is MoveNet's raw score.
Gates are applied when reading (`beta/lib/kp.js`): joint < 0.30 = absent, ankles < 0.45 = absent.
A frame with no person has no joints.

## How they were made

`node test/clips/track.mjs [name …]` runs `test/clips/track.html` in headless Chromium: MoveNet
SINGLEPOSE_LIGHTNING (TF.js 4.20, pose-detection 2.1.3, `enableSmoothing:true`, the games' detector) on
every frame of `test/clips/src/<name>.webm` at the clip's own frame rate — no frame skipped or duplicated.
Tracking uses the WASM backend (headless Chromium has no GPU; WebGL on software rendering took ~1.2 s/frame).
Same model and weights: against WebGL on `frozen-body` the largest keypoint difference was 0.0092 of the
frame and 0.12 confidence.

The videos are WebM (VP9) because the test browser has no H.264. All are 360×640.

| clip | made from | what it is |
|---|---|---|
| `frozen-body` | one frame of `freezegame/idle_sway.mp4` (0.5 s), held 10 s, light per-frame noise (`noise=alls=6`) | a body that cannot move: only detector jitter |
| `still-sway` | `freezegame/idle_sway.mp4` forward + reversed (10 s) | standing, small sway, feet planted |
| `dance-hype` | `freezegame/dance-hype.mp4` (10 s) | energetic dancing |
| `empty-room` | right 26 % of `freezegame/studio-bg.jpg` (the part with no one in it), 10 s, noise | no person. MoveNet returns no pose on every frame. **The full `studio-bg.jpg` is NOT empty: Nova stands in it.** |
| `pose-star` | `freezegame/freeze-star.mp4` | Nova's star freeze (arms out) |
| `pose-bear` | `freezegame/freezebear.mp4` | Nova's bear freeze (arms up, elbows bent) |
| `pose-armsup` | nova-avatar `hidden-demo/assets/nova_dance/both_hands_up.mp4` | both hands up |
| `own-left-up` | nova-avatar `…/nova_dance/right_hand_up.mp4` | Nova raises her **own left** hand (it's on the image's right) |
| `own-right-up` | nova-avatar `…/nova_dance/left_hand_up.mp4` | Nova raises her **own right** hand |
| `upperbody` | `media/upperbody-ref.mp4`, first 12 s | upper-body moves |
| `model-fail` | (no file) | the replay feeds `null` every frame, as the page does when the detector throws |

The nova-avatar clips are named from the viewer's side, so `right_hand_up.mp4` shows her own left hand.
The replay clips are named by the body's own hand.

## Mirror proof (measured 2026-10-17)

`docs/evidence/6h/mirror-proof.png`: on `own-left-up` (Nova's own left hand up), MoveNet's **`left_wrist` (lWrist)** rises
(0.67 shoulder-widths above the shoulder at 3.0 s), while `rWrist` stays 0.87 sw below. On `own-right-up` it is
`rWrist` (+0.55 sw). So on the un-mirrored camera image MoveNet's `left_*` is the **player's own left**. The
mission text said the opposite ("camera left_* = player's RIGHT"). That holds only if the frame is flipped
before detection, and no beta game does that. The page mirrors the **picture** for display only (CSS), and the
light layer mirrors its drawing to match. `beta/lib/kp.js` `OWN` is built on this measurement.

## Phase 2: Refael's reference clips

Pending. When `ref-still.mp4`, `ref-sway.mp4` and `ref-dance.mp4` arrive: drop them into `test/clips/src/`
(convert to WebM, or track in real Chrome), run `node test/clips/track.mjs ref-still ref-sway ref-dance`, then
`node test/replay/derive.mjs`. That prints the motion of each clip and the `moveFloor / moveK / moveCeil` that meet
still ≥ 95 % · sway ≥ 80 % · dance ≤ 15 %.

### Phase 2 run on Nova's clips (2026-10-17): pending clips

`docs/evidence/6h/p2-derive-nova-clips.txt`. Nova's CGI clips are too clean to set the bar. Her held frame
jitters at **0.01 sw/s** (p50), where a real body through a real camera jitters at **0.43**
(docs/FREEZE2-MEASURED.md). 212 of the swept parameter sets pass on her clips, so they can't choose between them.
The shipped tune (`moveFloor 1.1 · moveK 2.5 · moveCeil 1.4`, measured 2026-09-27 on real-body traces) stays,
and it passes the Nova replay table too (still 100 % · sway 100 % · dance 0 % held).

## Copy Nova targets (measured 2026-10-17, Phase 3)

Per arm, the player's own (`beta/lib/arms.js`): `upper` = shoulder→elbow angle from straight down (0 down, 90 out, 180 up),
`elbow` = inside elbow angle (180 straight), `wristUp` = wrist height above the shoulder in shoulder-widths.
Medians over each clip's pose hold:

| pose | clip, hold window | upper | elbow | wristUp |
|---|---|---|---|---|
| armsUp | `pose-armsup` 1.0–2.6 s | L149–161 · R161–164 | 138–158 | +1.2 |
| star | `pose-star` 1.0–3.5 s | L96–107 · R107–123 | 140–170 | +0.27…+0.62 |
| bear | `pose-bear` 1.5–3.5 s | 116–124 | 124–136 | +0.94…+1.05 |
| leftUp | `own-left-up` 1.6–2.6 s | raised L172–174, other R4–5 | 147–156 | +1.1 / other −1.4 |
| rightUp | `own-right-up` 1.6–2.6 s | raised R160–162 | 150–155 | +1.3 |
| armsOut | `upperbody` 0–6 s (moving, not held) | 78–97 | 157–180 | −0.19…+0.16 |
| handsHead | no clip | GUESS | GUESS | GUESS |

Hold confirm: 3 frames in a row alone (0.12 s) starred poses the arms only passed through. Longest continuous
match per clip × pose (seconds):

| clip | armsUp | armsOut | star | bear | leftUp | rightUp | handsHead |
|---|---|---|---|---|---|---|---|
| pose-armsup | **2.28** | 0 | 0.12 | 0.20 | 0 | 0 | 0 |
| pose-star | 0 | 0.04 | **2.38** | 0 | 0 | 0 | 0 |
| pose-bear | 0.38 | 0.04 | 0.08 | **2.92** | 0 | 0 | 0 |
| upperbody | 0 | 0.10 | 0 | 0 | 0 | 0 | 0 |
| own-left-up | 0 | 0 | 0 | 0 | **2.12** | 0 | 0 |
| own-right-up | 0 | 0 | 0 | 0 | 0 | **2.04** | 0 |

So the confirm is 3 frames **and** ≥ 0.6 s (pass-throughs top out at 0.38 s, real holds start at 2.04 s).
armsOut has no held clip in the repo, so its star isn't proven yet. `upperbody` only proves "no false star".

## Every video in the repo (night item A, 2026-10-17)

All 24 `.mp4` files in the repo (Maya excluded) are tracked into `test/clips/repo-*.json`. `test/clips/src/REPO-SOURCES.txt`
lists which video each came from. The converted WebM copies aren't committed (`.gitignore`). To rebuild them, convert
with ffmpeg (360 px on the short side, VP9) and run `node test/clips/track.mjs repo-…`. The intro videos are wide
shots where MoveNet finds no body (0/420 frames), so every game skips them, as it should.

`test/replay/edge.mjs` runs all three games on these 24 plus the 42 synthetic edge clips (`test/clips/synth.mjs`):
**66 clips, all PASS** (the game ends, the truth audit holds, no star from noise).
