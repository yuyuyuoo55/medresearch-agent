# 架构与部署说明

## 来源与范围

基于 didilili/deepsearch-agents 教程源码进行场景化整理；主Agent、专家助手、FastAPI/WebSocket及工具架构来自教程。当前医研智析为V0.1产品化预览，不能称为从零独立研发。保留根README全部原来源内容。仓库尚未找到LICENSE，发布复制代码前应核实上游许可，不能自行补MIT。

## 实际调用链

用户输入/会话附件 → React useDeepAgentSession → FastAPI /api/task → 主Agent → 数据库/网络/RAGFlow助手 → 工具 → 主Agent汇总与Markdown/PDF工具 → output会话目录 → /api/files与/api/download。
Monitor → WebSocket /ws/{thread_id} → 前端执行过程。代码存在的完整架构不等于全部链路均验收通过；见acceptance.md。

## 本机复现（人工步骤；本轮未执行安装/重启）

1. 进入项目根目录，使用项目已有Python3.12 .venv及锁文件。新环境可按原README使用uv锁定安装；不要用系统Python3.14替代，也不要升级锁文件。
2. 按.env.example在本机配置密钥与MySQL只读账号，不提交.env。RAGFlow应独立部署并预配Dataset/Chat；根README保留原教程详细步骤。本轮不重建Docker或数据卷。
3. 现有MySQL本机端口为3308（来自基线）；启动前核查当前端口和容器，不执行down -v或重复导入mysql.sql。
4. 在根目录终端运行 `.\.venv\Scripts\python.exe -m uvicorn app.api.server:app --host 127.0.0.1 --port 8000`。
5. 另开PowerShell终端进入frontend，以进程环境设置 `$env:VITE_API_BASE_URL='http://localhost:8000'` 和 `$env:VITE_WS_BASE_URL='ws://localhost:8000'`，运行 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort`。保留现有.env.local；它的端口与基线不同，不能只运行默认命令后假定正确。
6. 打开http://localhost:5173和http://localhost:8000/docs。仅查OpenAPI不会提交任务。提交研究才会产生模型/搜索费用，应由操作者明确确认。
7. 免费构建：frontend目录先 `.\node_modules\.bin\tsc.cmd -b`，再 `.\node_modules\.bin\vite.cmd build`。已有依赖可直接复用，不调用npx下载。

## 前端确认后的修改计划

仅改frontend/src/App.tsx、styles.css及必要展示组件；复用ConversationThread、ChatComposer和useDeepAgentSession。保留API/WS、上传、提交、取消与文件下载链路。按独立ui-preview.html实现森林绿/白/薄荷绿的首页、执行态、结果态。先确认原型，再实施与免费回归。当前尚无医疗版实际运行截图。
