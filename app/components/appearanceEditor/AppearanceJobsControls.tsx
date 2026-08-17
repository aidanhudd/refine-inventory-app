"use client"

import {
  JOBS_TAB_REGISTRY,
  JOBS_VIEW_MODES,
  type AppearanceConfig,
  type JobsViewMode,
} from "../../../lib/appearance"
import AppearanceOrderList from "./AppearanceOrderList"

type AppearanceJobsControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onReorder: (order: JobsViewMode[]) => void
  onChangeDefaultTab: (tab: JobsViewMode) => void
}

export default function AppearanceJobsControls({
  draft,
  disabled = false,
  onReorder,
  onChangeDefaultTab,
}: AppearanceJobsControlsProps) {
  const items = JOBS_VIEW_MODES.map((id) => ({
    id,
    label: JOBS_TAB_REGISTRY[id].label,
  }))

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Jobs tabs</legend>
      <p className="small">
        Reorder Jobs tabs and choose the default tab. Search and filter controls stay fixed and are
        not configurable here.
      </p>
      <AppearanceOrderList
        listLabel="Use Move up and Move down to change Jobs tab order."
        items={items}
        order={draft.jobs.tabOrder}
        disabled={disabled}
        onReorder={(next) => onReorder(next as JobsViewMode[])}
      />

      <div className="appearance-editor-field">
        <label htmlFor="appearance-jobs-default-tab">Default Jobs tab</label>
        <select
          id="appearance-jobs-default-tab"
          className="inline-input"
          value={draft.jobs.defaultTab}
          onChange={(e) => {
            const value = e.target.value as JobsViewMode
            if (!(JOBS_VIEW_MODES as readonly string[]).includes(value)) return
            onChangeDefaultTab(value)
          }}
        >
          {draft.jobs.tabOrder.map((id) => (
            <option key={id} value={id}>
              {JOBS_TAB_REGISTRY[id].label}
            </option>
          ))}
        </select>
        <p className="small">Must be one of the registered Jobs tabs.</p>
      </div>
    </fieldset>
  )
}
