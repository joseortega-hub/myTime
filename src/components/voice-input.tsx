"use client";
/**
 * Dictado por voz con la Web Speech API del navegador (gratuita).
 * Aviso de privacidad: en Chrome y Edge el audio lo procesa el servicio de
 * reconocimiento del fabricante del navegador. Por eso requiere consentimiento
 * explícito, que se recuerda solo en este navegador.
 */
import { Mic, MicOff } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "./ui";
import { useConfirm, useToast } from "./ui-client";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const CONSENT_KEY = "mytime.voiceConsent";

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<RecognitionLike | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  // Solo en el navegador se sabe si existe la API; en el servidor se asume que no.
  const supported = useSyncExternalStore(noopSubscribe, () => getRecognitionCtor() != null, () => false);

  const start = async () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    let consent = false;
    try {
      consent = localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      consent = false;
    }
    if (!consent) {
      const ok = await confirm({
        title: "Activar el dictado por voz",
        description:
          "El reconocimiento de voz lo hace tu navegador. En Chrome y Edge el audio se envía al servicio de reconocimiento del fabricante del navegador. MyTime solo recibe el texto. ¿Quieres activarlo?",
        confirmLabel: "Activar",
      });
      if (!ok) return;
      try {
        localStorage.setItem(CONSENT_KEY, "yes");
      } catch {
        // Sin almacenamiento: se volverá a preguntar la próxima vez.
      }
    }
    const r = new Ctor();
    r.lang = "es-ES";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e) => {
      toast({ tone: "error", message: e.error === "not-allowed" ? "Permiso de micrófono denegado." : "No se ha podido reconocer la voz." });
      setListening(false);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  if (!supported) return null;
  return listening ? (
    <Button variant="danger" onClick={() => rec.current?.stop()} aria-pressed="true">
      <MicOff className="size-4" /> Detener
    </Button>
  ) : (
    <Button variant="secondary" onClick={start} aria-pressed="false">
      <Mic className="size-4" /> Dictar
    </Button>
  );
}
