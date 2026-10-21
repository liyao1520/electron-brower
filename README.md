# ebrower

An Electron application with React and TypeScript

## UI 组件

使用 shadcn/ui（Radix）与 Tailwind CSS，组件源码位于 `src/renderer/src/components/ui`，主题变量在 `src/renderer/src/assets/main.css` 中维护。`components.json` 已适配 Electron renderer 目录和 `@renderer` 别名。

在项目根目录按需添加组件：

```bash
pnpm dlx shadcn@latest add input dropdown-menu tooltip
```

新增组件需遵循项目的显式返回类型规则；组件工具函数统一从 `@renderer/lib/utils` 导入。

## CI/CD

GitHub Actions checks pull requests and builds Windows x64 installers. Push a version tag such as `v1.0.0` to publish the installer to GitHub Releases.

See [CI/CD setup and release instructions](docs/ci-cd.md).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Typed IPC Library

通用 IPC 能力位于独立 workspace 包 `@electron-brower/typed-ipc`。主进程从 `/main` 入口初始化 Router，preload 从 `/renderer` 入口调用；业务协议保留在 `src/shared/ipc`。

```ts
const context = { getMainWindow }
const createRouter = initIpcRouter<IpcRequests, typeof context>({ context })
const router = createRouter('window')
```

模块通过 `router.register()` 注册；需要提前停用时，调用它返回的取消函数即可。

全局中间件通过 `initIpcRouter({ context, middlewares })` 配置，模块中间件通过 `router.use(...)` 添加；执行顺序为全局、模块、handler，再逆序返回。请求保留原有返回类型，单向事件异常可通过初始化参数 `onError` 统一处理。

使用方式和生命周期约定见 [Typed IPC 文档](packages/typed-ipc/README.md)。`pnpm build:ipc` 单独构建库，`pnpm test:ipc` 运行库及业务接入测试；开发和完整构建命令会先构建库。

### Install

```bash
$ pnpm install
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
