import logging
import os
import struct
import time

import pytest

from sentinel_common.config import ConfigError
from vision import pan
from vision.pan import GpioLines, PanFollower, SysfsPwmServo, Uln2003Stepper, make_pan


def follow(follower: PanFollower, bearing: float | None, start: float, seconds: float, every: float = 0.1) -> list[float]:
    """An inference every `every` seconds that sees the person at `bearing`: how far the camera is turned
    at each."""
    return [follower.aim(bearing, start + i * every) for i in range(1, round(seconds / every) + 1)]


# --- the follower -------------------------------------------------------------------------------------


def test_rests_at_zero_until_there_is_someone_to_turn_to():
    follower = PanFollower()
    assert follower.angle == 0
    assert follower.step(0.0) == 0
    assert follower.rest(1.0) == 0
    assert follower.step(5.0) == 0


def test_turns_to_the_person_followed_and_stops_once_they_are_near_the_middle_of_its_image():
    follower = PanFollower(speed=60, deadband=4)
    angles = follow(follower, 30.0, start=0.0, seconds=2.0)
    assert angles == sorted(angles)
    assert 26 <= angles[-1] <= 30
    # There for good: it does not hunt.
    assert follow(follower, 30.0, start=2.0, seconds=1.0) == [angles[-1]] * 10


def test_turns_the_other_way_just_as_well():
    right, left = PanFollower(), PanFollower()
    assert follow(left, -30.0, 0.0, 2.0) == [-angle for angle in follow(right, 30.0, 0.0, 2.0)]


def test_never_turns_faster_than_its_speed():
    follower = PanFollower(speed=60)
    follower.step(0.0)
    angles = [0.0, *follow(follower, 80.0, start=0.0, seconds=1.0, every=0.05)]
    assert all(later - earlier <= 60 * 0.05 + 1e-9 for earlier, later in zip(angles, angles[1:]))
    assert angles[-1] > 40


def test_leaves_someone_within_the_deadband_where_they_are():
    follower = PanFollower(deadband=4)
    assert follow(follower, 3.9, 0.0, 1.0) == [0.0] * 10
    assert follow(follower, -3.9, 1.0, 1.0) == [0.0] * 10


def test_never_turns_past_its_travel():
    follower = PanFollower(low=-45, high=60)
    assert follow(follower, 170.0, 0.0, 5.0)[-1] == 60
    assert follow(follower, -170.0, 5.0, 5.0)[-1] == -45


def test_stays_where_it_is_when_the_person_followed_is_not_seen():
    follower = PanFollower()
    reached = follow(follower, 40.0, 0.0, 0.5)[-1]
    assert 0 < reached < 40
    # It stops where the inference that misses them finds it.
    held = follow(follower, None, 0.5, 2.0)
    assert held == [held[0]] * 20
    assert 0 <= held[0] - reached <= 60 * 0.1 + 1e-9


def test_goes_back_to_where_it_rests_once_the_intrusion_is_over_slowly():
    follower = PanFollower(speed=60, home_speed=30)
    follow(follower, 45.0, 0.0, 3.0)
    turned = follower.angle
    assert turned > 40
    follower.rest(3.0)
    assert follower.step(4.0) == pytest.approx(turned - 30)
    assert follower.step(10.0) == 0
    assert follower.step(11.0) == 0


def test_is_the_same_whatever_the_rate_it_is_stepped_at():
    coarse, fine = PanFollower(), PanFollower()
    for follower in (coarse, fine):
        follower.aim(50.0, 0.0)
    coarse.step(0.5)
    for i in range(1, 51):
        fine.step(i * 0.01)
    assert fine.angle == pytest.approx(coarse.angle)


def test_a_clock_that_goes_back_turns_nothing():
    follower = PanFollower()
    follower.aim(50.0, 10.0)
    assert follower.step(9.0) == 0
    assert follower.step(10.5) == pytest.approx(30)


def test_remembers_how_far_it_was_turned_when_an_image_was_taken():
    follower = PanFollower(speed=60, gain=1)
    follower.aim(60.0, 0.0)
    for i in range(1, 11):
        follower.step(i * 0.1)
    assert follower.angle == pytest.approx(60)
    assert follower.angle_at(0.0) == 0
    assert follower.angle_at(0.5) == pytest.approx(30)
    assert follower.angle_at(0.25) == pytest.approx(15)
    # Later than now: where it is. Further back than it remembers: the oldest it does.
    assert follower.angle_at(5.0) == pytest.approx(60)
    assert follower.angle_at(-1.0) == 0
    follower.step(10.0)
    assert follower.angle_at(0.5) == pytest.approx(60)


def test_the_way_home_is_taken_at_its_speed_and_ends_where_it_rests():
    follower = PanFollower(speed=60, gain=1)
    assert follower.way_home(0.05) == []
    follower.aim(45.0, 0.0)
    follower.step(2.0)
    way = follower.way_home(0.05)
    assert way[-1] == 0
    assert len(way) == 15
    assert all(abs(later - earlier) <= 3 + 1e-9 for earlier, later in zip([45.0, *way], way))


@pytest.mark.parametrize(
    "settings",
    [
        {"low": 10, "high": 90},
        {"low": -90, "high": -10},
        {"low": 0, "high": 0},
        {"speed": 0},
        {"home_speed": -1},
        {"deadband": -1},
        {"gain": 0},
        {"gain": 1.5},
        {"memory": 0},
        {"speed": float("nan")},
    ],
)
def test_the_follower_refuses_invalid_settings(settings):
    with pytest.raises(ValueError):
        PanFollower(**settings)


# --- the servo ----------------------------------------------------------------------------------------


@pytest.fixture
def channel(tmp_path):
    """A PWM channel's directory, as the kernel shows one that was just exported."""
    for name in ("period", "duty_cycle", "enable"):
        (tmp_path / name).write_text("0")
    return tmp_path


def state(channel) -> dict[str, int]:
    return {name: int((channel / name).read_text()) for name in ("period", "duty_cycle", "enable")}


def test_opens_at_rest_with_a_pulse_every_20_ms(channel):
    servo = SysfsPwmServo(str(channel))
    servo.open()
    assert state(channel) == {"period": 20_000_000, "duty_cycle": 1_500_000, "enable": 1}


def test_the_pulse_says_the_angle_from_one_end_of_its_travel_to_the_other(channel):
    servo = SysfsPwmServo(str(channel), low=-90, high=90, min_us=500, max_us=2500)
    assert [servo.pulse_us(angle) for angle in (-90, -45, 0, 45, 90)] == [500, 1000, 1500, 2000, 2500]
    servo.open()
    servo.turn(45.0)
    assert state(channel)["duty_cycle"] == 2_000_000
    # Past its travel is the end of it.
    servo.turn(400.0)
    assert state(channel)["duty_cycle"] == 2_500_000
    servo.turn(-400.0)
    assert state(channel)["duty_cycle"] == 500_000


def test_a_servo_mounted_the_other_way_up_turns_the_other_way_for_the_same_angle(channel):
    servo = SysfsPwmServo(str(channel), invert=True)
    assert [servo.pulse_us(angle) for angle in (-90, 0, 90)] == [2500, 1500, 500]


def test_a_travel_that_is_not_half_a_turn_and_pulses_that_are_not_the_usual(channel):
    servo = SysfsPwmServo(str(channel), low=-60, high=120, min_us=600, max_us=2400)
    assert [servo.pulse_us(angle) for angle in (-60, 30, 120)] == [600, 1500, 2400]


def test_writes_the_pulse_only_when_it_changes(channel):
    servo = SysfsPwmServo(str(channel))
    servo.open()
    servo.turn(10.0)
    (channel / "duty_cycle").write_text("touched")
    servo.turn(10.0)
    assert (channel / "duty_cycle").read_text() == "touched"
    servo.turn(10.5)
    assert int((channel / "duty_cycle").read_text()) == round((1500 + 10.5 * 2000 / 180) * 1000)


def test_lets_the_servo_go_when_closed(channel):
    servo = SysfsPwmServo(str(channel))
    servo.open()
    servo.turn(30.0)
    servo.close()
    assert state(channel)["enable"] == 0
    # Closed twice, or never opened: nothing to do.
    (channel / "enable").write_text("7")
    servo.close()
    assert state(channel)["enable"] == 7


def test_a_channel_that_is_not_there_stops_nothing_and_is_tried_again_later(tmp_path, caplog):
    now = [0.0]
    missing = tmp_path / "pwm0"
    servo = SysfsPwmServo(str(missing), retry=5.0, clock=lambda: now[0])
    with caplog.at_level(logging.WARNING):
        servo.open()
        for _ in range(50):
            now[0] += 0.05
            servo.turn(20.0)
    assert len(caplog.records) == 1 and "unavailable" in caplog.text
    # The channel comes: the next try finds it, and turns to where the camera is told to be.
    missing.mkdir()
    for name in ("period", "duty_cycle", "enable"):
        (missing / name).write_text("0")
    now[0] = 5.5
    servo.turn(20.0)
    assert state(missing) == {"period": 20_000_000, "duty_cycle": round((1500 + 20 * 2000 / 180) * 1000), "enable": 1}


@pytest.mark.parametrize(
    "args, settings",
    [
        (("",), {}),
        (("/pwm",), {"low": 90, "high": -90}),
        (("/pwm",), {"min_us": 2500, "max_us": 500}),
        (("/pwm",), {"min_us": 0}),
        (("/pwm",), {"max_us": 25000}),
    ],
)
def test_the_servo_refuses_invalid_settings(args, settings):
    with pytest.raises(ValueError):
        SysfsPwmServo(*args, **settings)


# --- the stepper --------------------------------------------------------------------------------------

# IN1 to IN4 at each of the eight half-steps, and with the coils let go.
HALF = [(1, 0, 0, 0), (1, 1, 0, 0), (0, 1, 0, 0), (0, 1, 1, 0), (0, 0, 1, 0), (0, 0, 1, 1), (0, 0, 0, 1), (1, 0, 0, 1)]
OFF = (0, 0, 0, 0)
# The angle of one half-step, at 4096 to a turn.
STEP = 360 / 4096


class Board:
    """The ULN2003 board, in place of the kernel's GPIO: what its four inputs were set to, and when."""

    label = "a board on the bench"

    def __init__(self):
        self.asked, self.states, self.times, self.closed = [], [], [], 0
        self.missing: OSError | None = None  # what asking for the GPIO raises
        self.broken: OSError | None = None  # what setting them raises

    def __call__(self, chip, pins):
        if self.missing is not None:
            raise self.missing
        self.asked.append((chip, tuple(pins)))
        return self

    def set(self, values):
        if self.broken is not None:
            raise self.broken
        self.states.append(tuple(values))
        self.times.append(time.monotonic())

    def close(self):
        self.closed += 1

    def steps(self) -> list[int]:
        """Which of the eight half-steps each state was, the coils let go aside."""
        return [HALF.index(state) for state in self.states if state != OFF]


@pytest.fixture
def board():
    return Board()


@pytest.fixture
def stepper(board):
    """Makes a motor on the board, fast enough for the tests, and closes it after them."""
    made = []

    def make(**settings) -> Uln2003Stepper:
        motor = Uln2003Stepper("/dev/gpiochip0", (17, 18, 27, 22), lines=board, **{"step_ms": 0.2, "hold": 0.02, **settings})
        made.append(motor)
        return motor

    yield make
    for motor in made:
        motor.close()


def settle(done, seconds: float = 5.0) -> None:
    """Waits for the motor's thread to get there."""
    deadline = time.monotonic() + seconds
    while not done():
        assert time.monotonic() < deadline, "the motor did not get there"
        time.sleep(0.001)


def at_rest(board) -> bool:
    return board.states[-1:] == [OFF]


def test_asks_for_its_four_gpio_and_leaves_the_coils_off_until_told_to_turn(board, stepper):
    motor = stepper()
    motor.open()
    assert board.asked == [("/dev/gpiochip0", (17, 18, 27, 22))]
    motor.turn(0.0)
    time.sleep(0.05)
    assert board.states == [] and motor.angle == 0


def test_turns_by_half_steps_in_the_order_of_the_board_then_lets_the_coils_go(board, stepper):
    motor = stepper()
    motor.open()
    motor.turn(10 * STEP)
    settle(lambda: at_rest(board))
    # The coils on as they are counted to be, ten half-steps, off.
    assert board.states == [HALF[0], *(HALF[step % 8] for step in range(1, 11)), OFF]
    assert motor.angle == pytest.approx(10 * STEP)


def test_turns_the_other_way_by_the_same_half_steps_read_backwards(board, stepper):
    motor = stepper()
    motor.open()
    motor.turn(-10 * STEP)
    settle(lambda: at_rest(board))
    assert board.states == [HALF[0], *(HALF[-step % 8] for step in range(1, 11)), OFF]
    assert motor.angle == pytest.approx(-10 * STEP)


def test_a_motor_mounted_the_other_way_up_turns_the_other_way_for_the_same_angle(board, stepper):
    motor = stepper(invert=True)
    motor.open()
    motor.turn(10 * STEP)
    settle(lambda: at_rest(board))
    assert board.steps() == [0, *(-step % 8 for step in range(1, 11))]
    assert motor.angle == pytest.approx(10 * STEP)


def test_goes_on_from_where_it_let_the_coils_go(board, stepper):
    motor = stepper()
    motor.open()
    motor.turn(3 * STEP)
    settle(lambda: at_rest(board))
    motor.turn(5 * STEP)
    settle(lambda: at_rest(board) and len(board.states) > 5)
    # Back on at the half-step it stopped at, before the next.
    assert board.states == [HALF[0], HALF[1], HALF[2], HALF[3], OFF, HALF[3], HALF[4], HALF[5], OFF]


def test_never_skips_a_half_step_when_told_elsewhere_on_its_way(board, stepper):
    motor = stepper(step_ms=0.5)
    motor.open()
    motor.turn(60 * STEP)
    settle(lambda: len(board.states) > 10)
    motor.turn(-20 * STEP)
    settle(lambda: at_rest(board))
    assert motor.angle == pytest.approx(-20 * STEP)
    steps = board.steps()
    assert all((later - earlier) % 8 in (1, 7) for earlier, later in zip(steps, steps[1:]))
    # It turned back before it got to the first place.
    assert len(steps) < 1 + 60 + 80


def test_never_steps_faster_than_the_motor_follows(board, stepper):
    motor = stepper(step_ms=2)
    motor.open()
    motor.turn(25 * STEP)
    settle(lambda: at_rest(board))
    assert len(board.times) == 27
    # 5 % for the clock read between the board and the motor's own.
    assert all(later - earlier >= 0.0019 for earlier, later in zip(board.times, board.times[1:]))
    assert motor.max_speed == pytest.approx(0.8 * STEP / 0.002)


def test_remembers_how_far_it_had_turned_the_camera_when_an_image_was_taken(board, stepper):
    motor = stepper(step_ms=2)
    before = time.monotonic()
    motor.open()
    assert motor.angle_at(before) == 0
    motor.turn(20 * STEP)
    settle(lambda: at_rest(board))
    # The board saw each half-step a moment before the motor counted it.
    reached = dict(zip(range(1, 21), board.times[1:]))
    assert motor.angle_at(before) == 0
    assert motor.angle_at(reached[10] + 0.001) == pytest.approx(10 * STEP)
    assert motor.angle_at(reached[15] + 0.001) == pytest.approx(15 * STEP)
    assert motor.angle_at(time.monotonic()) == motor.angle == pytest.approx(20 * STEP)
    # No further back than its memory, 25 of these half-steps at most: the oldest it remembers.
    forgetful = stepper(memory=0.005)
    forgetful.open()
    forgetful.turn(100 * STEP)
    settle(lambda: at_rest(board) and forgetful.angle == pytest.approx(100 * STEP))
    assert 70 * STEP < forgetful.angle_at(before) < 100 * STEP


def test_never_turns_past_its_travel(board, stepper):
    motor = stepper(low=-1, high=2, steps_per_turn=3600)
    motor.open()
    motor.turn(400.0)
    settle(lambda: at_rest(board))
    assert motor.angle == pytest.approx(2)
    motor.turn(-400.0)
    settle(lambda: at_rest(board) and motor.angle < 0)
    assert motor.angle == pytest.approx(-1)


def test_closing_ends_where_it_was_last_told_to_turn_the_coils_off(board, stepper):
    motor = stepper(step_ms=1, hold=5)
    motor.open()
    motor.turn(50 * STEP)
    motor.turn(0.0)
    motor.turn(40 * STEP)
    motor.close()
    assert motor.angle == pytest.approx(40 * STEP)
    assert board.states[-1] == OFF and board.closed == 1
    # Closed twice, or never opened: nothing to do.
    motor.close()
    stepper().close()
    assert board.closed == 1


def test_a_chip_that_is_not_there_stops_nothing_and_is_tried_again_later(board, stepper, caplog):
    board.missing = FileNotFoundError(2, "No such file or directory")
    motor = stepper(retry=0.05)
    with caplog.at_level(logging.WARNING):
        motor.open()
        motor.turn(8 * STEP)
        time.sleep(0.2)
    assert len(caplog.records) == 1 and "unavailable" in caplog.text
    assert board.states == [] and motor.angle == 0
    # The chip comes: the next try finds it, and turns to where the camera is told to be.
    board.missing = None
    settle(lambda: at_rest(board))
    assert motor.angle == pytest.approx(8 * STEP)


def test_gpio_that_stop_answering_are_asked_for_again_and_the_count_kept(board, stepper):
    motor = stepper(step_ms=1, retry=0.05)
    motor.open()
    motor.turn(40 * STEP)
    settle(lambda: len(board.states) > 5)
    board.broken = OSError(5, "Input/output error")
    settle(lambda: board.closed == 1)
    reached = len(board.steps()) - 1
    assert 5 <= reached < 40 and motor.angle == pytest.approx(reached * STEP)
    board.broken = None
    settle(lambda: at_rest(board))
    assert len(board.asked) == 2
    assert motor.angle == pytest.approx(40 * STEP)
    # On again where it was, then the half-steps it had left.
    assert board.steps() == [step % 8 for step in [*range(reached + 1), *range(reached, 41)]]


@pytest.mark.parametrize(
    "args, settings",
    [
        (("", (17, 18, 27, 22)), {}),
        (("/dev/gpiochip0", (17, 18, 27)), {}),
        (("/dev/gpiochip0", (17, 18, 27, 27)), {}),
        (("/dev/gpiochip0", (17, 18, 27, -1)), {}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"low": 90, "high": -90}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"steps_per_turn": 0}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"step_ms": 0}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"hold": -1}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"retry": 0}),
        (("/dev/gpiochip0", (17, 18, 27, 22)), {"memory": 0}),
    ],
)
def test_the_stepper_refuses_invalid_settings(args, settings):
    with pytest.raises(ValueError):
        Uln2003Stepper(*args, **settings)


def test_the_gpio_are_asked_of_the_kernel_as_outputs_and_set_all_at_once(tmp_path, monkeypatch):
    fcntl = pytest.importorskip("fcntl", reason="no GPIO character device without Unix's ioctl")
    chip = tmp_path / "gpiochip0"
    chip.write_bytes(b"")
    theirs, ours = os.pipe()
    calls = []

    def ioctl(fd, request, arg):
        calls.append((fd, request, bytes(arg)))
        if request == 0x8044B401:  # GPIO_GET_CHIPINFO_IOCTL
            struct.pack_into("32s32sI", arg, 0, b"gpiochip0", b"pinctrl-bcm2711", 58)
        elif request == 0xC250B407:  # GPIO_V2_GET_LINE_IOCTL
            struct.pack_into("i", arg, 588, ours)
        return 0

    monkeypatch.setattr(fcntl, "ioctl", ioctl)
    try:
        lines = GpioLines(str(chip), (17, 18, 27, 22))
        assert lines.label == "pinctrl-bcm2711"
        (_, first, info), (_, second, request) = calls
        assert (first, len(info), second, len(request)) == (0x8044B401, 68, 0xC250B407, 592)
        # struct gpio_v2_line_request: offsets, consumer, config.flags (output, nothing else), num_lines.
        assert struct.unpack_from("64I", request, 0) == (17, 18, 27, 22, *[0] * 60)
        assert request[256:288] == b"sentinel-x".ljust(32, b"\0")
        assert struct.unpack_from("QI", request, 288) == (1 << 3, 0)
        assert struct.unpack_from("I", request, 560) == (4,)
        lines.set((1, 1, 0, 0))
        lines.set((0, 0, 0, 1))
        # On the lines' own descriptor, the four of them at each call: IN1 is the lowest bit.
        assert calls[2:] == [(ours, 0xC010B40F, struct.pack("QQ", 0b0011, 0b1111)), (ours, 0xC010B40F, struct.pack("QQ", 0b1000, 0b1111))]
        lines.close()
        with pytest.raises(OSError):
            os.fstat(ours)
    finally:
        os.close(theirs)


# --- PAN_DRIVE ----------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_pan_settings(monkeypatch):
    for name in ("PAN_PWM_DIR", "PAN_MIN_DEG", "PAN_MAX_DEG", "PAN_MIN_US", "PAN_MAX_US", "PAN_INVERT", "PAN_SPEED_DEG_S", "PAN_DEADBAND_DEG",
                 "PAN_GPIO_CHIP", "PAN_STEP_PINS", "PAN_STEPS_PER_TURN", "PAN_STEP_MS"):
        monkeypatch.delenv(name, raising=False)


def test_a_fixed_camera_has_no_pan():
    assert make_pan("none") is None


def test_the_pwm_drive_takes_its_channel_its_travel_and_its_pulses_from_the_environment(channel, monkeypatch):
    monkeypatch.setenv("PAN_PWM_DIR", str(channel))
    monkeypatch.setenv("PAN_MIN_DEG", "-60")
    monkeypatch.setenv("PAN_MAX_DEG", "120")
    monkeypatch.setenv("PAN_MIN_US", "600")
    monkeypatch.setenv("PAN_MAX_US", "2400")
    follower, drive = make_pan("pwm")
    assert drive.name == "pwm"
    assert [drive.pulse_us(angle) for angle in (-60, 30, 120)] == [600, 1500, 2400]
    # The follower keeps to the same travel.
    assert follow(follower, 170.0, 0.0, 5.0)[-1] == 120
    assert follow(follower, -170.0, 5.0, 8.0)[-1] == -60


def fastest(follower: PanFollower, toward: float = 80.0) -> float:
    """How fast the follower turns at most, in degrees a second."""
    follower.step(0.0)
    angles = [0.0, *follow(follower, toward, start=0.0, seconds=1.0, every=0.05)]
    return max(abs(later - earlier) for earlier, later in zip(angles, angles[1:])) / 0.05


def test_the_stepper_drive_is_the_28byj_48_as_the_installation_wires_it(board, monkeypatch):
    monkeypatch.setattr(pan, "GpioLines", board)
    follower, drive = make_pan("stepper")
    assert drive.name == "stepper"
    drive.open()
    drive.turn(4 * STEP)
    drive.close()
    assert board.asked == [("/dev/gpiochip0", (17, 18, 27, 22))]
    assert board.states == [HALF[0], HALF[1], HALF[2], HALF[3], HALF[4], OFF]
    # A half-step every 2 ms, and the follower no faster than the motor then turns the camera.
    assert drive.max_speed == pytest.approx(35.16, abs=0.01)
    assert fastest(follower) == pytest.approx(drive.max_speed)


def test_the_stepper_drive_takes_its_chip_its_gpio_its_steps_and_its_travel_from_the_environment(board, monkeypatch):
    monkeypatch.setattr(pan, "GpioLines", board)
    monkeypatch.setenv("PAN_GPIO_CHIP", "/dev/gpiochip4")
    monkeypatch.setenv("PAN_STEP_PINS", "5, 6,13,19")
    monkeypatch.setenv("PAN_STEPS_PER_TURN", "3600")
    monkeypatch.setenv("PAN_STEP_MS", "1")
    monkeypatch.setenv("PAN_INVERT", "true")
    monkeypatch.setenv("PAN_MIN_DEG", "-45")
    monkeypatch.setenv("PAN_MAX_DEG", "0.5")
    monkeypatch.setenv("PAN_SPEED_DEG_S", "20")
    follower, drive = make_pan("stepper")
    drive.open()
    drive.turn(400.0)
    drive.close()
    assert board.asked == [("/dev/gpiochip4", (5, 6, 13, 19))]
    # Half a degree is five of its half-steps, taken backwards.
    assert board.steps() == [0, 7, 6, 5, 4, 3]
    assert drive.max_speed == pytest.approx(80)
    assert fastest(follower, toward=-80.0) == pytest.approx(20)
    assert follow(follower, -170.0, 1.0, 8.0)[-1] == -45


def test_the_follower_is_kept_to_the_speed_of_the_stepper(board, monkeypatch, caplog):
    monkeypatch.setattr(pan, "GpioLines", board)
    monkeypatch.setenv("PAN_SPEED_DEG_S", "60")
    with caplog.at_level(logging.WARNING):
        follower, drive = make_pan("stepper")
    assert "PAN_SPEED_DEG_S" in caplog.text
    assert fastest(follower) == pytest.approx(drive.max_speed)


@pytest.mark.parametrize(
    "name, variables",
    [
        ("gimbal", {}),
        ("stepper", {"PAN_STEP_PINS": "17,18,27"}),
        ("stepper", {"PAN_STEP_PINS": "17,18,27,27"}),
        ("stepper", {"PAN_STEP_PINS": "17,18,27,40"}),
        ("stepper", {"PAN_STEP_PINS": "IN1,IN2,IN3,IN4"}),
        ("stepper", {"PAN_STEPS_PER_TURN": "0"}),
        ("stepper", {"PAN_STEP_MS": "0"}),
        ("stepper", {"PAN_MIN_DEG": "10"}),
        ("pwm", {"PAN_MIN_DEG": "10"}),
        ("pwm", {"PAN_MAX_DEG": "-10"}),
        ("pwm", {"PAN_MIN_DEG": "0", "PAN_MAX_DEG": "0"}),
        ("pwm", {"PAN_MIN_US": "2500", "PAN_MAX_US": "500"}),
        ("pwm", {"PAN_SPEED_DEG_S": "0"}),
        ("pwm", {"PAN_INVERT": "maybe"}),
    ],
)
def test_refuses_a_drive_or_a_setting_that_is_not_one(name, variables, monkeypatch):
    for variable, value in variables.items():
        monkeypatch.setenv(variable, value)
    with pytest.raises(ConfigError):
        make_pan(name)
