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
  userTab: '用户级',
  projectTab: '项目级',
  emptyUser: '用户级还没有任何 skill',
  emptyProject: '该项目还没有任何 skill',
  newSkill: '新建 Skill',
  ops: '操作',
  rename: '重命名',
  delete: '删除',
  moveToProject: '移至项目级',
  moveToUser: '移至用户级',
  loading: '加载中…',
  loadFailed: '加载失败',
  back: '返回',
  edit: '编辑',
  save: '保存',
  deleteConfirm: '确定删除这个 skill 吗？该操作不可撤销。',
  renameTo: '重命名为：',
  nameLabel: '名称',
  namePlaceholder: 'kebab-case，例如 my-skill',
  descriptionLabel: '描述',
  descriptionPlaceholder: '一句话描述这个 skill 的用途',
  whenToUseLabel: '何时使用（可选）',
  whenToUsePlaceholder: '额外路由指导',
  bodyLabel: '内容（SKILL.md body）',
  bodyPlaceholder: '这里是给模型的具体指令…',
  formNameRequired: '名称不能为空',
  formDescriptionRequired: '描述不能为空',
  formNameInvalid: '名称必须是合法的 kebab-case',
  cancel: '取消',
  confirm: '确认',
  pathOf: '路径',
  wireError: '请求失败',
}

/** The en dictionary (also registered into the DSH locale registry). */
export const en: Record<string, string> = {
  panelTitle: 'Skills Manager',
  userTab: 'User',
  projectTab: 'Project',
  emptyUser: 'No user-level skills yet',
  emptyProject: 'No project skills yet',
  newSkill: 'New Skill',
  ops: 'Actions',
  rename: 'Rename',
  delete: 'Delete',
  moveToProject: 'Move to project',
  moveToUser: 'Move to user',
  loading: 'Loading…',
  loadFailed: 'Load failed',
  back: 'Back',
  edit: 'Edit',
  save: 'Save',
  deleteConfirm: 'Delete this skill? This cannot be undone.',
  renameTo: 'Rename to:',
  nameLabel: 'Name',
  namePlaceholder: 'kebab-case, e.g. my-skill',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'One sentence describing what the skill does',
  whenToUseLabel: 'When to use (optional)',
  whenToUsePlaceholder: 'Extra routing guidance',
  bodyLabel: 'Content (SKILL.md body)',
  bodyPlaceholder: 'The concrete instructions for the model…',
  formNameRequired: 'Name is required',
  formDescriptionRequired: 'Description is required',
  formNameInvalid: 'Name must be valid kebab-case',
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
