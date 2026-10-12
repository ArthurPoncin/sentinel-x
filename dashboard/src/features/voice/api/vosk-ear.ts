import { heardFrom } from '../utils/heard'
import { GRAMMAR } from '../utils/interpret'
import type { EarEvent, Failure } from './ear'

// The recognition model, a static file of the dashboard itself: nothing leaves the machine to hear a voice.
// Fetched into `public/voice/` by `npm run voice:model`, and by the image's build.
export const MODEL_URL = `${import.meta.env.BASE_URL}voice/vosk-model-small-fr-0.22.tar.gz`

// The engine's log level that keeps its warnings and drops its account of every load.
const QUIET = -1

// Why the browser did not give the microphone.
function failureOf(error: unknown): Failure {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'refused'
  return 'no-microphone'
}

// The ear: the microphone of this machine, heard by Vosk in WebAssembly, in a worker, within its closed
// grammar. It asks for the microphone first, loads the engine and its model only then, and tells `emit` of
// each step, of each sentence once it is said, and of what stopped it. Returns what stops it: the microphone
// is let go of and the engine's memory freed. The engine is behind this function alone: another one would
// give the same events.
export function listen(emit: (event: EarEvent) => void, modelUrl = MODEL_URL): () => void {
  let stopped = false
  const cleanups: (() => void)[] = []
  const stop = () => {
    stopped = true
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  }
  const fail = (reason: Failure) => {
    if (stopped) return
    stop()
    emit({ type: 'failed', reason })
  }

  const start = async () => {
    // Without a secure context the browser has no microphone to give.
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return fail('unsupported')

    emit({ type: 'ear', state: 'asking' })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch (error) {
      return fail(failureOf(error))
    }
    cleanups.push(() => stream.getTracks().forEach((track) => track.stop()))
    if (stopped) return stop()

    emit({ type: 'ear', state: 'loading' })
    const context = new AudioContext()
    cleanups.push(() => void context.close())
    try {
      // The engine is some megabytes of its own: loaded with its model, never before.
      const { Model } = await import('vosk-browser')
      // The engine's worker is a blob: it needs the whole address of the model.
      const model = new Model(new URL(modelUrl, window.location.href).toString(), QUIET)
      cleanups.push(() => model.terminate())
      await new Promise<void>((resolve, reject) => {
        model.on('load', (message) => (message.event === 'load' && message.result ? resolve() : reject(new Error('model'))))
        model.on('error', () => reject(new Error('model')))
      })
      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url))
      if (stopped) return stop()

      const recognizer = new model.KaldiRecognizer(context.sampleRate, JSON.stringify(GRAMMAR))
      // Each word with how sure the engine is of it: the interpreter's threshold needs it.
      recognizer.setWords(true)
      recognizer.on('result', (message) => {
        if (!stopped && message.event === 'result') emit({ type: 'heard', heard: heardFrom(message.result) })
      })

      const tap = new AudioWorkletNode(context, 'pcm-tap', { numberOfOutputs: 0 })
      tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!stopped) recognizer.acceptWaveformFloat(data, context.sampleRate)
      }
      context.createMediaStreamSource(stream).connect(tap)
      await context.resume()
    } catch {
      return fail('model')
    }
    if (stopped) return stop()
    emit({ type: 'ear', state: 'listening' })
  }

  void start()
  return stop
}
