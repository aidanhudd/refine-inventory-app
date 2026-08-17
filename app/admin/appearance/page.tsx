"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import AdminSubNav from "../../components/AdminSubNav"
import AppearanceDraftPreviewFrame, {
  type AppearancePreviewWidth,
} from "../../components/AppearanceDraftPreviewFrame"
import { AppearanceDraftPreviewProvider } from "../../components/AppearanceDraftPreviewProvider"
import AppearanceBrandingControls from "../../components/appearanceEditor/AppearanceBrandingControls"
import AppearanceInventoryActionsControls from "../../components/appearanceEditor/AppearanceInventoryActionsControls"
import AppearanceInventoryFieldsControls from "../../components/appearanceEditor/AppearanceInventoryFieldsControls"
import AppearanceInventoryLayoutControls from "../../components/appearanceEditor/AppearanceInventoryLayoutControls"
import AppearanceJobsControls from "../../components/appearanceEditor/AppearanceJobsControls"
import AppearanceNavControls from "../../components/appearanceEditor/AppearanceNavControls"
import AppearanceThemeControls from "../../components/appearanceEditor/AppearanceThemeControls"
import { useAuth } from "../../components/AuthProvider"
import { Button, Notice, PageHeader, ViewToggle } from "../../components/ui"
import {
  APP_TITLE_MAX_LENGTH,
  cloneAppearanceConfig,
  validateAppearanceConfigStrict,
  type AppearanceConfig,
  type AppearanceValidationIssue,
  type DetailPresentation,
  type GridColumnsPreset,
  type InventoryActionSlotId,
  type InventoryCardFieldId,
  type InventoryViewMode,
  type JobsViewMode,
  type NavItemId,
  type OptionalInventoryCardFieldId,
} from "../../../lib/appearance"
import {
  getAppearanceDraft,
  upsertAppearanceDraft,
} from "../../../lib/appearanceApi"
import { isAdmin } from "../../../lib/profiles"

type EditorStatus = "idle" | "loading" | "ready" | "saving" | "saved" | "error"

const APP_TITLE_UNSAFE = /[\u0000-\u001F\u007F\u2028\u2029]/

function serializeConfig(config: AppearanceConfig): string {
  return JSON.stringify(config)
}

function titleFieldError(title: string): string | null {
  const trimmed = title.trim()
  if (trimmed.length === 0) return "App title must not be empty."
  if (trimmed.length > APP_TITLE_MAX_LENGTH) {
    return `App title must be at most ${APP_TITLE_MAX_LENGTH} characters.`
  }
  if (APP_TITLE_UNSAFE.test(trimmed)) {
    return "App title must be a single line without control characters or line breaks."
  }
  return null
}

function issueSummary(issues: AppearanceValidationIssue[]): string {
  if (issues.length === 0) return "Draft is invalid."
  return issues
    .slice(0, 4)
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join(" ")
}

function resetEditorDefaults(): {
  draft: AppearanceConfig
  baseline: string
} {
  const draft = cloneAppearanceConfig()
  return { draft, baseline: serializeConfig(draft) }
}

export default function AdminAppearancePage() {
  const { user, profile, loading: authLoading } = useAuth()

  const adminIdentityKey =
    !authLoading &&
    user?.id &&
    profile &&
    profile.id === user.id &&
    profile.approved === true &&
    isAdmin(profile.role)
      ? user.id
      : null

  const [draft, setDraft] = useState<AppearanceConfig>(() => cloneAppearanceConfig())
  const [baseline, setBaseline] = useState<string>(() =>
    serializeConfig(cloneAppearanceConfig()),
  )
  const [editorStatus, setEditorStatus] = useState<EditorStatus>("idle")
  const [loadWarning, setLoadWarning] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewWidth, setPreviewWidth] = useState<AppearancePreviewWidth>("desktop")

  const loadRequestIdRef = useRef(0)
  const saveRequestIdRef = useRef(0)
  const saveInFlightRef = useRef(false)
  const saveSnapshotRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const adminIdentityKeyRef = useRef(adminIdentityKey)
  adminIdentityKeyRef.current = adminIdentityKey

  const dirty = serializeConfig(draft) !== baseline
  dirtyRef.current = dirty

  const strictValidation = useMemo(() => validateAppearanceConfigStrict(draft), [draft])
  const titleError = titleFieldError(draft.branding.appTitle)
  const controlsDisabled = editorStatus === "saving"
  const canSave =
    !!adminIdentityKey &&
    editorStatus !== "loading" &&
    editorStatus !== "saving" &&
    dirty &&
    strictValidation.ok &&
    !titleError

  const applyEditorReset = useCallback((status: EditorStatus = "idle") => {
    const next = resetEditorDefaults()
    setDraft(next.draft)
    setBaseline(next.baseline)
    setLoadWarning(null)
    setSaveMessage(null)
    setSaveError(null)
    setEditorStatus(status)
  }, [])

  useEffect(() => {
    if (!adminIdentityKey) {
      loadRequestIdRef.current += 1
      saveRequestIdRef.current += 1
      saveInFlightRef.current = false
      saveSnapshotRef.current = null
      applyEditorReset("idle")
      return
    }

    const requestId = ++loadRequestIdRef.current
    const identityForRequest = adminIdentityKey
    let cancelled = false

    setEditorStatus("loading")
    setLoadWarning(null)
    setSaveMessage(null)
    setSaveError(null)

    void getAppearanceDraft().then((result) => {
      if (cancelled || requestId !== loadRequestIdRef.current) return
      if (identityForRequest !== adminIdentityKeyRef.current) return

      if (result.status === "missing") {
        const next = cloneAppearanceConfig()
        setDraft(next)
        setBaseline(serializeConfig(next))
        setEditorStatus("ready")
        return
      }

      if (result.status === "draft") {
        setDraft(cloneAppearanceConfig(result.row.config))
        setBaseline(serializeConfig(result.row.config))
        setEditorStatus("ready")
        return
      }

      if (result.status === "invalid") {
        const next = cloneAppearanceConfig(result.fallbackConfig)
        setDraft(next)
        setBaseline(serializeConfig(next))
        setLoadWarning(
          `${result.message} Showing compiled defaults in the editor. ${issueSummary(result.issues)}`,
        )
        setEditorStatus("ready")
        return
      }

      const next = cloneAppearanceConfig()
      setDraft(next)
      setBaseline(serializeConfig(next))
      setSaveError(
        result.status === "timeout"
          ? `Draft load timed out: ${result.message}`
          : `Could not load draft: ${result.message}`,
      )
      setEditorStatus("error")
    })

    return () => {
      cancelled = true
    }
  }, [adminIdentityKey, applyEditorReset])

  useEffect(() => {
    if (!dirty) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return

    const onDocumentClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.hasAttribute("download")) return

      const targetAttr = anchor.getAttribute("target")
      if (targetAttr && targetAttr !== "_self") return

      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#")) return

      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }

      if (url.origin !== window.location.origin) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return
      }

      const confirmed = window.confirm(
        "You have unsaved appearance draft changes. Leave this page?",
      )
      if (!confirmed) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    document.addEventListener("click", onDocumentClick, true)
    return () => document.removeEventListener("click", onDocumentClick, true)
  }, [dirty])

  const updateDraft = (updater: (prev: AppearanceConfig) => AppearanceConfig) => {
    if (controlsDisabled) return
    setDraft((prev) => updater(prev))
    setSaveMessage(null)
    setSaveError(null)
    if (editorStatus === "saved" || editorStatus === "error") {
      setEditorStatus("ready")
    }
  }

  const saveDraft = async () => {
    if (!adminIdentityKey || !canSave || saveInFlightRef.current) return

    const identityForSave = adminIdentityKey
    const requestId = ++saveRequestIdRef.current
    const snapshot = serializeConfig(draft)
    saveInFlightRef.current = true
    saveSnapshotRef.current = snapshot

    setEditorStatus("saving")
    setSaveMessage(null)
    setSaveError(null)

    const result = await upsertAppearanceDraft(draft)

    saveInFlightRef.current = false

    if (requestId !== saveRequestIdRef.current) return
    if (identityForSave !== adminIdentityKeyRef.current) return
    if (saveSnapshotRef.current !== snapshot) return

    if (result.status === "saved") {
      setDraft(cloneAppearanceConfig(result.row.config))
      setBaseline(serializeConfig(result.row.config))
      setSaveMessage("Draft saved. Changes are not live until published.")
      setEditorStatus("saved")
      saveSnapshotRef.current = null
      return
    }

    if (result.status === "validation") {
      setSaveError(`${result.message} ${issueSummary(result.issues)}`)
      setEditorStatus("error")
      return
    }

    setSaveError(
      result.status === "timeout"
        ? `Save timed out: ${result.message}`
        : `Could not save draft: ${result.message}`,
    )
    setEditorStatus("error")
  }

  if (authLoading || !adminIdentityKey) {
    return (
      <main>
        <AdminSubNav />
        <section className="card">
          <PageHeader
            title="Appearance"
            description="Checking admin access before loading your private draft…"
          />
          <div className="empty">Preparing appearance editor…</div>
        </section>
      </main>
    )
  }

  return (
    <main className="appearance-editor-page">
      <AdminSubNav />

      <section className="card appearance-editor-header-card">
        <PageHeader
          title="Appearance"
          description="Draft only — changes are not live until published."
        />
        <p className="subtext">
          Edit branding, navigation, Jobs tabs, and inventory layout for a private admin draft.
          The live app keeps its current published or default appearance until a future publish
          step.
        </p>
        <div className="appearance-editor-status-row">
          <span className="appearance-editor-badge">Draft only</span>
          <span className="small">
            {dirty ? "Unsaved changes" : editorStatus === "saved" ? "Saved" : "No unsaved changes"}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() => void saveDraft()}
          >
            {editorStatus === "saving" ? "Saving…" : "Save Draft"}
          </Button>
        </div>
        {loadWarning && <Notice className="page-feedback">{loadWarning}</Notice>}
        {saveMessage && <div className="success page-feedback">{saveMessage}</div>}
        {saveError && <Notice className="page-feedback">{saveError}</Notice>}
        {!strictValidation.ok && (
          <Notice className="page-feedback">
            Draft is invalid and cannot be saved. {issueSummary(strictValidation.errors)}
          </Notice>
        )}
      </section>

      {editorStatus === "loading" ? (
        <section className="card">
          <div className="empty">Loading your appearance draft…</div>
        </section>
      ) : (
        <div className="appearance-editor-layout">
          <section className="card appearance-editor-controls" aria-label="Appearance draft controls">
            <AppearanceBrandingControls
              draft={draft}
              titleError={titleError}
              disabled={controlsDisabled}
              onChangeTitle={(appTitle) =>
                updateDraft((prev) => ({
                  ...prev,
                  branding: { ...prev.branding, appTitle },
                }))
              }
            />

            <AppearanceThemeControls
              draft={draft}
              disabled={controlsDisabled}
              onChangeDensity={(density) => updateDraft((prev) => ({ ...prev, density }))}
              onChangeColorPreset={(colorPreset) =>
                updateDraft((prev) => ({
                  ...prev,
                  theme: { ...prev.theme, colorPreset },
                }))
              }
              onChangeColorScheme={(colorScheme) =>
                updateDraft((prev) => ({
                  ...prev,
                  theme: { ...prev.theme, colorScheme },
                }))
              }
              onChangeTypeScale={(typeScale) =>
                updateDraft((prev) => ({
                  ...prev,
                  theme: { ...prev.theme, typeScale },
                }))
              }
              onChangeSpacing={(spacingPreset) =>
                updateDraft((prev) => ({
                  ...prev,
                  theme: { ...prev.theme, spacingPreset },
                }))
              }
              onChangeButtonStyle={(buttonStyle) =>
                updateDraft((prev) => ({
                  ...prev,
                  theme: { ...prev.theme, buttonStyle },
                }))
              }
            />

            <AppearanceNavControls
              draft={draft}
              disabled={controlsDisabled}
              onReorder={(order: NavItemId[]) =>
                updateDraft((prev) => ({
                  ...prev,
                  nav: { ...prev.nav, order },
                }))
              }
            />

            <AppearanceJobsControls
              draft={draft}
              disabled={controlsDisabled}
              onReorder={(tabOrder: JobsViewMode[]) =>
                updateDraft((prev) => {
                  const defaultTab = tabOrder.includes(prev.jobs.defaultTab)
                    ? prev.jobs.defaultTab
                    : tabOrder[0]
                  return {
                    ...prev,
                    jobs: {
                      tabOrder,
                      defaultTab: defaultTab || prev.jobs.defaultTab,
                    },
                  }
                })
              }
              onChangeDefaultTab={(defaultTab: JobsViewMode) =>
                updateDraft((prev) => ({
                  ...prev,
                  jobs: { ...prev.jobs, defaultTab },
                }))
              }
            />

            <AppearanceInventoryLayoutControls
              draft={draft}
              disabled={controlsDisabled}
              onChangeDefaultView={(defaultView: InventoryViewMode) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: { ...prev.inventory, defaultView },
                }))
              }
              onChangeDetailPresentation={(detailPresentation: DetailPresentation) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: { ...prev.inventory, detailPresentation },
                }))
              }
              onChangeGridColumns={(gridColumns: GridColumnsPreset) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: { ...prev.inventory, gridColumns },
                }))
              }
            />

            <AppearanceInventoryFieldsControls
              draft={draft}
              disabled={controlsDisabled}
              onChangeFieldOrder={(fieldOrder: InventoryCardFieldId[]) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: {
                    ...prev.inventory,
                    card: { ...prev.inventory.card, fieldOrder },
                  },
                }))
              }
              onChangeHiddenFields={(hiddenFields: OptionalInventoryCardFieldId[]) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: {
                    ...prev.inventory,
                    card: { ...prev.inventory.card, hiddenFields },
                  },
                }))
              }
            />

            <AppearanceInventoryActionsControls
              draft={draft}
              disabled={controlsDisabled}
              onChangeActionPartitions={({
                actionOrder,
                moreActions,
              }: {
                actionOrder: InventoryActionSlotId[]
                moreActions: InventoryActionSlotId[]
              }) =>
                updateDraft((prev) => ({
                  ...prev,
                  inventory: {
                    ...prev.inventory,
                    card: { ...prev.inventory.card, actionOrder, moreActions },
                  },
                }))
              }
            />
          </section>

          <section className="card appearance-editor-preview-panel" aria-label="Draft preview">
            <div className="appearance-editor-preview-toolbar">
              <h2 className="appearance-editor-preview-heading">Preview</h2>
              <ViewToggle
                ariaLabel="Preview width"
                options={[
                  {
                    id: "desktop",
                    label: "Desktop",
                    active: previewWidth === "desktop",
                    onSelect: () => setPreviewWidth("desktop"),
                  },
                  {
                    id: "mobile",
                    label: "Mobile",
                    active: previewWidth === "mobile",
                    onSelect: () => setPreviewWidth("mobile"),
                  },
                ]}
              />
            </div>
            <p className="small appearance-editor-preview-note">
              Mock content only. This preview never changes the live app header or other sessions.
            </p>
            <AppearanceDraftPreviewProvider config={draft}>
              <AppearanceDraftPreviewFrame widthMode={previewWidth} />
            </AppearanceDraftPreviewProvider>
          </section>
        </div>
      )}
    </main>
  )
}
