"""
Agent 执行过程监控模块

负责把工具调用、子智能体调用、任务结果和会话目录等事件统一包装后推送给前端
在 Web 服务中优先通过 WebSocket 定向推送；在脚本调试场景中保留控制台输出
"""

import asyncio
import builtins
import datetime
from typing import Any, Optional

from fastapi import WebSocket

from app.api.context import get_thread_context

# chatgpt:
# 工具不知道前端连接，怎么把消息发过去？
# 可以把 monitor 当成“进度传达员”。工具只负责告诉它：
# monitor.report_tool(...)
# 意思就是：“帮我汇报一下，我正在执行这个工具。”
# 后面的事由 monitor 处理：整理消息格式、读取当前任务的 thread_id、找到对应连接、发送给前端。所以查数据库的工具，只需关心查数据和汇报进度。


# 你只记这四句：
# 1. monitor：负责“汇报现在做到哪了”。
# 2. ConnectionManager：负责记住“哪个 thread_id 对应哪个 WebSocket”。
# 3. ContextVar：负责让当前任务知道“我是谁”，拿到自己的 thread_id。
# 4. _send_to_websocket()：负责把消息安排到正确的事件循环里发送。



class ToolMonitor:
    """
    工具和助手调用的统一监控入口

    业务工具只需要导入全局 monitor，并调用 report_tool/report_assistant 等方法
    具体是通过 WebSocket 推送，还是输出到脚本运行时，由本类内部统一处理
    """

    _instance = None # 用来保存唯一的 ToolMonitor 实例。


    # 无论调用多少次 ToolMonitor()，都希望得到同一个对象。
    # 1. 创建对象：为 Dog 对象分配内存空间。
    # 2. 初始化对象：执行 public Dog() 构造函数。
    # 只不过 Java 把这些过程通过 new Dog() 帮你完成了。
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ToolMonitor, cls).__new__(cls)
            cls._instance.websocket_manager = None
        return cls._instance

# 把连接管理器保存下来，供以后使用，并没有在这里建立连接。
    # ConnectionManager 是项目自己定义的类名，不是 WebSocket 自带的 API。它负责管理“哪些用户连接着、消息应该发给谁”。
    def set_websocket_manager(self, manager: "ConnectionManager") -> None:
        """绑定 FastAPI WebSocket 连接管理器"""
        self.websocket_manager = manager

    def _emit(
        self,
        event_type: str,
        message: str,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """
        构造统一监控事件，并尝试推送到当前 thread_id 对应的前端连接

        :param event_type: 事件类型，例如 tool_start、assistant_call
        :param message: 面向前端展示的事件说明
        :param data: 附加结构化数据
        """
        payload = {
            "type": "monitor_event",
            "event": event_type,
            "message": message,
            "data": data or {},
            "timestamp": datetime.datetime.now().isoformat(),
        }

        # 判断 WebSocket 管理器是否已经绑定
        if self.websocket_manager:
            try:
                #  # thread_id 来自 ContextVar，确保事件只推给当前任务对应的前端连接
                # manager_loop：保存 WebSocket 管理器绑定的事件循环。
                # 事件循环：负责调度异步 Task 执行。
                thread_id = get_thread_context()
                manager_loop = self.websocket_manager.loop

                # 取出连接管理器使用的事件循环；如果循环和任务编号都存在，就安排发送这条消息。
                if manager_loop and thread_id:
                    self._send_to_websocket(payload, thread_id, manager_loop)
            except Exception as e:
                print(f"[Monitor] WebSocket send failed: {e}")

        # DeepAgents 脚本调试时，如果运行时暴露了 stream_writer，也同步写入流式输出
        if hasattr(builtins, "runtime") and hasattr(builtins.runtime, "stream_writer"):
            try:
                builtins.runtime.stream_writer(payload)
            except Exception:
                pass

        # 控制台保底输出，便于无前端场景下观察执行过程
        print(f"\n[Monitor:{event_type}] {message}")

    #先看看自己是不是在 WebSocket 所在的事件循环里；如果是，就直接创建 Task；如果不是，就把任务提交给 WebSocket 所在的事件循环。
    def _send_to_websocket(
        self,
        payload: dict[str, Any],#  消息内容
        thread_id: str, #任务编号
        manager_loop: asyncio.AbstractEventLoop, #负责发送的事件循环
    ) -> None:
        """
        将监控事件投递到 WebSocket 所在事件循环

        FastAPI 的 WebSocket 必须在创建它的事件循环中发送消息
        如果当前代码已经在同一个循环里，直接 create_task；否则使用线程安全投递
        """
        try:
            # 获取事件循环
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        coroutine = self.websocket_manager.send_to_thread(payload, thread_id)

        #“我现在是不是就在负责 WebSocket 的那个事件循环里？”
        if current_loop and current_loop == manager_loop:
            current_loop.create_task(coroutine) # 既然我已经在正确的事件循环里，那就直接在这里安排这个协程成为一个 Task。
        else:
            # 运行 Agent 的地方，和管理 WebSocket 连接的地方，可能各有自己的调度员。Agent 想发进度时，需要把发送工作交给管理这条连接的调度员。
            # 在这里就是做这件事：把发送任务交回 WebSocket 所在的事件循环执行。
            # 从其他线程安全地向指定事件循环提交协程
            # 把这个协程，交给指定的事件循环去执行，而且我现在可能不在那个事件循环/线程里
            asyncio.run_coroutine_threadsafe(coroutine, manager_loop)

    def report_tool(
        self,
        tool_name: str,
        args: Optional[dict[str, Any]] = None,
    ) -> None:
        """报告开始执行某个工具"""
        self._emit(
            "tool_start",
            f"开始执行工具: {tool_name}",
            {"tool_name": tool_name, "args": args},
        )

    def report_assistant(
        self,
        assistant_name: str,
        args: Optional[dict[str, Any]] = None,
    ) -> None:
        """报告正在调用某个子智能体"""
        self._emit(
            "assistant_call",
            f"正在调用助手: {assistant_name}",
            {"assistant_name": assistant_name, "args": args},
        )

    def report_task_result(self, result: str) -> None:
        """报告任务最终结果"""
        self._emit("task_result", "任务执行完成", {"result": result})

    def report_task_cancelled(self) -> None:
        """报告任务已被用户取消"""
        self._emit("task_cancelled", "任务已取消")

    def report_session_dir(self, path: str) -> None:
        """报告当前任务工作目录"""
        self._emit("session_created", f"工作目录已创建: {path}", {"path": path})


monitor = ToolMonitor()


class ConnectionManager:
    """
    WebSocket 连接管理器

    active_connections 使用 thread_id 作为 key，保证监控事件只推送给对应任务的前端连接
    """

    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}# 这个字典的 key 是字符串，value 是 WebSocket 对象。
        # WebSocket 发送必须回到创建连接的事件循环，因此启动时需要显式绑定 loop
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """绑定 FastAPI 主事件循环，并同步注册到 monitor"""
        self.loop = loop
        monitor.set_websocket_manager(self)
        print(f"[Monitor] ConnectionManager manually bound to loop: {id(self.loop)}")

    async def connect(self, websocket: WebSocket, thread_id: str) -> None:
        """接受 WebSocket 连接，并按 thread_id 保存"""
        await websocket.accept()
        self.active_connections[thread_id] = websocket
        print(f"Client connected: {thread_id}")

    def disconnect(self, websocket: WebSocket, thread_id: str) -> None:
        """移除已经断开的 WebSocket 连接"""
        if self.active_connections.get(thread_id) is websocket:
            del self.active_connections[thread_id]
            print(f"Client disconnected: {thread_id}")
        else:
            print(f"Stale websocket disconnected, current connection kept: {thread_id}")

    async def send_personal_message(self, message: str, websocket: WebSocket) -> None:
        """向指定 WebSocket 发送纯文本消息"""
        await websocket.send_text(message)

    # 调用 async def 定义的函数，通常先得到协程对象，并不会立即执行函数体。
    async def send_to_thread(self, message: dict[str, Any], thread_id: str) -> None:
        """向指定 thread_id 对应的前端连接发送 JSON 消息"""
        if thread_id in self.active_connections:
            websocket = self.active_connections[thread_id]
            await websocket.send_json(message)


manager = ConnectionManager()
