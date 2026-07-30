interface ActiveSpeechRequest {
  readonly senderId: number;
  readonly requestId: string;
  readonly abortController: AbortController;
}

export class SpeechRequestRegistry {
  private readonly requests = new Map<string, ActiveSpeechRequest>();

  public get size(): number {
    return this.requests.size;
  }

  public register(
    senderId: number,
    requestId: string,
    abortController: AbortController,
  ): () => void {
    const key = this.createKey(senderId, requestId);
    this.requests.get(key)?.abortController.abort();
    const request = { senderId, requestId, abortController };
    this.requests.set(key, request);
    return () => {
      if (this.requests.get(key) === request) this.requests.delete(key);
    };
  }

  public cancel(senderId: number, requestId: string): void {
    this.requests
      .get(this.createKey(senderId, requestId))
      ?.abortController.abort();
  }

  public cancelSender(senderId: number): void {
    this.cancelMatching((request) => request.senderId === senderId);
  }

  public cancelAll(): void {
    this.cancelMatching(() => true);
  }

  private createKey(senderId: number, requestId: string): string {
    return `${senderId}:${requestId}`;
  }

  private cancelMatching(
    predicate: (request: ActiveSpeechRequest) => boolean,
  ): void {
    for (const request of [...this.requests.values()]) {
      if (predicate(request)) request.abortController.abort();
    }
  }
}
