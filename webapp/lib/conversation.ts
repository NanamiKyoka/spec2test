import { api } from "./api";

const KEY = "s2t-current-conv";

export function currentConversationId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCurrentConversationId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 确保当前浏览器有一个可用会话：已存在就复用，被删掉就新建。 */
export async function ensureConversation(): Promise<string> {
  const cur = currentConversationId();
  if (cur) {
    try {
      await api.conversation(cur);
      return cur;
    } catch {
      /* 会话已被删除，走新建 */
    }
  }
  const c = await api.createConversation();
  setCurrentConversationId(c.id);
  return c.id;
}

export async function newConversation(): Promise<string> {
  const c = await api.createConversation();
  setCurrentConversationId(c.id);
  return c.id;
}
