# 医研智析正式 React 移植检查（2026-10-17）

正式入口：http://localhost:5173。首页截图为真实React页面，非静态HTML原型。前端7处改动：index.html、App.tsx、ConversationThread.tsx、ChatComposer.tsx、ResearchActivity.tsx（新增）、main.tsx、styles.css。

## 已完成

- 已确认原型的森林绿、浅色背景、研字品牌、窄侧栏和单一工作台移植。
- 保留useDeepAgentSession及submit/cancel/upload/reset真实回调、API客户端、WebSocket协议和地址配置。
- 真实Monitor事件映射到右侧摘要时间线；tool_start只显示开始，不标记成功。技术信息折叠，历史轨迹也保留折叠入口。
- task_result显示“任务结束”，不等同报告交付成功。真实文件数组全部保留，以path为key和下载参数；无固定文件名/数量。
- TypeScript、Vite构建、前端git diff --check通过，无依赖安装或升级。
- 正式页实际访问200、WebSocket已连接；示例仅填充输入，发送按钮启用，新建研究清空输入。
- 实际React展示组件通过临时隔离挂载检查运行/完成/取消/错误分支，输入与取消回调可触发。检查页已删除，不进入产品。
- 完成态回放使用真实文件API返回的报告卡片；浏览器点击下载成功，保存文件与磁盘原件字节一致。
- 434×938窄屏DOM检查无横向溢出，输入框和发送按钮在可视区内，执行过程可折叠。报告表格限定容器滚动。
- 与操作前快照比对35个后端/数据库/Docker/依赖/.env/Hook/API/config/types文件哈希均未变化。

## 证据边界

react-home-desktop.png是正式首页实际运行截图。react-running-replay.png和react-completed-replay.png是正式展示组件的隔离回放截图，页面明确标为非实时任务：旧Monitor事件与既有Demo数据用来查排版，不证明迁移后的新业务任务已通过。取消/错误分支检查也不等同真实业务取消/错误回归。

浏览器窄屏截图工具两次超时，仅保留DOM几何检查结果，不提供手机截图。Ant Design 5/React19既有兼容性提示仍存在，未出现页面崩溃，本轮不通过安装依赖处理。

## 待授权的真实业务回归

未发起任何新模型/Tavily/综合任务。真实任务提交后的助手调用、终态、文件更新，以及真实附件上传/取消，本轮没有端到端重测；沿用原链路并保留旧证据。若需要新任务验收，须先由用户确认费用范围。

没有修改文件命名/覆盖行为，没有新增历史恢复、知识库管理或后台入口，没有改变RAGFlow Chat配置。业务接口与协议不变；仅改正式展示结构、主题、文案，并补充任务发起失败的本地错误呈现。无commit/push。完成后停止开发，等待界面确认。
