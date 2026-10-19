import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Download, Info, LoaderCircle, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'

import type { UpdateState, UpdateStatus } from '../../shared/updater'

// 展示文案与业务状态一一对应，新增状态时 TypeScript 会提示补齐文案。
const statusLabels: Record<UpdateStatus, string> = {
  disabled: '开发模式',
  idle: '等待检查',
  checking: '正在检查',
  available: '发现新版本',
  'not-available': '已是最新版本',
  downloading: '正在下载',
  downloaded: '下载完成',
  installing: '正在安装',
  error: '更新失败'
}

/** 将主进程返回的字节数转换成下载进度和速度的易读单位。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function App(): React.JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null)
  const [connectionError, setConnectionError] = useState(() =>
    window.api?.updater ? '' : '请在 ebrower 桌面应用中使用更新功能。'
  )
  const [pending, setPending] = useState<string | null>(null)
  const [confirmInstall, setConfirmInstall] = useState(false)

  // 事件可能先于操作响应到达，丢弃旧快照，避免下载进度和按钮状态倒退。
  const acceptState = useCallback((next: UpdateState) => {
    setState((previous) => (!previous || next.revision >= previous.revision ? next : previous))
  }, [])

  // 先订阅再取快照，覆盖组件挂载期间的状态变化；卸载时释放订阅。
  useEffect(() => {
    if (!window.api?.updater) {
      return
    }
    let active = true
    const unsubscribe = window.api.updater.onState((next) => {
      if (active) acceptState(next)
    })
    window.api.updater.getState().then(
      (next) => {
        if (active) acceptState(next)
      },
      () => {
        if (active) setConnectionError('无法读取更新状态，请重启应用后重试。')
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptState])

  /** 统一管理操作中的按钮状态，并兜底处理 IPC 断连等通信错误。 */
  async function run(action: 'check' | 'download' | 'install'): Promise<void> {
    setPending(action)
    setConnectionError('')
    try {
      acceptState(await window.api.updater[action]())
    } catch {
      setConnectionError('无法执行更新操作，请重启应用后重试。')
    } finally {
      setPending(null)
    }
  }

  // 页面按钮限制用于反馈交互，主进程还会独立校验，不能只依赖页面禁用。
  const status = state?.status
  const busy =
    !!pending || status === 'checking' || status === 'downloading' || status === 'installing'
  const canCheck =
    !!state && !busy && !['disabled', 'downloaded', 'installing'].includes(state.status)
  const canDownload =
    status === 'available' || (status === 'error' && state?.failedAction === 'download')
  const progress = state?.progress

  const downloadPercent = Math.min(100, Math.max(0, Number((progress?.percent || 0).toFixed(1))))

  return (
    <main className="min-h-screen">
      <header className="flex h-[76px] items-center justify-between border-b bg-card px-5 sm:px-10">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-[34px] place-items-center rounded-[10px] bg-primary text-[25px] font-bold text-primary-foreground">
            e
          </span>
          <span>ebrower</span>
        </div>
        <Badge variant="secondary">GitHub Releases</Badge>
      </header>
      <section className="mx-auto max-w-[720px] px-4 py-8 sm:px-7 sm:py-12">
        <p className="text-xs tracking-[2px] text-muted-foreground">应用设置</p>
        <h1 className="mt-2.5 mb-2 text-[32px] font-semibold tracking-tight">软件更新</h1>
        <p className="mb-7 text-sm text-muted-foreground">检查新版本，获取最新功能与修复。</p>
        <Card className="gap-0 shadow-[0_8px_28px_#17243a05]">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">当前版本</p>
              <h2 className="mt-1.5 text-3xl font-semibold">
                {state ? `v${state.currentVersion}` : '—'}
              </h2>
            </div>
            <Badge
              variant={status === 'error' ? 'destructive' : 'secondary'}
              className={
                status === 'not-available'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : undefined
              }
            >
              {status ? statusLabels[status] : '正在连接'}
            </Badge>
          </CardHeader>
          <CardContent className="mt-6 grid gap-4 [overflow-wrap:anywhere]" aria-live="polite">
            {connectionError && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle className="line-clamp-none">{connectionError}</AlertTitle>
              </Alert>
            )}
            {state?.message && (
              <Alert variant={status === 'error' ? 'destructive' : 'default'}>
                {status === 'error' ? <CircleAlert /> : <Info />}
                <AlertTitle>{status === 'error' ? '暂时无法完成更新' : '更新提示'}</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}
            {status === 'idle' && (
              <p className="text-sm text-muted-foreground">点击下方按钮检查可用更新。</p>
            )}
            {status === 'checking' && (
              <p className="flex items-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                正在查询 GitHub Releases…
              </p>
            )}
            {status === 'not-available' && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CircleCheck />
                <AlertTitle>当前已是最新版本。</AlertTitle>
              </Alert>
            )}
            {state?.latestVersion && (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-semibold">新版本 v{state.latestVersion}</p>
                {state.releaseNotes && (
                  <p className="mt-2.5 max-h-[180px] overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {state.releaseNotes}
                  </p>
                )}
              </div>
            )}
            {status === 'downloading' && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>下载进度</span>
                  <span className="tabular-nums">{downloadPercent}%</span>
                </div>
                <Progress value={downloadPercent} aria-label="更新下载进度" />
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {progress
                      ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
                      : '正在准备下载…'}
                  </span>
                  <span>{progress ? `${formatBytes(progress.bytesPerSecond)}/s` : ''}</span>
                </div>
              </div>
            )}
            {status === 'downloaded' && (
              <Alert className="border-emerald-200 dark:border-emerald-900">
                <CircleCheck className="text-emerald-600" />
                <AlertTitle>更新已准备就绪</AlertTitle>
                <AlertDescription>
                  {state?.canInstall
                    ? '保存当前工作后，点击重启并安装以完成更新。'
                    : '开发模式可验证检查与下载，请使用安装版验证安装流程。'}
                </AlertDescription>
              </Alert>
            )}
            {status === 'installing' && (
              <Alert>
                <Info />
                <AlertTitle>应用即将退出并安装更新…</AlertTitle>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="mt-7 flex-wrap gap-2">
            <Button
              variant={canDownload || status === 'downloaded' ? 'outline' : 'default'}
              disabled={!canCheck}
              aria-busy={status === 'checking' || pending === 'check'}
              onClick={() => void run('check')}
            >
              {status === 'checking' || pending === 'check' ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              检查更新
            </Button>
            {(canDownload || status === 'downloading') && (
              <Button
                disabled={busy}
                aria-busy={status === 'downloading' || pending === 'download'}
                onClick={() => void run('download')}
              >
                {status === 'downloading' || pending === 'download' ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {status === 'downloading'
                  ? '正在下载'
                  : state?.failedAction === 'download'
                    ? '重新下载'
                    : '下载更新'}
              </Button>
            )}
            <AlertDialog open={confirmInstall} onOpenChange={setConfirmInstall}>
              {(status === 'downloaded' || status === 'installing') && (
                <AlertDialogTrigger asChild>
                  <Button disabled={busy || !state?.canInstall} aria-busy={status === 'installing'}>
                    {status === 'installing' && (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    )}
                    重启并安装
                  </Button>
                </AlertDialogTrigger>
              )}
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>重启并安装更新</AlertDialogTitle>
                  <AlertDialogDescription>
                    应用将关闭并安装 v{state?.latestVersion}。请先保存当前工作。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>稍后</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy || !state?.canInstall}
                    onClick={() => void run('install')}
                  >
                    重启并安装
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          更新由 GitHub Releases 提供。下载和重启安装均由你确认。
        </p>
      </section>
    </main>
  )
}

export default App
