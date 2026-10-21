import { appRouter } from './routers/app'
import { windowRouter } from './routers/window'

export function registerIpcRouters(): void {
  appRouter.register()
  windowRouter.register()
}
