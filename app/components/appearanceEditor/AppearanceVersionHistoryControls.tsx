"use client"

import { useEffect, useRef } from "react"
import type { AppearanceVersionHistoryEntry } from "../../../lib/appearanceApi"
import { Button } from "../ui"

export type AppearanceHistoryUiStatus = "idle" | "loading" | "ready" | "error" | "timeout"

type AppearanceVersionHistoryControlsProps = {
  status: AppearanceHistoryUiStatus
  versions: AppearanceVersionHistoryEntry[]
  errorMessage: string | null
  disabled?: boolean
  restoringVersionId: string | null
  onRefresh: () => void
  onRestore: (versionId: string) => void
}

function formatVersionNumber(value: bigint): string {
  return value.toString()
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function sourceLabel(source: AppearanceVersionHistoryEntry["source"]): string {
  if (source === "publish") return "Normal publish"
  if (source === "restore_publish") return "Restored-version publish"
  return "Unknown source"
}

export default function AppearanceVersionHistoryControls({
  status,
  versions,
  errorMessage,
  disabled = false,
  restoringVersionId,
  onRefresh,
  onRestore,
}: AppearanceVersionHistoryControlsProps) {
  const restoreButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pendingFocusVersionIdRef = useRef<string | null>(null)
  const previousRestoringRef = useRef<string | null>(null)

  useEffect(() => {
    const previous = previousRestoringRef.current
    previousRestoringRef.current = restoringVersionId

    if (previous && !restoringVersionId) {
      pendingFocusVersionIdRef.current = previous
    }
  }, [restoringVersionId])

  useEffect(() => {
    const id = pendingFocusVersionIdRef.current
    if (!id || restoringVersionId) return
    pendingFocusVersionIdRef.current = null
    const button = restoreButtonRefs.current.get(id)
    if (button && !button.disabled) {
      button.focus()
    }
  }, [restoringVersionId, versions, status])

  const busy = disabled || status === "loading" || restoringVersionId !== null

  return (
    <fieldset className="appearance-editor-fieldset" disabled={busy && status !== "ready"}>
      <legend>Version history</legend>
      <p className="small">
        Published appearance versions, newest first. Restoring replaces your private draft only — it
        does not publish anything.
      </p>
      <div className="appearance-history-toolbar">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onRefresh}
        >
          {status === "loading" ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {status === "loading" && versions.length === 0 && (
        <p className="appearance-history-empty">Loading version history…</p>
      )}

      {(status === "error" || status === "timeout") && (
        <div className="appearance-history-feedback" role="alert">
          <p className="small">
            {status === "timeout"
              ? `Version history timed out${errorMessage ? `: ${errorMessage}` : "."}`
              : `Could not load version history${errorMessage ? `: ${errorMessage}` : "."}`}
          </p>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onRefresh}>
            Retry
          </Button>
        </div>
      )}

      {status === "ready" && versions.length === 0 && (
        <p className="appearance-history-empty">
          No published appearance versions yet. History will appear here after the first publish.
        </p>
      )}

      {versions.length > 0 && (
        <ul className="appearance-history-list">
          {versions.map((version) => {
            const restoring = restoringVersionId === version.id
            return (
              <li key={version.id} className="appearance-history-row">
                <div className="appearance-history-meta">
                  <p className="appearance-history-title">
                    Version {formatVersionNumber(version.versionNumber)}
                    {version.label ? ` — ${version.label}` : ""}
                  </p>
                  <p className="small appearance-history-detail">
                    {formatCreatedAt(version.createdAt)} · {sourceLabel(version.source)}
                  </p>
                  {!version.restorable && (
                    <p className="small appearance-history-unavailable">
                      Unavailable
                      {version.unavailableReason ? `: ${version.unavailableReason}` : "."}
                    </p>
                  )}
                </div>
                <div className="appearance-history-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy || !version.restorable}
                    aria-label={`Restore version ${formatVersionNumber(version.versionNumber)} to draft`}
                    ref={(node) => {
                      if (node) restoreButtonRefs.current.set(version.id, node)
                      else restoreButtonRefs.current.delete(version.id)
                    }}
                    onClick={() => onRestore(version.id)}
                  >
                    {restoring ? "Restoring…" : "Restore to Draft"}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}
