"""The camera on its motor: it turns to keep the person followed in the middle of its image.

- `PanFollower`, the logic: from where that person stands around the camera to how far it is turned, at
  each instant. Pure, like the tracker: no motor and no clock in it, the caller passes the monotonic time.
- `PanDrive`, what turns the camera: `PAN_DRIVE`, `stepper` (`Uln2003Stepper`, a 28BYJ-48 stepper motor
  on its ULN2003 driver board, on four of the Pi's GPIO: the stack's), `pwm` (`SysfsPwmServo`, a servo on
  one of the Pi's hardware PWM pins) or `none` (the camera is fixed: nothing here runs). Another one plugs
  in the same way: a class with `open()`, `turn()` and `close()`, and a line in `DRIVES`.
- `python -m vision.pan <degrees>`, the service stopped: turns the camera by that much and leaves it
  there. Says whether the motor is wired, and which way it turns.

Angles are in degrees from where the camera rests, positive toward the right of its image: the `pan` of an
`intrusion` Alert.
"""

import logging
import math
import os
import struct
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
      motor, which says nothing of where it is, is where it was told to be; nor past `low` and `high`, the
      motor's travel;
    - when the last inference did not see that person, it stays where it is: they are found again where
      they were lost;
    - with no intrusion (`rest`), it goes back to where it rests, at `home_speed`.

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
        self._low, self._high = low, high
        self._speed, self._home_speed = speed, home_speed
        self._deadband, self._gain, self._memory = deadband, gain, memory
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
        self._pace = self._speed
        off = bearing - self._angle if bearing is not None and _is_number(bearing) else 0.0
        if abs(off) > self._deadband:
            self._goal = min(max(self._angle + self._gain * off, self._low), self._high)
        else:
            self._goal = self._angle
        return self._angle

    def rest(self, now: float) -> float:
        """After an inference with no intrusion in progress: back to where it rests."""
        self.step(now)
        self._goal, self._pace = 0.0, self._home_speed
        return self._angle

    def step(self, now: float) -> float:
        """Turns on toward where it is going, for the time gone by since the last call. Returns the angle
        to turn to now. A clock that goes back turns nothing."""
        if self._at is not None:
            reach = self._pace * max(0.0, now - self._at)
            self._angle += min(max(self._goal - self._angle, -reach), reach)
        if self._at is None or now > self._at:
            self._at = now
            self._trail.append((now, self._angle))
            while len(self._trail) > 1 and now - self._trail[1][0] >= self._memory:
                self._trail.popleft()
        return self._angle

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
        """Gets ready to turn the camera, to where it rests. Never raises because the motor is not there."""

    def turn(self, angle: float) -> None:
        """Turns the camera to `angle` degrees. Called on the loop's thread, many times a second."""

    def close(self) -> None:
        """Lets the motor go."""


class SysfsPwmServo:
    """A hobby servo on a hardware PWM channel of the Pi, through the kernel's /sys/class/pwm: a pulse
    every 20 ms, whose width says the angle, `min_us` microseconds at `low` degrees to `max_us` at `high`.
    The kernel times the pulses: none of the jitter of pulses timed from Python, which a servo shakes
    with, and the camera on it.

    `directory` is the channel's own directory (`…/pwmchip0/pwm0`), exported by the host and, under Docker,
    given to the container. `invert` is for a servo mounted the other way up: it turns the other way for
    the same pulse.

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


# The kernel's GPIO character device (linux/gpio.h, its v2): a chip is asked for some of its lines, which
# are then set all at once. The same numbers and the same layouts on every Linux, the Pi's included.
_GPIO_GET_CHIPINFO = 0x8044B401  # struct gpiochip_info, 68 bytes: its label at 32
_GPIO_V2_GET_LINE = 0xC250B407  # struct gpio_v2_line_request, 592 bytes
_GPIO_V2_LINE_SET_VALUES = 0xC010B40F  # struct gpio_v2_line_values: bits, mask
_GPIO_V2_LINE_FLAG_OUTPUT = 1 << 3


class GpioLines:
    """Some lines of one of the Pi's GPIO chips (`/dev/gpiochip0`, the header's: a line's number is its BCM
    one), as outputs, all low to begin with. Through the kernel's GPIO character device: no package
    needed. The kernel gives a line to one process at a time, and takes it back when that process ends."""

    def __init__(self, chip: str, offsets: Sequence[int], consumer: str = "sentinel-x") -> None:
        import fcntl  # Unix only: for a camera that turns, not for whoever imports this module

        self._ioctl = fcntl.ioctl
        info, request = bytearray(68), bytearray(592)
        struct.pack_into(f"={len(offsets)}I", request, 0, *offsets)  # offsets
        struct.pack_into("=31s", request, 256, consumer.encode())  # consumer
        struct.pack_into("=Q", request, 288, _GPIO_V2_LINE_FLAG_OUTPUT)  # config.flags
        struct.pack_into("=I", request, 560, len(offsets))  # num_lines
        fd = os.open(chip, os.O_RDWR)
        try:
            self._ioctl(fd, _GPIO_GET_CHIPINFO, info)
            self._ioctl(fd, _GPIO_V2_GET_LINE, request)
        finally:
            os.close(fd)
        self.label = bytes(info[32:64]).split(b"\0")[0].decode(errors="replace")
        self._fd = struct.unpack_from("=i", request, 588)[0]  # fd: the lines' own
        self._mask = (1 << len(offsets)) - 1

    def set(self, values: Sequence[int]) -> None:
        """Each line high or low, in the order they were asked for."""
        bits = sum(1 << place for place, value in enumerate(values) if value)
        self._ioctl(self._fd, _GPIO_V2_LINE_SET_VALUES, struct.pack("=QQ", bits, self._mask))

    def close(self) -> None:
        os.close(self._fd)


# A step of the 28BYJ-48's rotor in eight half-steps, as IN1 to IN4 of the ULN2003 board: a coil, it and
# the next, the next alone… Read the other way, it turns the other way.
_HALF_STEPS = (
    (1, 0, 0, 0), (1, 1, 0, 0), (0, 1, 0, 0), (0, 1, 1, 0),
    (0, 0, 1, 0), (0, 0, 1, 1), (0, 0, 0, 1), (1, 0, 0, 1),
)
_OFF = (0, 0, 0, 0)


class Uln2003Stepper:
    """A 28BYJ-48 stepper motor on its ULN2003 driver board, IN1 to IN4 on four of the Pi's GPIO (`pins`,
    their BCM numbers, in that order) of `chip`: `steps_per_turn` half-steps to a turn of the camera, one
    every `step_ms` milliseconds at most — faster, the motor misses some, and is no longer where it is
    counted to be. `invert` is for a motor mounted the other way up.

    A stepper says nothing of where it is and has no end stop: where the camera points when the service
    starts is where it rests, and every angle is counted from there. The service parks it there as it
    stops; after a power cut it is turned back with `python -m vision.pan`.

    A thread of its own paces the half-steps: the loop's, which says where to turn to, is held by each
    inference for longer than a motor that turns can wait. So it is always an inference behind where it
    was told to be, and says where it really was (`angle_at`), for the `memory` seconds it remembers. Once
    there, the coils are let go after `hold` seconds: the gears hold the camera, and coils left on only heat.

    A chip or a right that is missing stops nothing: it is logged, tried again every `retry` seconds, and
    the camera stays fixed meanwhile.
    """

    name = "stepper"

    def __init__(
        self,
        chip: str,
        pins: Sequence[int],
        *,
        low: float = -90.0,
        high: float = 90.0,
        steps_per_turn: float = 4096.0,
        step_ms: float = 2.0,
        invert: bool = False,
        hold: float = 0.2,
        retry: float = 5.0,
        memory: float = 2.0,
        lines: Callable[[str, Sequence[int]], GpioLines] | None = None,
    ) -> None:
        if not chip:
            raise ValueError("chip: the GPIO chip's device expected")
        if len(pins) != 4 or len(set(pins)) != 4 or not all(isinstance(pin, int) and pin >= 0 for pin in pins):
            raise ValueError(f"pins: the four GPIO of IN1 to IN4 expected, got {pins!r}")
        if not low < high:
            raise ValueError(f"low and high: low < high expected, got {low!r} to {high!r}")
        if not (_is_number(steps_per_turn) and steps_per_turn > 0 and _is_number(step_ms) and step_ms > 0):
            raise ValueError(f"steps_per_turn and step_ms: numbers > 0 expected, got {steps_per_turn!r} and {step_ms!r}")
        if not (_is_number(hold) and hold >= 0 and _is_number(retry) and retry > 0):
            raise ValueError(f"hold and retry: a number >= 0 and one > 0 expected, got {hold!r} and {retry!r}")
        if not (_is_number(memory) and memory > 0):
            raise ValueError(f"memory: a number > 0 expected, got {memory!r}")
        self._chip, self._pins = chip, tuple(pins)
        self._open_lines = lines  # what asks the kernel for the four GPIO: GpioLines, but in the tests
        self._low, self._high = low, high
        self._per_degree = steps_per_turn / 360 * (-1 if invert else 1)  # half-steps
        self._interval, self._hold, self._retry, self._memory = step_ms / 1000, hold, retry, memory
        # Where it is told to be and where it is, in half-steps from where the camera rests.
        self._changed = threading.Condition()
        self._goal = 0
        self._at = 0
        self._trail: deque[tuple[float, int]] = deque([(0.0, 0)])  # (when, the half-step it got to), oldest first
        self._closing = False
        self._thread: threading.Thread | None = None
        self._lines: GpioLines | None = None  # the four GPIO, once the kernel gave them
        self._problem: str | None = None

    @classmethod
    def from_env(cls) -> "Uln2003Stepper":
        low, high = _env_travel()
        raw = env_str("PAN_STEP_PINS", "17,18,27,22")
        try:
            pins = [int(pin) for pin in raw.split(",")]
        except ValueError:
            pins = []
        # The GPIO of the Pi's header.
        if len(pins) != 4 or len(set(pins)) != 4 or not all(2 <= pin <= 27 for pin in pins):
            raise ConfigError(f"PAN_STEP_PINS: the four GPIO of IN1 to IN4 expected, as 17,18,27,22, got {raw!r}")
        return cls(
            env_str("PAN_GPIO_CHIP", "/dev/gpiochip0"),
            pins,
            low=low,
            high=high,
            steps_per_turn=env_float("PAN_STEPS_PER_TURN", 4096, min=100, max=100_000),
            step_ms=env_float("PAN_STEP_MS", 2, min=0.5, max=50),
            invert=env_bool("PAN_INVERT", False),
        )

    @property
    def max_speed(self) -> float:
        """How fast the camera may be told to turn, in degrees a second: four fifths of what a half-step
        every `step_ms` gives, the rest for the thread to catch up when it is woken late."""
        return 0.8 / (self._interval * abs(self._per_degree))

    @property
    def angle(self) -> float:
        """How far it has turned the camera, as counted."""
        return self._at / self._per_degree or 0.0

    def angle_at(self, moment: float) -> float:
        """How far it had turned the camera at `moment`, on the monotonic clock. Further back than it
        remembers, the oldest it does."""
        with self._changed:
            at = self._trail[0][1]
            for when, reached in reversed(self._trail):
                if when <= moment:
                    at = reached
                    break
        return at / self._per_degree or 0.0

    def open(self) -> None:
        if self._thread is not None:
            return
        self._closing = False
        self._connect()
        self._thread = threading.Thread(target=self._run, name="pan", daemon=True)
        self._thread.start()

    def turn(self, angle: float) -> None:
        goal = round(min(max(angle, self._low), self._high) * self._per_degree)
        with self._changed:
            if goal != self._goal:
                self._goal = goal
                self._changed.notify_all()

    def close(self) -> None:
        """Lets the motor go, once it is where it was last told to turn."""
        thread, self._thread = self._thread, None
        if thread is None:
            return
        with self._changed:
            self._closing = True
            left = abs(self._goal - self._at)
            self._changed.notify_all()
        # Twice the time the way left takes.
        thread.join(1 + 2 * left * self._interval)
        if thread.is_alive():
            logger.warning("Stepper on %s still turning: left to it", self._chip)

    def _run(self) -> None:
        powered, stepped = False, 0.0  # whether a coil is on, and when the coils were last set
        while True:
            with self._changed:
                while self._goal == self._at and not self._closing:
                    if not powered:
                        self._changed.wait()
                    elif not self._changed.wait(self._hold):
                        break
                way = (self._goal > self._at) - (self._goal < self._at)
                closing = self._closing
            if way and self._lines is None and not self._connect():
                if closing:
                    break
                self._pause()
                continue
            if way or powered:
                # No sooner than `step_ms` after the last: the rotor is still on its way.
                wait = stepped + self._interval - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                # A half-step on. Before the first, the coils back on as they were let go: the gears held
                # the rotor there. Once there and told nothing more, off.
                at = self._at + way if powered else self._at
                try:
                    self._lines.set(_HALF_STEPS[at % 8] if way else _OFF)
                except OSError as error:
                    self._lost(error)
                    powered = False
                    if closing:
                        break
                    self._pause()
                    continue
                powered, stepped = bool(way), time.monotonic()
                if at != self._at:
                    with self._changed:
                        self._at = at
                        self._trail.append((stepped, at))
                        while len(self._trail) > 1 and stepped - self._trail[1][0] >= self._memory:
                            self._trail.popleft()
            if closing and not way:
                break
        lines, self._lines = self._lines, None
        if lines is not None:
            lines.close()

    def _pause(self) -> None:
        # Until the next try, or the close.
        with self._changed:
            self._changed.wait_for(lambda: self._closing, self._retry)

    def _connect(self) -> bool:
        try:
            self._lines = (self._open_lines or GpioLines)(self._chip, self._pins)
        except OSError as error:
            self._lost(error)
            return False
        self._problem = None
        pins = ", ".join(map(str, self._pins))
        logger.info("Stepper on %s ready: IN1 to IN4 on GPIO %s (%s)", self._chip, pins, self._lines.label)
        return True

    def _lost(self, error: OSError) -> None:
        lines, self._lines = self._lines, None
        if lines is not None:
            try:
                lines.close()
            except OSError:
                pass
        # Logged when the reason changes, not on every retry of a chip that stays out of reach.
        if str(error) != self._problem:
            self._problem = str(error)
            logger.warning("Stepper on %s unavailable (%s): the camera stays fixed, retrying every %g s", self._chip, error, self._retry)


def _env_travel() -> tuple[float, float]:
    """PAN_MIN_DEG and PAN_MAX_DEG: how far the motor turns the camera either way of where it rests."""
    low = env_float("PAN_MIN_DEG", -90, min=-180, max=0)
    high = env_float("PAN_MAX_DEG", 90, min=0, max=180)
    if not low < high:
        raise ConfigError(f"PAN_MIN_DEG and PAN_MAX_DEG: a travel expected, got {low:g} to {high:g}")
    return low, high


# PAN_DRIVE → a factory that reads its own settings. `none` is not here: a fixed camera has no drive.
DRIVES: dict[str, Callable[[], PanDrive]] = {
    "stepper": Uln2003Stepper.from_env,
    "pwm": SysfsPwmServo.from_env,
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
    drive = factory()
    # A motor that has a speed of its own is never told to turn faster: it would be left behind.
    limit = getattr(drive, "max_speed", None)
    speed = env_float("PAN_SPEED_DEG_S", 60 if limit is None else limit, min=1, max=360)
    if limit is not None and speed > limit:
        logger.warning("PAN_SPEED_DEG_S: %g is more than the %s drive turns at, kept to %.1f", speed, name, limit)
        speed = limit
    follower = PanFollower(
        low=low,
        high=high,
        speed=speed,
        home_speed=min(30.0, speed),
        deadband=env_float("PAN_DEADBAND_DEG", 4, min=0, max=45),
    )
    return follower, drive


def main() -> None:
    """python -m vision.pan <degrees>: turns the camera by that much from where it is, positive toward the
    right of its image, and leaves it there: where it then points is where it rests. With the service
    stopped, which holds the motor otherwise."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        (by,) = (float(arg) for arg in sys.argv[1:])
    except ValueError:
        sys.exit("Usage: python -m vision.pan <degrees>, positive toward the right of the camera's image")
    try:
        pan = make_pan(env_str("PAN_DRIVE", NO_DRIVE))
    except ConfigError as error:
        sys.exit(f"Invalid configuration: {error}")
    if pan is None:
        sys.exit("PAN_DRIVE=none: this camera is fixed")
    drive = pan[1]
    drive.open()
    drive.turn(by)
    drive.close()
    turned = drive.angle_at(time.monotonic()) if hasattr(drive, "angle_at") else by
    if by and not turned:
        sys.exit("The camera did not turn")
    print(f"Turned by {turned:+.1f} degrees")


if __name__ == "__main__":
    main()
