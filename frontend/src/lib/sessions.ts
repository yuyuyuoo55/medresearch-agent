import type { ChatTurn } from "../components/ConversationThread";
import { createThreadId } from "./thread";

const STORAGE_KEY = "deepsearch.sessions";
const ACTIVE_KEY = "deepsearch.active_session";
/** 最多保存多少个历史会话，避免 localStorage 无限膨胀 */
const MAX_SESSIONS = 20;
/** 每个会话最多保存多少条消息 */
const MAX_TURNS = 10;
/** 每条消息最多保留多少条执行事件 / 文件记录（只用于恢复展示，不需要全量） */
const MAX_EVENTS_PER_TURN = 12;
const MAX_FILES_PER_TURN = 20;

export interface SessionRecord {
  /** 等价于后端的 thread_id */
  id: string;
  /** 列表里显示的名称，默认取第一条提问的前 30 个字 */
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** 历史会话里不需要保留"运行中"状态，事件/文件也做裁剪，防止占满 localStorage */
export function sanitizeTurn(turn: ChatTurn): ChatTurn {
  return {
    ...turn,
    isRunning: false,
    events: turn.events.slice(-MAX_EVENTS_PER_TURN),
    files: turn.files.slice(0, MAX_FILES_PER_TURN)
  };
}

export function createSessionRecord(id?: string): SessionRecord {
  const sessionId = id || createThreadId();
  const now = Date.now();
  return {
    id: sessionId,
    title: "",
    createdAt: now,
    updatedAt: now,
    turns: []
  };
}

export function loadSessions(): SessionRecord[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SessionRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        ...item,
        turns: Array.isArray(item.turns) ? item.turns.map(sanitizeTurn) : []
      }));
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SessionRecord[]): void {
  if (!isBrowser()) {
    return;
  }

  const trimmed = sessions.slice(0, MAX_SESSIONS).map((session) => ({
    ...session,
    turns: session.turns.slice(-MAX_TURNS).map(sanitizeTurn)
  }));

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 满了也不影响当前页面使用，只是不持久化
  }
}

export function loadActiveSessionId(): string | null {
  if (!isBrowser()) {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveSessionId(sessionId: string): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_KEY, sessionId);
  } catch {
    // ignore
  }
}

/** 把某个会话记录写回列表（不存在则插到最前面） */
export function upsertSession(
  sessions: SessionRecord[],
  record: SessionRecord
): SessionRecord[] {
  const index = sessions.findIndex((item) => item.id === record.id);
  if (index === -1) {
    return [record, ...sessions].slice(0, MAX_SESSIONS);
  }
  const next = [...sessions];
  next[index] = record;
  return next;
}

export function removeSession(
  sessions: SessionRecord[],
  sessionId: string
): SessionRecord[] {
  return sessions.filter((item) => item.id !== sessionId);
}

/** 会话标题：取第一条提问，截断到 30 个字 */
export function buildSessionTitle(turns: ChatTurn[]): string {
  const first = turns.find((turn) => turn.content.trim());
  if (!first) {
    return "";
  }
  const text = first.content.trim().replace(/\s+/g, " ");
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
