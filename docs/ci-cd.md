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

使用 master 分支时替换示例中的 main。当前版本为 1.0.0，首次发布可直接打 `v1.0.0` 标签。

- 正式版：`1.0.1` 对应 `v1.0.1`，生成 `latest.yml`。
- 预发布：如 `1.1.0-beta.1` 对应 `v1.1.0-beta.1`，生成对应渠道元数据并标记为 prerelease；同样支持 alpha、rc。
- 标签与版本号不一致时构建失败；已公开发布的版本不会被覆盖，修复需提高版本号。
- 上传失败会保留草稿，修复后重新运行失败工作流可继续上传并发布。
- Actions 中可下载保存 14 天的安装包产物；Release 附件包含安装包、blockmap 和更新元数据，不包含源码目录或 builder 调试配置。

## 自动更新与签名

CI 在 runner 临时目录生成打包配置，将更新源设置为当前 GitHub 仓库，无需手写 owner/repo。本地 `electron-builder.yml` 和 `dev-app-update.yml` 已配置为 `liyao1520/electron-brower`；更换仓库时需同步修改这两处及 `package.json` 的 `repository`。

应用的“软件更新”页面通过主进程的 electron-updater 检查 GitHub Releases。点击“检查更新”后，如有新版本，再点击“下载更新”；下载进度、速度和失败信息会同步到页面。下载完成后，点击“重启并安装”并确认即可退出、安装和重新启动。关闭应用不会自动安装，重复点击不会启动重复任务。

公开仓库适合直接分发；私有仓库需要另行设计客户端更新鉴权，不要把发布 token 打进安装包。未发布 Release 或附件缺失时，页面显示错误并允许重试。

开发模式默认禁用更新。需要测试检查和下载时，在 PowerShell 中执行：

```powershell
$env:ELECTRON_UPDATER_DEV = 'true'
pnpm dev
```

调试时仍禁止安装，避免退出开发进程启动安装器。完整更新验收请安装旧版（例如 1.0.0），发布包含安装包、blockmap、latest.yml 的新版（例如 1.0.1），然后在旧版中依次检查、下载、重启安装，确认版本变为新版。首次发布 1.0.0 后，1.0.0 的检查结果应为“已是最新版本”。

`pnpm test` 验证更新状态切换、并发防护、失败重试、开发模式限制及安装调用；CI 同样执行这些测试。

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
