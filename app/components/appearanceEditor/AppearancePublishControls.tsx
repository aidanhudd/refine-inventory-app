"use client"

import {
  APPEARANCE_PUBLISH_LABEL_MAX_LENGTH,
  normalizeAppearancePublishLabel,
} from "../../../lib/appearanceApi"
import { Button } from "../ui"

type AppearancePublishControlsProps = {
  label: string
  onChangeLabel: (value: string) => void
  disabled?: boolean
  publishing?: boolean
  canPublish: boolean
  dirty: boolean
  draftPersisted: boolean
  publishUncertain: boolean
  /** Status line for currently loaded / session-published version. */
  publishedStatusText: string
  onPublish: () => void
}

export default function AppearancePublishControls({
  label,
  onChangeLabel,
  disabled = false,
  publishing = false,
  canPublish,
  dirty,
  draftPersisted,
  publishUncertain,
  publishedStatusText,
  onPublish,
}: AppearancePublishControlsProps) {
  const labelCheck = normalizeAppearancePublishLabel(label)
  const labelError = labelCheck.ok ? null : labelCheck.message
  const busy = disabled || publishing

  return (
    <fieldset className="appearance-editor-fieldset appearance-publish-fieldset" disabled={busy}>
      <legend>Publish Appearance</legend>
      <p className="small">
        Publishing replaces the company appearance for all approved users after they refresh. Inventory
        data, holds, jobs, estimates, and permissions are not changed.
      </p>
      <p className="small appearance-publish-status">{publishedStatusText}</p>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-publish-label">Publish label (optional)</label>
        <input
          id="appearance-publish-label"
          className="inline-input"
          type="text"
          value={label}
          maxLength={APPEARANCE_PUBLISH_LABEL_MAX_LENGTH}
          disabled={busy || publishUncertain}
          onChange={(e) => onChangeLabel(e.target.value)}
          placeholder="Optional note for this version"
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? "appearance-publish-label-error" : undefined}
        />
        {labelError && (
          <p id="appearance-publish-label-error" className="small appearance-editor-field-error">
            {labelError}
          </p>
        )}
      </div>

      {dirty && (
        <p className="small appearance-editor-field-error">Save Draft before publishing.</p>
      )}
      {!draftPersisted && !dirty && (
        <p className="small">Save a valid private draft before publishing.</p>
      )}
      {publishUncertain && (
        <p className="small appearance-editor-field-error" role="alert">
          A previous publish timed out with an uncertain outcome. Reload this page and inspect version
          history before trying again. Publish stays disabled for this page session.
        </p>
      )}

      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!canPublish || !!labelError}
        onClick={onPublish}
      >
        {publishing ? "Publishing…" : "Publish Appearance"}
      </Button>
    </fieldset>
  )
}
