# Portal Implementation Blueprint: `vos-portal` Frontend Architecture

本文件定义 `vos-portal` 前端（当前原型实现为 `apps/vos-web`）的 React 应用组件结构、状态管理策略与 UI 交互规范。

该文档用于指导视图代码生成与前端实现。

## 1. 技术栈约束
*   **框架**: React 18 (Vite)
*   **UI 库**: Tailwind CSS + Shadcn/UI + Lucide Icons
*   **状态管理与请求**: TanStack Query (React Query) v5
*   **路由**: React Router v6
*   **图表**: Recharts (用于成绩分布)

## 2. 核心视图组件树

### 2.1 Student Dashboard (`/dashboard`)
*   **Header**: 用户信息、退出登录。
*   **StageStepper**: 线性步骤条，展示 Boot -> Memory -> ... -> Final 的进度。
*   **LatestRunCard**: 
    - 状态：✅ Passed / ❌ Failed
    - 摘要：通过用例数 / 总用例数。
    - 指标：平均系统调用延迟（若有）。
*   **EvidenceExplorer**: 
    - 左侧：按 `suite` 分类的测试用例列表。
    - 右侧：选中用例的详细 JSON 指标与原始日志片段预览。

### 2.2 Architecture Viewer (`/architecture`)
*   **SpecTree**: 递归渲染 `spec/architecture` 下的 YAML 结构。
*   **InvariantIndicator**: 在组件旁显示不变量校验状态（通过为绿点，失败为红闪）。

### 2.3 Teacher Admin (`/admin`)
*   **StudentGrid**: 列表展示所有学生项目，背景色根据 `status` 区分。
*   **BatchActions**: 批量打分、批量冻结。
*   **AICollaborationAudit**: 
    - 展示学生与 Agent 的对话时间轴。
    - 高亮疑似代码块过长的记录。

## 3. API 请求封装 (Hooks)

所有请求必须封装为 Custom Hooks，存放在 `src/hooks/`：

*   `useProject(id: string)`: 获取项目详情，带 `refetchInterval: 5000`（实时更新 CI 状态）。
*   `useEvidence(runId: string)`: 获取指定流水线的证据详情。
*   `useRubrics(experimentId: string)`: 获取评分准则。
*   `useUpdateScore()`: Mutation Hook，用于教师手动修正分数。

## 4. UI 规范
1.  **Loading 状态**: 统一使用 Shadcn/UI 的 `Skeleton` 组件。
2.  **错误处理**: 使用 `ErrorBoundary` 捕获组件级崩溃，使用 `toast` 提醒 API 错误。
3.  **响应式**: 必须兼容 1366px 及以上分辨率，移动端优先隐藏复杂图表。
