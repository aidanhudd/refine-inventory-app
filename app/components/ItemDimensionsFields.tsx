"use client"

import {
  categoryIdSupportsDimensions,
  formatDimensionsSizeLine,
  formatDimensionsSquareFeetLine,
  type CategoryRef,
} from "../../lib/inventoryDimensions"

type ItemDimensionsFieldsProps = {
  categoryId: string
  categories: CategoryRef[]
  lengthInches: string
  widthInches: string
  squareFeet: string
  isEditing: boolean
  onUpdate?: (key: "length_inches" | "width_inches", value: string) => void
  storedLengthInches?: number | null
  storedWidthInches?: number | null
  storedSquareFeet?: number | null
}

export default function ItemDimensionsFields({
  categoryId,
  categories,
  lengthInches,
  widthInches,
  squareFeet,
  isEditing,
  onUpdate,
  storedLengthInches = null,
  storedWidthInches = null,
  storedSquareFeet = null,
}: ItemDimensionsFieldsProps) {
  if (!categoryIdSupportsDimensions(categoryId, categories)) return null

  if (isEditing) {
    return (
      <div className="item-dimensions-fields section-gap">
        <strong>Slab / Remnant Dimensions</strong>
        <div className="inline-dimension-fields">
          <label className="inline-dimension-field">
            <span className="inline-dimension-label">Length (in)</span>
            <input
              className="inline-input"
              type="number"
              min="0"
              step="0.01"
              value={lengthInches}
              onChange={(e) => onUpdate?.("length_inches", e.target.value)}
              placeholder="Length"
            />
          </label>
          <label className="inline-dimension-field">
            <span className="inline-dimension-label">Width (in)</span>
            <input
              className="inline-input"
              type="number"
              min="0"
              step="0.01"
              value={widthInches}
              onChange={(e) => onUpdate?.("width_inches", e.target.value)}
              placeholder="Width"
            />
          </label>
          <label className="inline-dimension-field">
            <span className="inline-dimension-label">Square Feet</span>
            <input
              className="inline-input inline-input-readonly"
              value={squareFeet || "0"}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="item-dimensions-display section-gap">
      <strong>Dimensions</strong>
      <div className="item-dimensions-lines">
        <div>{formatDimensionsSizeLine(storedLengthInches, storedWidthInches)}</div>
        <div>{formatDimensionsSquareFeetLine(storedSquareFeet)}</div>
      </div>
    </div>
  )
}
