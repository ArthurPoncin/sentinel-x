import { heardFrom } from '../utils/heard'
import { GRAMMAR } from '../utils/interpret'
import type { EarEvent, Failure } from './ear'

// The recognition model, a static file of the dashboard itself: nothing leaves the machine to hear a voice.
// Fetched into `public/voice/` by `npm run voice:model`, and by the image's build.
export const MODEL_URL = `${import.meta.env.BASE_URL}voice/vosk-model-small-fr-0.22.tar.gz`

// The engine's log level that keeps its warnings and drops its account of every load.
const QUIET = -1

// What the tabs of this browser take turns on: one ear at a time, or each tab would send the command it heard.
const TURN = 'sentinel-x:voice-ear'

// Milliseconds the browser is given to let the sound through. A page reloaded with the switch on has had no
// gesture, and some browsers then keep it asleep for ever.
const RESUME_MS = 3000

// Why the browser did not give the microphone.
export function failureOf(error: unknown): Failure {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'refused'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone'
  // There is one, and it cannot be read: held by another application, or refused by the system.
  return 'unavailable'
}

// This tab's turn to listen, among the tabs of this browser: resolves with what gives the turn back, once no
// other tab listens, and tells `wait` if that is not at once. Rejects as `givenUp` is aborted.
function turn(givenUp: AbortSignal, wait: () => void): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const hold = () => new Promise<void>((release) => resolve(release))
    navigator.locks
      .request(TURN, { ifAvailable: true }, (lock) => {
        if (lock) return hold()
        wait()
        navigator.locks.request(TURN, { signal: givenUp }, hold).catch(reject)
      })
      .catch(reject)
  })
}

// The ear: the microphone of this machine, heard by Vosk in WebAssembly, in a worker, within its closed
// grammar. It waits for its turn among the tabs, asks for the microphone, loads the engine and its model only
// then, and tells `emit` of each step, of each sentence once it is said, and of what stopped it, be it once
// it listens. What the microphone gives while `deaf` says so never reaches the engine: the dashboard's own
// voice. Returns what stops it: the microphone is let go of and the engine's memory freed. The engine is
// behind this function alone: another one would give the same events.
export function listen(emit: (event: EarEvent) => void, deaf: () => boolean = () => false, modelUrl = MODEL_URL): () => void {
  let stopped = false
  const cleanups: (() => void)[] = []
  const stop = () => {
    stopped = true
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  }
  // What is to be undone as the ear stops: at once, when it already has.
  const undo = (cleanup: () => void) => {
    if (stopped) cleanup()
    else cleanups.push(cleanup)
  }
  const fail = (reason: Failure) => {
    if (stopped) return
    stop()
    emit({ type: 'failed', reason })
  }

  const start = async () => {
    // Without a secure context the browser has no microphone to give.
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return fail('unsupported')

    // A browser without locks has one ear a tab, as before.
    if (navigator.locks) {
      const givenUp = new AbortController()
      undo(() => givenUp.abort())
      try {
        undo(await turn(givenUp.signal, () => !stopped && emit({ type: 'ear', state: 'waiting' })))
      } catch {
        // Stopped while it waited.
        return
      }
      if (stopped) return
    }

    emit({ type: 'ear', state: 'asking' })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch (error) {
      return fail(failureOf(error))
    }
    undo(() => stream.getTracks().forEach((track) => track.stop()))
    if (stopped) return
    // Unplugged, or taken back in the browser's settings: an ear that hears nothing must not say it listens.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => fail('unavailable'))

    emit({ type: 'ear', state: 'loading' })
    const context = new AudioContext()
    undo(() => void context.close())
    try {
      // The engine is some megabytes of its own: loaded with its model, never before.
      const { Model } = await import('vosk-browser')
      // Switched off while the engine came: its model is not loaded for nothing.
      if (stopped) return
      // The engine's worker is a blob: it needs the whole address of the model.
      const model = new Model(new URL(modelUrl, window.location.href).toString(), QUIET)
      const loaded = new Promise<void>((resolve, reject) => {
        model.on('load', (message) => (message.event === 'load' && message.result ? resolve() : reject(new Error('model'))))
        model.on('error', () => reject(new Error('model')))
      })
      // The engine frees its model only once it has one: told to end before that, its worker throws and
      // stays, with the model it goes on loading.
      undo(() => void loaded.then(() => model.terminate(), () => {}))
      await loaded
      // An engine that breaks once loaded hears nothing either.
      model.on('error', () => fail('model'))
      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url))
      if (stopped) return

      const recognizer = new model.KaldiRecognizer(context.sampleRate, JSON.stringify(GRAMMAR))
      // Each word with how sure the engine is of it: the interpreter's threshold needs it.
      recognizer.setWords(true)
      recognizer.on('result', (message) => {
        if (!stopped && message.event === 'result') emit({ type: 'heard', heard: heardFrom(message.result) })
      })

      const tap = new AudioWorkletNode(context, 'pcm-tap', { numberOfOutputs: 0 })
      tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!stopped && !deaf()) recognizer.acceptWaveformFloat(data, context.sampleRate)
      }
      context.createMediaStreamSource(stream).connect(tap)
      await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_MS))])
    } catch {
      return fail('model')
    }
    if (stopped) return
    if (context.state !== 'running') return fail('blocked')
    emit({ type: 'ear', state: 'listening' })
  }

  void start()
  return stop
}
