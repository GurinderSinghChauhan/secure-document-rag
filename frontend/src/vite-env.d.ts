/// <reference types="vite/client" />

declare const __APP_COMMIT__: string;
declare const __APP_VERSION__: string;
declare const __VOICE_INPUT_ENABLED__: boolean;

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  addEventListener(type: "start" | "end", listener: () => void): void;
  addEventListener(
    type: "result",
    listener: (event: SpeechRecognitionEvent) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: (event: SpeechRecognitionErrorEvent) => void,
  ): void;
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
