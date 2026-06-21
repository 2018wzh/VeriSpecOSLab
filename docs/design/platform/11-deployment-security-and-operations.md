# 11 Deployment Security And Operations

回答的问题：

- 平台如何部署
- 安全隔离、凭证管理、日志保留和故障恢复如何设计
- 单机、课程服务器、集群三种模式如何取舍

上游依赖文档：

- [02-system-architecture.md](./02-system-architecture.md)
- [07-judge-and-sandbox.md](./07-judge-and-sandbox.md)

下游消费者：

- DevOps
- Security
- 运维监控

## 1. 部署模式

### 1.1 单机教学部署

适用于小班或原型：

```text
portal
backend
spec-service
gitea
postgres
redis
minio
runner
judge
agent-gateway
```

要求：

- 资源简单
- 并发低
- 隔离有限但可控

### 1.2 课程服务器部署

适用于常规课程：

- 中央后端与 Git/Spec/Artifact 服务
- 每个学生或每批任务独立 workspace/runner
- 集中模型接入与审计

### 1.3 集群部署

适用于大班或多课程：

- 后端服务水平扩展
- 独立 pipeline / judge / workspace pool
- 对象存储、队列、监控和日志服务独立部署

## 2. 服务依赖

最低依赖：

- PostgreSQL
- Redis 或消息队列
- 对象存储
- Git 服务
- Runner 资源池
- 本地 `vos-agent` 可使用的模型网关或 provider 配置

## 3. 安全控制点

### 3.1 身份与凭证

- 用户身份与服务身份分离
- Runner 不持久保存长期密钥
- 访问对象存储使用短期签名或受限服务账号

### 3.2 隔离

- workspace 按项目隔离
- judge 任务按提交隔离
- hidden tests 仅在受控环境挂载
- 默认禁止任务访问课程内网

### 3.3 审计

必须记录：

- 登录与权限变更
- 规则发布
- 项目创建与冻结
- Agent 工具调用
- Pipeline / Judge 调度
- 人工评分 override

### 3.4 资源限制

- CPU、内存、磁盘、网络和运行时间配额
- Artifact 大小限制
- 并发配额

## 4. 日志与保留

至少区分：

- 业务审计日志
- 运行日志
- 安全日志
- artifact 索引

保留策略：

- 成绩与申诉相关证据保留到课程结束后指定窗口
- 可重建的临时构建缓存可较早淘汰

## 5. 故障恢复

需要支持：

- 数据库备份与恢复
- 对象存储一致性校验
- 任务队列恢复
- 项目供应重试
- 评测重跑但保留原记录

## 6. 失败模式与约束

- 不允许单点 Runner 持有全部隐藏测试。
- 不允许长期共享 workspace 导致项目串扰。
- 不允许无审计的人工改分。

## 7. VeriSpecOSLab 特化说明

VeriSpecOSLab 在运维侧额外需要：

- `QEMU` / `KVM` 能力节点
- 可能的硬件板卡预约和串口采集设施
- 更高的磁盘与日志配额以容纳镜像和 trace

## 8. 后续扩展点

- 多地域部署
- 机密计算或更强隔离 Runner
- 安全事件自动化处置
