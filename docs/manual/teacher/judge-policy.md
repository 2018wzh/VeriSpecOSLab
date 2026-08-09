# Judge 边界

学生本地公开确定性的 spec lint、build、public、contract、固定种子 fuzz 和有界 trace/oracle 门禁。本地 hidden tests 由 `vos agent implement` 生成，学生可以读取，只有显式 `vos verify --hidden` 才执行；它们不构成保密边界。风险评分、真正的课程 hidden tests 和硬件自动评分仍留给未来 Judge。
