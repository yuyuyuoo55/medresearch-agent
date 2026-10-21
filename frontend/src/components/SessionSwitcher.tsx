import { DeleteOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, type MenuProps } from "antd";
import type { SessionRecord } from "../lib/sessions";

interface SessionSwitcherProps {
  sessions: SessionRecord[];
  activeId: string;
  onDelete: (sessionId: string) => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) {
    return `今天 ${hh}:${mm}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

/**
 * 顶部「当前会话」入口：点开后是历史会话列表，可以切回旧会话或删除。
 * 会话内容保存在 localStorage，切换时直接恢复，不需要重新请求后端。
 */
export function SessionSwitcher({
  sessions,
  activeId,
  onDelete,
  onNew,
  onSelect
}: SessionSwitcherProps) {
  const active = sessions.find((session) => session.id === activeId);

  const items: MenuProps["items"] =
    sessions.length > 0
      ? sessions.map((session) => ({
          key: session.id,
          label: (
            <div className="session-menu-item">
              <div className="session-menu-text">
                <span
                  className={`session-menu-title ${session.id === activeId ? "is-active" : ""}`}
                  title={session.title || "未命名研究"}
                >
                  {session.title || "未命名研究"}
                </span>
                <span className="session-menu-meta">
                  {formatTime(session.updatedAt)} · {session.turns.length} 个问题
                </span>
              </div>
              <Button
                aria-label="删除该会话"
                className="session-menu-delete"
                icon={<DeleteOutlined aria-hidden />}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(session.id);
                }}
                size="small"
                type="text"
              />
            </div>
          )
        }))
      : [{ key: "empty", label: <span className="session-menu-empty">还没有历史会话</span>, disabled: true }];

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (key !== "empty" && key !== activeId) {
            onSelect(key);
          }
        }
      }}
      placement="bottom"
      trigger={["click"]}
    >
      <button className="session-switcher" title="查看历史会话" type="button">
        <HistoryOutlined aria-hidden />
        <span className="session-switcher-title">{active?.title || "当前会话"}</span>
        {sessions.length > 0 ? <span className="session-switcher-count">{sessions.length}</span> : null}
      </button>
    </Dropdown>
  );
}

export function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      aria-label="新建研究"
      className="new-chat-button"
      icon={<PlusOutlined aria-hidden />}
      onClick={onClick}
    >
      新建研究
    </Button>
  );
}
