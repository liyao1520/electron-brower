import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, ConfigProvider, Modal, Progress, Space, Tag, Typography } from 'antd'
import zhCN from 'antd/locale/zh_CN'
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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 12,
          fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
        }
      }}
    >
      <main className="update-page">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">e</span>
            <Typography.Text strong>ebrower</Typography.Text>
          </div>
          <Tag bordered={false}>GitHub Releases</Tag>
        </header>
        <section className="update-content">
          <Typography.Text className="eyebrow">应用设置</Typography.Text>
          <Typography.Title level={1}>软件更新</Typography.Title>
          <Typography.Paragraph type="secondary" className="page-description">
            检查新版本，获取最新功能与修复。
          </Typography.Paragraph>
          <Card className="update-card">
            <div className="version-row">
              <div>
                <Typography.Text type="secondary">当前版本</Typography.Text>
                <Typography.Title level={2} className="version-number">
                  {state ? `v${state.currentVersion}` : '—'}
                </Typography.Title>
              </div>
              <Tag
                color={
                  status === 'error' ? 'error' : status === 'not-available' ? 'success' : 'blue'
                }
              >
                {status ? statusLabels[status] : '正在连接'}
              </Tag>
            </div>
            <div className="update-details" aria-live="polite">
              {connectionError && <Alert type="error" showIcon title={connectionError} />}
              {state?.message && (
                <Alert
                  type={status === 'error' ? 'error' : 'info'}
                  showIcon
                  title={status === 'error' ? '暂时无法完成更新' : '更新提示'}
                  description={state.message}
                />
              )}
              {status === 'idle' && (
                <Typography.Paragraph type="secondary">
                  点击下方按钮检查可用更新。
                </Typography.Paragraph>
              )}
              {status === 'checking' && (
                <Typography.Paragraph>正在查询 GitHub Releases…</Typography.Paragraph>
              )}
              {status === 'not-available' && (
                <Alert type="success" showIcon title="当前已是最新版本。" />
              )}
              {state?.latestVersion && (
                <div className="release-info">
                  <Typography.Text strong>新版本 v{state.latestVersion}</Typography.Text>
                  {state.releaseNotes && <p className="release-notes">{state.releaseNotes}</p>}
                </div>
              )}
              {status === 'downloading' && (
                <div>
                  <Progress percent={Number((progress?.percent || 0).toFixed(1))} />
                  <div className="download-metrics">
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
                <Alert
                  type="success"
                  showIcon
                  title="更新已准备就绪"
                  description={
                    state?.canInstall
                      ? '保存当前工作后，点击重启并安装以完成更新。'
                      : '开发模式可验证检查与下载，请使用安装版验证安装流程。'
                  }
                />
              )}
              {status === 'installing' && (
                <Alert type="info" showIcon title="应用即将退出并安装更新…" />
              )}
            </div>
            <Space wrap className="update-actions">
              <Button
                type={canDownload || status === 'downloaded' ? 'default' : 'primary'}
                disabled={!canCheck}
                loading={status === 'checking'}
                onClick={() => void run('check')}
              >
                检查更新
              </Button>
              {(canDownload || status === 'downloading') && (
                <Button
                  type="primary"
                  disabled={busy}
                  loading={status === 'downloading'}
                  onClick={() => void run('download')}
                >
                  {status === 'downloading'
                    ? '正在下载'
                    : state?.failedAction === 'download'
                      ? '重新下载'
                      : '下载更新'}
                </Button>
              )}
              {(status === 'downloaded' || status === 'installing') && (
                <Button
                  type="primary"
                  disabled={busy || !state?.canInstall}
                  loading={status === 'installing'}
                  onClick={() => setConfirmInstall(true)}
                >
                  重启并安装
                </Button>
              )}
            </Space>
          </Card>
          <Typography.Paragraph type="secondary" className="update-footer">
            更新由 GitHub Releases 提供。下载和重启安装均由你确认。
          </Typography.Paragraph>
        </section>
        <Modal
          title="重启并安装更新"
          open={confirmInstall}
          okText="重启并安装"
          cancelText="稍后"
          onCancel={() => setConfirmInstall(false)}
          onOk={() => {
            setConfirmInstall(false)
            void run('install')
          }}
        >
          <Typography.Paragraph>
            应用将关闭并安装 v{state?.latestVersion}。请先保存当前工作。
          </Typography.Paragraph>
        </Modal>
      </main>
    </ConfigProvider>
  )
}

export default App
