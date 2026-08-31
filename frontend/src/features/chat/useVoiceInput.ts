import { useEffect, useRef, useState } from "react";

export function useVoiceInput(
  value: string,
  onChange: (value: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Ready to search");
  const recognition = useRef<SpeechRecognition | null>(null);
  const base = useRef("");

  useEffect(() => {
    const Constructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    instance.continuous = false;
    instance.interimResults = true;
    instance.lang = navigator.language || "en-US";
    instance.addEventListener("start", () => {
      setListening(true);
      setStatus("Listening… speak now");
    });
    instance.addEventListener("result", (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1)
        transcript += event.results[index]?.[0]?.transcript ?? "";
      onChange(
        `${base.current}${base.current && !base.current.endsWith(" ") ? " " : ""}${transcript}`.slice(
          0,
          8000,
        ),
      );
    });
    instance.addEventListener("error", (event) => {
      const messages: Record<string, string> = {
        "not-allowed": "Microphone permission was denied",
        "audio-capture": "No microphone is available",
        "no-speech": "No speech was detected",
        network: "Voice recognition is unavailable",
      };
      setStatus(messages[event.error] ?? "Voice input could not be completed");
    });
    instance.addEventListener("end", () => {
      setListening(false);
      setStatus((current) =>
        current.startsWith("Voice") ||
        current.startsWith("Microphone") ||
        current.startsWith("No ")
          ? current
          : "Ready to search",
      );
    });
    recognition.current = instance;
    return () => {
      instance.stop();
      recognition.current = null;
    };
  }, [onChange]);

  function toggle() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    base.current = value.trimEnd();
    try {
      recognition.current?.start();
    } catch {
      setStatus("Voice input is already starting");
    }
  }

  return {
    available: Boolean(
      window.SpeechRecognition || window.webkitSpeechRecognition,
    ),
    listening,
    status,
    toggle,
    stop: () => recognition.current?.stop(),
  };
}
