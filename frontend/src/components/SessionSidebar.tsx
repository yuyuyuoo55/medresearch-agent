import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { SessionRecord } from "../lib/sessions";

interface SessionSidebarProps {
  sessions: SessionRecord[];
  activeId: string;
  onDelete: (sessionId: string) => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
}

interface SessionGroup {
  label: string;
  items: SessionRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按「今天 / 昨天 / 7 天内 / 更早」分组，顺序与聊天软件一致 */
export function groupSessions(sessions: SessionRecord[]): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - DAY_MS;
  const startOf7Days = startOfToday - 6 * DAY_MS;

  const groups: SessionGroup[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "7 天内", items: [] },
    { label: "更早", items: [] }
  ];

  [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((session) => {
      if (session.updatedAt >= startOfToday) {
        groups[0].items.push(session);
      } else if (session.updatedAt >= startOfYesterday) {
        groups[1].items.push(session);
      } else if (session.updatedAt >= startOf7Days) {
        groups[2].items.push(session);
      } else {
        groups[3].items.push(session);
      }
    });

  return groups.filter((group) => group.items.length > 0);
}

function displayTitle(session: SessionRecord): string {
  return session.title || "未命名研究";
}

export function SessionSidebar({
  sessions,
  activeId,
  onDelete,
  onNew,
  onSelect
}: SessionSidebarProps) {
  const groups = groupSessions(sessions);

  return (
    <aside className="session-sidebar" aria-label="历史会话">
      <div className="session-sidebar-head">
        <Button
          block
          className="sidebar-new-chat"
          icon={<PlusOutlined aria-hidden />}
          onClick={onNew}
        >
          开启新对话
        </Button>
      </div>

      <div className="session-sidebar-list">
        {groups.length === 0 ? (
          <p className="sidebar-empty">还没有历史会话，先提一个问题吧</p>
        ) : (
          groups.map((group) => (
            <section className="sidebar-group" key={group.label}>
              <h3 className="sidebar-group-title">{group.label}</h3>
              {group.items.map((session) => (
                <div
                  className={`sidebar-item ${session.id === activeId ? "is-active" : ""}`}
                  key={session.id}
                  onClick={() => onSelect(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(session.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={displayTitle(session)}
                >
                  <span className="sidebar-item-title">{displayTitle(session)}</span>
                  <button
                    aria-label="删除该会话"
                    className="sidebar-item-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(session.id);
                    }}
                    type="button"
                  >
                    <DeleteOutlined aria-hidden />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
