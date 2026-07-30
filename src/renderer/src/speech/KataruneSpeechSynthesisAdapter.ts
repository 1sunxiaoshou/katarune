import type {
  SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { notify } from "../notifications/notificationCenter";

type SpeechStatus = SpeechSynthesisAdapter.Status;
type SpeechUtterance = SpeechSynthesisAdapter.Utterance;

let applicationUtterance: KataruneSpeechUtterance | null = null;

class KataruneSpeechUtterance implements SpeechUtterance {
  public status: SpeechStatus = { type: "starting" };

  private readonly subscribers = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private cancelled = false;

  public constructor(
    private readonly characterId: string,
    private readonly text: string,
    private readonly onFinalize: () => void,
  ) {
    applicationUtterance?.cancel();
    applicationUtterance = this;
    void this.start();
  }

  public cancel = (): void => {
    if (this.status.type === "ended") return;
    this.cancelled = true;
    if (this.status.type === "starting") {
      window.katarune.cancelSpeech({ requestId: this.requestId });
    }
    this.releaseAudio();
    this.finish({ type: "ended", reason: "cancelled" });
  };

  public subscribe = (callback: () => void): (() => void) => {
    if (this.status.type === "ended") {
      let subscribed = true;
      queueMicrotask(() => {
        if (subscribed) callback();
      });
      return () => {
        subscribed = false;
      };
    }
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  };

  private readonly requestId = crypto.randomUUID();

  private async start(): Promise<void> {
    try {
      const response = await window.katarune.generateSpeech({
        requestId: this.requestId,
        characterId: this.characterId,
        text: this.text,
      });
      if (this.cancelled || response.requestId !== this.requestId) return;
      if (response.status === "cancelled") {
        this.finish({ type: "ended", reason: "cancelled" });
        return;
      }
      if (response.status === "error") {
        throw new Error(response.message);
      }

      const bytes = new Uint8Array(response.audio.byteLength);
      bytes.set(response.audio);
      this.objectUrl = URL.createObjectURL(
        new Blob([bytes.buffer], { type: response.mediaType }),
      );
      const audio = new Audio(this.objectUrl);
      this.audio = audio;
      audio.onended = () => {
        this.releaseAudio();
        this.finish({ type: "ended", reason: "finished" });
      };
      audio.onerror = () => {
        this.fail(new Error("浏览器无法播放供应商返回的音频。"));
      };
      await audio.play();
      if (this.cancelled || this.audio !== audio) {
        audio.pause();
        return;
      }
      this.transition({ type: "running" });
    } catch (error) {
      if (!this.cancelled) this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.releaseAudio();
    notify({
      channel: "toast",
      level: "error",
      message: "朗读失败，请重试。",
      dedupeKey: "speech-playback-error",
    });
    this.finish({ type: "ended", reason: "error", error });
  }

  private transition(status: SpeechStatus): void {
    if (this.status.type === "ended") return;
    this.status = status;
    for (const subscriber of this.subscribers) subscriber();
  }

  private finish(status: Extract<SpeechStatus, { type: "ended" }>): void {
    if (this.status.type === "ended") return;
    this.status = status;
    if (applicationUtterance === this) applicationUtterance = null;
    this.onFinalize();
    for (const subscriber of this.subscribers) subscriber();
  }

  private releaseAudio(): void {
    if (this.audio !== null) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

export class KataruneSpeechSynthesisAdapter
  implements SpeechSynthesisAdapter
{
  private activeUtterance: KataruneSpeechUtterance | null = null;

  public constructor(private readonly characterId: string) {}

  public speak(text: string): SpeechUtterance {
    this.activeUtterance?.cancel();
    const utterance = new KataruneSpeechUtterance(
      this.characterId,
      text,
      () => {
        if (this.activeUtterance === utterance) this.activeUtterance = null;
      },
    );
    this.activeUtterance = utterance;
    return utterance;
  }

  public dispose(): void {
    this.activeUtterance?.cancel();
    this.activeUtterance = null;
  }
}
