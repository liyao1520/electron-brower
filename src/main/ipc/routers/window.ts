import { createRouter } from '../runtime'

export const windowRouter = createRouter('window')

windowRouter.handle('window:updateSize', ({ ctx }, width, height) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('窗口宽高必须为正整数')
  }
  const win = ctx.getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
  win.setSize(width, height)
})
