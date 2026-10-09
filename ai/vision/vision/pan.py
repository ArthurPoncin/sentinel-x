"""The camera on its servo: it turns to keep the person followed in the middle of its image.

- `PanFollower`, the logic: from where that person stands around the camera to how far it is turned, at
  each instant. Pure, like the tracker: no servo and no clock in it, the caller passes the monotonic time.
- `PanDrive`, what turns the camera: `PAN_DRIVE`, `pwm` (`SysfsPwmServo`, a servo on one of the Pi's
  hardware PWM pins), `stepper` (`GpioStepper`, a geared stepper motor on four of its GPIOs) or `none` (the
  camera is fixed: nothing here runs). Another one plugs in the same way: a class with `open()`, `turn()`
  and `close()`, and a line in `DRIVES`.

- `python -m vision.pan <degrees>`, the service stopped: turns the camera by that much and leaves it
  there. Says whether the motor is wired and which way it turns, and puts a camera back to where it rests.

Angles are in degrees from where the camera rests, positive toward the right of its image: the `pan` of an
`intrusion` Alert. Where it rests, its 0, is where it stands when the service starts: the stepper counts
its half-steps from there, and the service parks it there as it stops.
"""

import logging
import math
import os
import sys
import threading
import time
from collections import deque
from typing import Callable, Protocol, Sequence

from sentinel_common.config import ConfigError, env_bool, env_float, env_str

logger = logging.getLogger(__name__)


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class PanFollower:
    """How far the camera is turned, from one instant to the next.

    - while an intrusion goes on (`aim`), it turns toward the person followed, most of the way at each
      inference (`gain`: an inference is always a little late on where they are), and leaves them be once
      they are within `deadband` degrees of the middle of its image: it does not hunt for the last degree;
    - it never turns faster than `speed` degrees a second, so that what it frames does not blur and the
      servo, which says nothing of where it is, is where it was told to be; nor past `low` and `high`, the
      servo's travel;
    - when the last inference did not see that person, it stays where it is: they are found again where
      they were lost;
    - with no intrusion (`rest`), it stays where it is for `home_after` seconds (someone lost may come
      back into its image), then goes back to where it rests, at `home_speed`;
    - and once there, with `patrol` degrees, it looks around for intruders: from `patrol` degrees to the
      left to as many to the right and back again, no further than its travel, slowly, at `patrol_speed`,
      so that what it frames does not blur and the motor does not work for nothing. With 0, it stays
      where it rests.

    It remembers where it was for the last `memory` seconds: an image is always a little old, and the
    angle that goes with it is the one of when it was taken (`angle_at`).
    """

    def __init__(
        self,
        *,
        low: float = -90.0,
        high: float = 90.0,
        speed: float = 60.0,
        home_speed: float = 30.0,
        deadband: float = 4.0,
        gain: float = 0.7,
        memory: float = 2.0,
        home_after: float = 0.0,
        patrol: float = 0.0,
        patrol_speed: float = 8.0,
    ) -> None:
        if not (_is_number(low) and _is_number(high) and low <= 0 <= high and low < high):
            raise ValueError(f"low and high: a travel that holds 0, where the camera rests, expected, got {low!r} to {high!r}")
        if not (_is_number(speed) and speed > 0 and _is_number(home_speed) and home_speed > 0):
            raise ValueError(f"speed and home_speed: numbers > 0 expected, got {speed!r} and {home_speed!r}")
        if not (_is_number(deadband) and deadband >= 0):
            raise ValueError(f"deadband: a number >= 0 expected, got {deadband!r}")
        if not (_is_number(gain) and 0 < gain <= 1):
            raise ValueError(f"gain: a number in ]0, 1] expected, got {gain!r}")
        if not (_is_number(memory) and memory > 0):
            raise ValueError(f"memory: a number > 0 expected, got {memory!r}")
        if not (_is_number(home_after) and home_after >= 0):
            raise ValueError(f"home_after: a number >= 0 expected, got {home_after!r}")
        if not (_is_number(patrol) and patrol >= 0 and _is_number(patrol_speed) and patrol_speed > 0):
            raise ValueError(f"patrol and patrol_speed: numbers >= 0 and > 0 expected, got {patrol!r} and {patrol_speed!r}")
        self._low, self._high = low, high
        self._speed, self._home_speed = speed, home_speed
        self._deadband, self._gain, self._memory = deadband, gain, memory
        self._home_after, self._patrol_speed = home_after, patrol_speed
        # Its patrol, within its travel: on one side only when where it rests is an end of it.
        self._patrol = (max(-patrol, low), min(patrol, high)) if patrol > 0 else None
        self._idle_since: float | None = None  # since when there is no intrusion, None during one
        self._patrolling = False  # it is back where it rests, and looks around from there
        self._angle = 0.0  # how far it is turned
        self._goal = 0.0  # how far it is turning to
        self._pace = speed  # and how fast, in degrees a second
        self._at: float | None = None  # when it was last moved on
        self._trail: deque[tuple[float, float]] = deque()  # (when, how far turned), oldest first

    @property
    def angle(self) -> float:
        """How far the camera is turned, as of the last call."""
        return self._angle

    def aim(self, bearing: float | None, now: float) -> float:
        """After an inference of an intrusion in progress: `bearing` is where the person followed stands
        (the tracker's `target`), None when that inference did not see them. Returns the angle to turn to
        now."""
        self.step(now)
        self._idle_since, self._patrolling = None, False
        self._pace = self._speed
        off = bearing - self._angle if bearing is not None and _is_number(bearing) else 0.0
        if abs(off) > self._deadband:
            self._goal = min(max(self._angle + self._gain * off, self._low), self._high)
        else:
            self._goal = self._angle
        return self._angle

    def rest(self, now: float) -> float:
        """After an inference with no intrusion in progress: after `home_after` seconds, back to where it
        rests, then on patrol around it."""
        if self._idle_since is None:
            self._idle_since = now
            self._goal = self._angle  # it waits where it is
        return self.step(now)

    def step(self, now: float) -> float:
        """Turns on toward where it is going, for the time gone by since the last call. Returns the angle
        to turn to now. A clock that goes back turns nothing."""
        if self._at is not None:
            reach = self._pace * max(0.0, now - self._at)
            off = self._goal - self._angle
            # Right there when within reach, give or take the rounding of the steps before: an end of its
            # patrol is reached, and it turns back.
            self._angle = self._goal if abs(off) <= reach + 1e-9 else self._angle + math.copysign(reach, off)
        if self._idle_since is not None:
            self._idle(now)
        if self._at is None or now > self._at:
            self._at = now
            self._trail.append((now, self._angle))
            while len(self._trail) > 1 and now - self._trail[1][0] >= self._memory:
                self._trail.popleft()
        return self._angle

    def _idle(self, now: float) -> None:
        """Where it goes with no intrusion: nowhere for `home_after` seconds, then where it rests, then
        from one end of its patrol to the other."""
        if now - self._idle_since < self._home_after:
            return
        if not self._patrolling:
            self._goal, self._pace = 0.0, self._home_speed
            if self._angle == 0.0 and self._patrol is not None:
                # From where it rests, to the right first.
                self._patrolling, self._goal, self._pace = True, self._patrol[1], self._patrol_speed
        elif self._angle == self._goal:
            low, high = self._patrol
            self._goal = low if self._goal == high else high

    def angle_at(self, moment: float) -> float:
        """How far the camera was turned at `moment`, between the two instants it remembers around it.
        Further back than it remembers, the oldest it does; later than the last call, where it is now."""
        before = None
        for at, angle in self._trail:
            if at >= moment:
                if before is None or at == moment:
                    return angle
                share = (moment - before[0]) / (at - before[0])
                return before[1] + (angle - before[1]) * share
            before = (at, angle)
        return self._angle

    def way_home(self, every: float) -> list[float]:
        """The angles to go through, one every `every` seconds, to be back where it rests at `speed`: for
        the service to park the camera as it stops. Empty when it is there."""
        stride = self._speed * every
        steps = math.ceil(abs(self._angle) / stride - 1e-9) if stride > 0 else 0
        return [self._angle * (1 - step / steps) for step in range(1, steps + 1)]


class PanDrive(Protocol):
    """What turns the camera. One that counts how far it really turned it also has `angle_at(moment)`, on
    the monotonic clock: the service then takes its word rather than the follower's, which only supposes
    that the motor kept up."""

    name: str

    def open(self) -> None:
        """Gets ready to turn the camera, to where it rests. Never raises because the servo is not there."""

    def turn(self, angle: float) -> None:
        """Turns the camera to `angle` degrees. Called on the loop's thread, many times a second."""

    def close(self) -> None:
        """Lets the servo go."""


class SysfsPwmServo:
    """A hobby servo on a hardware PWM channel of the Pi, through the kernel's /sys/class/pwm: a pulse
    every 20 ms, whose width says the angle, `min_us` microseconds at `low` degrees to `max_us` at `high`.
    The kernel times the pulses: none of the jitter of pulses timed from Python, which a servo shakes
    with, and the camera on it.

    `directory` is the channel's own directory (`…/pwmchip0/pwm0`), exported by the host and given to the
    container: docker-compose.pan.yml. `invert` is for a servo mounted the other way up: it turns the
    other way for the same pulse.

    A servo, a channel or a right that is missing stops nothing: it is logged, tried again every
    `retry` seconds, and the camera stays fixed meanwhile.
    """

    name = "pwm"

    def __init__(
        self,
        directory: str,
        *,
        low: float = -90.0,
        high: float = 90.0,
        min_us: float = 500.0,
        max_us: float = 2500.0,
        invert: bool = False,
        period_ms: float = 20.0,
        retry: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not directory:
            raise ValueError("directory: the PWM channel's directory expected")
        if not low < high:
            raise ValueError(f"low and high: low < high expected, got {low!r} to {high!r}")
        if not 0 < min_us < max_us < period_ms * 1000:
            raise ValueError(f"min_us and max_us: 0 < min < max < the period expected, got {min_us!r} to {max_us!r}")
        self._directory = directory
        self._low, self._high = low, high
        self._min_us, self._max_us, self._invert = min_us, max_us, invert
        self._period_ns = round(period_ms * 1_000_000)
        self._retry, self._clock = retry, clock
        self._ready = False
        self._tried_at: float | None = None
        self._problem: str | None = None
        self._duty_ns: int | None = None  # the pulse last written

    @classmethod
    def from_env(cls) -> "SysfsPwmServo":
        low, high = _env_travel()
        min_us = env_float("PAN_MIN_US", 500, min=100, max=5000)
        max_us = env_float("PAN_MAX_US", 2500, min=100, max=5000)
        if not min_us < max_us:
            raise ConfigError(f"PAN_MIN_US and PAN_MAX_US: PAN_MIN_US < PAN_MAX_US expected, got {min_us:g} and {max_us:g}")
        return cls(
            env_str("PAN_PWM_DIR", "/sys/class/pwm/pwmchip0/pwm0"),
            low=low,
            high=high,
            min_us=min_us,
            max_us=max_us,
            invert=env_bool("PAN_INVERT", False),
        )

    def pulse_us(self, angle: float) -> float:
        """The width of the pulse that turns the servo to `angle`, kept within its travel."""
        share = (min(max(angle, self._low), self._high) - self._low) / (self._high - self._low)
        if self._invert:
            share = 1 - share
        return self._min_us + share * (self._max_us - self._min_us)

    def open(self) -> None:
        self._start(0.0)

    def turn(self, angle: float) -> None:
        if not self._ready:
            if self._tried_at is not None and self._clock() - self._tried_at < self._retry:
                return
            self._start(angle)
            return
        duty = round(self.pulse_us(angle) * 1000)
        if duty == self._duty_ns:
            return
        try:
            self._write("duty_cycle", duty)
            self._duty_ns = duty
        except OSError as error:
            self._lost(error)

    def close(self) -> None:
        if not self._ready:
            return
        self._ready = False
        try:
            self._write("enable", 0)
        except OSError as error:
            logger.warning("Servo on %s could not be let go (%s)", self._directory, error)

    def _start(self, angle: float) -> None:
        self._tried_at = self._clock()
        duty = round(self.pulse_us(angle) * 1000)
        try:
            # The period first: a channel just exported has none, and refuses everything else until it
            # has one. One left with a pulse longer than this period refuses the period: without its
            # pulse, it takes it.
            try:
                self._write("period", self._period_ns)
            except OSError:
                self._write("duty_cycle", 0)
                self._write("period", self._period_ns)
            self._write("duty_cycle", duty)
            self._write("enable", 1)
        except OSError as error:
            self._lost(error)
            return
        self._ready, self._duty_ns, self._problem = True, duty, None
        logger.info("Servo on %s ready", self._directory)

    def _lost(self, error: OSError) -> None:
        self._ready, self._duty_ns = False, None
        # Logged when the reason changes, not on every retry of a servo left unplugged.
        if str(error) != self._problem:
            self._problem = str(error)
            logger.warning("Servo on %s unavailable (%s): the camera stays fixed, retrying every %g s", self._directory, error, self._retry)

    def _write(self, name: str, value: int) -> None:
        with open(os.path.join(self._directory, name), "w") as file:
            file.write(str(value))


# The coils of a 28BYJ-48, IN1 to IN4 of its ULN2003 board, at each of the 8 half-steps that turn its rotor
# once: one coil, then two, then the next one alone. Each half-step is next to the one before.
HALF_STEPS: tuple[tuple[int, int, int, int], ...] = (
    (1, 0, 0, 0),
    (1, 1, 0, 0),
    (0, 1, 0, 0),
    (0, 1, 1, 0),
    (0, 0, 1, 0),
    (0, 0, 1, 1),
    (0, 0, 0, 1),
    (1, 0, 0, 1),
)
_COILS_OFF = (0, 0, 0, 0)


class Lines(Protocol):
    """The four GPIO lines of a stepper's board, IN1 to IN4: `put` sets them, `release` gives them back."""

    def put(self, values: Sequence[int]) -> None: ...

    def release(self) -> None: ...


class GpioStepper:
    """A geared stepper motor, the 28BYJ-48 on its ULN2003 board: IN1 to IN4 on four of the Pi's GPIOs,
    through the kernel's GPIO character device (`chip`). In half-steps, `steps_per_turn` of them for a turn
    of its shaft (4096 through its gears), one every `step_s` seconds at most: faster, it misses some.

    It says nothing of where it is: it counts the half-steps it made from where it started. The camera is
    taken to rest there when the service starts, and the service parks it there as it stops. A thread of
    its own steps toward where it was last told to turn, and lets the coils go once there: the gears hold
    the camera, and the motor does not heat up.

    The loop tells it where to turn once an inference: it is always that far behind where it was told to
    be, and further when it is told to turn faster than it steps. So it says where it really was
    (`angle_at`), for the `memory` seconds it remembers: an image is seen from there.

    `invert` is for a motor mounted the other way: it turns the other way for the same angle. A chip, a
    line or a right that is missing stops nothing, as for the servo: logged, tried again every `retry`
    seconds, the camera fixed meanwhile.
    """

    name = "stepper"

    def __init__(
        self,
        pins: Sequence[int],
        *,
        chip: str = "/dev/gpiochip0",
        steps_per_turn: float = 4096.0,
        step_s: float = 0.002,
        invert: bool = False,
        retry: float = 5.0,
        memory: float = 2.0,
        open_lines: Callable[[str, tuple[int, ...]], Lines] | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        pins = tuple(pins)
        if len(pins) != 4 or len(set(pins)) != 4 or not all(isinstance(pin, int) and not isinstance(pin, bool) and pin >= 0 for pin in pins):
            raise ValueError(f"pins: four different GPIO numbers expected, IN1 to IN4, got {pins!r}")
        if not chip:
            raise ValueError("chip: the GPIO chip's device expected")
        if not (_is_number(steps_per_turn) and steps_per_turn > 0):
            raise ValueError(f"steps_per_turn: a number > 0 expected, got {steps_per_turn!r}")
        if not (_is_number(step_s) and step_s > 0):
            raise ValueError(f"step_s: a number > 0 expected, got {step_s!r}")
        if not (_is_number(memory) and memory > 0):
            raise ValueError(f"memory: a number > 0 expected, got {memory!r}")
        self._pins, self._chip = pins, chip
        self._steps_per_turn, self._step_s, self._invert = steps_per_turn, step_s, invert
        self._retry, self._memory, self._clock, self._sleep = retry, memory, clock, sleep
        self._open_lines = open_lines or _gpiod_lines
        self._lines: Lines | None = None
        self._thread: threading.Thread | None = None
        self._moved = threading.Condition()
        self._position = 0  # half-steps made from where it started
        self._target = 0  # and where it is stepping to
        self._trail: deque[tuple[float, int, int]] = deque()  # (when, the half-step it got to, which way), oldest first
        self._closing = False
        self._tried_at: float | None = None
        self._problem: str | None = None

    @classmethod
    def from_env(cls) -> "GpioStepper":
        return cls(
            _env_pins("PAN_STEPPER_PINS", (6, 13, 19, 26)),
            chip=env_str("PAN_GPIO_CHIP", "/dev/gpiochip0"),
            steps_per_turn=env_float("PAN_STEPS_PER_TURN", 4096, min=100, max=100000),
            step_s=env_float("PAN_STEP_MS", 2, min=0.5, max=100) / 1000,
            invert=env_bool("PAN_INVERT", False),
        )

    def steps_for(self, angle: float) -> int:
        """The half-steps from where it rests to `angle`."""
        steps = round(angle / 360 * self._steps_per_turn)
        return -steps if self._invert else steps

    def angle_at(self, moment: float) -> float:
        """How far it had turned the camera at `moment`, on its clock, as it counted it. Before the oldest
        half-step it remembers, where that one started from."""
        with self._moved:
            steps = self._position
            for at, reached, way in reversed(self._trail):
                if at <= moment:
                    steps = reached
                    break
                steps = reached - way
        angle = steps / self._steps_per_turn * 360
        return (-angle if self._invert else angle) or 0.0

    def open(self) -> None:
        self._start()

    def turn(self, angle: float) -> None:
        if self._thread is None:
            if self._tried_at is not None and self._clock() - self._tried_at < self._retry:
                return
            self._start()
            if self._thread is None:
                return
        target = self.steps_for(angle)
        with self._moved:
            if target != self._target:
                self._target = target
                self._moved.notify()

    def close(self) -> None:
        """Lets it make the rest of its way, then gives the lines back."""
        thread = self._thread
        if thread is None:
            return
        with self._moved:
            self._closing = True
            left = abs(self._target - self._position)
            self._moved.notify()
        thread.join(timeout=left * self._step_s + 2.0)
        self._thread = None
        self._release()

    def _start(self) -> None:
        self._tried_at = self._clock()
        try:
            self._lines = self._open_lines(self._chip, self._pins)
            self._lines.put(_COILS_OFF)
        except (OSError, ImportError) as error:
            self._lost(error)
            return
        self._closing, self._problem = False, None
        self._thread = threading.Thread(target=self._run, name="pan-stepper", daemon=True)
        self._thread.start()
        logger.info("Stepper on %s, GPIO %s, ready", self._chip, ", ".join(map(str, self._pins)))

    def _run(self) -> None:
        lines = self._lines
        while True:
            with self._moved:
                while self._position == self._target and not self._closing:
                    self._moved.wait()
                if self._position == self._target:
                    return
                way = 1 if self._target > self._position else -1
            try:
                lines.put(HALF_STEPS[(self._position + way) % len(HALF_STEPS)])
                self._sleep(self._step_s)
                with self._moved:
                    self._position += way
                    there = self._position == self._target
                    now = self._clock()
                    self._trail.append((now, self._position, way))
                    while len(self._trail) > 1 and now - self._trail[1][0] >= self._memory:
                        self._trail.popleft()
                if there:
                    lines.put(_COILS_OFF)
            except OSError as error:
                self._lost(error)
                return

    def _release(self) -> None:
        lines, self._lines = self._lines, None
        if lines is None:
            return
        try:
            lines.put(_COILS_OFF)
            lines.release()
        except OSError as error:
            logger.warning("Stepper on %s could not be let go (%s)", self._chip, error)

    def _lost(self, error: Exception) -> None:
        self._thread = None
        self._release()
        # Logged when the reason changes, not on every retry of a board left unplugged.
        if str(error) != self._problem:
            self._problem = str(error)
            logger.warning("Stepper on %s unavailable (%s): the camera stays fixed, retrying every %g s", self._chip, error, self._retry)


class _GpiodLines:
    """IN1 to IN4 through libgpiod, the Debian package python3-libgpiod: its version 1 (Bookworm's), or 2."""

    def __init__(self, chip: str, pins: tuple[int, ...]) -> None:
        import gpiod  # in the image, not on a laptop: imported only for PAN_DRIVE=stepper

        self._pins = pins
        if hasattr(gpiod, "request_lines"):
            from gpiod.line import Direction, Value

            self._active, self._inactive = Value.ACTIVE, Value.INACTIVE
            self._request = gpiod.request_lines(
                chip,
                consumer="sentinel-x-vision",
                config={pins: gpiod.LineSettings(direction=Direction.OUTPUT, output_value=Value.INACTIVE)},
            )
            self._chip = None
        else:
            self._chip = gpiod.Chip(chip)
            self._request = self._chip.get_lines(list(pins))
            self._request.request(consumer="sentinel-x-vision", type=gpiod.LINE_REQ_DIR_OUT, default_vals=[0] * len(pins))

    def put(self, values: Sequence[int]) -> None:
        if self._chip is None:
            self._request.set_values({pin: self._active if on else self._inactive for pin, on in zip(self._pins, values)})
        else:
            self._request.set_values(list(values))

    def release(self) -> None:
        self._request.release()
        if self._chip is not None:
            self._chip.close()


def _gpiod_lines(chip: str, pins: tuple[int, ...]) -> Lines:
    return _GpiodLines(chip, pins)


def _env_pins(name: str, default: tuple[int, ...]) -> tuple[int, ...]:
    """Four GPIO numbers, IN1 to IN4, as `6,13,19,26`."""
    raw = env_str(name)
    if raw is None:
        return default
    try:
        pins = tuple(int(part) for part in raw.split(","))
    except ValueError:
        pins = ()
    if len(pins) != 4 or len(set(pins)) != 4 or min(pins) < 0:
        raise ConfigError(f"{name}: four different GPIO numbers expected, IN1 to IN4, as 6,13,19,26, got {raw!r}")
    return pins


def _env_travel() -> tuple[float, float]:
    """PAN_MIN_DEG and PAN_MAX_DEG: how far the servo turns the camera either way of where it rests."""
    low = env_float("PAN_MIN_DEG", -90, min=-180, max=0)
    high = env_float("PAN_MAX_DEG", 90, min=0, max=180)
    if not low < high:
        raise ConfigError(f"PAN_MIN_DEG and PAN_MAX_DEG: a travel expected, got {low:g} to {high:g}")
    return low, high


# PAN_DRIVE → a factory that reads its own settings. `none` is not here: a fixed camera has no drive.
DRIVES: dict[str, Callable[[], PanDrive]] = {
    "pwm": SysfsPwmServo.from_env,
    "stepper": GpioStepper.from_env,
}
NO_DRIVE = "none"


def make_pan(name: str) -> tuple[PanFollower, PanDrive] | None:
    """What turns the camera for PAN_DRIVE, and what says how far: None for `none`, the camera is fixed.
    A ConfigError when it names no drive, or when one of the PAN_ settings is not one."""
    if name == NO_DRIVE:
        return None
    factory = DRIVES.get(name)
    if factory is None:
        raise ConfigError(f"PAN_DRIVE: expected one of {', '.join([NO_DRIVE, *DRIVES])}, got {name!r}")
    low, high = _env_travel()
    follower = PanFollower(
        low=low,
        high=high,
        speed=env_float("PAN_SPEED_DEG_S", 60, min=1, max=360),
        deadband=env_float("PAN_DEADBAND_DEG", 4, min=0, max=45),
        home_after=env_float("PAN_HOME_AFTER_S", 2, min=0, max=600),
        patrol=env_float("PAN_PATROL_DEG", 30, min=0, max=180),
        patrol_speed=env_float("PAN_PATROL_SPEED_DEG_S", 8, min=1, max=90),
    )
    return follower, factory()


def main() -> None:
    """python -m vision.pan <degrees>: turns the camera by that much from where it is, positive toward the
    right of its image and no further than its travel, and leaves it there: where it then points is where
    it rests. With the service stopped, which holds the motor otherwise."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        (by,) = (float(arg) for arg in sys.argv[1:])
    except ValueError:
        sys.exit("Usage: python -m vision.pan <degrees>, positive toward the right of the camera's image")
    try:
        pan = make_pan(env_str("PAN_DRIVE", NO_DRIVE))
        low, high = _env_travel()
    except ConfigError as error:
        sys.exit(f"Invalid configuration: {error}")
    if pan is None:
        sys.exit("PAN_DRIVE=none: this camera is fixed")
    drive = pan[1]
    by = min(max(by, low), high)
    drive.open()
    drive.turn(by)
    drive.close()
    turned = drive.angle_at(time.monotonic()) if hasattr(drive, "angle_at") else by
    if by and not turned:
        sys.exit("The camera did not turn")
    print(f"Turned by {turned:+.1f} degrees")


if __name__ == "__main__":
    main()
