# leap/ — hand bridge (Leap Motion Controller → dashboard)

The Operator's hands over a **Leap Motion Controller**, sent to the dashboard open on the same machine. It is an
extra on the Operator's laptop: nothing of it runs in the Enclosure, and the dashboard works the same without it.

```
Leap Motion Controller ─USB→ Ultraleap tracking service ─LeapC→ this bridge ─ws://127.0.0.1:6438→ dashboard
```

## What the hands do

Switch it on in the dashboard's side menu: **Commande gestuelle : activée**. The top bar then says what the sensor
sees and what the hand does.

| Gesture | What it does |
|---|---|
| Flat hand over the sensor, palm down | Steers the Digital Twin's camera: to the side turns round the Outpost, pushed away or pulled back tilts, lowered or raised zooms. Still at the middle, about 20 cm above the sensor. |
| Fist | Holds the camera where it is. During a replay, held to the right or the left, it winds the time-scrubber forward or back. |
| Thumb up, held 1.2 s | Silences the Alarm (the actuator panel's « Couper la sirène »). |
| Thumb down, held 1.2 s | Sounds the Alarm (« Déclencher la sirène »). |
| Hand on its edge, swept across | Changes screen: Operator view ↔ Digital Twin. |

On the Twin, the hand floats in hologram in the lower left of the view: cold white while it steers, green as a
thumb is raised, red as one is turned down. A ring fills in the top bar while a thumb is held: let go before it
is full and nothing is sent.

## Set it up (Windows or macOS)

1. Install the **Ultraleap tracking software** (Gemini 5.17 or later, or Hyperion) from Ultraleap's site, plug
   the sensor in, and check in its control panel that it shows your hands.
2. With Node 22 or later installed, double-click **`start.bat`** (Windows) or **`start.command`** (macOS) in
   this folder. The first time it installs what it needs, which takes Internet: do it **before** joining the
   table Wi-Fi, which has none. By hand, it is `npm install` then `npm start`.

   It says `Hand bridge listening on ws://127.0.0.1:6438`, then `The sensor is tracking.` once frames come.
3. Join the table Wi-Fi, open the dashboard **on that same machine**, in Chrome, Edge or Firefox, and switch
   the hand control on.

The bridge loads Ultraleap's own library (`LeapC`) where its installer puts it: nothing to compile.

**Why not on the Pi, with the rest?** `infra/plug-and-play.sh` cannot set this up: Ultraleap's tracking software
does not read the original Leap Motion Controller on a Raspberry Pi (only the Controller 2), so the sensor has
to be plugged into the Operator's Windows or macOS machine, and what reads it has to run there.

| Variable | For |
|---|---|
| `LEAPSDK_INSTALL_LOCATION` | The `LeapSDK` folder, when the tracking software is not installed in its default place. |
| `LEAPC_LIBRARY` | The path of `LeapC.dll` / `libLeapC.dylib` / `libLeapC.so` itself. |
| `LEAP_BRIDGE_PORT` | Another port than 6438. The dashboard only looks on 6438. |

## Without a sensor

```sh
npm run simulate
```

plays a made-up hand through every gesture, over and over (about 35 s a round): the dashboard answers to it as to
a real one. To tell a problem of the sensor from one of the dashboard, and to work on the gestures without one.
Mind that its thumbs really send the Alarm's commands.

## If it does not work

| The top bar says | Look at |
|---|---|
| « Pont du capteur injoignable sur ce poste » | The bridge is not running on this machine, or the browser blocks a page from reaching `127.0.0.1` (Safari does; Chrome may ask for the permission to reach the local network). |
| « En attente du capteur de main » | The bridge runs but no frame comes: sensor unplugged, or the Ultraleap tracking service stopped. |
| « Capteur prêt · approchez la main » | All is well: no hand over the sensor. |
| « Main détectée » | A hand, in no pose the dashboard knows. |

The gestures' thresholds are constants, one file each, in `dashboard/src/features/gestures/utils/`: `pose.ts`
(what counts as a thumb up, a flat hand), `steer.ts` (the joystick's dead zone and reach), `interpret.ts` (how
long a thumb is held, how fast a swipe is). They were set on the simulated hand: expect to tune them on a real
one.

## Security

- The bridge listens on the loopback address only: nothing of it is reachable from the network.
- It sends and never reads: a page that connects to it learns where a hand is, and can ask nothing of it.
- A gesture has no power of its own: a thumb goes through `POST /api/v1/commands` like the actuator panel's
  buttons, under the Operator's session and the same rate limit.

## Develop

```sh
npm test         # the byte offsets read from LeapC, the simulated hand, the socket
npm run typecheck
```

`src/tracking.ts` reads LeapC's packed structs as bytes. Its offsets were checked with `offsetof` against
`LeapC.h` (5.x), and the whole chain run against a stand-in library built from that header. It has **not** yet
been run against a real sensor: the tracking software's Linux packages could not be had on the machine it was
written on.
