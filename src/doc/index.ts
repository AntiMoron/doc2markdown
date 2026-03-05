import { LRU as LRUCache } from "tiny-lru";
import Feishu2Markdown from "./impl/feishu";
import GoogleDocDoc2Markdown from "./impl/googledoc";
import { HandleDocParams } from "./type";
import sha256 from "sha256";
import { Doc2MarkdownBase } from "./base";

const handlerCache = new LRUCache(50);

const HandlerClasses: (typeof Doc2MarkdownBase)[] = [
  Feishu2Markdown,
  GoogleDocDoc2Markdown,
];

function getHandlerClass(type: string): typeof Doc2MarkdownBase | undefined {
  return HandlerClasses.find((clx) => clx.type === type);
}

function getHandler<T extends Doc2MarkdownBase>(params: HandleDocParams): T {
  const { type: t } = params;
  const hash = sha256(JSON.stringify(params));

  let handler = handlerCache.get(hash);
  if (handler) {
    return handler as T;
  }
  const HandlerClass = getHandlerClass(t) as any;
  if (!HandlerClass) {
    throw new Error(`Unsupported document type: ${t}`);
  }
  const newHandler = new HandlerClass(params) as T;
  handlerCache.set(hash, newHandler);
  return newHandler;
}

function checkParams(params: HandleDocParams) {
  const { type: t, docUrl, docToken, folderToken } = params;
  if (!docUrl && !folderToken && !docToken) {
    throw new Error("Feishu docUrl, docToken or folderToken is required");
  }
  const HandlerClass = getHandlerClass(t);
  if (!HandlerClass) {
    throw new Error(`Unsupported document type: ${t}`);
  }
}

/**
 * Get tasks from folder, if only url provided, a single task in an array will be returned
 * @param params
 * @returns
 */
export async function getDocTaskList(params: HandleDocParams) {
  checkParams(params);
  const { type: t } = params;
  const handler = getHandler(params);
  await handler.getCachedAccessToken();
  const tasks = await handler.getDocTaskList();
  return tasks;
}

/**
 * Convert documents to markdown and assets
 * @param params
 */
export default async function handleDoc(params: HandleDocParams) {
  checkParams(params);
  const { handleProgress, onDocFinish, shouldHandleUrl } = params;
  const handler = getHandler(params);
  await handler.getCachedAccessToken();
  const tasks = await handler.getDocTaskList();
  let totalCount = tasks.length;
  let errorCount = 0;
  let doneCount = 0;
  const metdatas: any[] = tasks;
  if (typeof handleProgress === "function") {
    handleProgress(0, errorCount, totalCount);
  }
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const { id: docId, url: taskUrl } = task;
    let shouldHandle = false;
    try {
      shouldHandle = Boolean((await shouldHandleUrl?.(taskUrl)) ?? true);
    } catch {}
    if (!shouldHandle) {
      continue;
    }
    try {
      await handler.getCachedAccessToken();
      const result = await handler.handleDocTask(task);
      doneCount += 1;
      try {
        if (typeof handleProgress === "function") {
          handleProgress(doneCount, errorCount, totalCount);
        }
      } catch {}
      try {
        const relief = onDocFinish?.(docId, result, metdatas[i]);
        if (
          relief instanceof Promise ||
          typeof (relief as any).then === "function"
        ) {
          await (relief as Promise<void>);
        }
      } catch {}
    } catch (err: any) {
      errorCount += 1;
      if (err?.response) {
        const url = err.config?.url ?? "";
        const status = err.response.status;
        const msg =
          err.response.data?.error?.message ??
          err.response.data?.error_description ??
          err.response.data?.error ??
          err.response.statusText;
        throw new Error(`API error ${status} [${url}]: ${msg}`);
      }
      throw err;
    }
  }
}
