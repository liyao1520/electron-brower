# ebrower

An Electron application with React and TypeScript

内置基于 electron-updater 的 GitHub Releases 更新功能，使用 shadcn/ui 展示检查更新、下载进度和重启安装入口。开发模式默认关闭更新；启用方式和完整安装验收步骤见 [更新说明](docs/ci-cd.md#自动更新与签名)。

## UI 组件

使用 shadcn/ui（Radix）与 Tailwind CSS，组件源码位于 `src/renderer/src/components/ui`，主题变量在 `src/renderer/src/assets/main.css` 中维护。`components.json` 已适配 Electron renderer 目录和 `@renderer` 别名。

在项目根目录按需添加组件：

```bash
pnpm dlx shadcn@latest add input dropdown-menu tooltip
```

新增组件需遵循项目的显式返回类型规则；组件工具函数统一从 `@renderer/lib/utils` 导入。

## CI/CD

GitHub Actions checks pull requests and builds Windows x64 installers. Push a version tag such as `v1.0.0` to publish a GitHub Release with update metadata.

See [CI/CD setup and release instructions](docs/ci-cd.md).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
