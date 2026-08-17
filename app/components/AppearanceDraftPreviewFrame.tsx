"use client"

import {
  JOBS_TAB_REGISTRY,
  NAV_LINK_REGISTRY,
  type NavItemId,
  type JobsViewMode,
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
  { name: "Sample wall cabinet", qty: "12 ea", price: "$84.00" },
  { name: "Sample vanity top", qty: "4 ea", price: "$220.00" },
  { name: "Sample soft-close hinge", qty: "48 ea", price: "$6.50" },
] as const

function PreviewListCard() {
  return (
    <article className="appearance-preview-card item-card">
      <div className="appearance-preview-card-top">
        <Badge>Cabinetry</Badge>
        <Badge>Soft-close</Badge>
      </div>
      <h3 className="appearance-preview-card-name">Sample wall cabinet</h3>
      <dl className="appearance-preview-card-meta">
        <div>
          <dt>Qty</dt>
          <dd>12 ea</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>$84.00</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>active</dd>
        </div>
      </dl>
      <p className="appearance-preview-card-notes">
        Preview-only mock list card. No inventory data is loaded here.
      </p>
      <div className="appearance-preview-actions action-row">
        <Button type="button" variant="edit" size="sm" tabIndex={-1} onClick={noop}>
          Edit
        </Button>
        <Button type="button" variant="primary" size="sm" tabIndex={-1} onClick={noop}>
          Use
        </Button>
        <Button type="button" variant="secondary" size="sm" tabIndex={-1} onClick={noop}>
          Hold
        </Button>
        <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={noop}>
          More Actions
        </Button>
      </div>
    </article>
  )
}

function PreviewCompactCard({
  name,
  qty,
  price,
}: {
  name: string
  qty: string
  price: string
}) {
  return (
    <article className="appearance-preview-compact-card">
      <div className="appearance-preview-compact-photo" aria-hidden="true" />
      <h4 className="appearance-preview-compact-name">{name}</h4>
      <div className="appearance-preview-compact-meta">
        <span>{qty}</span>
        <span>{price}</span>
      </div>
      <div className="appearance-preview-compact-actions">
        <Button type="button" variant="edit" size="sm" tabIndex={-1} onClick={noop}>
          Edit
        </Button>
        <Button type="button" variant="primary" size="sm" tabIndex={-1} onClick={noop}>
          Use
        </Button>
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
          <PreviewListCard />
        ) : (
          <div
            className="appearance-preview-category-grid"
            data-preview-grid-columns={
              widthMode === "mobile" ? "one" : config.inventory.gridColumns
            }
          >
            {MOCK_CATEGORY_CARDS.map((card) => (
              <PreviewCompactCard
                key={card.name}
                name={card.name}
                qty={card.qty}
                price={card.price}
              />
            ))}
          </div>
        )}

        <section className="appearance-preview-jobs" aria-label="Preview jobs tabs">
          <h3 className="appearance-preview-section-title">Jobs</h3>
          <ViewToggle
            ariaLabel="Preview jobs tabs"
            focusable={false}
            options={jobTabs.map((id) => ({
              id,
              label: JOBS_TAB_REGISTRY[id].label,
              active: id === config.jobs.defaultTab,
              onSelect: () => undefined,
            }))}
          />
        </section>
      </div>
    </div>
  )
}
