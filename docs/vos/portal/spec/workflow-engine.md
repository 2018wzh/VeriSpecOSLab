# Portal Implementation Blueprint: Workflow Engine Logic

本文件定义了门户后端的三个核心异步流程逻辑，旨在指导 Vibe Coding 实现具体服务层函数。

## 1. StageGate 状态机逻辑 (`fn check_stage_promotion`)

**目的**：判断学生是否满足进入下一阶段的条件。

*   **输入**：`project_id`
*   **触发时机**：新的 `EvidenceRecord` 入库后。
*   **业务逻辑流程**：
    1.  获取当前项目的 `current_stage_id` 和其对应的 `sequence` 序号。
    2.  查询 `stage_gates` 表中 `sequence = current_sequence + 1` 的下一个阶段。
    3.  如果下个阶段是 `gate_type = "auto"`：
        - 查询当前项目所有相关的 `EvidenceRecord`。
        - 检查是否所有 `StageGate.config` 中要求的测试用例均为 `result = "pass"`。
        - 如果全部满足，更新 `projects.current_stage_id` 并发送 `StagePromoted` 事件。
    4.  如果下个阶段是 `gate_type = "manual"`：
        - 检查 `DesignSubmission` 是否存在且状态为 `approved`。
        - 如果满足，更新状态。

---

## 2. 证据自动解析与评分逻辑 (`fn process_incoming_evidence`)

**目的**：将 CI 上报的原始 JSON 转化为分数值。

*   **输入**：`VosReportJSON`
*   **业务逻辑流程**：
    1.  **原子化写入**：将报告中的每个测试用例解析为 `EvidenceRecordModel` 并批量插入数据库。
    2.  **准则匹配**：针对插入的每一项，查询 `evaluation_rubrics` 表：
        - 如果匹配到 `suite` 和 `case` 名。
        - 根据其 `weight` 计算当前项得分（e.g., pass = 100% weight, fail = 0）。
    3.  **分值聚合**：按 `rubric_id` 分组汇总得分，更新 `scores.auto_score`。
    4.  **不变量约束检查**：如果 `kind = "invariant"` 且失败，立即在前端 Dashboard 标记“架构不一致警告”。

---

## 3. Gitea Webhook 处理器 (`fn handle_gitea_webhook`)

**目的**：同步仓库状态并触发后端流水线记录。

*   **支持事件**：`push`, `pull_request`
*   **核心逻辑**：
    1.  验证 Webhook Secret。
    2.  解析 `commit_sha` 和分支名。
    3.  如果分支是实验主分支（main）：
        - 创建一条 `pipeline_runs` 记录，状态设为 `running`。
        - 等待 CI Runner 的后续 Evidence 上报。
    4.  如果是新的 PR：
        - 在 `DesignSubmission` 中创建一条待审核记录，通知教师。

---

## 4. 关键异步任务队列
*   **Task 1**: `CleanupExpiredEvidence` - 每周清理 30 天前的原始日志片段。
*   **Task 2**: `ConsistencyCheck` - 定期核对 Gitea 提交记录与本地 `pipeline_runs` 是否对齐。
