import { useSyncExternalStore } from "react";

let stream: MediaStream | null = null;
let pending: Promise<MediaStream> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function microphoneIsActive(): boolean {
  return stream?.getAudioTracks().some((track) => track.readyState === "live") ?? false;
}

export function useMicrophoneActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    microphoneIsActive,
    () => false,
  );
}

export async function requestMicrophone(): Promise<MediaStream> {
  if (microphoneIsActive()) return stream!;
  if (pending) return pending;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("O microfone não está disponível neste navegador ou fora de uma conexão segura.");
  }

  const requestedGeneration = generation;
  pending = navigator.mediaDevices.getUserMedia({ audio: true }).then((acquired) => {
    if (requestedGeneration !== generation) {
      acquired.getTracks().forEach((track) => track.stop());
      throw new Error("A ativação do microfone foi cancelada.");
    }
    stream = acquired;
    acquired.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (stream === acquired) {
          stream = null;
          notify();
        }
      });
    });
    notify();
    return acquired;
  }).finally(() => { pending = null; });
  return pending;
}

export function turnOffMicrophone(): void {
  generation += 1;
  const previous = stream;
  stream = null;
  previous?.getTracks().forEach((track) => track.stop());
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", turnOffMicrophone);
}