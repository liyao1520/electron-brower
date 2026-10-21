export type AppRequests = {
  'app:getVersion': () => string
}

export type WindowRequests = {
  'window:updateSize': (width: number, height: number) => void
}

/** 主进程生成的稳定业务 ID，不直接使用 webContents.id。 */
export type TabId = string

export type TabNavigationError = {
  code: number
  message: string
  url: string
}

export type TabLoadState =
  | { status: 'idle' | 'loading' | 'ready' }
  | { status: 'failed'; error: TabNavigationError }
  | { status: 'crashed'; reason: string }

/** 可通过 IPC 传输的标签状态，不包含 WebContentsView 等主进程对象。 */
export type TabState = {
  id: TabId
  workspaceId: string
  /** 当前主框架 URL，随重定向及页面内导航更新。 */
  url: string
  title: string
  faviconUrl: string | null
  load: TabLoadState
  canGoBack: boolean
  canGoForward: boolean
}

export type TabSnapshot = {
  /** 当前窗口内单调递增；忽略较旧的查询响应或事件，避免状态回退。 */
  revision: number
  /** 当前窗口的标签，数组顺序即标签栏顺序。 */
  tabs: TabState[]
  /** 非空时必须指向 tabs 中的标签；没有标签时为 null。 */
  activeTabId: TabId | null
}

export type CreateTabOptions = {
  /** URL 或搜索词；省略时使用配置的新标签页。 */
  input?: string
  /** 省略时使用当前工作空间，分区由主进程决定。 */
  workspaceId?: string
  /** 默认 true；空窗口创建首个标签时始终激活。 */
  active?: boolean
  /** 从 0 开始的插入位置，合法范围为 0..tabs.length；省略时追加。 */
  index?: number
}

export type ReloadTabOptions = {
  /** 默认 false；为 true 时忽略缓存刷新。 */
  ignoreCache?: boolean
}

/**
 * 所有操作限定在调用方所属窗口，主进程校验参数、工作空间和目标标签。
 * 无效参数、不存在或无权访问的标签使 invoke reject。
 * 返回值表示操作已处理；导航操作不等待网页加载完成，后续状态通过事件同步。
 * 此处声明业务返回类型，TypedIpcRenderer.invoke 会统一包装为 Promise。
 */
export type TabRequests = {
  'tab:getState': () => TabSnapshot
  'tab:create': (options?: CreateTabOptions) => TabState
  'tab:activate': (tabId: TabId) => void
  /** true 表示已关闭；false 表示用户取消关闭（例如未保存表单提示）。 */
  'tab:close': (tabId: TabId) => boolean
  /** toIndex 为移动后的最终下标，合法范围为 0..tabs.length - 1。 */
  'tab:move': (tabId: TabId, toIndex: number) => void
  /** 恢复并激活当前工作空间最近关闭的普通标签；无记录或临时空间返回 null。 */
  'tab:restoreClosed': () => TabState | null
  /** 主进程统一解析 URL、补全协议或转换搜索词。 */
  'tab:navigate': (tabId: TabId, input: string) => void
  /** 无可后退的历史时不执行操作。 */
  'tab:goBack': (tabId: TabId) => void
  /** 无可前进的历史时不执行操作。 */
  'tab:goForward': (tabId: TabId) => void
  'tab:reload': (tabId: TabId, options?: ReloadTabOptions) => void
  /** 未在加载时不执行操作；主动停止不应记为导航失败。 */
  'tab:stop': (tabId: TabId) => void
}

export type TabEvents = {
  /**
   * 仅向所属窗口发送完整快照，覆盖增删、排序、激活及页面状态变化。
   * renderer 先订阅再 getState，并按 revision 丢弃旧快照。
   */
  'tab:stateChanged': (snapshot: TabSnapshot) => void
}

export type IpcRequests = AppRequests & WindowRequests & TabRequests

// 按实际业务添加事件，函数参数表示消息载荷；事件没有返回值。
export type RendererToMainEvents = Record<never, never>
export type MainToRendererEvents = TabEvents
