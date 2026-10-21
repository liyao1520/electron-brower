# GitHub CI/CD

当前交付 Windows x64 NSIS 安装包，后续再增加其他平台。

## 工作流

| 文件                            | 触发方式                       | 行为                                                                                 |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`      | PR、推送 main/master、手动运行 | 安装锁定依赖 → lint → 类型检查与构建 → 打包 → 上传 Actions 产物                      |
| `.github/workflows/release.yml` | 推送版本标签                   | 校验标签与 package.json 版本 → 执行相同构建 → 创建草稿 → 上传全部产物 → 发布 Release |
| `.github/workflows/build.yml`   | 由上述工作流调用               | 统一 Windows 构建过程                                                                |

Node.js 版本由 `.node-version` 固定，pnpm 版本由 package.json 的 `packageManager` 固定。Action 使用提交 SHA 固定，由 Dependabot 提交更新。

## 首次启用

1. 将项目提交并推送到 GitHub 仓库，确保 `.github`、配置文件和 `pnpm-lock.yaml` 一并提交。
2. 在仓库 Actions 中确认工作流可运行；组织策略需要允许发布任务使用 `contents: write`。
3. 合并目标分支为 main/master 时自动执行 CI；其他长期分支可修改 `ci.yml`。
4. 在分支保护中将 CI 的 Windows 构建检查设为必需检查。

同仓库发布使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需配置 PAT。

## 发布版本

先在 package.json 修改版本并提交，通过 CI 后推送对应标签。例如发布下一版：

```bash
pnpm version 1.0.1 --no-git-tag-version
git add package.json
git commit -m "chore: release 1.0.1"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

使用 master 分支时替换示例中的 main。当前版本以 `package.json` 为准，发布标签必须与它完全对应；已发布版本的修复需提高版本号后重新发布。

- 正式版：`1.0.1` 对应 `v1.0.1`。
- 预发布：如 `1.1.0-beta.1` 对应 `v1.1.0-beta.1`，标记为 prerelease；同样支持 alpha、rc。
- 标签与版本号不一致时构建失败；已公开发布的版本不会被覆盖，修复需提高版本号。
- 上传失败会保留草稿，修复后重新运行失败工作流可继续上传并发布。
- Actions 中可下载保存 14 天的安装包产物；Release 附件仅包含 Windows 安装包。

## 签名

默认构建未签名的学习版。正式签名时，在仓库 Secrets 配置：

| Secret                 | 用途                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `WIN_CSC_LINK`         | electron-builder 支持的 Windows 签名证书，如 Base64 编码的 PFX |
| `WIN_CSC_KEY_PASSWORD` | 证书密码                                                       |

签名凭据只传给版本发布构建的打包步骤，PR 构建不接收这些 Secrets。证书、私钥和密码不得提交到仓库。

## 本地检查

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm exec electron-builder --win nsis --x64 --publish never
```

本地检查只验证代码与安装包；真实 GitHub 权限、上传和发布须在仓库 Actions 中验证。

参考：[GitHub Actions Node.js 工作流](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)、[electron-builder 发布配置](https://www.electron.build/v26/docs/publish/)。
