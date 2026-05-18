# Portal Implementation Blueprint: Data Model (Rust/SQLx)

本文件定义了后端的 Rust Struct 与数据库表结构的精确映射，用于驱动 Vibe Coding 生成数据库迁移文件和模型层代码。

## 1. 核心枚举定义 (Postgres Enum Mapping)
```rust
#[derive(Debug, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "user_role", rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    Teacher,
    Student,
}

#[derive(Debug, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "project_status", rename_all = "lowercase")]
pub enum ProjectStatus {
    Provisioning, 
    Active,       
    Locked,       
    Archived,     
}

#[derive(Debug, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "evidence_kind", rename_all = "lowercase")]
pub enum EvidenceKind {
    Test,       
    Benchmark,  
    Invariant,  
    Audit,      
}
```

## 2. 核心实体模型

### 2.1 Project (学生项目)
*   **Table**: `projects`
*   **Unique Constraint**: `(user_id, experiment_id)`
```rust
pub struct ProjectModel {
    pub id: Uuid,                // UUID v4
    pub user_id: Uuid,           // FK: users.id
    pub experiment_id: Uuid,     // FK: experiments.id
    pub repo_url: String,        // Gitea Repo SSH/HTTP URL
    pub current_stage_id: Uuid,  // FK: stage_gates.id
    pub status: ProjectStatus,   // Enum
    pub last_commit_sha: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

### 2.2 StageGate (实验阶段门禁)
*   **Table**: `stage_gates`
*   **Logic**: 实验进度的控制节点。
```rust
pub struct StageGateModel {
    pub id: Uuid,
    pub experiment_id: Uuid,     // FK: experiments.id
    pub name: String,            // 阶段名：e.g., "Memory Management"
    pub sequence: i32,           // 排序：从 0 开始
    pub gate_type: String,       // "auto" (代码测试通过即开), "manual" (设计审核)
    pub config: serde_json::Value, // 包含开启此阶段所需的特定测试用例列表
}
```

### 2.3 EvidenceRecord (原始证据记录)
*   **Table**: `evidence_records`
*   **Index**: `(project_id, commit_sha, suite, case)`
```rust
pub struct EvidenceRecordModel {
    pub id: Uuid,
    pub project_id: Uuid,
    pub pipeline_run_id: Uuid,
    pub commit_sha: String,
    pub kind: EvidenceKind,
    pub suite: String,           // e.g., "arch::riscv64"
    pub case: String,            // e.g., "page_fault_handler"
    pub result: String,          // "pass", "fail", "error"
    pub metrics: serde_json::Value, // e.g., { "latency": 150, "unit": "ns" }
    pub log_segment: Option<String>, // 截取的关键日志片段
    pub created_at: DateTime<Utc>,
}
```

### 2.4 ScoreItem (细分得分项)
*   **Table**: `scores`
*   **Constraints**: `CHECK (manual_score >= 0 AND auto_score >= 0)`
```rust
pub struct ScoreModel {
    pub id: Uuid,
    pub project_id: Uuid,
    pub rubric_id: Uuid,         // FK: evaluation_rubrics.id
    pub auto_score: f32,         // 系统计算分
    pub manual_score: Option<f32>, // 教师调整分
    pub feedback: Option<String>,
    pub is_final: bool,          // 是否冻结，冻结后不可自动更新
    pub updated_at: DateTime<Utc>,
}
```

---

## 3. 实现细节：关联与级联
1.  **Delete User**: 级联删除相关的 `projects` 与 `scores`。
2.  **Experiment Update**: 更新 `stage_gates` 时，不应影响已有 `projects` 的 `current_stage_id`（需要逻辑校验）。
3.  **Timestamp**: 所有表必须包含 `created_at` 和 `updated_at`，由数据库 Trigger 自动维护。
