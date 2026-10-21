"""
Tavily 网络搜索工具模块

封装 internet_search 工具，供网络搜索子智能体检索互联网公开信息
工具内部会先通过 monitor 上报调用参数，再请求 Tavily API 返回结构化搜索结果
"""

import os
from typing import Literal

from dotenv import load_dotenv
from langchain_core.tools import tool
from tavily import TavilyClient

from app.api.context import get_thread_context
from app.api.monitor import monitor

load_dotenv()


# 单次任务允许的最大检索次数，与 prompts.yml 里网络搜索助手的提示词保持一致。
MAX_SEARCH_CALLS = 5

# 任务级计数器：{thread_id: 已检索次数}
# - 为什么不用 ToolCallLimitMiddleware：它的 run_limit 按「子智能体一次运行」计数，
#   主智能体每重复调用一次子智能体，计数就会重置（实测被调 2 次 => 搜了 10 次）。
# - 为什么不用 ContextVar：Tool.invoke() 每次调用可能运行在独立上下文里，
#   计数不会跨调用累积（实测 6 次调用全部放行）。
# - 用按 thread_id 的字典：同一任务内所有工具调用共享计数，不同会话互不影响；
#   每个任务开始时由 run_deep_agent 显式重置。
_SEARCH_CALLS: dict[str, int] = {}
_DEFAULT_KEY = "__default__"

# 问：现在是哪个任务？ 比如拿到 "manual-1792..."
def _call_key() -> str:
    return get_thread_context() or _DEFAULT_KEY


def reset_search_calls(thread_id: str | None = None) -> None:
    """每个新任务开始时调用，把该任务的检索计数归零"""
    _SEARCH_CALLS[thread_id or _call_key()] = 0


def get_search_calls() -> int:
    """读取当前任务的已检索次数（便于测试和日志）"""
    return _SEARCH_CALLS.get(_call_key(), 0)


# TavilyClient 是实际访问搜索服务的客户端；模块级复用可避免每次工具调用重复初始化
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))


# @tool 会把函数签名和 docstring 暴露给 DeepAgents，模型据此决定是否调用以及如何填参
@tool
def internet_search(
    query: str,
    topic: Literal["news", "finance", "general"] = "general",
    max_results: int = 5,
    include_raw_content: bool = False,
):
    """
    根据用户问题检索互联网公开信息

    注意：本工具只用于外部公开网页、新闻、政策等信息，不用于查询业务数据库或 RAGFlow 私有知识库
    :param query: 搜索关键词或自然语言问题
    :param topic: 搜索主题，可选 news、finance、general
    :param max_results: 返回的最大结果数
    :param include_raw_content: 是否返回网页原文内容；False 返回摘要，True 尝试返回更完整正文
    :return: Tavily 返回的结构化搜索结果
    """
    # 硬性次数限制：超过上限后不再真正请求 Tavily，而是返回一条提示，
    # 让模型基于已经检索到的结果作答，避免反复搜索把任务拖到几分钟。
    key = _call_key()
    used = _SEARCH_CALLS.get(key, 0)
    if used >= MAX_SEARCH_CALLS:
        return (
            f"本次任务已达到检索次数上限（{MAX_SEARCH_CALLS} 次），"
            "请立即基于已获得的检索结果整理并回答，不要再次调用搜索工具。"
        )
    _SEARCH_CALLS[key] = used + 1

    # 工具内部埋点比外层 stream 解析更直接：只要工具被调用，前端就能看到本次搜索参数
    # 这里只上报查询参数，不上报搜索结果正文，避免监控事件体过大
    monitor.report_tool(
        tool_name="网络搜索工具",
        args={
            "query": query,
            "topic": topic,
            "max_results": max_results,
            "include_raw_content": include_raw_content,
        },
    )

    # Tavily 返回 query、results、title、url、content 等结构化字段，后续由子智能体阅读并汇总
    return tavily_client.search(
        query=query,
        topic=topic,
        max_results=max_results,
        include_raw_content=include_raw_content,
    )


if __name__ == "__main__":
    from pprint import pprint

    # 本地调试入口：直接运行本文件可验证 TAVILY_API_KEY 和 Tavily API 是否可用
    pprint(
        internet_search.invoke(
            {"query": "查询截至今天 DeepAgents 的公开资料，总结它的主要用途，并查找其全球企业付费客户总数。请给出来源；找不到可靠数据的部分明确说明。"}
        )
    )
