"""
请求上下文管理模块

负责在异步请求链路中保存当前任务的 thread_id 和 session_dir
工具、智能体和监控模块可以在深层调用中读取这些值，而不需要层层传参
"""

from contextvars import ContextVar, Token
from typing import Optional

# ContextVar 是协程级上下文变量，适合 FastAPI 这类异步 Web 服务
# gpt:ContextVar 让不同请求分别保存自己的值，而同一次请求里的函数又能方便地取到这个值。
# 它可以避免多个并发请求共用全局变量时出现 thread_id 或 session_dir 串台


# 等号右边：创建上下文变量
# 意思是：
# - 创建一个上下文变量。
# - 给它取个内部名字，叫 "session_dir"，方便识别。
# - 当前上下文还没设置值时，默认返回 None。

# 等号左边：保存对象，并标注类型
# _session_dir_ctx：Python 变量名，保存刚创建的对象；开头的 _ 表示约定在模块内部使用。
# ContextVar[...]：说明它是一个上下文变量。
# Optional[str]：说明里面的值可以是字符串，也可以是 None。

# 总结:
# asyncio：安排不同请求任务交替执行。
# ContextVar：在交替执行时，让每个请求读到自己的值，避免串到别人的数据。
# threading.local 只认线程，A、B 又在同一个线程，所以它们用的是同一份存储。

# 设置当前任务生成文件的会话目录
_session_dir_ctx: ContextVar[Optional[str]] = ContextVar(
    "session_dir",
    default=None,
)

# 设置当前任务对应的前端连接和 Agent 执行线程
_thread_id_ctx: ContextVar[Optional[str]] = ContextVar(
    "thread_id",
    default=None,
)


def set_session_context(path: str) -> Token[Optional[str]]:
    """
    设置当前请求链路的会话目录

    :param path: 当前任务的工作目录
    :return: reset 时需要使用的上下文 token
    """
    return _session_dir_ctx.set(path)


def get_session_context() -> Optional[str]:
    """
    获取当前请求链路的会话目录

    :return: 当前任务工作目录；未设置时返回 None
    """
    return _session_dir_ctx.get()


def set_thread_context(thread_id: str) -> Token[Optional[str]]:
    """
    设置当前请求链路的线程 ID

    :param thread_id: 前端连接和 Agent 执行共用的任务 ID
    :return: reset 时需要使用的上下文 token
    """
    return _thread_id_ctx.set(thread_id)


def get_thread_context() -> Optional[str]:
    """
    获取当前请求链路的线程 ID

    :return: 当前任务 ID；未设置时返回 None
    """
    return _thread_id_ctx.get()


def reset_session_context(
    session_token: Token[Optional[str]],
    thread_token: Optional[Token[Optional[str]]] = None,
) -> None:
    """
    恢复请求上下文，避免本次任务信息残留到后续请求

    :param session_token: set_session_context 返回的 token
    :param thread_token: set_thread_context 返回的 token
    """
    _session_dir_ctx.reset(session_token)
    if thread_token is not None:
        _thread_id_ctx.reset(thread_token)
