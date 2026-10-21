"""
RAGFlow 知识库工具模块

封装两个给 RAGFlow 子智能体使用的 LangChain 工具：
get_assistant_list 用于发现可用聊天助手及其绑定知识库，
create_ask_delete 用于创建临时会话、发起一次问题查询，并在查询后删除会话。
"""

import json
import time

import requests
from langchain_core.tools import tool
from ragflow_sdk import RAGFlow

from app.api.context import get_thread_context
from app.api.monitor import monitor
from app.ragflow.rag_config import _load_ragflow_env

# 模块级复用 RAGFlow 客户端，避免每次工具调用都重新初始化 SDK 对象
api_key, base_url = _load_ragflow_env()
ragflow_client = RAGFlow(api_key=api_key, base_url=base_url)

# 单次提问的总时长上限（秒）：RAGFlow 内部要跑 LLM 生成答案，同机部署时可能很慢，
# 没有上限会把整个任务拖死（实测卡在 create_ask_delete 后再无任何日志）。
RAGFLOW_ASK_TIMEOUT_SECONDS = 90
# 单次读取超时（秒）：连接 10 秒内必须建好，之后每 60 秒必须收到数据，否则抛 Timeout
RAGFLOW_READ_TIMEOUT_SECONDS = 60
# 单次任务最多向 RAGFlow 提问几次：模型可能一次并发问 6 个问题，既慢又浪费
MAX_RAGFLOW_ASKS = 3

# 任务级计数器：{thread_id: 已提问次数}（与网络搜索同一套机制）
_RAGFLOW_CALLS: dict[str, int] = {}
_DEFAULT_KEY = "__default__"


def _ragflow_key() -> str:
    return get_thread_context() or _DEFAULT_KEY


def reset_ragflow_calls(thread_id: str | None = None) -> None:
    """每个新任务开始时调用，把该任务的 RAGFlow 提问计数归零"""
    _RAGFLOW_CALLS[thread_id or _ragflow_key()] = 0


def get_ragflow_calls() -> int:
    """读取当前任务的已提问次数（测试/日志用）"""
    return _RAGFLOW_CALLS.get(_ragflow_key(), 0)



# @tool 会把函数签名和 docstring 暴露给 DeepAgents，模型据此决定是否调用以及如何填参
@tool
def get_assistant_list() -> str:
    """
    查询 RAGFlow 中有哪些聊天助手，以及每个助手关联了哪些知识库

    作用：让模型先了解“哪个助手能回答哪类内部文档问题”，再决定后续要向哪个助手提问。
    调用 create_ask_delete 之前，应先调用本工具确认助手名称。
    :return: 有助手时返回助手名称、功能介绍、关联知识库；无助手或异常时返回中文提示
    """

    # 埋点：工具被调用后，前端可以展示当前正在查询 RAGFlow 助手列表
    monitor.report_tool(tool_name="ragflow聊天助手列表查询工具：get_assistant_list")

    try:
        # list_chats 查询的是 RAGFlow 的 Chat 层，不是 Dataset 层
        # Chat 负责对外问答，Dataset 只负责承载文档
        chat_list = ragflow_client.list_chats()
        if not chat_list:
            return "没有任何可用助手"

        # 把每个助手的名称、描述和绑定知识库拼成模型容易阅读的路由信息
        count_chat_info = ""
        for chat in chat_list:
            # 不同版本 SDK 字段可能为空，这里用 getattr 兼容没有绑定知识库的助手
            # “去 chat 身上找 kb_names，找不到就给我 []。”
            dataset_names = getattr(chat, "kb_names", []) or []

            count_chat_info += f"助手名称:{chat.name};功能介绍：{chat.description}; 关联的知识库：{'、'.join(dataset_names)} \n"
        return count_chat_info
    except Exception as e:
        return f"查询助手信息异常，无可用助手,异常信息:{str(e)}"


@tool
def create_ask_delete(chat_name, question) -> str:
    """
    向某个 RAGFlow 聊天助手创建临时会话并完成一次提问

    注意：调用此工具之前，必须先调用 get_assistant_list，明确可用助手名称和助手能力边界。
    :param chat_name: 助手名称，必须来自 get_assistant_list 返回结果
    :param question: 本次提问的问题
    :return: RAGFlow 返回的回答文本；异常时返回中文错误提示
    """
    # 任务级次数限制：超过上限就不再真正请求 RAGFlow，返回提示让模型用已有资料作答
    key = _ragflow_key()
    used = _RAGFLOW_CALLS.get(key, 0)
    if used >= MAX_RAGFLOW_ASKS:
        return (
            f"本次任务的知识库提问次数已达上限（{MAX_RAGFLOW_ASKS} 次），"
            "请立即基于已获得的资料整理回答，不要再次提问。"
        )
    _RAGFLOW_CALLS[key] = used + 1

    # 埋点：记录目标助手和问题，便于前端展示当前知识库检索动作
    monitor.report_tool(
        tool_name="ragflow提问助手工具：create_ask_delete",
        args={"chat_name": chat_name, "question": question},
    )

    session = None
    use_chat = None
    response = None
    try:
        # 先按名称找到 Chat 对象；真正提问时还需要在 Chat 下创建 Session
        chats = ragflow_client.list_chats(name=chat_name)
        if not chats:
            return f"没有找到名为「{chat_name}」的聊天助手"

        use_chat = chats[0]

        # 每次工具调用只创建一个临时会话，避免多轮上下文污染当前问题
        session = use_chat.create_session(name="temp_session_ask")

        # SDK 的 post() 内部写死了 requests.post，不支持传 timeout，
        # 所以这里直接用 requests 调同一个接口，才能设置连接/读取超时。
        # 没有超时时，RAGFlow 不返回数据会把整个任务无限期挂住（实测复现过）。
        response = requests.post(
            url=f"{ragflow_client.api_url}/chats/{use_chat.id}/completions",
            json={
                "messages": [{"role": "user", "content": question}],
                "stream": True,
                "session_id": session.id,
            },
            headers=ragflow_client.authorization_header,
            stream=True,
            timeout=(10, RAGFLOW_READ_TIMEOUT_SECONDS),
        )
        result = ""
        started_at = time.time()
        # iter_lines:把服务器返回的数据，一行一行地拿出来。
        # line 是一个字符串 str。
        # 它大概长这样：
        # line = 'data: {"data": {"name": "张三"}}'

        for line in response.iter_lines(decode_unicode=True):
            # 总时长兜底：即使服务一直慢慢吐数据，也不能超过上限
            if time.time() - started_at > RAGFLOW_ASK_TIMEOUT_SECONDS:
                return (
                    f"知识库检索超时（超过 {RAGFLOW_ASK_TIMEOUT_SECONDS} 秒），"
                    "请基于其它来源作答。"
                )

            # 这一行如果是空的，就跳过，不处理。
            if not line:
                continue

            # RAGFlow 流式返回遵循 SSE 风格：每行以 data: 开头，[DONE] 表示结束

            # 原sse=line:'data: {"data": {"name": "张三"}}'
            # 1.line.removeprefix("data:") =='{"data": {"name": "张三"}}'
            # 2.strip 去掉多余字符串
            # 3.json.loads()这个JSON字符串转换成 Python 字典：
            line = line.removeprefix("data:").strip()
            # 去掉 data: 后可能变成空字符串
            if not line:
                continue

            if line == "[DONE]":
                break

            data = json.loads(line)
            chunk_data = data.get("data")
            if not isinstance(chunk_data, dict):
                continue
            answer = chunk_data.get("answer")
            if answer:
                # 部分流式片段会返回“截至当前的完整答案”，部分会返回增量内容
                # 这里兼容两种情况，尽量避免重复拼接
                # RAGFlow 的流式片段在不同接口或版本下可能有两种形态。一种是“覆盖型完整内容” 一种是"增量型片段"
                if answer.startswith(result):
                    result = answer
                elif not result.startswith(answer):
                    result += answer

        return result

    except requests.exceptions.Timeout:
        # 连接/读取超时：返回可读提示，让模型用其它来源继续，而不是把任务挂死
        return (
            f"知识库检索超时（超过 {RAGFLOW_ASK_TIMEOUT_SECONDS} 秒），"
            "请基于其它来源作答。"
        )
    except Exception as e:
        return f"提问失败，错误原因：{str(e)}"
    finally:
        # 关闭流式响应，避免连接泄漏
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        # use_chat 存在吗？
        #     ↓
        # 是 → session 存在吗？
        #           ↓
        #           是 → 删除这个 session
        #           否 → 什么都不做
        if use_chat is not None and session is not None:
            use_chat.delete_sessions(ids=[session.id])


if __name__ == "__main__":
    # 本地调试入口：直接运行本文件可验证 RAGFlow API Key、服务地址和助手名称是否可用
    # print(get_assistant_list.invoke({}))
    print(
        create_ask_delete.invoke(
            {
                "chat_name": "电商行业助手",
                "question": "如果我是一个电商平台运营负责人，应该怎样制定 2026 年 AI 应用路线图？",
            }
        )
    )
