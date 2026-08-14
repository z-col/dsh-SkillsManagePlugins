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
  const [entries, setEntries] = useState<SkillsEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async (root: 'user' | 'project', scope0: SkillsScope) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const next = await api.list(scope0, root)
      if (seq !== requestSeq.current) return
      setEntries(next)
      setLoading(false)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(messageOf(cause))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(state.root, scope)
  }, [state.root, scope, load])

  return (
    <>
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
      <div className={css.actionsRow}>
        {state.view !== 'list' ? (
          <button
            type="button"
            className={css.ghostButton}
            onClick={() => store.actions.showList()}
          >
            ← {t('back')}
          </button>
        ) : (
          <span />
        )}
        {state.view === 'list' && (
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => store.actions.showCreate()}
          >
            + {t('newSkill')}
          </button>
        )}
      </div>
      {error !== null && <div className={css.error}>{error}</div>}
      <div className={css.body}>
        {state.view === 'list' && (
          <ListView
            entries={entries}
            loading={loading}
            emptyLabel={state.root === 'user' ? t('emptyUser') : t('emptyProject')}
            onOpen={(name) => store.actions.showDetail(name)}
          />
        )}
        {state.view === 'detail' && (
          <DetailView store={store} root={state.root} name={state.selectedName} scope={scope} onChanged={() => { void load(state.root, scope) }} />
        )}
        {state.view === 'create' && (
          <CreateView store={store} root={state.root} scope={scope} onCreated={() => { void load(state.root, scope) }} />
        )}
      </div>
    </>
  )
}

/** The list view: skill cards. */
function ListView(props: {
  entries: SkillsEntry[] | null
  loading: boolean
  emptyLabel: string
  onOpen: (name: string) => void
}) {
  const { entries, loading, emptyLabel, onOpen } = props
  if (loading) return <p className={css.status}>{t('loading')}</p>
  if (entries === null) return <p className={css.status}>{t('loadFailed')}</p>
  if (entries.length === 0) return <p className={css.status}>{emptyLabel}</p>
  return (
    <div className={css.skillList}>
      {entries.map(entry => (
        <button
          key={entry.name}
          type="button"
          className={css.skillCard}
          onClick={() => onOpen(entry.name)}
        >
          <span className={css.skillName}>{entry.name}</span>
          <span className={css.skillDesc}>{entry.description}</span>
          <span className={css.skillBadge}>{entry.form === 'bundle' ? 'dir' : '.md'}</span>
        </button>
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

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void api.get(scope, root, name)
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
  }, [scope, root, name])

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
