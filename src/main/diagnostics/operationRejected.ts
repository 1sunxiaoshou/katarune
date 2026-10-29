import type * as z from "zod/mini";
import { rejectionCodeSchema, type RejectionCode } from "../../shared/diagnostics";

const messages: Record<RejectionCode, string> = {
  "invalid-input": "请求参数无效，请检查后重试。",
  "forbidden-source": "不允许从此界面发起该操作。",
  "resource-unavailable": "所需资源不存在或不可用，请刷新后重试。",
  "ownership-mismatch": "此资源不属于当前会话或角色。",
  "operation-not-allowed": "当前状态不允许此操作，请检查后重试。",
  "operation-in-progress": "操作正在进行，请稍候再试。",
  "configuration-required": "请先完成所需配置。",
  "missing-port": "请求缺少通信端口，请重新打开界面。",
  "method-not-allowed": "不支持此请求方式。",
  "unsupported-media": "不支持此资源类型。",
  "rate-limited": "请求过于频繁，请稍后重试。",
};

/** Explicit trusted rejection, never inferred from arbitrary error names/messages. */
export class OperationRejected extends Error {
  readonly reasonCode: RejectionCode;
  constructor(reasonCode: RejectionCode, publicMessage?: string) {
    const code = rejectionCodeSchema.parse(reasonCode);
    // Optional copy must be a trusted UI message, never input/provider/exception text.
    super(publicMessage ?? messages[code]);
    this.name = "OperationRejected";
    this.reasonCode = code;
  }
}

/** Use only for external request input; stored data and output still use schema.parse. */
export function parseRequest<T>(schema: z.ZodMiniType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new OperationRejected("invalid-input");
  return result.data;
}
