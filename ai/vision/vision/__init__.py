"""The vision service of the Command Post: a person on the ZIF camera becomes one `intrusion` Alert.

`sources` gives the frames, `detectors` finds the intruder in them, `tracker` (pure, camera and model aside)
turns the boxes into the Alerts to post, `service` runs the loop and serves the annotated feed.
Python 3.11 (the Pi OS's): the image runs the system Python, for Picamera2.
"""
