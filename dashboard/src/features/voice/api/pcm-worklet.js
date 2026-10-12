// Runs on the audio thread: hands the microphone's samples to the page, a quarter of a second or so at a
// time. Plain JavaScript, loaded as it is by `audioWorklet.addModule`.
const CHUNK = 4096

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunk = new Float32Array(CHUNK)
    this.filled = 0
  }

  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples) return true
    let read = 0
    while (read < samples.length) {
      const taken = Math.min(samples.length - read, CHUNK - this.filled)
      this.chunk.set(samples.subarray(read, read + taken), this.filled)
      this.filled += taken
      read += taken
      if (this.filled === CHUNK) {
        this.port.postMessage(this.chunk)
        this.chunk = new Float32Array(CHUNK)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
