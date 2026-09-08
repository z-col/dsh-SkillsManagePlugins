/**
 * The Skills manager views: browse the user-level, project-level, and Skill
 * library surfaces, open a skill's full SKILL.md (raw frontmatter + body),
 * edit and save it, create new skills, and manage assignments.
 *
 * Skill model: the library (<$DSH_HOME>/skill-library) is the canonical home
 * of every skill; the user/project tabs show the COPIES assigned to those
 * levels. Assigning copies a library skill to a level, recycling removes one
 * copy, rename/delete operate everywhere (canonical + all copies), and sync
 * pushes the canonical to every copy.
 *
 * The views are mounted by the dsh-better-sidebar tab ({@link SkillsTab});
 * the {@link SkillsManagerBody} receives the request scope explicitly so the
 * shell supplies the current session's facts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconFolderOpen16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsPanelStore, SkillsScope } from './state.ts'
import type { SkillsAssignTarget, SkillsEntry, SkillsFile, SkillsLevelRoot, SkillsLibraryData } from './api.ts'
import { api, SkillsApiError } from './api.ts'
import { t } from './locales.ts'
import css from './SkillsPanel.module.css'

/** Map a wire failure to an inline message. */
function messageOf(error: unknown): string {
  if (error instanceof SkillsApiError) return `${t('wireError')}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * The shared manager body: root tabs (用户级 / 项目级 / Skill 库), the action
 * row, and the list/detail/create views. `scope` is the request scope the
 * body's API calls ride (session id + cwd), supplied by the mounting shell.
 */
export function SkillsManagerBody(props: { store: SkillsPanelStore; scope: SkillsScope }) {
  const { store, scope } = props
  const state = store.getSnapshot()
  const [, force] = useState(0)
  useEffect(() => store.subscribe(() => force(v => v + 1)), [store])

  // The sidebar shell rebuilds the `scope` prop object on every shell
  // re-render (session feed / store / locale changes). Depending on the
  // OBJECT would re-fire api.list and flash the loading state on every such
  // re-render — the visible "flicker". Depend on the primitive fields so an
  // equal scope (same session id + cwd) is a no-op.
  const sessionId = scope.sessionId
  const cwd = scope.cwd

  /** The entries currently shown for a LEVEL root, tagged with its kind. */
  const [loaded, setLoaded] = useState<{ root: 'user' | 'project'; entries: SkillsEntry[] } | null>(null)
  /** The library payload (canonical skills + assignments + projects). */
  const [libraryData, setLibraryData] = useState<SkillsLibraryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingFolder, setOpeningFolder] = useState(false)
  const requestSeq = useRef(0)

  const loadLevel = useCallback(async (root: 'user' | 'project', sessionId0: string, cwd0: string | undefined) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const next = await api.list({ sessionId: sessionId0, cwd: cwd0 }, root)
      if (seq !== requestSeq.current) return
      setLoaded({ root, entries: next })
      setLoading(false)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(messageOf(cause))
      setLoading(false)
    }
  }, [])

  const loadLibrary = useCallback(async (sessionId0: string, cwd0: string | undefined) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const next = await api.libraryList({ sessionId: sessionId0, cwd: cwd0 })
      if (seq !== requestSeq.current) return
      setLibraryData(next)
      setLoading(false)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(messageOf(cause))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (state.root === 'library') void loadLibrary(sessionId, cwd)
    else void loadLevel(state.root, sessionId, cwd)
  }, [state.root, sessionId, cwd, loadLevel, loadLibrary])

  const reload = useCallback(() => {
    if (state.root === 'library') void loadLibrary(sessionId, cwd)
    else void loadLevel(state.root, sessionId, cwd)
  }, [state.root, sessionId, cwd, loadLevel, loadLibrary])

  /** Open the currently selected level's folder in the OS file manager. */
  const openCurrentFolder = useCallback(async (): Promise<void> => {
    setOpeningFolder(true)
    setError(null)
    try {
      await api.openFolder({ sessionId, cwd }, state.root)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setOpeningFolder(false)
    }
  }, [sessionId, cwd, state.root])

  return (
    <>
      <div className={css.toolbar}>
        <div className={css.tabs}>
          <button
            type="button"
            className={`${css.tab} ${state.root === 'library' ? css.tabActive : ''}`}
            onClick={() => store.actions.switchRoot('library')}
          >
            {t('libraryTab')}
          </button>
          <button
            type="button"
            className={`${css.tab} ${state.root === 'user' ? css.tabActive : ''}`}
            onClick={() => store.actions.switchRoot('user')}
          >
            {t('userTab')}
          </button>
          <button
            type="button"
            className={`${css.tab} ${state.root === 'project' ? css.tabActive : ''}`}
            onClick={() => store.actions.switchRoot('project')}
          >
            {t('projectTab')}
          </button>
        </div>
        <div className={css.actions}>
          {state.view !== 'list' && (
            <button
              type="button"
              className={css.ghostButton}
              onClick={() => store.actions.showList()}
            >
              ← {t('back')}
            </button>
          )}
          <button
            type="button"
            className={css.iconButton}
            title={t('openFolder')}
            aria-label={t('openFolder')}
            disabled={openingFolder}
            onClick={() => { void openCurrentFolder() }}
          >
            <IconFolderOpen16 />
          </button>
        </div>
      </div>
      {error !== null && <div className={css.error}>{error}</div>}
      <div className={css.body}>
        {state.view === 'list' && (
          state.root === 'library' ? (
            <LibraryView
              data={libraryData}
              loading={loading}
              scope={scope}
              onOpen={(name) => store.actions.showDetail(name)}
              onChanged={reload}
            />
          ) : (
            <ListView
              entries={loaded !== null && loaded.root === state.root ? loaded.entries : null}
              loading={loading}
              emptyLabel={state.root === 'user' ? t('emptyUser') : t('emptyProject')}
              root={state.root}
              scope={scope}
              onOpen={(name) => store.actions.showDetail(name)}
              onChanged={reload}
            />
          )
        )}
        {state.view === 'detail' && (
          <DetailView store={store} root={state.root} name={state.selectedName} scope={scope} onChanged={reload} />
        )}
      </div>
    </>
  )
}

/** One open card menu (level list): which skill, and which step is showing. */
type CardMenu =
  | { name: string; mode: 'actions' }
  | { name: string; mode: 'rename' }
  | { name: string; mode: 'confirm-recycle' }
  | null

/**
 * The LEVEL list view (用户级 / 项目级): skill cards with a per-card 「操作」
 * menu (rename everywhere / recycle from this level). `entries` is null only
 * while the CURRENT root has never loaded; a refresh keeps the previous
 * entries on screen (no full-panel flash).
 */
function ListView(props: {
  entries: SkillsEntry[] | null
  loading: boolean
  emptyLabel: string
  root: 'user' | 'project'
  scope: SkillsScope
  onOpen: (name: string) => void
  onChanged: () => void
}) {
  const { entries, loading, emptyLabel, root, scope, onOpen, onChanged } = props
  const [menu, setMenu] = useState<CardMenu>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closeMenu = (): void => {
    setMenu(null)
    setRenameValue('')
    setError(null)
    setBusyName(null)
  }

  // Close the open menu on outside click or Escape; clicks inside the card
  // (including the ops button that toggles it) are left to their handlers.
  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = event.target as Element | null
      if (el !== null && el.closest('[data-skill-card]')) return
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const toggleMenu = (name: string): void => {
    if (menu?.name === name && menu.mode === 'actions') {
      closeMenu()
      return
    }
    setRenameValue('')
    setError(null)
    setMenu({ name, mode: 'actions' })
  }

  const startRename = (name: string): void => {
    setRenameValue(name)
    setError(null)
    setMenu({ name, mode: 'rename' })
  }

  const doRename = async (): Promise<void> => {
    if (menu === null || menu.mode !== 'rename') return
    const name = menu.name
    const next = renameValue.trim()
    if (next === '' || next === name) {
      closeMenu()
      return
    }
    setBusyName(name)
    setError(null)
    try {
      await api.rename(scope, name, next)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  const doRecycle = async (): Promise<void> => {
    if (menu === null || menu.mode !== 'confirm-recycle') return
    const name = menu.name
    setBusyName(name)
    setError(null)
    try {
      await api.recycle(scope, root, name)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  if (entries === null) {
    return loading ? <p className={css.status}>{t('loading')}</p> : <p className={css.status}>{t('loadFailed')}</p>
  }
  if (entries.length === 0) return <p className={css.status}>{emptyLabel}</p>
  return (
    <div className={css.skillList}>
      {entries.map(entry => (
        <div key={entry.name} className={`${css.skillCard} ${menu?.name === entry.name ? css.skillCardActive : ''}`} data-skill-card>
          <button
            type="button"
            className={css.skillCardMain}
            onClick={() => { closeMenu(); onOpen(entry.name) }}
          >
            <span className={css.skillName}>{entry.name}</span>
            <span className={css.skillDesc}>{entry.description}</span>
          </button>
          <button
            type="button"
            className={`${css.opsButton} ${menu?.name === entry.name ? css.opsButtonActive : ''}`}
            aria-label={t('ops')}
            onClick={(event) => { event.stopPropagation(); toggleMenu(entry.name) }}
          >
            {t('ops')}
          </button>
          {menu?.name === entry.name && (
            <div className={css.cardMenu} onClick={(event) => event.stopPropagation()}>
              {menu.mode === 'rename' ? (
                <>
                  <label className={css.menuLabel}>{t('renameTo')}</label>
                  <input
                    className={css.menuInput}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    disabled={busyName !== null}
                    autoFocus
                  />
                  <div className={css.menuActions}>
                    <button type="button" className={css.primaryButton} disabled={busyName !== null} onClick={() => { void doRename() }}>
                      {busyName !== null ? '…' : t('confirm')}
                    </button>
                    <button type="button" className={css.ghostButton} disabled={busyName !== null} onClick={closeMenu}>
                      {t('cancel')}
                    </button>
                  </div>
                </>
              ) : menu.mode === 'confirm-recycle' ? (
                <>
                  <p className={css.menuText}>{t('recycleConfirm')}</p>
                  <div className={css.menuActions}>
                    <button type="button" className={`${css.ghostButton} ${css.dangerButton}`} disabled={busyName !== null} onClick={() => { void doRecycle() }}>
                      {busyName !== null ? '…' : t('recycle')}
                    </button>
                    <button type="button" className={css.ghostButton} disabled={busyName !== null} onClick={closeMenu}>
                      {t('cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => startRename(entry.name)}>
                    {t('rename')}
                  </button>
                  <button type="button" className={`${css.menuItem} ${css.menuDanger}`} disabled={busyName !== null} onClick={() => setMenu({ name: entry.name, mode: 'confirm-recycle' })}>
                    {t('recycle')}
                  </button>
                </>
              )}
              {error !== null && <p className={css.menuError}>{error}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** One open library card menu: which skill, and which step is showing. */
type LibraryMenu =
  | { name: string; mode: 'actions' }
  | { name: string; mode: 'rename' }
  | { name: string; mode: 'confirm-delete' }
  | null

/**
 * The Skill library view: every canonical skill with a per-card menu —
 * 移至全局 / 移至项目级 / 重命名 / 删除. 移至 copies the canonical into the
 * target level (the library original stays); rename/delete operate
 * everywhere (canonical + all copies). Clicking a card opens its canonical.
 */
function LibraryView(props: {
  data: SkillsLibraryData | null
  loading: boolean
  scope: SkillsScope
  onOpen: (name: string) => void
  onChanged: () => void
}) {
  const { data, loading, scope, onOpen, onChanged } = props
  const [menu, setMenu] = useState<LibraryMenu>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closeMenu = (): void => {
    setMenu(null)
    setRenameValue('')
    setError(null)
    setBusyName(null)
  }

  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = event.target as Element | null
      if (el !== null && el.closest('[data-skill-card]')) return
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  if (data === null) {
    return loading ? <p className={css.status}>{t('loading')}</p> : <p className={css.status}>{t('loadFailed')}</p>
  }

  const toggleMenu = (name: string): void => {
    if (menu?.name === name && menu.mode === 'actions') {
      closeMenu()
      return
    }
    setRenameValue('')
    setError(null)
    setMenu({ name, mode: 'actions' })
  }

  /** 移至 a level: copy the canonical there (upsert — an existing copy is
   *  refreshed from the library). */
  const doMoveTo = async (to: SkillsAssignTarget): Promise<void> => {
    if (menu === null) return
    const name = menu.name
    setBusyName(name)
    setError(null)
    try {
      await api.libraryAssign(scope, name, to)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  const startRename = (name: string): void => {
    setRenameValue(name)
    setError(null)
    setMenu({ name, mode: 'rename' })
  }

  const doRename = async (): Promise<void> => {
    if (menu === null || menu.mode !== 'rename') return
    const name = menu.name
    const next = renameValue.trim()
    if (next === '' || next === name) {
      closeMenu()
      return
    }
    setBusyName(name)
    setError(null)
    try {
      await api.rename(scope, name, next)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  const doDelete = async (): Promise<void> => {
    if (menu === null || menu.mode !== 'confirm-delete') return
    const name = menu.name
    setBusyName(name)
    setError(null)
    try {
      await api.delete(scope, name)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  if (data.skills.length === 0) return <p className={css.status}>{t('libraryEmpty')}</p>

  return (
    <div className={css.libraryWrap}>
      <div className={css.libraryHeader}>
        <span className={css.libraryCount}>{t('libraryCount', { count: data.skills.length })}</span>
      </div>
      <div className={css.skillList}>
        {data.skills.map(entry => (
          <div key={entry.name} className={`${css.skillCard} ${menu?.name === entry.name ? css.skillCardActive : ''}`} data-skill-card>
            <button
              type="button"
              className={css.skillCardMain}
              onClick={() => { closeMenu(); onOpen(entry.name) }}
            >
              <span className={css.skillName}>{entry.name}</span>
              <span className={css.skillDesc}>{entry.description}</span>
            </button>
            <button
              type="button"
              className={`${css.opsButton} ${menu?.name === entry.name ? css.opsButtonActive : ''}`}
              aria-label={t('ops')}
              onClick={(event) => { event.stopPropagation(); toggleMenu(entry.name) }}
            >
              {t('ops')}
            </button>
            {menu?.name === entry.name && (
              <div className={css.cardMenu} onClick={(event) => event.stopPropagation()}>
                {menu.mode === 'rename' ? (
                  <>
                    <label className={css.menuLabel}>{t('renameTo')}</label>
                    <input
                      className={css.menuInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      placeholder={t('namePlaceholder')}
                      disabled={busyName !== null}
                      autoFocus
                    />
                    <div className={css.menuActions}>
                      <button type="button" className={css.primaryButton} disabled={busyName !== null} onClick={() => { void doRename() }}>
                        {busyName !== null ? '…' : t('confirm')}
                      </button>
                      <button type="button" className={css.ghostButton} disabled={busyName !== null} onClick={closeMenu}>
                        {t('cancel')}
                      </button>
                    </div>
                  </>
                ) : menu.mode === 'confirm-delete' ? (
                  <>
                    <p className={css.menuText}>{t('deleteConfirm')}</p>
                    <div className={css.menuActions}>
                      <button type="button" className={`${css.ghostButton} ${css.dangerButton}`} disabled={busyName !== null} onClick={() => { void doDelete() }}>
                        {busyName !== null ? '…' : t('delete')}
                      </button>
                      <button type="button" className={css.ghostButton} disabled={busyName !== null} onClick={closeMenu}>
                        {t('cancel')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => { void doMoveTo('user') }}>
                      {busyName !== null ? '…' : t('moveToGlobal')}
                    </button>
                    <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => { void doMoveTo({ project: data.currentProject }) }}>
                      {busyName !== null ? '…' : t('moveToProject')}
                    </button>
                    <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => startRename(entry.name)}>
                      {t('rename')}
                    </button>
                    <button type="button" className={`${css.menuItem} ${css.menuDanger}`} disabled={busyName !== null} onClick={() => setMenu({ name: entry.name, mode: 'confirm-delete' })}>
                      {t('delete')}
                    </button>
                  </>
                )}
                {error !== null && <p className={css.menuError}>{error}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The detail view: full SKILL.md editor with save / delete / rename. The
 *  root may be a level (user/project) or the library canonical. */
function DetailView(props: {
  store: SkillsPanelStore
  root: SkillsLevelRoot
  name: string
  scope: SkillsScope
  onChanged: () => void
}) {
  const { store, root, name, scope, onChanged } = props
  const [file, setFile] = useState<SkillsFile | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameTo, setRenameTo] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Same flicker guard as the body: depend on the scope's primitive fields,
  // not the object the sidebar shell rebuilds on every re-render.
  const sessionId = scope.sessionId
  const cwd = scope.cwd

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void api.get({ sessionId, cwd }, root, name)
      .then((next) => {
        if (!alive) return
        setFile(next)
        setDraft(next.raw)
        setLoading(false)
      })
      .catch((cause) => {
        if (!alive) return
        setError(messageOf(cause))
        setLoading(false)
      })
    return () => { alive = false }
  }, [sessionId, cwd, root, name])

  if (loading) return <p className={css.status}>{t('loading')}</p>
  if (error !== null || file === null) {
    return (
      <div>
        <div className={css.error}>{error ?? t('loadFailed')}</div>
        <button type="button" className={css.ghostButton} onClick={() => store.actions.showList()}>
          ← {t('back')}
        </button>
      </div>
    )
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.update(scope, root, name, draft)
      setFile({ ...file, raw: draft })
      setSaving(false)
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setSaving(false)
    }
  }

  const doDelete = async (): Promise<void> => {
    setDeleting(true)
    setError(null)
    try {
      await api.delete(scope, name)
      setDeleting(false)
      setConfirmDelete(false)
      store.actions.showList()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const doRename = async (): Promise<void> => {
    if (renameTo.trim() === '') return
    setRenamingBusy(true)
    setError(null)
    try {
      const next = await api.rename(scope, name, renameTo.trim())
      setRenaming(false)
      setRenameTo('')
      setRenamingBusy(false)
      store.actions.showDetail(next.name)
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setRenamingBusy(false)
    }
  }

  return (
    <div className={css.detail}>
      <div className={css.detailHeader}>
        <h3 className={css.skillName}>{file.name}</h3>
        <button type="button" className={css.ghostButton} onClick={() => setRenaming(v => !v)}>
          {t('rename')}
        </button>
        <button
          type="button"
          className={`${css.ghostButton} ${css.dangerButton}`}
          onClick={() => setConfirmDelete(true)}
        >
          {t('delete')}
        </button>
      </div>
      {renaming && (
        <div className={css.form}>
          <div className={css.field}>
            <label className={css.fieldLabel}>{t('renameTo')}</label>
            <input
              className={css.fieldInput}
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder={t('namePlaceholder')}
              disabled={renamingBusy}
            />
          </div>
          <div className={css.formActions}>
            <button type="button" className={css.primaryButton} disabled={renamingBusy} onClick={() => { void doRename() }}>
              {t('confirm')}
            </button>
            <button type="button" className={css.ghostButton} onClick={() => setRenaming(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      <div className={css.detailMeta}>
        <span>{t('pathOf')}: {file.path}</span>
      </div>
      <textarea
        className={css.editor}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        aria-label={t('edit')}
      />
      <div className={css.formActions}>
        <button type="button" className={css.primaryButton} disabled={saving} onClick={() => { void save() }}>
          {saving ? '…' : t('save')}
        </button>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('delete')}
        headless
      >
        <div className={css.confirmBar}>
          <p className={css.confirmText}>{t('deleteConfirm')}</p>
          <button type="button" className={css.ghostButton} onClick={() => setConfirmDelete(false)}>
            {t('cancel')}
          </button>
          <button type="button" className={`${css.ghostButton} ${css.dangerButton}`} disabled={deleting} onClick={() => { void doDelete() }}>
            {deleting ? '…' : t('delete')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
