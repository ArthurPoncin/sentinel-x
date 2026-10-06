# A package, so pytest names these modules `tests.*`: without it, importlib mode names them `vision.tests.*`
# and takes the directory ai/vision for the `vision` package, hiding ai/vision/vision.
# Every service's tests are then `tests.*`: a test module's name must be unique across ai/.
