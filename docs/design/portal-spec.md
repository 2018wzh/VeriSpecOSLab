# VeriSpecOSLab Portal 详细设计文档 (v1.1)

本设计文档旨在细化 VeriSpecOSLab 教学实验门户的实现细节，涵盖数据库、API、前端架构及评测业务流程。

## 1. 总体架构
*   **Backend**: 独立 Portal API / platform backend + optional PostgreSQL / Redis adapters
*   **Frontend**: React + TypeScript + Vite + Shadcn/UI + TailwindCSS
*   **Integration**: 通过 Webhook 接收 Git 事件，通过 sandbox runner 启动 `vos serve` 或受控 `vos` runtime，接收 `vos` 上传的结构化摘要、manifest、evidence、report、KB source manifest 和 artifact/object 引用。

Portal 是课程控制面，不是实验 repo runtime。它不直接执行 QEMU、不解析
`ToolchainSpec`、不读取本地 `spec/` 语义、不调用 workspace tools。所有与
实验 checkout 相关的 build/run/test/verify、Agent 执行、patch gate 和本地
evidence 生成都由 `vos-cli` / `vos-agent` 在 runner 或本地 workspace 内完成。
Portal 可提供 Q&A 页面，但只作为 `vos agent ask` 的 runner/控制面入口和
thread/object/audit 存储，不直接承载 workspace Agent 工具执行。

---

## 2. 数据库 Schema 设计 (核心表)

### 2.1 用户与权限 (Users & Auth)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role VARCHAR(20) NOT NULL, -- 'admin', 'teacher', 'student'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 课程与实验 (Courses & Experiments)
```sql
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL, -- e.g., 'CS101-2024'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id),
    title TEXT NOT NULL,
    description TEXT,
    base_repo_url TEXT, -- 模板仓库地址
    config JSONB, -- 实验配置，如阶段定义
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 学生项目与进度 (Student Projects)
```sql
CREATE TABLE student_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    experiment_id UUID REFERENCES experiments(id),
    repo_url TEXT NOT NULL,
    current_stage TEXT DEFAULT 'boot',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 证据与流水线 (Pipelines & Evidence)
```sql
CREATE TABLE pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES student_projects(id),
    commit_sha TEXT NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'running', 'passed', 'failed'
    trigger_type TEXT NOT NULL, -- 'push', 'manual'
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_run_id UUID REFERENCES pipeline_runs(id),
    kind TEXT NOT NULL, -- 'test', 'benchmark', 'invariant'
    suite TEXT NOT NULL,
    case_name TEXT NOT NULL,
    result TEXT NOT NULL, -- 'pass', 'fail'
    data JSONB, -- 详细指标或错误信息
    log_uri TEXT, -- 指向 OSS 或本地存储的日志文件
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4.1 对象存储与知识库引用
```sql
CREATE TABLE object_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES student_projects(id),
    uri TEXT NOT NULL, -- s3://bucket/key 或等价对象存储 URI
    sha256 TEXT NOT NULL,
    content_type TEXT,
    size_bytes BIGINT,
    visibility TEXT NOT NULL DEFAULT 'student',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kb_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES student_projects(id),
    source_kind TEXT NOT NULL, -- course, project, external
    title TEXT NOT NULL,
    object_ref_id UUID REFERENCES object_refs(id),
    source_url TEXT,
    stage_scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.5 评测与评分 (Judging & Scoring)
```sql
-- 评分准则表
CREATE TABLE evaluation_rubrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID REFERENCES experiments(id),
    name TEXT NOT NULL, -- e.g., '基础正确性', '并发不变量'
    target_kind TEXT NOT NULL, -- 对应的证据类型：test, benchmark, invariant
    target_suite TEXT,
    target_case TEXT,
    weight FLOAT NOT NULL, -- 分值或权重
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 最终成绩表
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES student_projects(id),
    rubric_id UUID REFERENCES evaluation_rubrics(id),
    manual_score FLOAT, -- 教师手动调整后的分数
    auto_score FLOAT,   -- 系统自动计算的分数
    feedback TEXT,      -- 评语
    is_final BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, rubric_id)
);
```

---

## 3. API 接口定义

### 3.1 认证接口
*   `POST /api/v1/auth/login`: 用户登录
*   `POST /api/v1/auth/logout`: 用户登出
*   `GET /api/v1/auth/me`: 获取当前用户信息
*   `GET /api/v1/projects/{id}/vos-policy`: 获取当前用户、项目、阶段绑定的 `vos` policy snapshot

### 3.2 学生端接口
*   `GET /api/v1/projects`: 获取当前学生的所有实验项目
*   `GET /api/v1/projects/{id}`: 获取项目详情（含进度、评分摘要）
*   `GET /api/v1/projects/{id}/pipelines`: 获取项目流水线历史
*   `GET /api/v1/projects/{id}/evidence`: 获取指定流水线的详细证据
*   `GET /api/v1/projects/{id}/qa-threads`: 获取 stage 绑定问答线程
*   `POST /api/v1/projects/{id}/qa-threads`: 创建或追加问答；后端调度 runner 内 `vos agent ask`
*   `GET /api/v1/projects/{id}/kb-sources`: 获取学生可见 KB source refs
*   `GET /api/v1/projects/{id}/objects/manifest`: 获取 runner replay 所需 object manifest
*   `POST /api/v1/projects/{id}/objects/presign`: 为课程材料、web snapshot 或学生本地 KB 附件创建对象上传地址

### 3.3 教师端接口
*   `GET /api/v1/teacher/courses`: 获取管理的课程
*   `GET /api/v1/teacher/experiments/{id}/students`: 查看该实验所有学生的进度矩阵
*   `GET /api/v1/teacher/projects/{id}/scores`: 查看学生各评分项详情
*   `POST /api/v1/teacher/projects/{id}/grade`: 手动修正分数、填写评语或冻结成绩

### 3.4 评测准则接口 (Teacher Only)
*   `GET /api/v1/teacher/experiments/{id}/rubrics`: 获取实验评分准则
*   `POST /api/v1/teacher/experiments/{id}/rubrics`: 创建/更新评分准则
*   `POST /api/v1/teacher/experiments/{id}/judge`: 触发全量或增量自动评测计算

### 3.5 系统集成接口 (Internal/Webhook)
*   `POST /api/v1/webhooks/gitea`: 接收 Gitea 的 Push 事件，触发后端同步
*   `POST /api/v1/internal/evidence`: 供 CI Runner 调用，上报证据 JSON
*   `POST /api/v1/internal/objects`: 供 Runner 上报 object manifest / KB source manifest
*   `POST /api/v1/internal/agent-audit`: 供 Runner 上报 `knowledgebase.v1` 等 Agent 审计摘要

---

## 4. 前端视图设计 (UI/UX)

### 4.1 学生主页 (Dashboard)
*   **状态概览**: 显示当前实验名称、当前阶段、最后一次提交的通过情况。
*   **评分摘要**: 实时显示当前已获得的自动评分与总分。

### 4.2 架构浏览器 (Architecture View)
*   读取 runner / `vos report generate` 产出的结构化架构摘要、public summary 和 evidence refs，渲染架构树与不变量约定。

### 4.3 证据大屏 (Evidence View)
*   可视化展示测试用例结果、QEMU 串口日志、不变量验证证据。

### 4.4 问答页面 (Q&A View)
*   以当前 project/stage 为默认上下文，提供学生设计问答。
*   显示 `knowledgebase.v1` 回答、citation、source/object refs 和建议 next steps。
*   支持把问答 turn 标记为设计证据，关联到 DesignSubmission 或 stage review。
*   显示对象存储中的课程手册、web snapshot、项目 KB source 清单。

### 4.5 评测仪表盘 (Evaluation Dashboard - Teacher)
*   **成绩分布**: 全班成绩分布直方图。
*   **异常监控**: 标记“证据缺失”、“性能突变”或“AI 协作异常”的项目。
*   **批量打分**: 支持对满足特定证据条件的学生进行批量评分。

---

## 5. 核心业务流程：证据采集闭环
1.  **触发**: 学生执行 `git push`。
2.  **绑定**: 平台为提交生成 project / stage / policy snapshot，并分配 sandbox runner。
3.  **验证**: Runner checkout 提交后启动 `vos serve` 或运行 authenticated `vos` 命令。
4.  **上报**: Runner 上报 `vos` 生成的 report、manifest、evidence 和 artifact 引用。
5.  **同步**: 后端更新流水线状态与证据表。

Runner 复现 Q&A 时，Portal 下发 object manifest；runner 在 checkout 后恢复到
`.vos/kb/`，再运行 `vos agent ask`。Portal 只保存对象引用和审计摘要。

v1 的对象存储是本地 S3-shape backend：manifest 保持 `s3://...` URI、
sha256、content type、size、visibility，并在本地测试/runner replay 中携带可校验
content snapshot。真实 S3/OSS 后端只替换上传、下载和 presign adapter，不改变
`object_refs`、`kb_sources` 或 runner manifest 形状。

---

## 6. 核心业务流程：自动评测闭环
1.  **匹配**: 当新证据入库时，后台任务扫描 `evaluation_rubrics` 表。
2.  **计算**: 根据证据的 `result` 和 `data`，匹配对应的 `rubric`，计算 `auto_score`。
3.  **持久化**: 更新 `scores` 表，若成绩已冻结（`is_final=true`）则忽略自动更新。
4.  **教师干预**: 教师查看证据，通过 `manual_score` 修正系统误差。

---

## 7. 后续扩展点 (待细化)
*   **WebSocket 实时通知**: 实时推送 CI 进度与评分变化。
*   **OSS / S3-compatible 对象存储**: 大容量 Log、KB source、web snapshot、report 与 runner replay manifest 的托管。
*   **RBAC 细粒度权限**: 区分助教与教师权限。
