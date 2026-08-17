"use client"

import {
  APP_TITLE_MAX_LENGTH,
  type AppearanceConfig,
} from "../../../lib/appearance"

type AppearanceBrandingControlsProps = {
  draft: AppearanceConfig
  titleError: string | null
  disabled?: boolean
  onChangeTitle: (title: string) => void
}

export default function AppearanceBrandingControls({
  draft,
  titleError,
  disabled = false,
  onChangeTitle,
}: AppearanceBrandingControlsProps) {
  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Branding</legend>
      <div className="appearance-editor-field">
        <label htmlFor="appearance-app-title">App title</label>
        <input
          id="appearance-app-title"
          className="inline-input"
          type="text"
          value={draft.branding.appTitle}
          maxLength={APP_TITLE_MAX_LENGTH + 8}
          autoComplete="off"
          onChange={(e) => onChangeTitle(e.target.value)}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={
            titleError ? "appearance-app-title-error" : "appearance-app-title-hint"
          }
        />
        <p id="appearance-app-title-hint" className="small">
          1–{APP_TITLE_MAX_LENGTH} characters. Trimmed on save; single line only.
        </p>
        {titleError && (
          <p id="appearance-app-title-error" className="appearance-editor-field-error">
            {titleError}
          </p>
        )}
      </div>
    </fieldset>
  )
}
