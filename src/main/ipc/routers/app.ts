import { app } from 'electron'
import { createRouter } from '../runtime'

export const appRouter = createRouter('app')

appRouter.handle('app:getVersion', () => app.getVersion())
