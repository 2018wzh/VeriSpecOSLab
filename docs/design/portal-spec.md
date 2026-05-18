# VeriSpecOSLab Portal 详细设计文档 (v1.1)

本设计文档旨在细化 VeriSpecOSLab 教学实验门户的实现细节，涵盖数据库、API、前端架构及评测业务流程。

## 1. 总体架构
*   **Backend**: Rust (Axum) + SQLx (PostgreSQL) + Redis (Session/Cache)
*   **Frontend**: React + TypeScript + Vite + Shadcn/UI + TailwindCSS
*   **Integration**: 通过 Webhook 接收 Gitea 事件，通过本地库调用 `vos-core` 解析证据。

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

### 3.2 学生端接口
*   `GET /api/v1/projects`: 获取当前学生的所有实验项目
*   `GET /api/v1/projects/{id}`: 获取项目详情（含进度、评分摘要）
*   `GET /api/v1/projects/{id}/pipelines`: 获取项目流水线历史
*   `GET /api/v1/projects/{id}/evidence`: 获取指定流水线的详细证据

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

---

## 4. 前端视图设计 (UI/UX)

### 4.1 学生主页 (Dashboard)
*   **状态概览**: 显示当前实验名称、当前阶段、最后一次提交的通过情况。
*   **评分摘要**: 实时显示当前已获得的自动评分与总分。

### 4.2 架构浏览器 (Architecture View)
*   读取 `spec/architecture/*.yaml`，渲染架构树与不变量约定。

### 4.3 证据大屏 (Evidence View)
*   可视化展示测试用例结果、QEMU 串口日志、不变量验证证据。

### 4.4 评测仪表盘 (Evaluation Dashboard - Teacher)
*   **成绩分布**: 全班成绩分布直方图。
*   **异常监控**: 标记“证据缺失”、“性能突变”或“AI 协作异常”的项目。
*   **批量打分**: 支持对满足特定证据条件的学生进行批量评分。

---

## 5. 核心业务流程：证据采集闭环
1.  **触发**: 学生执行 `git push`。
2.  **验证**: Gitea Actions 运行 `vos verify`。
3.  **上报**: Runner 上报 `report.json` 至后端。
4.  **同步**: 后端更新流水线状态与证据表。

---

## 6. 核心业务流程：自动评测闭环
1.  **匹配**: 当新证据入库时，后台任务扫描 `evaluation_rubrics` 表。
2.  **计算**: 根据证据的 `result` 和 `data`，匹配对应的 `rubric`，计算 `auto_score`。
3.  **持久化**: 更新 `scores` 表，若成绩已冻结（`is_final=true`）则忽略自动更新。
4.  **教师干预**: 教师查看证据，通过 `manual_score` 修正系统误差。

---

## 7. 后续扩展点 (待细化)
*   **WebSocket 实时通知**: 实时推送 CI 进度与评分变化。
*   **OSS 日志存储**: 大容量 Log 文件的托管。
*   **RBAC 细粒度权限**: 区分助教与教师权限。
