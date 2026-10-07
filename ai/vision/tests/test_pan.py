import logging

import pytest

from sentinel_common.config import ConfigError
from vision.pan import PanFollower, SysfsPwmServo, make_pan


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


# --- PAN_DRIVE ----------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_pan_settings(monkeypatch):
    for name in ("PAN_PWM_DIR", "PAN_MIN_DEG", "PAN_MAX_DEG", "PAN_MIN_US", "PAN_MAX_US", "PAN_INVERT", "PAN_SPEED_DEG_S", "PAN_DEADBAND_DEG"):
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


@pytest.mark.parametrize(
    "name, variables",
    [
        ("stepper", {}),
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
