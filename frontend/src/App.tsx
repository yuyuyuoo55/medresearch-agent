import { CheckOutlined, CloseOutlined, LoadingOutlined, MinusOutlined } from "@ant-design/icons";
import { Alert, App as AntApp } from "antd";
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./components/ChatComposer";
import { ConversationThread } from "./components/ConversationThread";
import { ResearchActivity } from "./components/ResearchActivity";
import { SessionSidebar } from "./components/SessionSidebar";
import type { ChatTurn } from "./components/ConversationThread";
import { API_BASE_URL, WS_BASE_URL } from "./lib/config";
import {
  buildSessionTitle,
  createSessionRecord,
  loadSessions,
  removeSession,
  saveSessions,
  upsertSession,
  type SessionRecord
} from "./lib/sessions";
import { useDeepAgentSession } from "./hooks/useDeepAgentSession";
import type { ConnectionState, UploadedItem } from "./types";

function connectionLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已关闭"
  };
  return labels[state];
}

function createTurn(content: string): ChatTurn {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    content,
    events: [],
    files: [],
    isRunning: true,
    result: "",
    timestamp: new Date().toISOString()
  };
}

export default function App() {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [stagedItems, setStagedItems] = useState<UploadedItem[]>([]);
  const streamRef = useRef<HTMLElement | null>(null);
  const workspaceScrollRef = useRef<HTMLDivElement | null>(null);
  const session = useDeepAgentSession();

  // ===== 多会话：历史会话列表（localStorage 持久化） =====
  const [sessions, setSessions] = useState<SessionRecord[]>(() => {
    const stored = loadSessions();
    if (stored.some((item) => item.id === session.threadId)) {
      return stored;
    }
    return upsertSession(stored, createSessionRecord(session.threadId));
  });
  // 当前会话的消息记录，切换会话时整体替换
  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    const stored = loadSessions().find((item) => item.id === session.threadId);
    return stored?.turns ?? [];
  });
  // 刚从历史会话恢复时，跳过「用实时事件覆盖最新一轮」的同步，避免把恢复的内容冲掉
  const hydratingSessionRef = useRef(false);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 新会话（或首次访问）要保证列表里有记录
  useEffect(() => {
    setSessions((previous) => {
      if (previous.some((item) => item.id === session.threadId)) {
        return previous;
      }
      const next = upsertSession(previous, createSessionRecord(session.threadId));
      saveSessions(next);
      return next;
    });
  }, [session.threadId]);

  // 当前会话内容变化时写回历史列表
  useEffect(() => {
    const current = sessionsRef.current;
    const index = current.findIndex((item) => item.id === session.threadId);
    if (index === -1) {
      return;
    }
    const next = upsertSession(current, {
      ...current[index],
      title: current[index].title || buildSessionTitle(turns),
      turns,
      updatedAt: Date.now()
    });
    saveSessions(next);
    setSessions(next);
  }, [session.threadId, turns]);

  useEffect(() => {
    if (hydratingSessionRef.current) {
      // 刚切回历史会话：turns 已经是完整记录，不要用当前空事件覆盖
      hydratingSessionRef.current = false;
      return;
    }

    setTurns((previous) => {
      if (previous.length === 0) {
        return previous;
      }

      const latestTurn = previous[previous.length - 1];
      const nextLatestTurn = {
        ...latestTurn,
        events: session.events,
        files: session.files,
        isRunning: session.isRunning,
        result: session.result
      };

      return [...previous.slice(0, -1), nextLatestTurn];
    });
  }, [session.events, session.files, session.isRunning, session.result]);

  useEffect(() => {
    const mobileScrollNode = workspaceScrollRef.current;
    const streamNode = mobileScrollNode?.clientHeight ? mobileScrollNode : streamRef.current;
    if (!streamNode) {
      return;
    }

    window.requestAnimationFrame(() => {
      streamNode.scrollTo({
        top: streamNode.scrollHeight,
        behavior: "smooth"
      });
    });
  // 只在提交新问题时定位，后续执行事件不打断用户阅读。
  }, [turns.length]);

  async function handleSubmit() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      message.warning("请输入研究任务");
      return;
    }

    setSubmissionError("");
    const nextTurn = createTurn(cleanQuery);
    setTurns((previous) => [...previous, nextTurn]);
    setQuery("");

    try {
      await session.submitTask(cleanQuery);
      message.success("任务已启动，执行过程会显示在右侧");
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "任务启动失败");
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === nextTurn.id
            ? {
                ...turn,
                isRunning: false,
                result: error instanceof Error ? error.message : "任务启动失败"
              }
            : turn
        )
      );
      message.error(error instanceof Error ? error.message : "任务启动失败");
    }
  }

  async function handleCancel() {
    try {
      const response = await session.cancelCurrentTask();
      message.info(response.status === "cancelling" ? "取消请求已发送，正在等待当前调用结束" : "任务已取消");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消任务失败");
    }
  }

  async function handleUpload(items: UploadedItem[]) {
    try {
      const response = await session.uploadFiles(items);
      setStagedItems([]);
      message.success(`已上传 ${response.files.length} 个文件`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
    }
  }

  function handleNewSession() {
    session.resetSession();
    setSubmissionError("");
    setTurns([]);
    setQuery("");
    setStagedItems([]);
  }

  /** 切回历史会话：复用其 thread_id 重新连接 WebSocket，并恢复该会话的消息记录 */
  function handleSwitchSession(sessionId: string) {
    if (sessionId === session.threadId) {
      return;
    }
    const record = sessions.find((item) => item.id === sessionId);
    if (!record) {
      return;
    }
    hydratingSessionRef.current = true;
    session.switchSession(sessionId);
    setTurns(record.turns);
    setQuery("");
    setSubmissionError("");
    setStagedItems([]);
  }

  function handleDeleteSession(sessionId: string) {
    const next = removeSession(sessions, sessionId);
    saveSessions(next);
    setSessions(next);
    // 删掉的正好是当前会话：回到一个全新的会话
    if (sessionId === session.threadId) {
      session.resetSession();
      setTurns([]);
      setQuery("");
      setSubmissionError("");
      setStagedItems([]);
    }
  }

  const online = session.connectionState === "connected";
  const latestTurn = turns[turns.length - 1];
  const hasResearch = turns.length > 0;
  const displayError = session.lastError || submissionError;
  const hasError = Boolean(displayError) || session.events.some((event) => event.event === "error");
  const wasCancelled = session.events.some((event) => event.event === "task_cancelled");
  const hasResult = session.events.some((event) => event.event === "task_result");
  const statusLabel = session.isRunning
    ? session.isCancelling ? "正在取消" : "正在研究"
    : hasError ? "任务出错" : wasCancelled ? "已取消" : hasResult ? "任务结束" : "等待研究";
  const currentTitle = latestTurn?.content || "尚未提交研究";

  return (
    <div className="app-layout">
      <SessionSidebar
        activeId={session.threadId}
        onDelete={handleDeleteSession}
        onNew={handleNewSession}
        onSelect={handleSwitchSession}
        sessions={sessions}
      />
      <div className={`chat-app-shell ${hasResearch ? "has-research" : "is-empty"}`}>
      <a className="skip-link" href="#research-content">跳到研究内容</a>
      <header className="workspace-header">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>研</span>
          <div><strong>医研智析</strong><span>MEDRESEARCH AI</span></div>
        </div>
        <span className="current-session-label">
          {sessions.find((item) => item.id === session.threadId)?.title || "当前会话"}
        </span>
        <div className="header-actions">
          <div className={`connection-state ${online ? "is-online" : ""}`} role="status">
            <span />{connectionLabel(session.connectionState)}
          </div>
        </div>
      </header>
      <main className="chat-main" id="research-content" tabIndex={-1}>
        <header className="chat-topbar">
          <span className="workspace-caption">医药企业 AI 研究分析助手<span>仅当前会话</span></span>
          <div className={`run-indicator ${session.isRunning ? "is-running" : hasError ? "is-error" : ""}`} role="status">
            {session.isRunning ? <LoadingOutlined aria-hidden /> : hasError ? <CloseOutlined aria-hidden /> : wasCancelled ? <MinusOutlined aria-hidden /> : hasResult ? <CheckOutlined aria-hidden /> : <span className="session-dot" />}
            {statusLabel}
            <details className="connection-details"><summary>连接详情</summary><p>连接：{connectionLabel(session.connectionState)}</p><p>会话：{session.threadId}</p><code>{API_BASE_URL}</code><code>{WS_BASE_URL}</code></details>
          </div>
        </header>
        {displayError ? <Alert className="chat-alert" message={displayError} showIcon type="error" /> : null}
        <div className="workspace-grid">
          <div className="workspace-scroll" ref={workspaceScrollRef}>
            <section className="chat-stream-panel" ref={streamRef} aria-label="研究内容">
              {hasResearch ? <div className="research-heading"><span className="panel-kicker">当前研究</span><h1 title={currentTitle}>{currentTitle.length > 30 ? `${currentTitle.slice(0, 30)}…` : currentTitle}</h1><p>当前会话 · 教学模拟数据</p></div> : null}
              <ConversationThread onUseExample={setQuery} turns={turns} />
            </section>
            {hasResearch ? <ResearchActivity events={session.events} isRunning={session.isRunning} /> : null}
          </div>
          <div className="workspace-composer">
              <ChatComposer
                isCancelling={session.isCancelling}
                isRunning={session.isRunning}
                isUploading={session.isUploading}
                onCancel={handleCancel}
                onNewSession={handleNewSession}
                onQueryChange={setQuery}
                onStagedItemsChange={setStagedItems}
                onSubmit={handleSubmit}
                onUpload={handleUpload}
                query={query}
                stagedItems={stagedItems}
                uploadedItems={session.uploadedItems}
              />
              <p className="composer-footnote">仅供医药企业业务演示 · 不提供临床用药建议</p>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
