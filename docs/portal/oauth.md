# OAuth 2.0 登录

VOS Portal 支持标准 OAuth 2.0 Authorization Code + PKCE。OAuth 2.0 与 OIDC 分开配置：
OAuth 不产生 ID Token，Portal 会使用 access token 调用已配置的 HTTPS UserInfo endpoint，
再根据映射后的 subject、用户名、显示名和角色创建或更新 Portal 账户。

## 管理员配置

管理员在“系统与身份认证管理 → OAuth 2.0 Provider”中填写：

- issuer（仅用于身份提供方审计与账户绑定）；
- authorization、token、userinfo 三个 HTTPS endpoint；
- client ID 与 client secret；
- scope、subject claim、username/display-name claim；
- 可选 role claim 与 `teacher`、`ta`、`student` 映射；
- 至少 10 个字符的审计理由。

Client secret 只以 Portal 主密钥包封后的密文保存，API summary、日志和前端列表不会返回
secret。管理员保存后应在提供方注册精确的回调地址：

```text
https://<portal-origin>/api/v1/auth/oauth/<provider-id>/callback
```

Provider 必须使用 HTTPS；Portal 不接受 OAuth 密码模式、隐式模式或前端直存 token。OAuth
登录按钮只在启用的 Provider 存在时显示，回调成功后使用 HttpOnly `vos_session` 与同源
CSRF cookie 建立 Portal Web 会话。

## 安全边界

- 每次登录生成一次性 state、PKCE `S256` verifier/challenge，state 仅保存哈希，10 分钟
  过期且成功回调后立即消费；重复回调失败。
- OAuth token 只存在服务端短生命周期请求内，不写入数据库、cookie、日志或审计 payload。
- UserInfo 请求固定使用 HTTPS 和 `Authorization: Bearer`；缺失 subject、非对象响应、非
  2xx 状态或配置端点不安全时直接失败。
- 账户唯一绑定为 `(issuer, subject)`。同名本地账户不会被覆盖，而是使用稳定后缀避免
  身份碰撞；角色只允许映射为教师、助教或学生，不能通过 OAuth 提升为管理员。
- OAuth 与 OIDC provider 使用独立 API 命名空间和审计动作；Demo 永远不保存或模拟 OAuth
  凭据。

## 验证

```sh
bun run --cwd apps/vos-portal typecheck
bun test apps/vos-portal/tests/contracts.test.ts apps/vos-portal/tests/oauth.integration.test.ts
```

`oauth.integration.test.ts` 需要显式设置 `PORTAL_TEST_DATABASE_URL`，并使用受控 HTTPS
transport 验证密文不回显、PKCE、UserInfo 映射和一次性 state。没有该环境变量时测试会
明确跳过，不把跳过结果当作 connected 证据。
