"""The Alarm's sounds, for the DFPlayer's microSD card: writes mp3/0001.mp3 to mp3/0003.mp3 beside this file.

  0001  the siren, 1800 and 2600 Hz in turn, 350 ms each, as the buzzer played it: a critical Alert, or `pattern`
  0002  a steady 2600 Hz: the Operator's `on`
  0003  a short beep at boot: the speaker is wired

The siren and the tone last 30 s: the firmware plays them again just before their end (LOOP_MS in
src/speaker.cpp). The files are in git: run this only to change a sound, with `pip install lameenc`.
"""

import math
from array import array
from pathlib import Path

import lameenc

RATE = 44100
LOUD = 0.6  # of full scale, room left for the MP3 to overshoot: the DFPlayer's volume does the rest
LOOPED_S = 30
PEAK = math.sqrt(2) * 2 / 3  # of sin(x) + sin(3x) / 3, at x = pi/4


def tone(seconds: float, hz_at, fade_s: float = 0.0) -> array:
    """A tone whose pitch at t seconds is hz_at(t), its phase unbroken when the pitch changes: no click.

    Its third harmonic makes it a little square, harsher, as a buzzer sounds."""
    n = round(seconds * RATE)
    fade = round(fade_s * RATE)
    samples = array("h")
    phase = 0.0
    for i in range(n):
        phase += 2 * math.pi * hz_at(i / RATE) / RATE
        wave = (math.sin(phase) + math.sin(3 * phase) / 3) / PEAK
        gain = min(1, i / fade, (n - 1 - i) / fade) if fade else 1
        samples.append(round(32767 * LOUD * gain * wave))
    return samples


def mp3(samples: array) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(RATE)
    encoder.set_out_sample_rate(RATE)  # LAME would resample to 32 kHz: 44.1 kHz is what every DFPlayer reads
    encoder.set_channels(1)
    encoder.set_bit_rate(48)
    encoder.set_quality(2)
    return encoder.encode(samples.tobytes()) + encoder.flush()


def main() -> None:
    out = Path(__file__).parent / "mp3"
    out.mkdir(exist_ok=True)
    sounds = {
        "0001.mp3": tone(LOOPED_S, lambda t: 2600 if int(t / 0.35) % 2 else 1800),
        "0002.mp3": tone(LOOPED_S, lambda t: 2600),
        "0003.mp3": tone(0.15, lambda t: 2600, fade_s=0.005),
    }
    for name, samples in sounds.items():
        (out / name).write_bytes(mp3(samples))
        print(f"{out / name}: {len(samples) / RATE:.2f} s")


if __name__ == "__main__":
    main()
