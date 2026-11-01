// Only messages created inside this trusted module family may be shown directly.
export class LiveOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "LiveOperationError"; }
}
export class BiliAccessError extends LiveOperationError {}
export class LivePortInUseError extends LiveOperationError {
  constructor(options?: ErrorOptions) { super("直播本地端口已被占用，请在输出 Tab 中修改本地端口。", options); }
}
