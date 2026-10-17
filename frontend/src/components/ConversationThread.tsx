import {
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  StopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { getDownloadUrl } from "../lib/api";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { MonitorMessage, OutputFile } from "../types";

export interface ChatTurn {
  id: string;
  content: string;
  events: MonitorMessage[];
  files: OutputFile[];
  isRunning: boolean;
  result: string;
  timestamp: string;
}

interface ConversationThreadProps {
  onUseExample: (prompt: string) => void;
  turns: ChatTurn[];
}

const TASK_EXAMPLES = [
  { tool: "01 / 业务数据", title: "药品销售与库存分析", description: "查询销售变化与库存分布", prompt: "请查询心血管类药品的库存情况，包括药品名称、库存数量、批次、仓库和效期，并生成 Markdown 报告。", icon: <DatabaseOutlined aria-hidden /> },
  { tool: "02 / 内部资料", title: "内部产品资料研究", description: "整理预先配置的企业知识库", prompt: "请根据内部资料，查询立普妥的内部产品编号、分类、资料版本和业务备注，注明资料来源；未提供的信息请明确说明。", icon: <FileSearchOutlined aria-hidden /> },
  { tool: "03 / 公开信息", title: "外部市场信息研究", description: "整理公开动态与资料来源", prompt: "请检索公开医药企业与行业信息，整理研究摘要并附来源链接，区分公开事实和分析判断。", icon: <CloudServerOutlined aria-hidden /> },
];

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function parseTime(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

function getLastEventTime(
  events: MonitorMessage[],
  eventName?: string,
): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!eventName || event.event === eventName) {
      return parseTime(event.timestamp);
    }
  }
  return null;
}

function getThinkingDuration(
  events: MonitorMessage[],
  fallbackStart: string,
  isRunning: boolean,
  now: number,
): string {
  const startedAt =
    (events[0] ? parseTime(events[0].timestamp) : null) ??
    parseTime(fallbackStart) ??
    now;
  const finishedAt =
    getLastEventTime(events, "task_result") ??
    (!isRunning ? getLastEventTime(events) : null) ??
    now;
  return formatDuration(finishedAt - startedAt);
}

function EventIcon({ event }: { event: string }) {
  if (event === "assistant_call") {
    return <BranchesOutlined aria-hidden />;
  }
  if (event === "tool_start") {
    return <ToolOutlined aria-hidden />;
  }
  if (event === "session_created") {
    return <FileSearchOutlined aria-hidden />;
  }
  if (event === "task_result") {
    return <CheckCircleOutlined aria-hidden />;
  }
  if (event === "task_cancelled") {
    return <StopOutlined aria-hidden />;
  }
  if (event === "error") {
    return <CloseCircleOutlined aria-hidden />;
  }
  return <ClockCircleOutlined aria-hidden />;
}

function FileIcon({ name }: { name: string }) {
  if (name.endsWith(".pdf")) {
    return <FilePdfOutlined aria-hidden />;
  }
  if (name.endsWith(".md")) {
    return <FileMarkdownOutlined aria-hidden />;
  }
  return <FileTextOutlined aria-hidden />;
}

function ThinkingTimeline({ events }: { events: MonitorMessage[] }) {
  const timelineRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const timelineNode = timelineRef.current;
    if (!timelineNode) {
      return;
    }

    window.requestAnimationFrame(() => {
      timelineNode.scrollTop = timelineNode.scrollHeight;
    });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="thinking-empty">
        <ClockCircleOutlined aria-hidden />
        等待后端推送执行事件
      </div>
    );
  }

  return (
    <ol className="thinking-timeline" ref={timelineRef}>
      {events.map((event, index) => (
        <li
          className={`thinking-event thinking-event--${event.event}`}
          key={`${event.timestamp}-${index}`}
        >
          <span className="thinking-event-icon">
            <EventIcon event={event.event} />
          </span>
          <div>
            <div className="thinking-event-meta">
              <span>{event.event}</span>
              <time dateTime={event.timestamp}>
                {formatTime(event.timestamp)}
              </time>
            </div>
            <p>{event.message}</p>
            {event.event === "assistant_call" ||
            event.event === "tool_start" ? (
              <code>{JSON.stringify(event.data)}</code>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ArtifactShelf({ files }: { files: OutputFile[] }) {
  if (files.length === 0) {
    return (
      <div className="artifact-empty">
        <FileSearchOutlined aria-hidden />
        暂无输出文件
      </div>
    );
  }

  return (
    <div className="artifact-shelf">
      {files.map((file) => (
        <div className="artifact-card" key={file.path}>
          <span className="artifact-icon">
            <FileIcon name={file.name} />
          </span>
          <div className="artifact-copy">
            <strong title={file.name}>{file.name}</strong>
            <span>{file.name.toLowerCase().endsWith(".md") ? "Markdown" : file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "文件"} · {formatBytes(file.size)}</span>
          </div>
          <Tooltip title="下载">
            <Button
              aria-label={`下载 ${file.name}`}
              className="artifact-download"
              href={getDownloadUrl(file.path)}
              icon={<DownloadOutlined />}
            >下载报告</Button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

function ThinkingLoader({ durationLabel }: { durationLabel: string }) {
  return <div className="thinking-loader" aria-live="polite" aria-label="正在处理研究任务"><strong><span className="session-dot" />正在处理你的研究任务</strong><p>等待助手与工具返回结果</p><span>已用时 {durationLabel}</span></div>;
}

function AssistantMessage({
  events,
  files,
  isRunning,
  result,
  timestamp,
}: Pick<ChatTurn, "events" | "files" | "isRunning" | "result" | "timestamp">) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  const durationLabel = getThinkingDuration(events, timestamp, isRunning, now);
  const isCancelled = events.some((event) => event.event === "task_cancelled");
  const hasError = events.some((event) => event.event === "error");
  const hasResult = events.some((event) => event.event === "task_result");
  const syncLabel = isRunning
    ? `生成中 · 思考 ${durationLabel}`
    : `${hasError ? "任务出错" : isCancelled ? "已取消" : hasResult ? "任务结束" : "已停止"} · 用时 ${durationLabel}`;

  return (
    <article className="chat-message chat-message--assistant">
      <div className="message-avatar">AI</div>
      <div className="message-bubble">
        <div className="message-meta">
          <span>医研智析</span>
          <time>{syncLabel}</time>
        </div>

        <details
          className="thinking-block"

        >
          <summary>
            <span>
              <BranchesOutlined aria-hidden />
              执行详情
            </span>
            <strong>{events.length}</strong>
          </summary>
          <ThinkingTimeline events={events} />
        </details>

        {result ? (
          <div className="assistant-answer">
            <MarkdownRenderer content={result} />
          </div>
        ) : (
          <div className="assistant-answer assistant-answer--pending">
            {isRunning ? (
              <ThinkingLoader durationLabel={durationLabel} />
            ) : (
              "当前没有最终回答。"
            )}
          </div>
        )}

        <details
          className="thinking-block artifact-block"
          open={files.length > 0}
        >
          <summary>
            <span>
              <FileSearchOutlined aria-hidden />
              交付文件
            </span>
            <strong>{files.length}</strong>
          </summary>
          <ArtifactShelf files={files} />
        </details>
      </div>
    </article>
  );
}

export function ConversationThread({
  onUseExample,
  turns,
}: ConversationThreadProps) {
  if (turns.length === 0) {
    return (
      <div className="conversation-empty">
        <div className="empty-examples">
          <div className="empty-examples-copy">
            <span className="panel-kicker">MEDICAL BUSINESS RESEARCH</span>
            <h1>让业务问题，<br />成为有据可查的研究结论。</h1>
            <p>
              整合业务数据、内部资料与公开信息，交付清晰的分析报告。
            </p>
          </div>

          <div className="example-grid" aria-label="研究场景">
            {TASK_EXAMPLES.map((example) => (
              <button
                className="example-card"
                key={example.tool}
                onClick={() => onUseExample(example.prompt)}
                type="button"
              >
                <span className="example-icon">{example.icon}</span>
                <span className="example-copy">
                  <span>{example.tool}</span>
                  <strong>{example.title}</strong>
                  <small>{example.description}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-thread" aria-label="聊天消息流">
      {turns.map((turn) => (
        <div className="conversation-turn" key={turn.id}>
          <article className="chat-message chat-message--user">
            <div className="message-bubble">
              <div className="message-meta">
                <span>用户任务</span>
                <time dateTime={turn.timestamp}>
                  {formatTime(turn.timestamp)}
                </time>
              </div>
              <p>{turn.content}</p>
            </div>
          </article>
          <AssistantMessage
            events={turn.events}
            files={turn.files}
            isRunning={turn.isRunning}
            result={turn.result}
            timestamp={turn.timestamp}
          />
        </div>
      ))}
    </div>
  );
}
