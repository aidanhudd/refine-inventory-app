"use client"

import {
  BUTTON_STYLE_IDS,
  COLOR_SCHEME_PREFERENCES,
  DENSITY_PRESETS,
  SPACING_PRESET_IDS,
  THEME_PRESET_IDS,
  type AppearanceConfig,
  type ButtonStyleId,
  type ColorSchemePreference,
  type DensityPreset,
  type SpacingPresetId,
  type ThemePresetId,
  type TypeScaleId,
  TYPE_SCALE_IDS,
} from "../../../lib/appearance"

type AppearanceThemeControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onChangeDensity: (value: DensityPreset) => void
  onChangeColorPreset: (value: ThemePresetId) => void
  onChangeColorScheme: (value: ColorSchemePreference) => void
  onChangeTypeScale: (value: TypeScaleId) => void
  onChangeSpacing: (value: SpacingPresetId) => void
  onChangeButtonStyle: (value: ButtonStyleId) => void
}

export default function AppearanceThemeControls({
  draft,
  disabled = false,
  onChangeDensity,
  onChangeColorPreset,
  onChangeColorScheme,
  onChangeTypeScale,
  onChangeSpacing,
  onChangeButtonStyle,
}: AppearanceThemeControlsProps) {
  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Theme and density</legend>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-density">Density</label>
        <select
          id="appearance-density"
          className="inline-input"
          value={draft.density}
          onChange={(e) => {
            const value = e.target.value as DensityPreset
            if (!(DENSITY_PRESETS as readonly string[]).includes(value)) return
            onChangeDensity(value)
          }}
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
      </div>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-color-preset">Color preset</label>
        <select
          id="appearance-color-preset"
          className="inline-input"
          value={draft.theme.colorPreset}
          onChange={(e) => {
            const value = e.target.value as ThemePresetId
            if (!(THEME_PRESET_IDS as readonly string[]).includes(value)) return
            onChangeColorPreset(value)
          }}
        >
          <option value="systemDefault">System Default</option>
          <option value="slate">Slate</option>
          <option value="ocean">Ocean</option>
        </select>
      </div>

      <div className="appearance-editor-field">
        <span className="appearance-editor-label" id="appearance-color-scheme-label">
          Color scheme
        </span>
        <div
          className="appearance-editor-radio-row"
          role="radiogroup"
          aria-labelledby="appearance-color-scheme-label"
        >
          {(
            [
              ["system", "System"],
              ["light", "Light"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="appearance-editor-radio">
              <input
                type="radio"
                name="appearance-color-scheme"
                value={value}
                checked={draft.theme.colorScheme === value}
                onChange={() => {
                  const next = value as ColorSchemePreference
                  if (!(COLOR_SCHEME_PREFERENCES as readonly string[]).includes(next)) return
                  onChangeColorScheme(next)
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-type-scale">Type scale</label>
        <select
          id="appearance-type-scale"
          className="inline-input"
          value={draft.theme.typeScale}
          onChange={(e) => {
            const value = e.target.value as TypeScaleId
            if (!(TYPE_SCALE_IDS as readonly string[]).includes(value)) return
            onChangeTypeScale(value)
          }}
        >
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
        </select>
      </div>

      <div className="appearance-editor-field">
        <label htmlFor="appearance-spacing">Spacing</label>
        <select
          id="appearance-spacing"
          className="inline-input"
          value={draft.theme.spacingPreset}
          onChange={(e) => {
            const value = e.target.value as SpacingPresetId
            if (!(SPACING_PRESET_IDS as readonly string[]).includes(value)) return
            onChangeSpacing(value)
          }}
        >
          <option value="tight">Tight</option>
          <option value="normal">Normal</option>
          <option value="relaxed">Relaxed</option>
        </select>
      </div>

      <div className="appearance-editor-field">
        <span className="appearance-editor-label" id="appearance-button-style-label">
          Button style
        </span>
        <div
          className="appearance-editor-radio-row"
          role="radiogroup"
          aria-labelledby="appearance-button-style-label"
        >
          {(
            [
              ["solid", "Solid"],
              ["soft", "Soft"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="appearance-editor-radio">
              <input
                type="radio"
                name="appearance-button-style"
                value={value}
                checked={draft.theme.buttonStyle === value}
                onChange={() => {
                  const next = value as ButtonStyleId
                  if (!(BUTTON_STYLE_IDS as readonly string[]).includes(next)) return
                  onChangeButtonStyle(next)
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  )
}
