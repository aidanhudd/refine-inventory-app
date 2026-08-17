"use client"

import {
  INVENTORY_CARD_FIELD_IDS,
  INVENTORY_CARD_FIELD_LABELS,
  isRequiredInventoryCardField,
  setOptionalFieldHidden,
  type AppearanceConfig,
  type InventoryCardFieldId,
  type OptionalInventoryCardFieldId,
} from "../../../lib/appearance"
import AppearanceOrderList from "./AppearanceOrderList"

type AppearanceInventoryFieldsControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onChangeFieldOrder: (fieldOrder: InventoryCardFieldId[]) => void
  onChangeHiddenFields: (hiddenFields: OptionalInventoryCardFieldId[]) => void
}

export default function AppearanceInventoryFieldsControls({
  draft,
  disabled = false,
  onChangeFieldOrder,
  onChangeHiddenFields,
}: AppearanceInventoryFieldsControlsProps) {
  const items = INVENTORY_CARD_FIELD_IDS.map((id) => ({
    id,
    label: INVENTORY_CARD_FIELD_LABELS[id],
  }))
  const hiddenSet = new Set(draft.inventory.card.hiddenFields)

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Inventory card fields</legend>
      <p className="small">
        Reorder fields on inventory cards. Required fields stay visible. Optional fields can be
        hidden without removing them from the order.
      </p>
      <AppearanceOrderList
        listLabel="Use Move up and Move down to change inventory card field order."
        items={items}
        order={draft.inventory.card.fieldOrder}
        disabled={disabled}
        onReorder={(next) => onChangeFieldOrder(next as InventoryCardFieldId[])}
        renderAccessory={({ id, label }) => {
          if (isRequiredInventoryCardField(id)) {
            return (
              <span className="appearance-field-always-shown" aria-label={`${label}: Always shown`}>
                Always shown
              </span>
            )
          }

          const optionalId = id as OptionalInventoryCardFieldId
          const isHidden = hiddenSet.has(optionalId)
          return (
            <label className="appearance-field-visibility">
              <input
                type="checkbox"
                checked={!isHidden}
                disabled={disabled}
                onChange={(e) => {
                  onChangeHiddenFields(
                    setOptionalFieldHidden(
                      draft.inventory.card.hiddenFields,
                      optionalId,
                      !e.target.checked,
                    ),
                  )
                }}
              />
              Visible
            </label>
          )
        }}
      />
    </fieldset>
  )
}
