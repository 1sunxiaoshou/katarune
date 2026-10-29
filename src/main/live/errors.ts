// Only messages created inside this trusted module family may be shown directly.
export class LiveOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "LiveOperationError"; }
}
export class BiliAccessError extends LiveOperationError {}
