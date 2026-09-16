import type { ExtensionMessage } from "../lib/types";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };
type ApiResult<T> = ApiOk<T> | ApiErr;

export async function send<T>(message: ExtensionMessage): Promise<T> {
  const res = (await chrome.runtime.sendMessage(message)) as ApiResult<T>;
  if (!res?.ok) {
    throw new Error((res as ApiErr)?.error || "İstek başarısız");
  }
  return res.data;
}
