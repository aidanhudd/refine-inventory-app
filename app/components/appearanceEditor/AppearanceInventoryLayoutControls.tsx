"use client"

import {
  DETAIL_PRESENTATIONS,
  GRID_COLUMNS_PRESETS,
  INVENTORY_VIEW_MODES,
  type AppearanceConfig,
  type DetailPresentation,
  type GridColumnsPreset,
  type InventoryViewMode,
} from "../../../lib/appearance"

type AppearanceInventoryLayoutControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onChangeDefaultView: (value: InventoryViewMode) => void
  onChangeDetailPresentation: (value: DetailPresentation) => void
  onChangeGridColumns: (value: GridColumnsPreset) => void
}

export default function AppearanceInventoryLayoutControls({
  draft,
  disabled = false,
  onChangeDefaultView,
  onChangeDetailPresentation,
  onChangeGridColumns,
}: AppearanceInventoryLayoutControlsProps) {
  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Inventory layout</legend>

      <div className="appearance-editor-field">
        <span className="appearance-editor-label" id="appearance-default-view-label">
          Company default view
        </span>
        <div
          className="appearance-editor-radio-row"
          role="radiogroup"
          aria-labelledby="appearance-default-view-label"
        >
          {(
            [
              ["list", "List"],
              ["category", "Category"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="appearance-editor-radio">
              <input
                type="radio"
                name="appearance-default-view"
                value={value}
                checked={draft.inventory.defaultView === value}
                onChange={() => {
                  const next = value as InventoryViewMode
                  if (!(INVENTORY_VIEW_MODES as readonly string[]).includes(next)) return
                  onChangeDefaultView(next)
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="small">
          This is only the fallback for browsers without a saved List/Category preference. It does
          not overwrite existing browser preferences.
        </p>
      </div>

      <div className="appearance-editor-field">
        <span className="appearance-editor-label" id="appearance-detail-presentation-label">
          Item-detail presentation
        </span>
        <div
          className="appearance-editor-radio-row"
          role="radiogroup"
          aria-labelledby="appearance-detail-presentation-label"
        >
          {(
            [
              ["expand", "Expand inline"],
              ["modal", "Open in modal"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="appearance-editor-radio">
              <input
                type="radio"
                name="appearance-detail-presentation"
                value={value}
                checked={draft.inventory.detailPresentation === value}
                onChange={() => {
                  const next = value as DetailPresentation
                  if (!(DETAIL_PRESENTATIONS as readonly string[]).includes(next)) return
                  onChangeDetailPresentation(next)
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-grid-columns">Category grid columns</label>
        <select
          id="appearance-grid-columns"
          className="inline-input"
          value={draft.inventory.gridColumns}
          onChange={(e) => {
            const value = e.target.value as GridColumnsPreset
            if (!(GRID_COLUMNS_PRESETS as readonly string[]).includes(value)) return
            onChangeGridColumns(value)
          }}
        >
          <option value="one">One</option>
          <option value="two">Two</option>
          <option value="three">Three</option>
        </select>
        <p className="small">
          Applies to the category grid on desktop. Mobile preview always shows one column.
        </p>
      </div>
    </fieldset>
  )
}
