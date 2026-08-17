"use client"

import type { ReactNode } from "react"
import {
  INVENTORY_ACTION_SLOT_LABELS,
  INVENTORY_CARD_FIELD_LABELS,
  JOBS_TAB_REGISTRY,
  NAV_LINK_REGISTRY,
  resolveVisibleInventoryFields,
  type InventoryActionSlotId,
  type InventoryCardFieldId,
  type JobsViewMode,
  type NavItemId,
} from "../../lib/appearance"
import { Badge, Button, SearchField, ViewToggle } from "./ui"
import { useAppearanceDraftPreview } from "./AppearanceDraftPreviewProvider"

export type AppearancePreviewWidth = "desktop" | "mobile"

type AppearanceDraftPreviewFrameProps = {
  widthMode: AppearancePreviewWidth
}

function noop(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault()
  event.stopPropagation()
}

const MOCK_CATEGORY_CARDS = [
  { key: "cabinet", name: "Sample wall cabinet", qty: "12 ea", price: "$84.00" },
  { key: "vanity", name: "Sample vanity top", qty: "4 ea", price: "$220.00" },
  { key: "hinge", name: "Sample soft-close hinge", qty: "48 ea", price: "$6.50" },
] as const

/** Fixed mock values for allowlisted field IDs — preview only. */
function MockLabeledValue({
  id,
  children,
}: {
  id: InventoryCardFieldId
  children: ReactNode
}) {
  return (
    <div className="appearance-preview-field">
      <span className="appearance-preview-field-label">{INVENTORY_CARD_FIELD_LABELS[id]}</span>
      <span className="appearance-preview-field-value">{children}</span>
    </div>
  )
}

function renderMockInventoryField(
  id: InventoryCardFieldId,
  mode: "detail" | "compact",
  cardIndex = 0,
): ReactNode {
  const sample = MOCK_CATEGORY_CARDS[cardIndex % MOCK_CATEGORY_CARDS.length] || MOCK_CATEGORY_CARDS[0]

  switch (id) {
    case "holdStatus":
      return (
        <p className="appearance-preview-field appearance-preview-field-hold" key={id}>
          <span className="appearance-preview-field-label">
            {INVENTORY_CARD_FIELD_LABELS.holdStatus}
          </span>
          <span className="appearance-preview-field-value">Available</span>
        </p>
      )
    case "productName":
      return mode === "compact" ? (
        <h4 className="appearance-preview-compact-name" key={id}>
          {sample.name}
        </h4>
      ) : (
        <h3 className="appearance-preview-card-name" key={id}>
          {sample.name}
        </h3>
      )
    case "quantity":
      return (
        <MockLabeledValue id={id} key={id}>
          {sample.qty}
        </MockLabeledValue>
      )
    case "badges":
      return (
        <div className="appearance-preview-card-top" key={id}>
          <Badge>Cabinetry</Badge>
          <Badge>Soft-close</Badge>
        </div>
      )
    case "unitCost":
      return (
        <MockLabeledValue id={id} key={id}>
          {sample.price}
        </MockLabeledValue>
      )
    case "location":
      return (
        <MockLabeledValue id={id} key={id}>
          Aisle B / Bay 3
        </MockLabeledValue>
      )
    case "dimensions":
      return (
        <MockLabeledValue id={id} key={id}>
          30 × 18 × 12 in
        </MockLabeledValue>
      )
    case "totalValue":
      return (
        <MockLabeledValue id={id} key={id}>
          $1,008.00
        </MockLabeledValue>
      )
    case "status":
      return (
        <MockLabeledValue id={id} key={id}>
          active
        </MockLabeledValue>
      )
    case "createdAt":
      return (
        <MockLabeledValue id={id} key={id}>
          Aug 1, 2026
        </MockLabeledValue>
      )
    case "notes":
      return (
        <p className="appearance-preview-card-notes" key={id}>
          Preview-only mock notes. No inventory data is loaded here.
        </p>
      )
    case "usageHistory":
      return (
        <MockLabeledValue id={id} key={id}>
          3 uses (mock)
        </MockLabeledValue>
      )
    case "photos":
      return mode === "compact" ? (
        <div className="appearance-preview-compact-photo" aria-hidden="true" key={id} />
      ) : (
        <MockLabeledValue id={id} key={id}>
          2 photos (mock)
        </MockLabeledValue>
      )
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

function PreviewActionButton({ slot }: { slot: InventoryActionSlotId }) {
  const label = INVENTORY_ACTION_SLOT_LABELS[slot]
  const variant =
    slot === "edit" ? "edit" : slot === "use" ? "primary" : slot === "delete" ? "danger" : "secondary"

  return (
    <Button type="button" variant={variant} size="sm" tabIndex={-1} onClick={noop}>
      {label}
    </Button>
  )
}

function PreviewListCard({
  fieldOrder,
  hiddenFields,
  actionOrder,
  moreActions,
}: {
  fieldOrder: readonly string[]
  hiddenFields: readonly string[]
  actionOrder: readonly InventoryActionSlotId[]
  moreActions: readonly InventoryActionSlotId[]
}) {
  const visibleFields = resolveVisibleInventoryFields({
    fieldOrder,
    hiddenFields,
    isEditing: false,
    mode: "detail",
  })

  return (
    <article className="appearance-preview-card item-card">
      {visibleFields.map((id) => renderMockInventoryField(id, "detail"))}
      <div className="appearance-preview-actions action-row">
        {actionOrder.length === 0 ? (
          <p className="small">No primary actions configured.</p>
        ) : (
          actionOrder.map((slot) => <PreviewActionButton key={slot} slot={slot} />)
        )}
      </div>
      <div className="appearance-preview-more-actions" aria-label="More Actions preview">
        <p className="appearance-preview-more-actions-label small">More Actions (mock)</p>
        {moreActions.length === 0 ? (
          <p className="small appearance-preview-more-actions-empty">No More Actions configured.</p>
        ) : (
          <div className="appearance-preview-actions action-row">
            {moreActions.map((slot) => (
              <PreviewActionButton key={slot} slot={slot} />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function PreviewCompactCard({
  cardIndex,
  fieldOrder,
  hiddenFields,
  actionOrder,
  moreActions,
}: {
  cardIndex: number
  fieldOrder: readonly string[]
  hiddenFields: readonly string[]
  actionOrder: readonly InventoryActionSlotId[]
  moreActions: readonly InventoryActionSlotId[]
}) {
  const visibleFields = resolveVisibleInventoryFields({
    fieldOrder,
    hiddenFields,
    isEditing: false,
    mode: "compact",
  })

  return (
    <article className="appearance-preview-compact-card">
      {visibleFields.map((id) => renderMockInventoryField(id, "compact", cardIndex))}
      <div className="appearance-preview-compact-actions">
        {actionOrder.length === 0 ? (
          <p className="small">No primary actions configured.</p>
        ) : (
          actionOrder.map((slot) => <PreviewActionButton key={slot} slot={slot} />)
        )}
      </div>
      <div className="appearance-preview-more-actions" aria-label="More Actions preview">
        <p className="appearance-preview-more-actions-label small">More Actions (mock)</p>
        {moreActions.length === 0 ? (
          <p className="small appearance-preview-more-actions-empty">No More Actions configured.</p>
        ) : (
          <div className="appearance-preview-compact-actions">
            {moreActions.map((slot) => (
              <PreviewActionButton key={slot} slot={slot} />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Mock-only appearance preview. Does not navigate, mutate data, or call real handlers.
 */
export default function AppearanceDraftPreviewFrame({
  widthMode,
}: AppearanceDraftPreviewFrameProps) {
  const { config } = useAppearanceDraftPreview()

  const navIds = config.nav.order.filter((id): id is NavItemId => id in NAV_LINK_REGISTRY)
  const jobTabs = config.jobs.tabOrder.filter(
    (id): id is JobsViewMode => id in JOBS_TAB_REGISTRY,
  )
  const isList = config.inventory.defaultView === "list"
  const detailLabel =
    config.inventory.detailPresentation === "modal"
      ? "Item details open in a modal"
      : "Item details expand inline"
  const { fieldOrder, hiddenFields, actionOrder, moreActions } = config.inventory.card

  return (
    <div
      className={`appearance-preview-frame appearance-preview-frame-${widthMode}`}
      data-preview-width={widthMode}
      aria-label="Appearance draft preview"
    >
      <div className="appearance-preview-chrome">
        <div className="appearance-preview-header">
          <div className="appearance-preview-brand">
            <div className="appearance-preview-logo" aria-hidden="true" />
            <h2 className="appearance-preview-title">{config.branding.appTitle}</h2>
          </div>
          <nav className="appearance-preview-nav" aria-label="Preview navigation">
            {navIds.map((id) => (
              <button
                key={id}
                type="button"
                className="appearance-preview-nav-link"
                onClick={noop}
                tabIndex={-1}
              >
                {NAV_LINK_REGISTRY[id].label}
              </button>
            ))}
          </nav>
        </div>

        <div className="appearance-preview-toolbar">
          <SearchField
            toolbar
            readOnly
            value=""
            placeholder="Search inventory…"
            aria-label="Preview search"
            tabIndex={-1}
            onChange={noop}
            onFocus={(e) => e.currentTarget.blur()}
          />
          <div className="appearance-preview-toolbar-actions">
            <Button
              type="button"
              variant={isList ? "primary" : "secondary"}
              size="sm"
              tabIndex={-1}
              onClick={noop}
            >
              List
            </Button>
            <Button
              type="button"
              variant={!isList ? "primary" : "secondary"}
              size="sm"
              tabIndex={-1}
              onClick={noop}
            >
              Category
            </Button>
            <Button type="button" variant="primary" size="sm" tabIndex={-1} onClick={noop}>
              Add Inventory
            </Button>
          </div>
        </div>

        <p className="appearance-preview-detail-note small">{detailLabel}</p>

        {isList ? (
          <PreviewListCard
            fieldOrder={fieldOrder}
            hiddenFields={hiddenFields}
            actionOrder={actionOrder}
            moreActions={moreActions}
          />
        ) : (
          <div
            className="appearance-preview-category-grid"
            data-preview-grid-columns={
              widthMode === "mobile" ? "one" : config.inventory.gridColumns
            }
          >
            {MOCK_CATEGORY_CARDS.map((card, index) => (
              <PreviewCompactCard
                key={card.key}
                cardIndex={index}
                fieldOrder={fieldOrder}
                hiddenFields={hiddenFields}
                actionOrder={actionOrder}
                moreActions={moreActions}
              />
            ))}
          </div>
        )}

        <div className="appearance-preview-jobs">
          <h3 className="appearance-preview-section-title">Jobs tabs (preview)</h3>
          <ViewToggle
            ariaLabel="Preview jobs tabs"
            focusable={false}
            options={jobTabs.map((id) => ({
              id,
              label: JOBS_TAB_REGISTRY[id].label,
              active: id === config.jobs.defaultTab,
              onSelect: () => {},
            }))}
          />
        </div>
      </div>
    </div>
  )
}
