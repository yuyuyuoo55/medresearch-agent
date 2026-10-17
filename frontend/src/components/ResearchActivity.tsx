import { CheckOutlined, CloseOutlined, MinusOutlined } from "@ant-design/icons";
import type { MonitorMessage } from "../types";

function eventCopy(event: MonitorMessage): { title: string; description: string } {
  const tool = typeof event.data.tool_name === "string" ? event.data.tool_name : "工具";
  const assistant = typeof event.data.assistant_name === "string" ? event.data.assistant_name : "研究助手";
  switch (event.event) {
    case "session_created": return { title: "研究任务已启动", description: "当前研究已进入处理流程" };
    case "assistant_call": return { title: assistant, description: "已收到助手调用记录" };
    case "tool_start": {
      let title = tool;
      if (tool.includes("list_sql_tables")) title = "发现业务数据表";
      else if (tool.includes("get_table_data")) title = "查看业务数据";
      else if (tool.includes("execute_sql_query")) title = "查询业务数据";
      else if (tool.includes("get_assistant_list")) title = "查找内部资料助手";
      else if (tool.includes("create_ask_delete")) title = "检索内部资料";
      return { title, description: "已开始调用，尚不能据此判断成功" };
    }
    case "task_result": return { title: "研究任务已结束", description: "最终回答已返回；交付文件以实际列表为准" };
    case "task_cancelled": return { title: "研究任务已取消", description: "已收到后端取消事件" };
    case "error": return { title: "任务执行出错", description: event.message };
    default: return { title: "执行记录", description: event.message };
  }
}

export function ResearchActivity({ events, isRunning }: { events: MonitorMessage[]; isRunning: boolean }) {
  return (
    <details className="activity-panel" open aria-label="执行记录">
      <summary className="activity-heading"><h2>执行记录</h2><span>与研究回答同步呈现</span></summary>
      <div className="activity-content">
        {events.length === 0 ? <p className="activity-empty">等待后端推送执行事件</p> : (
          <ol className="activity-timeline">
            {events.map((event, index) => {
              const copy = eventCopy(event);
              const active = isRunning && index === events.length - 1 && !["task_result", "error", "task_cancelled"].includes(event.event);
              return <li className={`activity-step ${active ? "is-current" : ""} ${event.event === "error" ? "is-error" : ""}`} key={`${event.timestamp}-${index}`}>
                <span className="activity-node" aria-hidden>{event.event === "task_result" ? <CheckOutlined /> : event.event === "error" ? <CloseOutlined /> : event.event === "task_cancelled" ? <MinusOutlined /> : <span />}</span>
                <time className="activity-time" dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <h3>{copy.title}</h3><p>{copy.description}</p>
              </li>;
            })}
          </ol>
        )}
        {events.length > 0 ? <details className="activity-technical"><summary>技术详情</summary>{events.map((event, index) => <div className="activity-raw" key={`${event.timestamp}-${index}`}><strong>{event.event}</strong><time>{event.timestamp}</time><p>{event.message}</p><pre>{JSON.stringify(event.data, null, 2)}</pre></div>)}</details> : null}
      </div>
    </details>
  );
}
