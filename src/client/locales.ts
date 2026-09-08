/**
 * Minimal zh/en copy for the skills manager. The copy follows the DSH i18n
 * system: the client apply attaches the locale service (`ctx.locale`) and
 * `t()`/`isZh()` resolve the active locale from it. The dictionaries are
 * also registered into the DSH locale registry under {@link LOCALE_NS}.
 */
export const LOCALE_NS = 'dsh-skills-manager'

/** The zh dictionary (also registered into the DSH locale registry). */
export const zh = {
  panelTitle: 'Skills 管理器',
  userTab: '全局',
  projectTab: '项目级',
  libraryTab: 'Skill 库',
  emptyUser: '全局还没有任何 skill',
  emptyProject: '该项目还没有任何 skill',
  libraryEmpty: 'Skill 库还没有任何 skill',
  libraryCount: '共 {count} 个 skill',
  ops: '操作',
  rename: '重命名',
  delete: '删除',
  moveToGlobal: '移至全局',
  moveToProject: '移至项目级',
  openFolder: '打开文件夹',
  recycle: '回收',
  recycleConfirm: '仅从当前层级移除该 skill（Skill 库与其它分配位置不受影响）。确定？',
  loading: '加载中…',
  loadFailed: '加载失败',
  back: '返回',
  edit: '编辑',
  save: '保存',
  close: '关闭',
  noSession: '暂无会话，请先打开一个会话',
  deleteConfirm: '将同时删除 Skill 库原件和所有分配副本（全局、各项目），不可恢复。确定？',
  renameTo: '重命名为：',
  namePlaceholder: 'kebab-case，例如 my-skill',
  cancel: '取消',
  confirm: '确认',
  pathOf: '路径',
  wireError: '请求失败',
}

/** The en dictionary (also registered into the DSH locale registry). */
export const en: Record<string, string> = {
  panelTitle: 'Skills Manager',
  userTab: 'Global',
  projectTab: 'Project',
  libraryTab: 'Skill Library',
  emptyUser: 'No global skills yet',
  emptyProject: 'No project skills yet',
  libraryEmpty: 'The skill library is empty',
  libraryCount: '{count} skills',
  ops: 'Actions',
  rename: 'Rename',
  delete: 'Delete',
  moveToGlobal: 'Move to global',
  moveToProject: 'Move to project',
  openFolder: 'Open folder',
  recycle: 'Recycle',
  recycleConfirm: 'Remove this skill from the current level only (the library and other assignments stay). Sure?',
  loading: 'Loading…',
  loadFailed: 'Load failed',
  back: 'Back',
  edit: 'Edit',
  save: 'Save',
  close: 'Close',
  noSession: 'No active session — open a conversation first',
  deleteConfirm: 'Delete this skill everywhere (library canonical + all assigned levels)? This cannot be undone.',
  renameTo: 'Rename to:',
  namePlaceholder: 'kebab-case, e.g. my-skill',
  cancel: 'Cancel',
  confirm: 'Confirm',
  pathOf: 'Path',
  wireError: 'Request failed',
}

/** The zh/en dictionary pair keyed by locale for the client. */
export const dictionaries = { zh, en }

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/**
 * Attach (or detach, with undefined) the DSH locale service. Components keep
 * calling the plain `t()` function; the panel subscribes to locale snapshot
 * changes and re-renders on switches.
 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/** The active locale id ('zh' | 'en'): the DSH locale service's snapshot when
 *  attached, else the browser language. */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
  let text = dict[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Whether the active locale is Chinese (used for selectors). */
export function isZh(): boolean {
  return activeLocale().toLowerCase().startsWith('zh')
}

/** Resolve the active locale (zh-cn → zh). */
export function activeLocaleId(preference: string): 'zh' | 'en' {
  return preference.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
