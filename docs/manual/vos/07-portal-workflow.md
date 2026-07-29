# 07 Portal 在线实验工作流

## 登录与绑定

```sh
vos login --portal-url https://portal.example.edu
```

CLI 显示验证地址和八位设备代码。浏览器登录 Portal 后打开 `/device`，核对并
批准代码。CLI token 有效期有限且可撤销；不会写入项目目录。本地凭据文件使用
AES-256-GCM 加密，随机密钥保存在操作系统凭据管理器（Windows Credential
Manager、macOS Keychain 或 Linux Secret Service）中。凭据管理器不可用时登录明确
失败，不会降级为同目录密钥文件。旧版同目录密钥会在首次成功访问时迁入系统凭据
管理器并删除。`VOS_AUTH_STORE` 仅用于隔离测试和自动化夹具，会显式启用临时文件密钥
后端，不是交互式 CLI 的生产配置。

```sh
vos project bind --portal-url https://portal.example.edu --project-id project-1
vos whoami
```

绑定会更新 `.vos/project.yaml`。应检查改动并提交，使远端 project、当前 HEAD、
commit ledger 和策略快照能够形成可审计证据链。

## 提交与跟踪

提交前必须满足 clean-tree、当前 HEAD 已记录 commit ledger、在线策略未过期：

```sh
vos pipeline trigger --scope public --reason "submit memory stage public evidence"
vos pipeline status run-123
vos pipeline watch run-123
vos pipeline evidence run-123
vos pipeline download run-123
vos pipeline reproduce run-123
```

`watch` 使用 Portal SSE 事件流直到终态，以事件 sequence 续传并去重；连接提前中断时
执行最多五次有界退避重连，认证失败或重连耗尽会明确失败，不会自动退回本地运行。
`download` 只下载当前身份可见的产物，在写入
`.vos/downloads/<run-id>` 前后校验服务端授权、字节数和 SHA-256；可用 `--out` 指定
目录。`reproduce` 返回不可变 commit、策略快照、runner image、执行命令和可见产物
checksum，不会声称本地环境已经等价复现。

课程允许 BYOK 且 provider 在已发布模型白名单中时，可在触发时绑定已保存的凭据：

```sh
vos pipeline trigger --scope public --model-credential credential-1 \
  --reason "submit memory stage with approved course model"
```

CLI 不读取或回显模型密钥。Portal 仅向持有有效 pipeline 租约的 worker 创建短期解封
租约，runner 通过权限受限的临时文件读取，租约到期、运行结束、撤销或 worker 恢复时销毁。

取消必须提供可审计理由：

```sh
vos pipeline cancel run-123 --reason "superseded by corrected commit"
```

退出会先请求服务端撤销当前 token，再删除本地记录：

```sh
vos logout
```
