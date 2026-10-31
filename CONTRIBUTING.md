# 参与贡献

欢迎提交问题报告和改进。较大的功能或接口变更建议先提交 Issue，说明使用场景和方案，方便协调。

开发环境需要 Node.js 24、pnpm 10 和 `global.json` 指定的 .NET SDK。启动和配置方法见 [README](README.md)。提交前请运行：

```sh
cd web
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ..
dotnet test Classight.slnx
```

提交 PR 时请说明问题、改动和验证结果。功能涉及接口时同步更新 `docs/` 中的契约；插件还应说明权限、启停和迁移行为。界面改动请检查中英文、键盘和窄屏使用。

请勿提交真实班级资料、数据库、服务商密钥、访问令牌或个人信息。安全问题请按 [SECURITY.md](SECURITY.md) 报告。
