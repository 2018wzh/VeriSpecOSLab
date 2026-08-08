# Lab 10：公开验证与提交

`vos verify` 不调用模型，固定执行 spec check、build、全部 public tests 和 contract checks。脏树可以开发，但 verify、自动提交和权威 evidence 必须 clean HEAD。

```sh
vos verify
vos report
vos submit
```

报告从 commits、Spec IDs、测试、日志和 evidence 确定性生成到 `.vos/report.json`。提交归档绑定 commit/spec/config hashes；导出日志遮蔽凭据并把绝对路径替换为稳定别名。fuzz、trace、hidden tests 和评分服务延后到 Judge 阶段。
