"""The eye of the Command Post's screen, drawn with pygame straight on the Pi's HDMI, without a desktop
(SDL's kmsdrm). infra/screen.py opens it and hands it, a frame at a time, what it knows.

The eye is the Outpost's Status at a glance. Its colour and its manner are those of the most serious
Alert raised:
    nothing     cyan, it looks around and blinks
    presence    its pupil opens wide and it looks straight ahead
    noise       rings run out of it, as wide as the sound is loud (they follow the sound at all times)
    gas         yellow green, half shut
    thermal     orange, it flickers
    predictive  violet, it looks around in circles
    cyber       magenta, the picture tears
    intrusion   red, its pupil shut tight, it follows the person the camera follows
A critical Alert makes it beat, a red frame around the screen. Around it, a radar seen from above, the
front of the box toward the bottom: the people the camera sees are on its ring, where they stand around it.

While something of the Command Post is missing, the status takes the screen instead, the same lines
as on the console.
"""

from __future__ import annotations

import math
import os
import random
import re
from datetime import datetime
from pathlib import Path

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
import pygame  # noqa: E402

SIZE = WIDTH, HEIGHT = 800, 480
FPS = 20
CENTRE = CX, CY = 400, 205
BACKGROUND = (5, 8, 12)
SCLERA = (13, 20, 27)
# Half the eye's width, its height above and below its corners when wide open.
EYE_W, EYE_UP, EYE_DOWN = 255, 112, 96
IRIS_R = 90
# How far the iris goes from the middle of the eye, across and up or down.
REACH_X, REACH_Y = 105, 26
RADAR_R = 188
# The bearing, in degrees, that takes the eye to the end of its reach.
FULL_TURN = 50

FONTS = [
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"),
    Path("/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf"),
]

NOMINAL = (70, 205, 235)
COLOURS = {
    "presence": (70, 205, 235),
    "noise": (255, 190, 60),
    "gas": (190, 225, 55),
    "thermal": (255, 125, 35),
    "predictive": (150, 125, 255),
    "cyber": (225, 70, 245),
    "intrusion": (255, 55, 45),
}
# Of several Alerts as severe as each other, the one the eye takes its manner from.
PRIORITY = ["intrusion", "cyber", "gas", "thermal", "predictive", "noise", "presence"]
RANK = {"critical": 0, "warning": 1, "info": 2}
LABELS = {
    "gas": "GAZ",
    "thermal": "TEMPÉRATURE",
    "presence": "PRÉSENCE",
    "noise": "BRUIT",
    "intrusion": "INTRUSION",
    "predictive": "DÉRIVE",
    "cyber": "CYBERATTAQUE",
}

# The console's colours, for the status: 30–37 as foreground, 40–47 as background.
ANSI = {0: (10, 12, 14), 1: (235, 70, 60), 2: (80, 210, 110), 3: (240, 190, 60), 6: (70, 205, 235), 7: (225, 230, 235)}
ESCAPE = re.compile(r"\033\[([0-9;?]*)([A-Za-z])")


def mood(alerts: list[tuple[str, str]]) -> tuple[str | None, str | None]:
    """The kind and the severity of the Alert the eye shows: the most severe, then by PRIORITY."""
    known = [(RANK.get(severity, 2), PRIORITY.index(kind), kind, severity) for kind, severity in alerts if kind in PRIORITY]
    if not known:
        return None, None
    return min(known)[2:]


def shade(colour: tuple[int, int, int], share: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(part * share))) for part in colour)


def towards(value: float, target: float, rate: float, dt: float) -> float:
    return value + (target - value) * min(1.0, rate * dt)


class Stage:
    """The screen, opened once. draw() paints one frame and waits for the next one's time."""

    def __init__(self) -> None:
        desktop = os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
        if not desktop:
            os.environ.setdefault("SDL_VIDEODRIVER", "kmsdrm")
        # Only what draws: the mixer would look for a sound card.
        pygame.display.init()
        pygame.font.init()
        if desktop or os.environ.get("SDL_VIDEODRIVER") == "dummy":
            self._screen = pygame.display.set_mode(SIZE)
            pygame.display.set_caption("Sentinel-X")
        else:
            self._screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
            pygame.mouse.set_visible(False)
        # Drawn at 800x480 whatever the screen is, then put on it: turned over when the screen is
        # mounted upside down (rotate=180 in cmdline.txt turns the console only), fitted when it is another size.
        self._canvas = pygame.Surface(SIZE)
        try:
            self._flipped = "rotate=180" in Path("/proc/cmdline").read_text()
        except OSError:
            self._flipped = False
        self._clock = pygame.time.Clock()
        # DejaVu on the Pi (fonts-dejavu-core); elsewhere, whatever fixed-width font there is.
        self._font_file = next((str(path) for path in FONTS if path.exists()), None) or pygame.font.match_font(
            "dejavusansmono,liberationmono,notosansmono,couriernew", bold=True
        )
        self._fonts: dict[int, pygame.font.Font] = {}
        self._texts: dict[tuple, pygame.Surface] = {}
        self._irises: dict[tuple, pygame.Surface] = {}
        self._sweeps: dict[tuple, pygame.Surface] = {}
        self._page: tuple[list[str], pygame.Surface] | None = None
        self._random = random.Random()
        self._time = 0.0
        # Where the eye looks, -1 to 1 across and down, and where it is going to.
        self._gaze, self._aim, self._aim_until = [0.0, 0.0], (0.0, 0.0), 0.0
        self._open, self._blink_at, self._pupil, self._colour = 1.0, 3.0, 0.4, [float(part) for part in NOMINAL]
        self._sound, self._sweep = 0.0, 0.0

    def close(self) -> None:
        pygame.quit()

    # --- one frame ---------------------------------------------------------------------------

    def draw(self, watch, system: dict, seen, status: bool) -> bool:
        """False once the window was closed (on a desktop; on the Pi there is nothing to close it with)."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                return False
        dt = min(0.2, self._clock.tick(FPS) / 1000)
        self._time += dt
        if status:
            self._status(watch.lines(50, system, seen))
        else:
            self._eye(dt, watch, seen)
        frame = self._canvas
        if self._flipped:
            frame = pygame.transform.flip(frame, True, True)
        if self._screen.get_size() != SIZE:
            frame = pygame.transform.scale(frame, self._screen.get_size())
        self._screen.blit(frame, (0, 0))
        pygame.display.flip()
        return True

    # --- the status, as text -----------------------------------------------------------------

    def _status(self, lines: list[str]) -> None:
        if self._page is None or self._page[0] != lines:
            page = pygame.Surface(SIZE)
            page.fill(BACKGROUND)
            # The largest letters that leave the console's 50 columns and 15 rows on the screen.
            font = next(
                (font for font in map(self._font, range(30, 12, -1)) if font.size("M" * 50)[0] <= WIDTH - 8 and 15 * font.get_linesize() <= HEIGHT - 8),
                self._font(12),
            )
            cell, row = font.size("M")[0], font.get_linesize()
            for at, line in enumerate(lines[: HEIGHT // row]):
                self._line(page, font, line, at * row + 4, cell, row)
            self._page = (lines, page)
        self._canvas.blit(self._page[1], (0, 0))

    def _line(self, page: pygame.Surface, font: pygame.font.Font, line: str, y: int, cell: int, row: int) -> None:
        """One line of the console, its colours read from its escape codes."""
        column, at = 0, 0
        ink, paper, dim = ANSI[7], None, False
        while at < len(line):
            escape = ESCAPE.match(line, at)
            if escape:
                at = escape.end()
                for code in [int(code or 0) for code in escape.group(1).split(";")] if escape.group(2) == "m" else []:
                    if code == 0:
                        ink, paper, dim = ANSI[7], None, False
                    elif code == 2:
                        dim = True
                    elif code - 30 in ANSI:
                        ink = ANSI[code - 30]
                    elif code - 40 in ANSI:
                        paper = ANSI[code - 40]
                continue
            end = line.find("\033", at)
            end = len(line) if end < 0 else end
            text = line[at:end]
            if paper is not None:
                pygame.draw.rect(page, paper, (column * cell + 4, y, len(text) * cell, row - 2), border_radius=3)
            if text.strip():
                page.blit(font.render(text, True, shade(ink, 0.5) if dim else ink), (column * cell + 4, y))
            column, at = column + len(text), end

    # --- the eye -----------------------------------------------------------------------------

    def _eye(self, dt: float, watch, seen) -> None:
        now, canvas = self._time, self._canvas
        kind, severity = mood(seen.alerts)
        readings = seen.readings or {}
        critical = severity == "critical"
        beat = 0.5 + 0.5 * math.sin(now * 2 * math.pi * 1.6)

        # Its colour slides from one Alert's to the next.
        for part, target in enumerate(COLOURS.get(kind, NOMINAL)):
            self._colour[part] = towards(self._colour[part], target, 5, dt)
        # Stepped, so that only a few irises are ever drawn.
        colour = tuple(int(part) // 12 * 12 for part in self._colour)

        # Where it looks.
        person = seen.people[0] if seen.people else None
        if person is not None:
            # As in a mirror: who stands at the camera's right is at the left of whoever faces the box.
            aim = (max(-1.0, min(1.0, -person[0] / FULL_TURN)), 0.15 + 0.5 * person[1])
        elif kind == "presence":
            aim = (0.0, 0.1)
        elif kind == "predictive":
            aim = (0.75 * math.cos(now * 1.3), 0.8 * math.sin(now * 1.3))
        else:
            if now >= self._aim_until:
                wide = 0.35 if kind else 0.75
                self._aim = (self._random.uniform(-wide, wide), self._random.uniform(-0.7, 0.7))
                self._aim_until = now + self._random.uniform(0.4, 1.2) if kind else now + self._random.uniform(1.2, 3.8)
            aim = self._aim
        rate = 9 if person is not None else 6
        self._gaze[0] = towards(self._gaze[0], aim[0], rate, dt)
        self._gaze[1] = towards(self._gaze[1], aim[1], rate, dt)

        # How wide it is open: a blink now and then, half shut in the gas, wide when it is critical.
        wide = 0.62 if kind == "gas" else 1.12 if critical else 1.0
        since = now - self._blink_at
        if since >= 0.22:
            self._blink_at = now + self._random.uniform(4, 9) if critical else now + self._random.uniform(2.5, 6)
        blink = abs(since / 0.11 - 1) if 0 <= since < 0.22 else 1.0
        self._open = towards(self._open, wide, 8, dt)
        opening = self._open * blink

        pupil = 0.22 + 0.06 * (1 - person[1]) if person is not None else 0.56 if readings.get("pir") is True else 0.4
        self._pupil = towards(self._pupil, pupil, 6, dt)
        sound = readings.get("sound")
        sound = min(1.0, max(0.0, sound)) if isinstance(sound, (int, float)) and not isinstance(sound, bool) else 0.0
        self._sound = towards(self._sound, sound, 10, dt)

        canvas.fill(BACKGROUND)
        iris_at = (CX + self._gaze[0] * REACH_X, CY + self._gaze[1] * REACH_Y)
        self._ball(colour, iris_at, opening, 0.75 + 0.25 * self._random.random() if kind == "thermal" else 1.0)
        self._radar(dt, colour, kind, seen.people)
        if self._sound > 0.08 and opening > 0.5:
            self._rings(colour, iris_at)
        if kind == "cyber":
            self._tear()
        self._words(watch, seen, kind, colour, critical, beat)
        if critical:
            pygame.draw.rect(canvas, shade(COLOURS["intrusion"], 0.35 + 0.65 * beat), canvas.get_rect(), width=6)

    def _lid(self, opening: float) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        """The edges of the upper and of the lower eyelid, left to right."""
        upper, lower = [], []
        for step in range(-24, 25):
            across = step / 24
            arch = (1 - across * across) ** 0.8
            upper.append((CX + across * EYE_W, CY - EYE_UP * opening * arch))
            lower.append((CX + across * EYE_W, CY + EYE_DOWN * opening * arch))
        return upper, lower

    def _ball(self, colour: tuple, iris_at: tuple[float, float], opening: float, light: float) -> None:
        canvas = self._canvas
        upper, lower = self._lid(max(0.0, opening))
        if opening > 0.04:
            pygame.draw.polygon(canvas, SCLERA, upper + lower[::-1])
            iris = self._iris(colour)
            iris.set_alpha(round(255 * light))
            canvas.blit(iris, (iris_at[0] - IRIS_R, iris_at[1] - IRIS_R))
            pupil = self._pupil * IRIS_R
            pygame.draw.circle(canvas, (0, 0, 0), iris_at, pupil)
            pygame.draw.circle(canvas, shade(colour, 0.9), iris_at, pupil, width=2)
            # The light it catches stays where the light is, whatever it looks at.
            glint = (iris_at[0] - 0.3 * IRIS_R, iris_at[1] - 0.36 * IRIS_R)
            pygame.draw.circle(canvas, (235, 245, 250), glint, 9)
            pygame.draw.circle(canvas, (150, 165, 175), (glint[0] + 21, glint[1] + 15), 4)
            # The eyelids over what is past them, in the background's colour.
            top, bottom = CY - EYE_UP * 1.3, CY + EYE_DOWN * 1.3
            left, right = CX - EYE_W - 4, CX + EYE_W + 4
            pygame.draw.polygon(canvas, BACKGROUND, [(left, CY), (left, top), (right, top), (right, CY)] + upper[::-1])
            pygame.draw.polygon(canvas, BACKGROUND, [(left, CY), (left, bottom), (right, bottom), (right, CY)] + lower[::-1])
        for edge in (upper, lower):
            pygame.draw.lines(canvas, shade(colour, 0.85), False, edge, width=3)
            pygame.draw.aalines(canvas, colour, False, edge)

    def _iris(self, colour: tuple) -> pygame.Surface:
        """The iris in one colour, drawn once: its fibres, lighter around the pupil, a dark rim."""
        if colour not in self._irises:
            if len(self._irises) > 24:
                self._irises.clear()
            iris = pygame.Surface((2 * IRIS_R, 2 * IRIS_R), pygame.SRCALPHA)
            middle = (IRIS_R, IRIS_R)
            for radius in range(IRIS_R, 0, -2):
                # Darker at the rim, lighter toward the pupil.
                pygame.draw.circle(iris, shade(colour, 0.28 + 0.5 * (1 - radius / IRIS_R)), middle, radius)
            fibres = random.Random(7)
            for _ in range(190):
                angle = fibres.uniform(0, 2 * math.pi)
                start, end = fibres.uniform(0.25, 0.5) * IRIS_R, fibres.uniform(0.7, 0.97) * IRIS_R
                ray = (math.cos(angle), math.sin(angle))
                pygame.draw.line(
                    iris,
                    shade(colour, fibres.uniform(0.45, 1.15)),
                    (IRIS_R + ray[0] * start, IRIS_R + ray[1] * start),
                    (IRIS_R + ray[0] * end, IRIS_R + ray[1] * end),
                    width=fibres.choice((1, 1, 2)),
                )
            pygame.draw.circle(iris, shade(colour, 0.16), middle, IRIS_R, width=5)
            self._irises[colour] = iris
        return self._irises[colour]

    def _radar(self, dt: float, colour: tuple, kind: str | None, people: list[tuple[float, float]]) -> None:
        canvas, faint = self._canvas, shade(colour, 0.3)
        for radius in (RADAR_R, RADAR_R - 22):
            pygame.draw.circle(canvas, faint, CENTRE, radius, width=1)
        for tick in range(24):
            angle = tick * math.pi / 12
            ray, inner = (math.cos(angle), math.sin(angle)), RADAR_R - (12 if tick % 6 == 0 else 6)
            pygame.draw.line(
                canvas, faint, (CX + ray[0] * inner, CY + ray[1] * inner), (CX + ray[0] * RADAR_R, CY + ray[1] * RADAR_R)
            )
        # The beam turns faster once something is raised.
        self._sweep = (self._sweep + dt * (150 if kind else 70)) % 360
        beam = pygame.transform.rotate(self._beam(colour), -self._sweep)
        canvas.blit(beam, beam.get_rect(center=CENTRE), special_flags=pygame.BLEND_RGB_ADD)
        # Seen from above, the front of the box toward the bottom: each person on the ring, where they
        # stand around the box, the bigger the closer. The one the camera follows is white and echoes.
        for index, (angle, near) in enumerate(people):
            turn, reach = math.radians(angle), RADAR_R - 11
            spot = (CX - reach * math.sin(turn), CY + reach * math.cos(turn))
            if index == 0:
                echo = self._time * 1.5 % 1
                pygame.draw.circle(canvas, shade(colour, 1 - echo), spot, 9 + 18 * echo, width=2)
            pygame.draw.circle(canvas, (255, 240, 235) if index == 0 else shade(colour, 0.8), spot, 4 + 5 * near)

    def _beam(self, colour: tuple) -> pygame.Surface:
        """The radar's beam in one colour, pointing right, its trail fading behind it. Black adds nothing."""
        if colour not in self._sweeps:
            if len(self._sweeps) > 24:
                self._sweeps.clear()
            beam = pygame.Surface((2 * RADAR_R, 2 * RADAR_R))
            middle = (RADAR_R, RADAR_R)
            for step in range(60, 0, -1):
                # A band no wider than what is seen above and below the eye.
                near, far = math.radians(step), math.radians(step - 1.5)
                points = [
                    (RADAR_R + radius * math.cos(angle), RADAR_R - radius * math.sin(angle))
                    for radius, angle in ((RADAR_R - 22, near), (RADAR_R, near), (RADAR_R, far), (RADAR_R - 22, far))
                ]
                pygame.draw.polygon(beam, shade(colour, 0.7 * (1 - step / 60) ** 1.6), points)
            pygame.draw.line(beam, shade(colour, 0.9), (2 * RADAR_R - 22, RADAR_R), (2 * RADAR_R, RADAR_R), width=2)
            pygame.draw.circle(beam, (0, 0, 0), middle, RADAR_R - 23)
            self._sweeps[colour] = beam
        return self._sweeps[colour]

    def _rings(self, colour: tuple, iris_at: tuple[float, float]) -> None:
        """What it hears: rings leaving the iris, as far as the sound is loud."""
        for ring in range(3):
            phase = (self._time * 1.4 + ring / 3) % 1
            radius = IRIS_R + 6 + phase * (20 + 70 * self._sound)
            light = (1 - phase) * min(1.0, 0.2 + self._sound)
            ring = tuple(round(dark + (bright - dark) * light) for dark, bright in zip(SCLERA, colour))
            pygame.draw.circle(self._canvas, ring, iris_at, radius, width=2)

    def _tear(self) -> None:
        """A picture under attack: now and then, strips of it slip sideways."""
        if self._random.random() > 0.35:
            return
        for _ in range(self._random.randint(1, 4)):
            top, height = self._random.randint(40, 380), self._random.randint(4, 26)
            strip = self._canvas.subsurface((0, top, WIDTH, height)).copy()
            self._canvas.blit(strip, (self._random.choice((-1, 1)) * self._random.randint(8, 48), top))

    def _words(self, watch, seen, kind: str | None, colour: tuple, critical: bool, beat: float) -> None:
        canvas, quiet = self._canvas, (110, 125, 135)
        canvas.blit(self._text(f"SENTINEL-X · table {watch.table}", 17, quiet), (12, 8))
        clock = self._text(f"{datetime.now():%H:%M:%S}", 17, quiet)
        canvas.blit(clock, (WIDTH - 12 - clock.get_width(), 8))

        # Every Alert raised, the one the eye shows first.
        names = sorted({name for name, _ in seen.alerts if name in LABELS}, key=lambda name: (name != kind, PRIORITY.index(name)))
        label = " · ".join(LABELS[name] for name in names[:3]) if names else "NOMINAL"
        title = self._text(label, 30, colour)
        title.set_alpha(round(255 * (0.55 + 0.45 * beat)) if critical else 255)
        canvas.blit(title, title.get_rect(center=(CX, 424)))

        readings = seen.readings or {}

        def shown(key: str, form: str) -> str:
            value = readings.get(key)
            return form.format(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else "-"

        line = " · ".join((shown("temp", "{:.1f} °C"), shown("humidity", "{:.0f} %"), "gaz " + shown("air", "{:.0f}"), "son " + shown("sound", "{:.0%}")))
        measures = self._text(line, 17, quiet)
        canvas.blit(measures, (12, HEIGHT - 8 - measures.get_height()))
        address = self._text(f"https://{watch.pi_ip}/", 17, quiet)
        canvas.blit(address, (WIDTH - 12 - address.get_width(), HEIGHT - 8 - address.get_height()))

    # --- letters -----------------------------------------------------------------------------

    def _font(self, size: int) -> pygame.font.Font:
        if size not in self._fonts:
            # Without DejaVu, pygame's own font: the status then loses its columns, not its words.
            self._fonts[size] = pygame.font.Font(self._font_file, size)
        return self._fonts[size]

    def _text(self, text: str, size: int, colour: tuple) -> pygame.Surface:
        key = (text, size, colour)
        if key not in self._texts:
            if len(self._texts) > 64:
                self._texts.clear()
            self._texts[key] = self._font(size).render(text, True, colour)
        return self._texts[key]
