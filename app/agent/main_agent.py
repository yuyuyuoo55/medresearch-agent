"""
主智能体组装与异步执行模块

负责把模型、主提示词、文件类工具和三个专家子智能体组装成 DeepAgent，
并提供 run_deep_agent 作为后续 API 层调用的统一入口。运行时还会为每个
session_id 创建独立工作目录，并把工具调用、子智能体调用和最终结果推送给前端。
"""

import asyncio
import shutil
import time
from pathlib import Path
from uuid import uuid4

from deepagents import create_deep_agent
from langgraph.checkpoint.memory import InMemorySaver

from app.agent.llm import model
from app.agent.prompts import main_agent_content
from app.agent.subagents.database_query_agent import database_query_agent
from app.agent.subagents.knowledge_base_agent import knowledge_base_agent
from app.agent.subagents.network_search_agent import network_search_agent
from app.api.context import (
    reset_session_context,
    set_session_context,
    set_thread_context,
)
from app.api.monitor import monitor

# 文件类工具由主智能体直接掌握，负责读取上传附件和生成最终交付文档
from app.tools.markdown_tools import generate_markdown
from app.tools.pdf_tools import convert_md_to_pdf
from app.tools.upload_file_read_tool import read_file_content
# 网络搜索的「任务级」计数重置：工具内部最多执行 MAX_SEARCH_CALLS 次，
# 每个新任务开始时必须归零，否则第二个任务会直接超限。
from app.tools.tavily_tool import reset_search_calls

# 主智能体是调度中心：
# 1. tools 只放最终交付相关的文件工具
# 2. subagents 放网络、数据库、RAGFlow 三类信息获取助手
# 3. checkpointer 通过 thread_id 保存同一会话中的执行上下文
main_agent = create_deep_agent(
    model=model,
    system_prompt=main_agent_content["system_prompt"],
    tools=[generate_markdown, convert_md_to_pdf, read_file_content],
    checkpointer=InMemorySaver(),
    subagents=[database_query_agent, network_search_agent, knowledge_base_agent],
)

# 当前文件位于 app/agent/main_agent.py，parents[1] 即 app 目录
project_root_path = Path(__file__).parents[1].resolve()

# 先把“这个任务的工作环境”准备好，再让 Agent 开始干活。
async def run_deep_agent(task_query, session_id):
    """
    异步流式执行主智能体

    API 层会为每次任务传入用户问题和 session_id。本函数负责准备会话目录、
    复制上传文件、写入 ContextVar，并在流式执行过程中把关键事件上报给前端。
    :param task_query: 前端提交的原始任务问题
    :param session_id: 当前任务 ID，同时用于 thread_id、输出目录和 WebSocket 定向推送
    """

    # 第一步：创建当前会话输出目录 session_dir
    print(f"[MainAgent] 开始执行会话，session_id={session_id}")

    # 网络搜索次数计数器归零：工具层限制是任务级的，不重置会让同一进程里的后续任务直接超限
    reset_search_calls(session_id)

    # 每个会话独立使用 output/session_{session_id}，避免不同用户的产物互相覆盖
    session_dir = project_root_path / "output" / f"session_{session_id}"

    # 同一个 thread_id 再次提交任务时，先把上一轮产物归档，保证「交付文件」只属于本次任务。
    # 不这么做的话，旧报告会留在同一目录里，前端会把它当成本次任务的交付物。
    if session_dir.exists() and any(session_dir.iterdir()):
        archive_dir = (
            project_root_path
            / "output"
            / "_archive"
            / f"session_{session_id}_{int(time.time())}"
        )
        archive_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(session_dir), str(archive_dir))

    session_dir.mkdir(parents=True, exist_ok=True)

    # 前端和工具使用绝对路径；提示词里只给模型相对路径，降低模型误用系统绝对路径的概率
    session_dir_str = str(session_dir).replace("\\", "/")# 给前端和工具使用
    relative_session_dir_str = str(session_dir.relative_to(project_root_path)).replace(
        "\\", "/"
    )# 给大模型提示词使用 	output/session_xxx



    # 第二步：处理上传文件
    # 上传文件先落在 updated/session_{session_id}，执行前复制到本次 output 工作目录
    # 为什么复制 因为output文件夹有生成文件和用户上传文件 不用查两个目录
    # 这样读文件工具和生成文件工具都只需要围绕同一个 session_dir 工作
    updated_dir_path = project_root_path / "updated" / f"session_{session_id}"
    updated_info_prompt = ""
    if updated_dir_path.exists():
        # updated_dir_path.iterdir()：把这个文件夹里面的东西一个一个列出来。
        files = [f.name for f in updated_dir_path.iterdir() if f.is_file()]
        if files:
            for filename in files:
                # copy2 会保留上传文件的修改时间、权限等元数据，便于后续排查文件来源
                shutil.copy2(updated_dir_path / filename, session_dir / filename)

            # 把上传文件列表注入用户消息，提醒模型先调用 read_file_content 获取附件内容
            updated_info_prompt = (
                "\n    [已上传文件] 已加载到工作目录:\n"
                + "\n".join([f"    - {f}" for f in files])
                + "\n    请优先使用工具（read_file_content）读取并参考这些文件。"
            )

    # 第三步：绑定 ContextVar 并推送会话目录
    # ContextVar 让深层工具无需显式传参，也能拿到当前会话目录和 WebSocket thread_id
    session_dir_token = set_session_context(session_dir_str)
    session_id_token = set_thread_context(session_id)

    # 前端拿到工作目录后，可以展示本次任务生成的 Markdown/PDF 等产物
    monitor.report_session_dir(session_dir_str)

    # 第四步：构建工作目录提示词
    # 工作环境指令是运行时动态补充的，约束模型只在当前会话目录读写文件
    path_instruction = f"""
    【工作环境指令】
    工作目录: {relative_session_dir_str}
    {updated_info_prompt}

    规则：
    1. 新生成文件必须保存到工作目录：'{relative_session_dir_str}/filename'
    2. 读取已上传的文件时，请直接将文件名（例如：'开篇.txt'）作为 filename 参数传入（read_file_content）读取工具，不要带上任何目录前缀。
    3. 使用相对路径，禁止使用绝对路径
    4. 若存在上传文件，请先分析内容
    """

    # 第五步：使用 main_agent.astream 执行
    # checkpoint 线程键按「任务」唯一（session_id + UUID），不用 session_id 本身：
    # - WebSocket 推送、文件目录仍然用 session_id（见上面的 ContextVar），前端无感知
    # - 但 LangGraph 的对话历史必须每任务独立：任务被「取消」或异常中断时，
    #   历史里会留下「assistant 带 tool_calls、tool 结果没回来」的残破记录，
    #   复用同一 thread_id 会让下一个任务一开跑就报 400
    #   （DeepSeek: An assistant message with 'tool_calls' must be followed by tool messages）
    checkpoint_thread_id = f"{session_id}::{uuid4().hex}"
    config = {"configurable": {"thread_id": checkpoint_thread_id}}

    try:
        # astream 会持续产出模型节点、工具节点和子智能体节点的状态片段
        async for chunk in main_agent.astream(
            {"messages": [{"role": "user", "content": task_query + path_instruction}]},
            config=config,
        ):
            # chunk 形如 {"model": {"messages": [...]}}，这里主要关心模型最新消息

     # 第六步：解析流式 chunk
            for node_name, state in chunk.items():

                if not state or "messages" not in state:
                    continue
                # 为什么 DeepAgent 这里可能没有 messages？
                # 因为 Agent 运行过程中拿到的 state 不一定每一次都是完整的消息状态。
                # 我现在只想处理包含消息的 state。
                messages = state["messages"]
                if messages and isinstance(messages, list):
                    last_msg = messages[-1] # 取到最后一条消息
                    #  情况一：调用子智能体
                    if node_name == "model":
                        if last_msg.tool_calls:
                            # DeepAgents 调用子智能体时，本质上会产生名为 task 的工具调用
                            for tool_call in last_msg.tool_calls:
                                if tool_call["name"] == "task":
                                    # 子智能体调用单独上报，前端可以展示“正在调用哪个专家助手”
                                    monitor.report_assistant(
                                        tool_call["args"]["subagent_type"],
                                        {
                                            "description": tool_call["args"][
                                                "description"
                                            ]
                                        },
                                    )
                    #  情况二：主智能体返回最终结果
                        elif last_msg.content:
                            # 模型没有继续调用工具时，最新文本内容就是本轮可反馈给前端的结果
                            print(
                                f"主智能体执行结果，最终结果：{last_msg.content[:100]}"
                            )
                            monitor.report_task_result(last_msg.content)

    except asyncio.CancelledError:
        # 如果这个异步任务被取消了，就执行“任务已取消”的处理，然后把这个取消继续往上抛。
        monitor.report_task_cancelled()
        raise
    except Exception as e:
        # 异步执行异常也走 monitor，保证前端能收到明确错误事件
        monitor._emit("error", f"执行主智能发生异常信息：{str(e)}")
    finally:
        # 任务结束后恢复 ContextVar，避免后续请求复用到本次会话目录或 thread_id
        reset_session_context(session_dir_token, session_id_token)


if __name__ == "__main__":
    import asyncio

    asyncio.run(
        run_deep_agent("从网络查询机器人信息，并生成Markdown文件", "test_session_001")
    )
