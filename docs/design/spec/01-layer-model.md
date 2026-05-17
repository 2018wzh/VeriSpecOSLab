# Spec 分层模型

## 1. 本地与云端边界

本地仓库中的 `spec/` 只保存项目设计真相。

云端服务保存：

- 课程规则
- 隐藏验证规则
- 平台派生风险模型
- staff-only 评分控制信息

因此逻辑上有三层：

```text
Local Project Spec
Cloud Course / Hidden Spec
Derived Runtime Spec
```

## 2. 本地 Spec 的七层模型

### 2.1 Architecture Layer

回答：

- 系统目标是什么
- 参考了哪些系统
- 当前阶段采用哪些机制
- 哪些内容明确不是目标

### 2.2 Module Layer

回答：

- 一个模块管理哪些状态
- 提供哪些接口族
- 模块级不变量是什么
- 和其他模块的接口边界是什么

### 2.3 Operation Layer

回答：

- 某个操作可在什么条件下调用
- 读取和修改哪些状态
- 保证哪些效果
- 在失败时返回什么
- 要满足哪些锁、原子性、权限和测试义务

### 2.4 Composition Layer

回答：

- 多个模块组合后有哪些跨组件不变量
- 某一机制不能绕过另一机制的哪些边界

### 2.5 Evolution Layer

回答：

- 设计为什么变化
- 哪些模块和操作受影响
- 哪些回归测试必须重跑

### 2.6 Toolchain Layer

回答：

- 如何从源码得到 kernel / image / artifact
- 哪些构建约束属于系统语义的一部分
- 哪些 QEMU / linker / ABI 假设必须被工具遵守

### 2.7 Verification Layer

回答：

- 每条 Spec 至少需要哪些公开验证
- 哪些证据应被收集
- 哪些结果会进入报告和评分映射

## 3. 各层依赖关系

```text
Architecture
  -> Module
  -> Composition

Module
  -> Operation

Architecture / Module / Operation
  -> Verification

Architecture / Module / Operation
  -> Toolchain Binding

Any structural change
  -> Evolution / SpecPatch
```

## 4. StageGate 约束

推荐采用以下门禁：

1. 没有对应 `ArchitectureSlice`，不得引入新核心模块。
2. 没有 `ModuleSpec`，不得生成该模块核心实现。
3. 没有 `OperationContract`，不得修改核心函数。
4. 没有 `CompositionSpec`，不得合并跨模块机制。
5. 没有 `SpecPatch`，不得引入架构级变化。
6. 没有 `test_obligations`，不得进入 `verify patch`。
