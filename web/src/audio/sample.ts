// Short one-off sounds for the setup screen: a Kokoro voice sample (base64 MP3 from the server) or a
// line in the browser's own voice. The full speech queue (Player) moves over in step 6.
let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

export function unlockAudio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export async function playBase64(data: string): Promise<void> {
  const ac = unlockAudio();
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const buf = await ac.decodeAudioData(bytes.buffer);
  current?.stop();
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
  current = src;
}

export function speakInBrowser(text: string): void {
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

const w = (typeof window !== "undefined" ? window : {}) as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
export const BROWSER_STT = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
export const BROWSER_TTS = typeof window !== "undefined" && "speechSynthesis" in window;
