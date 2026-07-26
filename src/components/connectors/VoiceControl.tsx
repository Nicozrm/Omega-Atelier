import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'
import type { Device, DeviceCommand } from '@/domain'
import { parseVoiceCommand } from '@/twin/voiceCommands'

/**
 * VoiceControl — real in-app voice control ("Alexa/Siri", but local).
 *
 * Uses the browser's Web Speech API to listen (de-DE), routes the transcript
 * through the pure `parseVoiceCommand` brain, executes the resulting neutral
 * twin commands and speaks the confirmation back via speech synthesis. No
 * cloud, no vendor account — it drives the same twin every connector feeds.
 * Degrades to a disabled hint where the browser has no speech recognition
 * (e.g. Firefox); Chrome and Safari support it.
 */

// Minimal typing for the non-standard SpeechRecognition (not in lib.dom).
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } } }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SRCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function speak(text: string): void {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'de-DE'
    synth.cancel()
    synth.speak(u)
  } catch { /* speech synthesis optional */ }
}

export function VoiceControl({ devices, onRun }: {
  devices: Device[]
  onRun: (commands: DeviceCommand[]) => void
}) {
  const supported = !!getRecognitionCtor()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState<{ text: string; ok: boolean } | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const devicesRef = useRef(devices)
  devicesRef.current = devices

  const handle = useCallback((phrase: string) => {
    setTranscript(phrase)
    const result = parseVoiceCommand(phrase, devicesRef.current)
    if (result && result.commands.length) {
      onRun(result.commands)
      setReply({ text: result.reply, ok: true })
      speak(result.reply)
    } else {
      setReply({ text: 'Nicht verstanden — versuch z. B. „Alle Lichter aus".', ok: false })
    }
  }, [onRun])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'de-DE'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1]
      const phrase = last[0]?.transcript ?? ''
      setTranscript(phrase)
      if ((last as { isFinal?: boolean }).isFinal) handle(phrase)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setReply(null)
    setTranscript('')
    setListening(true)
    rec.start()
  }, [handle])

  const stop = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
  }, [])

  useEffect(() => () => { recRef.current?.stop() }, [])

  if (!supported) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]" title="Dieser Browser unterstützt keine Spracherkennung (Chrome/Safari schon)">
        <MicOff size={14} /> Sprache n. v.
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => (listening ? stop() : start())}
        className={`spring-press inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
          listening
            ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.12)] text-[color:var(--fg)]'
            : 'border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'
        }`}
        title={'Sprachsteuerung — z. B. „Alle Lichter aus“, „Licht heller“, „Licht wärmer“, „Rollo auf 30 %“, „Saugroboter starten“'}
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <Mic size={14} />
          {listening && <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-[color:var(--accent)] opacity-40" />}
        </span>
        {listening ? 'Höre zu …' : 'Sprechen'}
      </button>
      {(transcript || reply) && (
        <span className="max-w-[46vw] truncate text-[11px]">
          {transcript && <span className="text-[color:var(--muted)]">„{transcript}" </span>}
          {reply && (
            <span className={`inline-flex items-center gap-1 ${reply.ok ? 'text-[#3fb27f]' : 'text-[#d8635f]'}`}>
              {reply.ok && <Volume2 size={11} />}{reply.text}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
