# VeriSpecOSLab Portal 平台开发计划

本计划旨在构建 VeriSpecOSLab 的教学实验管理门户（Portal），作为连接学生、教师、`vos` 执行引擎与基础设施的桥梁。

## 核心设计目标 (教学闭环支撑)
1. **规格可视化与引导**：将抽象的 YAML 架构规格转为直观的教学拓扑，引导学生理解 OS 设计。
2. **AI 协作审计 (防止代写)**：通过记录并分析 AI 协作日志，评估学生的设计思考过程。
3. **证据驱动评分**：基于 `vos` 生成的 Evidence JSON 自动打分，确保评分客观可溯源。
4. **阶段门禁控制**：通过 StageGate 强制执行“先设计规格，后实现代码”的教学逻辑。

---

## 第一阶段：MVP (最小可行闭环)

### 后端 (Vos-Server) - 基于 Bun / TypeScript
- [ ] **基础框架搭建**：在 `apps/vos-agent` 的 Portal API 基础上整理 TypeScript 后端边界，定义核心 Domain Model。
- [ ] **Agent Gateway (核心能力)**：
    - [ ] 实现 OpenAI 兼容的 `/v1/chat/completions` 接口。
    - [ ] 注入 `vos-agent-core` 构造的 `ContextBundle` / `PromptEnvelope` 与版本化 fixed prompt。
    - [ ] 异步记录 AI 协作请求到数据库。
- [ ] **Evidence 接收器**：提供 API 接收 CI 运行生成的 Evidence JSON，并关联到学生项目。
- [ ] **实验进度管理**：支持定义 StageGate（如：Memory 阶段、Trap 阶段），记录学生当前状态。

### 前端 (Vos-Web) - 基于 React + Shadcn/UI
- [ ] **学生仪表盘 (Dashboard)**：
    - [ ] 显示当前实验阶段进度。
    - [ ] 展示最近一次 `vos verify` 的结果摘要。
- [ ] **架构规格浏览器**：基于 YAML 数据渲染树形/图形化的架构切片预览。
- [ ] **AI 记录看板**：学生可查看自己的 AI 提问历史与 Agent 返回的规格建议。

---

## 第二阶段：全功能平台 (增强教学体验)

### 后端 (Vos-Server)
- [ ] **Gitea 深度集成**：通过 Webhook 自动接收 Push 事件，触发流水线。
- [ ] **评分引擎 (Scoring Engine)**：
    - [ ] 实现根据 Evidence 映射到具体评分项的逻辑。
    - [ ] 支持教师手动 Override 评分结果。
- [ ] **审计与风控**：
    - [ ] 识别异常的大段代码生成请求。
    - [ ] 生成学生 AI 使用习惯的分析报告（如：Prompt 质量分析）。

### 前端 (Vos-Web)
- [ ] **教师管理大屏**：
    - [ ] 班级整体进度热力图。
    - [ ] 异常项目告警（测试长期不通过或 AI 使用异常）。
- [ ] **证据溯源视图**：支持点击评分项直接跳转到对应的 QEMU 串口日志、Trace 记录或代码位置。
- [ ] **架构比较工具**：对比学生当前实现与原始 Architecture Seed 的偏离度。

---

## 第三阶段：自部署与高性能优化

### 基础设施与运维
- [ ] **容器化编排 (Docker Compose)**：一键拉起 Gitea + Vos-Server + vLLM + PostgreSQL。
- [ ] **高性能推理路由**：支持根据学生负载动态选择本地 vLLM 实例。
- [ ] **离线化验证**：确保所有静态资源与依赖在无外网环境下可正常使用。

---

## 任务关联与依赖
1. **依赖 `vos-core` / `vos-spec` / `vos-evidence`**：后端必须引入 TypeScript package 以解析规格、验证证据并共享数据契约。
2. **依赖 Gitea**：用于托管学生代码并运行 CI。
3. **依赖 vLLM**：提供本地模型推理能力。
