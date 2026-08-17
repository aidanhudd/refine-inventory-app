"use client"

import { useEffect, useRef } from "react"
import { Button } from "../ui"

type AppearanceDraftResetControlsProps = {
  disabled?: boolean
  resetting?: boolean
  dirty: boolean
  onReset: () => void
}

export default function AppearanceDraftResetControls({
  disabled = false,
  resetting = false,
  dirty,
  onReset,
}: AppearanceDraftResetControlsProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasResettingRef = useRef(false)

  useEffect(() => {
    if (wasResettingRef.current && !resetting) {
      buttonRef.current?.focus()
    }
    wasResettingRef.current = !!resetting
  }, [resetting])

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled || resetting}>
      <legend>Reset draft</legend>
      <p className="small">
        Reset Draft to Defaults deletes only your current private appearance draft. It does not
        change the published or live appearance for anyone else.
      </p>
      <p className="small">
        After reset, the editor shows compiled defaults. Nothing is saved automatically — Save Draft
        again before any future Publish can use a draft.
      </p>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={disabled || resetting}
        ref={buttonRef}
        onClick={onReset}
      >
        {resetting ? "Resetting…" : "Reset Draft to Defaults"}
      </Button>
      {dirty && (
        <p className="small appearance-editor-field-error">
          You currently have unsaved editor changes. Confirming reset will discard them.
        </p>
      )}
    </fieldset>
  )
}
