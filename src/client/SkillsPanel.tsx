/**
 * The Skills manager views: browse the user-level or project-level skill
 * roots, open a skill's full SKILL.md (raw frontmatter + body), edit and
 * save it, create new skills, delete, and rename. All data rides the
 * plugin's own fenced /skills API.
 *
 * The views are mounted by the dsh-better-sidebar tab ({@link SkillsTab});
 * the {@link SkillsManagerBody} receives the request scope explicitly so the
 * shell supplies the current session's facts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsPanelStore, SkillsScope } from './state.ts'
import type { SkillsEntry, SkillsFile } from './api.ts'
import { api, SkillsApiError } from './api.ts'
import { t } from './locales.ts'
import css from './SkillsPanel.module.css'

/** Map a wire failure to an inline message. */
function messageOf(error: unknown): string {
  if (error instanceof SkillsApiError) return `${t('wireError')}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * The shared manager body: root tabs, action row, and the list/detail/create
 * views. `scope` is the request scope the body's API calls ride (session id +
 * cwd), supplied by the mounting shell.
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

  /** The entries currently shown, tagged with the root they came from. */
  const [loaded, setLoaded] = useState<{ root: 'user' | 'project'; entries: SkillsEntry[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async (root: 'user' | 'project', sessionId0: string, cwd0: string | undefined) => {
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

  useEffect(() => {
    void load(state.root, sessionId, cwd)
  }, [state.root, sessionId, cwd, load])

  return (
    <>
      <div className={css.toolbar}>
        <div className={css.tabs}>
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
          {state.view !== 'list' ? (
            <button
              type="button"
              className={css.ghostButton}
              onClick={() => store.actions.showList()}
            >
              ← {t('back')}
            </button>
          ) : (
            <button
              type="button"
              className={css.primaryButton}
              onClick={() => store.actions.showCreate()}
            >
              + {t('newSkill')}
            </button>
          )}
        </div>
      </div>
      {error !== null && <div className={css.error}>{error}</div>}
      <div className={css.body}>
        {state.view === 'list' && (
          <ListView
            entries={loaded !== null && loaded.root === state.root ? loaded.entries : null}
            loading={loading}
            emptyLabel={state.root === 'user' ? t('emptyUser') : t('emptyProject')}
            root={state.root}
            scope={scope}
            onOpen={(name) => store.actions.showDetail(name)}
            onChanged={() => { void load(state.root, sessionId, cwd) }}
          />
        )}
        {state.view === 'detail' && (
          <DetailView store={store} root={state.root} name={state.selectedName} scope={scope} onChanged={() => { void load(state.root, sessionId, cwd) }} />
        )}
        {state.view === 'create' && (
          <CreateView store={store} root={state.root} scope={scope} onCreated={() => { void load(state.root, sessionId, cwd) }} />
        )}
      </div>
    </>
  )
}

/** One open card menu: which skill, and which step is showing. */
type CardMenu =
  | { name: string; mode: 'actions' }
  | { name: string; mode: 'rename' }
  | { name: string; mode: 'confirm-delete' }
  | null

/**
 * The list view: skill cards with a per-card 「操作」 menu (rename / delete /
 * move to the other level). `entries` is null only while the CURRENT root has
 * never loaded; a refresh keeps the previous entries on screen (no full-panel
 * flash), the loading state is only visible on first load.
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
      await api.rename(scope, root, name, next)
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
      await api.delete(scope, root, name)
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  const doMove = async (): Promise<void> => {
    if (menu === null) return
    const name = menu.name
    setBusyName(name)
    setError(null)
    try {
      await api.move(scope, root, name, root === 'user' ? 'project' : 'user')
      closeMenu()
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
      setBusyName(null)
    }
  }

  const moveLabel = root === 'user' ? t('moveToProject') : t('moveToUser')

  if (entries === null) {
    return loading ? <p className={css.status}>{t('loading')}</p> : <p className={css.status}>{t('loadFailed')}</p>
  }
  if (entries.length === 0) return <p className={css.status}>{emptyLabel}</p>
  return (
    <div className={css.skillList}>
      {entries.map(entry => (
        <div key={entry.name} className={css.skillCard} data-skill-card>
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
                  <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => startRename(entry.name)}>
                    {t('rename')}
                  </button>
                  <button type="button" className={`${css.menuItem} ${css.menuDanger}`} disabled={busyName !== null} onClick={() => setMenu({ name: entry.name, mode: 'confirm-delete' })}>
                    {t('delete')}
                  </button>
                  <button type="button" className={css.menuItem} disabled={busyName !== null} onClick={() => { void doMove() }}>
                    {busyName !== null ? '…' : moveLabel}
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

/** The detail view: full SKILL.md editor with save / delete / rename. */
function DetailView(props: {
  store: SkillsPanelStore
  root: 'user' | 'project'
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
      await api.delete(scope, root, name)
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
      const next = await api.rename(scope, root, name, renameTo.trim())
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

/** The create view: name / description / whenToUse / body form. */
function CreateView(props: {
  store: SkillsPanelStore
  root: 'user' | 'project'
  scope: SkillsScope
  onCreated: () => void
}) {
  const { store, root, scope, onCreated } = props
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      setError(t('formNameRequired'))
      return
    }
    if (description.trim() === '') {
      setError(t('formDescriptionRequired'))
      return
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.trim())) {
      setError(t('formNameInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.create(scope, root, {
        name: name.trim(),
        description: description.trim(),
        ...(whenToUse.trim() !== '' ? { whenToUse: whenToUse.trim() } : {}),
        ...(body !== '' ? { body } : {}),
      })
      setBusy(false)
      setName('')
      setDescription('')
      setWhenToUse('')
      setBody('')
      store.actions.showDetail(name.trim())
      onCreated()
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  return (
    <div className={css.form}>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('nameLabel')}</label>
        <input
          className={css.fieldInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </div>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('descriptionLabel')}</label>
        <input
          className={css.fieldInput}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('descriptionPlaceholder')}
        />
      </div>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('whenToUseLabel')}</label>
        <input
          className={css.fieldInput}
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value)}
          placeholder={t('whenToUsePlaceholder')}
        />
      </div>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('bodyLabel')}</label>
        <textarea
          className={css.editor}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('bodyPlaceholder')}
          spellCheck={false}
        />
      </div>
      {error !== null && <p className={css.fieldError}>{error}</p>}
      <div className={css.formActions}>
        <button type="button" className={css.primaryButton} disabled={busy} onClick={() => { void submit() }}>
          {busy ? '…' : t('confirm')}
        </button>
        <button type="button" className={css.ghostButton} onClick={() => store.actions.showList()}>
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
