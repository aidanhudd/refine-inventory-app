"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "../lib/supabaseClient"
import { safeGetItem, safeSetItem } from "../lib/storageSafe"
import { useAuth } from "./components/AuthProvider"
import { useHidePrices } from "./components/HidePricesProvider"
import InventoryItemCard from "./components/InventoryItemCard"
import InventoryCategoryGridCard from "./components/InventoryCategoryGridCard"
import CategoryExpandedItemPanel from "./components/CategoryExpandedItemPanel"
import CategoryItemDetailModal from "./components/CategoryItemDetailModal"
import UseInventoryModal from "./components/UseInventoryModal"
import HoldItemModal from "./components/HoldItemModal"
import ItemDimensionsFields from "./components/ItemDimensionsFields"
import {
  buildDimensionPayload,
  calculateSquareFeetFromStrings,
  categoryIdSupportsDimensions,
  formatSquareFeetNumber,
  normalizeDimensionValue,
} from "../lib/inventoryDimensions"
import { canUndoSharedUsage, formatPhase2Error } from "../lib/customersJobs"
import { releaseItemHoldRpc } from "../lib/customerJobApi"
import { type InventoryViewMode } from "../lib/appearance"
import { useAppearance } from "./components/AppearanceProvider"
import { Button, EmptyState, Notice, SearchField, Toolbar, ViewToggle } from "./components/ui"

type Category = {
  id: string
  name: string
}

type Subcategory = {
  id: string
  category_id: string
  name: string
}

type QuantityType = {
  id: string
  name: string
}

type InventoryItem = {
  id: string
  sku: string | null
  product_name: string | null
  category_id: string | null
  subcategory_id: string | null
  quantity_on_hand: number | null
  quantity_type: string | null
  unit_cost: number | null
  warehouse_location: string | null
  notes: string | null
  status: string | null
  hold_last_name: string | null
  hold_at: string | null
  hold_customer_id: string | null
  hold_job_id: string | null
  created_at: string | null
  length_inches: number | null
  width_inches: number | null
  square_feet: number | null
}

type UsageRow = {
  id: string
  item_id: string
  user_id: string | null
  job_id: string | null
  job_name: string | null
  quantity_used: number | null
  notes: string | null
  used_at: string | null
}

type PhotoMap = Record<string, string[]>
type InlineEditForm = {
  product_name: string
  category_id: string
  subcategory_id: string
  quantity_on_hand: string
  quantity_type: string
  unit_cost: string
  warehouse_location: string
  notes: string
  length_inches: string
  width_inches: string
  square_feet: string
}

type SoldUndoSnapshot = {
  status: string
  quantity_on_hand: number
}

const defaultInlineDraft = (
  categories: Category[],
  quantityTypes: QuantityType[],
  categoryFilter: string,
  subcategoryFilter: string,
): InlineEditForm => ({
  product_name: "",
  category_id: categoryFilter && categoryFilter !== "all" ? categoryFilter : categories[0]?.id || "",
  subcategory_id: subcategoryFilter && subcategoryFilter !== "none" ? subcategoryFilter : "",
  quantity_on_hand: "1",
  quantity_type: quantityTypes[0]?.name || "",
  unit_cost: "",
  warehouse_location: "",
  notes: "",
  length_inches: "",
  width_inches: "",
  square_feet: "",
})

const SETTING_MATS_CATEGORY_NAME = "Setting Mats"
const NEW_ITEM_DRAFT_ID = "__new-item__"
const INVENTORY_VIEW_STORAGE_KEY = "inventory-view-mode"

type InventorySubcategoryGroup = {
  key: string
  name: string
  items: InventoryItem[]
}

type InventoryCategoryGroup = {
  key: string
  name: string
  subcategories: InventorySubcategoryGroup[]
  itemCount: number
}

const UNCategorized_CATEGORY_KEY = "__uncategorized__"
const NO_SUBCATEGORY_KEY = "__none__"

const normalizeInventoryItem = (item: InventoryItem): InventoryItem => ({
  ...item,
  hold_last_name: item.hold_last_name ?? null,
  hold_at: item.hold_at ?? null,
  hold_customer_id: item.hold_customer_id ?? null,
  hold_job_id: item.hold_job_id ?? null,
  length_inches: normalizeDimensionValue(item.length_inches),
  width_inches: normalizeDimensionValue(item.width_inches),
  square_feet: normalizeDimensionValue(item.square_feet),
})

const getActionableSupabaseError = (message: string) => {
  const lower = message.toLowerCase()

  if (lower.includes("column") && lower.includes("user_id")) {
    return "Database migration missing: run supabase/migrations/20260428_inventory_usage_user_auth.sql in Supabase SQL Editor, then retry."
  }

  if (lower.includes("subcategor") || (lower.includes("column") && lower.includes("subcategory_id"))) {
    return "Database migration missing: run supabase/migrations/20260519_inventory_subcategories.sql in Supabase SQL Editor, then retry."
  }

  if (
    lower.includes("length_inches") ||
    lower.includes("width_inches") ||
    lower.includes("square_feet")
  ) {
    return "Database migration missing: run supabase/migrations/20260520_inventory_item_dimensions.sql in Supabase SQL Editor, then retry."
  }

  if (
    lower.includes("hold_last_name") ||
    lower.includes("hold_at")
  ) {
    return "Database migration missing: run supabase/migrations/20260713_inventory_item_holds.sql in Supabase SQL Editor, then retry."
  }

  if (lower.includes("row-level security")) {
    return "Permission blocked by Supabase RLS. Confirm you are logged in and that inventory_usage policies are applied."
  }

  if (lower.includes("permission denied") && lower.includes("inventory_items")) {
    return "Permission denied on inventory_items update. Check RLS/table permissions for authenticated users."
  }

  if (
    lower.includes("customers") ||
    lower.includes("jobs") ||
    (lower.includes("column") && lower.includes("job_id"))
  ) {
    return "Database migration missing: run supabase/migrations/20260817152650_customers_jobs_schema.sql in Supabase SQL Editor, then retry."
  }

  return message
}

const formatCurrency = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" })

const validateCategorySubcategory = (
  categoryId: string,
  subcategoryId: string,
  subcategories: Subcategory[],
) => {
  if (!subcategoryId) return null
  if (!categoryId) return "Select a category before choosing a subcategory."
  const subcategory = subcategories.find((sub) => sub.id === subcategoryId)
  if (!subcategory) return "Selected subcategory is invalid."
  if (subcategory.category_id !== categoryId) {
    return "Selected subcategory does not belong to the chosen category."
  }
  return null
}

export default function Home() {
  const { user, profile } = useAuth()
  const { hidePrices } = useHidePrices()
  const { config } = useAppearance()
  const inventoryViewTouchedRef = useRef(false)
  const categoryCardRefs = useRef<Map<string, HTMLElement>>(new Map())
  const categoryDetailReturnFocusIdRef = useRef<string | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [subcategories, setSubcategories] = useState<Subcategory[]>([])
  const [quantityTypes, setQuantityTypes] = useState<QuantityType[]>([])
  const [usageList, setUsageList] = useState<UsageRow[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [subcategoryFilter, setSubcategoryFilter] = useState("")
  const [categoryPickerCollapsed, setCategoryPickerCollapsed] = useState(false)
  const [jobSearch, setJobSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [newItemFiles, setNewItemFiles] = useState<File[]>([])
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null)
  const [photoMap, setPhotoMap] = useState<PhotoMap>({})
  const [activeImage, setActiveImage] = useState<string | null>(null)
  const [useModalOpen, setUseModalOpen] = useState(false)
  const [holdModalOpen, setHoldModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)
  const [inlineDraft, setInlineDraft] = useState<InlineEditForm | null>(null)
  const [inlineSaving, setInlineSaving] = useState(false)
  const [soldUndoMap, setSoldUndoMap] = useState<Record<string, SoldUndoSnapshot>>({})
  const [undoingUsageId, setUndoingUsageId] = useState<string | null>(null)
  const [settingMatsBootstrapping, setSettingMatsBootstrapping] = useState(false)
  const [inventoryViewMode, setInventoryViewMode] = useState<InventoryViewMode>(
    () => config.inventory.defaultView,
  )
  const [collapsedBrowseGroups, setCollapsedBrowseGroups] = useState<Set<string>>(() => new Set())
  const [categoryExpandedItemId, setCategoryExpandedItemId] = useState<string | null>(null)
  const inlineDraftRef = useRef<InlineEditForm | null>(null)

  useEffect(() => {
    inlineDraftRef.current = inlineDraft
  }, [inlineDraft])

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    const stored = safeGetItem("local", INVENTORY_VIEW_STORAGE_KEY)
    if (stored === "list" || stored === "category") {
      setInventoryViewMode(stored)
      return
    }
    setInventoryViewMode(config.inventory.defaultView)
  }, [])

  useEffect(() => {
    if (inventoryViewTouchedRef.current) return
    const stored = safeGetItem("local", INVENTORY_VIEW_STORAGE_KEY)
    if (stored === "list" || stored === "category") return
    setInventoryViewMode(config.inventory.defaultView)
  }, [config.inventory.defaultView])

  const loadAll = async () => {
    setLoading(true)
    setErrorMessage("")

    try {
      const [itemsRes, categoriesRes, subcategoriesRes, quantityTypesRes, usageRes] = await Promise.all([
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
        supabase.from("categories").select("*").order("name", { ascending: true }),
        supabase.from("subcategories").select("*").order("name", { ascending: true }),
        supabase.from("quantity_types").select("*").order("name", { ascending: true }),
        supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      ])

      if (itemsRes.error) {
        console.error("[Inventory] inventory_items load failed:", itemsRes.error)
        setErrorMessage(getActionableSupabaseError(itemsRes.error.message))
      }
      if (categoriesRes.error) {
        console.error("[Inventory] categories load failed:", categoriesRes.error)
        setErrorMessage(categoriesRes.error.message)
      }
      if (subcategoriesRes.error) {
        console.error("[Inventory] subcategories load failed:", subcategoriesRes.error)
        setErrorMessage(getActionableSupabaseError(subcategoriesRes.error.message))
      }
      if (quantityTypesRes.error) {
        console.error("[Inventory] quantity_types load failed:", quantityTypesRes.error)
        setErrorMessage(quantityTypesRes.error.message)
      }
      if (usageRes.error) {
        console.error("[Inventory] inventory_usage load failed:", usageRes.error)
        setErrorMessage(usageRes.error.message)
      }

      const loadedItems = (itemsRes.data || []).map((item) => normalizeInventoryItem(item as InventoryItem))
      setItems(loadedItems)
      setCategories(categoriesRes.data || [])
      setSubcategories(subcategoriesRes.data || [])
      setQuantityTypes(quantityTypesRes.data || [])
      setUsageList((usageRes.data as UsageRow[]) || [])

      await loadPhotosForItems(loadedItems)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load inventory"
      console.error("[Inventory] loadAll failed:", error)
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }

  const settingMatsCategory = useMemo(
    () =>
      categories.find((c) => c.name.trim().toLowerCase() === SETTING_MATS_CATEGORY_NAME.toLowerCase()) ?? null,
    [categories],
  )

  const selectCategory = (id: string) => {
    setCategoryFilter(id)
    setSubcategoryFilter("")
  }

  const handleSettingMatsCategory = async () => {
    if (settingMatsCategory) {
      selectCategory(settingMatsCategory.id)
      return
    }
    setSettingMatsBootstrapping(true)
    setErrorMessage("")
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: SETTING_MATS_CATEGORY_NAME })
      .select("id")
      .single()
    if (error) {
      setErrorMessage(getActionableSupabaseError(error.message))
      setSettingMatsBootstrapping(false)
      return
    }
    await loadAll()
    if (data?.id) selectCategory(data.id)
    setSettingMatsBootstrapping(false)
  }

  const loadPhotosForItems = async (loadedItems: InventoryItem[]) => {
    const nextMap: PhotoMap = {}

    for (const item of loadedItems) {
      const { data, error } = await supabase.storage.from("inventory-photos").list(item.id, {
        limit: 20,
        sortBy: { column: "name", order: "asc" },
      })

      if (!error && data) {
        nextMap[item.id] = data.map((file) => {
          const { data: publicUrlData } = supabase.storage
            .from("inventory-photos")
            .getPublicUrl(`${item.id}/${file.name}`)
          return publicUrlData.publicUrl
        })
      }
    }

    setPhotoMap(nextMap)
  }

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((cat) => map.set(cat.id, cat.name))
    return map
  }, [categories])

  const subcategoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    subcategories.forEach((sub) => map.set(sub.id, sub.name))
    return map
  }, [subcategories])

  const subcategoriesInView = useMemo(() => {
    if (categoryFilter === "all" || !categoryFilter) return []
    return subcategories.filter((sub) => sub.category_id === categoryFilter)
  }, [subcategories, categoryFilter])

  const isAddingNew = inlineEditingId === NEW_ITEM_DRAFT_ID && !!inlineDraft
  const isCategoryView = inventoryViewMode === "category"
  const detailPresentation = config.inventory.detailPresentation
  const isCategoryModalPresentation = isCategoryView && detailPresentation === "modal"
  const isCategoryExpandPresentation = isCategoryView && detailPresentation === "expand"

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const categoryName = item.category_id ? categoryNameById.get(item.category_id) || "" : ""
      const subcategoryName = item.subcategory_id ? subcategoryNameById.get(item.subcategory_id) || "" : ""
      const haystack = [
        item.sku || "",
        item.product_name || "",
        categoryName,
        subcategoryName,
        item.quantity_type || "",
        item.warehouse_location || "",
        item.notes || "",
        item.status || "",
        item.length_inches != null ? String(item.length_inches) : "",
        item.width_inches != null ? String(item.width_inches) : "",
        item.square_feet != null ? String(item.square_feet) : "",
      ]
        .join(" ")
        .toLowerCase()

      const matchesSearch = !search || haystack.includes(search.toLowerCase())
      const matchesStatus = statusFilter === "all" || (item.status || "").toLowerCase() === statusFilter
      const matchesCategory = categoryFilter === "all" || item.category_id === categoryFilter
      const matchesSubcategory = (() => {
        if (categoryFilter === "all" || !subcategoryFilter) return true
        if (subcategoryFilter === "none") return !item.subcategory_id
        return item.subcategory_id === subcategoryFilter
      })()

      return matchesSearch && matchesStatus && matchesCategory && matchesSubcategory
    })
  }, [
    items,
    search,
    statusFilter,
    categoryFilter,
    subcategoryFilter,
    categoryNameById,
    subcategoryNameById,
  ])

  const groupedInventory = useMemo((): InventoryCategoryGroup[] => {
    const itemsByCategory = new Map<string, InventoryItem[]>()

    filteredItems.forEach((item) => {
      const categoryKey = item.category_id || UNCategorized_CATEGORY_KEY
      const categoryItems = itemsByCategory.get(categoryKey) || []
      categoryItems.push(item)
      itemsByCategory.set(categoryKey, categoryItems)
    })

    const groups: InventoryCategoryGroup[] = []

    itemsByCategory.forEach((categoryItems, categoryKey) => {
      const itemsBySubcategory = new Map<string, InventoryItem[]>()

      categoryItems.forEach((item) => {
        const subcategoryKey = item.subcategory_id || NO_SUBCATEGORY_KEY
        const subcategoryItems = itemsBySubcategory.get(subcategoryKey) || []
        subcategoryItems.push(item)
        itemsBySubcategory.set(subcategoryKey, subcategoryItems)
      })

      const subcategories: InventorySubcategoryGroup[] = []

      itemsBySubcategory.forEach((subcategoryItems, subcategoryKey) => {
        subcategories.push({
          key: subcategoryKey,
          name:
            subcategoryKey === NO_SUBCATEGORY_KEY
              ? "No subcategory"
              : subcategoryNameById.get(subcategoryKey) || "Unknown subcategory",
          items: subcategoryItems,
        })
      })

      subcategories.sort((a, b) => {
        if (a.key === NO_SUBCATEGORY_KEY) return 1
        if (b.key === NO_SUBCATEGORY_KEY) return -1
        return a.name.localeCompare(b.name)
      })

      groups.push({
        key: categoryKey,
        name:
          categoryKey === UNCategorized_CATEGORY_KEY
            ? "Uncategorized"
            : categoryNameById.get(categoryKey) || "Unknown category",
        subcategories,
        itemCount: categoryItems.length,
      })
    })

    groups.sort((a, b) => {
      if (a.key === UNCategorized_CATEGORY_KEY) return 1
      if (b.key === UNCategorized_CATEGORY_KEY) return -1
      return a.name.localeCompare(b.name)
    })

    return groups
  }, [filteredItems, categoryNameById, subcategoryNameById])

  useEffect(() => {
    if (categoryExpandedItemId && !filteredItems.some((item) => item.id === categoryExpandedItemId)) {
      if (inlineEditingId === categoryExpandedItemId) {
        cancelInlineEdit()
      }
      setCategoryExpandedItemId(null)
      categoryDetailReturnFocusIdRef.current = null
    }
  }, [filteredItems, categoryExpandedItemId, inlineEditingId])

  const hasSelectedInventoryView = useMemo(() => {
    if (categoryFilter === "all") return true
    return categories.some((category) => category.id === categoryFilter)
  }, [categoryFilter, categories])

  const selectedCategoryName = useMemo(() => {
    if (categoryFilter === "all") return "All Inventory"
    return categoryNameById.get(categoryFilter) || ""
  }, [categoryFilter, categoryNameById])

  const selectedViewLabel = useMemo(() => {
    if (categoryFilter === "all") return "All Inventory"
    if (!subcategoryFilter) return selectedCategoryName
    if (subcategoryFilter === "none") return `${selectedCategoryName} (no subcategory)`
    const subName = subcategoryNameById.get(subcategoryFilter)
    return subName ? `${selectedCategoryName} › ${subName}` : selectedCategoryName
  }, [categoryFilter, subcategoryFilter, selectedCategoryName, subcategoryNameById])

  const browseFilterSummary = useMemo(() => {
    if (!categoryFilter) return "No category selected"
    return selectedViewLabel
  }, [categoryFilter, selectedViewLabel])

  const itemCountsByCategory = useMemo(() => {
    const counts = new Map<string, number>()
    items.forEach((item) => {
      if (!item.category_id) return
      counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1)
    })
    return counts
  }, [items])

  const itemCountsBySubcategory = useMemo(() => {
    const counts = new Map<string, number>()
    if (categoryFilter === "all" || !categoryFilter) return counts

    items.forEach((item) => {
      if (item.category_id !== categoryFilter || !item.subcategory_id) return
      counts.set(item.subcategory_id, (counts.get(item.subcategory_id) || 0) + 1)
    })
    return counts
  }, [items, categoryFilter])

  const uncategorizedCountInView = useMemo(() => {
    if (categoryFilter === "all" || !categoryFilter) return 0
    return items.filter((item) => item.category_id === categoryFilter && !item.subcategory_id).length
  }, [items, categoryFilter])

  const totalValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const qty = Number(item.quantity_on_hand || 0)
      const cost = Number(item.unit_cost || 0)
      return sum + qty * cost
    }, 0)
  }, [items])

  const soldCount = useMemo(() => {
    return items.filter((item) => (item.status || "").toLowerCase() === "sold").length
  }, [items])

  const jobEntries = useMemo(() => {
    const grouped: Record<string, UsageRow[]> = {}

    usageList.forEach((row) => {
      const key = (row.job_name || "No Job").trim() || "No Job"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(row)
    })

    return Object.entries(grouped)
      .filter(([job]) => job.toLowerCase().includes(jobSearch.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [usageList, jobSearch])

  const getPhotoUrl = (itemId: string, fileName: string) => {
    const { data: publicUrlData } = supabase.storage
      .from("inventory-photos")
      .getPublicUrl(`${itemId}/${fileName}`)
    return publicUrlData.publicUrl
  }

  const loadPhotosForItem = async (itemId: string) => {
    const { data, error } = await supabase.storage.from("inventory-photos").list(itemId, {
      limit: 20,
      sortBy: { column: "name", order: "asc" },
    })

    if (error) throw error

    const urls = (data || []).map((file) => getPhotoUrl(itemId, file.name))
    setPhotoMap((prev) => ({ ...prev, [itemId]: urls }))
  }

  const uploadPhotos = async (itemId: string, files: File[]) => {
    if (!files.length) return []

    const uploadedUrls: string[] = []

    for (const file of files) {
      const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`
      const { error } = await supabase.storage
        .from("inventory-photos")
        .upload(`${itemId}/${safeName}`, file, { upsert: true })

      if (error) throw error
      uploadedUrls.push(getPhotoUrl(itemId, safeName))
    }

    return uploadedUrls
  }

  const openAddForm = () => {
    cancelInlineEdit()
    setMessage("")
    setErrorMessage("")
    setNewItemFiles([])
    setInlineEditingId(NEW_ITEM_DRAFT_ID)
    setInlineDraft(defaultInlineDraft(categories, quantityTypes, categoryFilter, subcategoryFilter))
  }

  const startInlineEdit = (item: InventoryItem) => {
    cancelInlineEdit()
    setInlineEditingId(item.id)
    setInlineDraft({
      product_name: item.product_name || "",
      category_id: item.category_id || "",
      subcategory_id: item.subcategory_id || "",
      quantity_on_hand: String(item.quantity_on_hand ?? 0),
      quantity_type: item.quantity_type || quantityTypes[0]?.name || "",
      unit_cost: String(item.unit_cost ?? 0),
      warehouse_location: item.warehouse_location || "",
      notes: item.notes || "",
      length_inches: item.length_inches != null ? String(item.length_inches) : "",
      width_inches: item.width_inches != null ? String(item.width_inches) : "",
      square_feet: item.square_feet != null ? formatSquareFeetNumber(item.square_feet) : "",
    })
    setErrorMessage("")
    setMessage("")
  }

  const cancelInlineEdit = () => {
    setInlineEditingId(null)
    setInlineDraft(null)
    setInlineSaving(false)
    setNewItemFiles([])
  }

  const updateInlineDraft = (key: keyof InlineEditForm, value: string) => {
    setInlineDraft((prev) => {
      if (!prev) return prev
      const next = { ...prev, [key]: value }
      if (key === "category_id") {
        const subcategoryStillValid = subcategories.some(
          (sub) => sub.id === prev.subcategory_id && sub.category_id === value,
        )
        if (!subcategoryStillValid) next.subcategory_id = ""
        if (!categoryIdSupportsDimensions(value, categories)) {
          next.length_inches = ""
          next.width_inches = ""
          next.square_feet = ""
        }
      }
      if (key === "length_inches" || key === "width_inches") {
        next.square_feet = calculateSquareFeetFromStrings(
          key === "length_inches" ? value : next.length_inches,
          key === "width_inches" ? value : next.width_inches,
        )
      }
      return next
    })
  }

  const saveNewItem = async () => {
    const draft = inlineDraftRef.current
    if (!draft) return

    if (!draft.product_name.trim()) {
      setErrorMessage("Product name is required.")
      return
    }

    const categoryValidationError = validateCategorySubcategory(
      draft.category_id,
      draft.subcategory_id,
      subcategories,
    )
    if (categoryValidationError) {
      setErrorMessage(categoryValidationError)
      return
    }

    setInlineSaving(true)
    setErrorMessage("")
    setMessage("")

    const dimensions = buildDimensionPayload(
      draft.category_id,
      categories,
      draft.length_inches,
      draft.width_inches,
      draft.square_feet,
    )

    const payload = {
      sku: null,
      product_name: draft.product_name,
      category_id: draft.category_id || null,
      subcategory_id: draft.subcategory_id || null,
      quantity_on_hand: Number(draft.quantity_on_hand || 0),
      quantity_type: draft.quantity_type || null,
      unit_cost: Number(draft.unit_cost || 0),
      warehouse_location: draft.warehouse_location || null,
      notes: draft.notes || null,
      status: "active",
      ...dimensions,
    }

    const { data, error } = await supabase.from("inventory_items").insert([payload]).select().single()

    if (error || !data) {
      setErrorMessage(error?.message || "Failed to save item.")
      setInlineSaving(false)
      return
    }

    try {
      if (newItemFiles.length) {
        const uploadedUrls = await uploadPhotos(data.id, newItemFiles)
        if (uploadedUrls.length) {
          setPhotoMap((prev) => ({ ...prev, [data.id]: uploadedUrls }))
        }
      }
      setItems((prev) => [normalizeInventoryItem(data as InventoryItem), ...prev])
      setMessage("Item saved successfully.")
      cancelInlineEdit()
    } catch (uploadError: any) {
      setItems((prev) => [normalizeInventoryItem(data as InventoryItem), ...prev])
      setErrorMessage(`Item saved, but photo upload failed: ${uploadError.message}`)
      cancelInlineEdit()
    }

    setInlineSaving(false)
  }

  const saveInlineEdit = async (item: InventoryItem) => {
    const draft = inlineDraftRef.current
    if (!draft) return

    if (!draft.product_name.trim()) {
      setErrorMessage("Product name is required.")
      return
    }

    const categoryValidationError = validateCategorySubcategory(
      draft.category_id,
      draft.subcategory_id,
      subcategories,
    )
    if (categoryValidationError) {
      setErrorMessage(categoryValidationError)
      return
    }

    setInlineSaving(true)
    setErrorMessage("")
    setMessage("")

    const dimensions = buildDimensionPayload(
      draft.category_id,
      categories,
      draft.length_inches,
      draft.width_inches,
      draft.square_feet,
    )

    const payload = {
      product_name: draft.product_name,
      category_id: draft.category_id || null,
      subcategory_id: draft.subcategory_id || null,
      quantity_on_hand: Number(draft.quantity_on_hand || 0),
      quantity_type: draft.quantity_type || null,
      unit_cost: Number(draft.unit_cost || 0),
      warehouse_location: draft.warehouse_location || null,
      notes: draft.notes || null,
      ...dimensions,
    }

    const { data: updatedItem, error } = await supabase
      .from("inventory_items")
      .update(payload)
      .eq("id", item.id)
      .select()
      .single()

    if (error || !updatedItem) {
      setErrorMessage(error?.message || "Failed to update item.")
      setInlineSaving(false)
      return
    }

    const savedItem = normalizeInventoryItem({
      ...(updatedItem as InventoryItem),
      ...dimensions,
    })

    setItems((prev) =>
      prev.map((existingItem) => (existingItem.id === item.id ? savedItem : existingItem)),
    )
    setMessage("Item updated successfully.")
    cancelInlineEdit()
  }

  const deleteItem = async (id: string) => {
    const confirmed = window.confirm("Delete this item?")
    if (!confirmed) return

    setErrorMessage("")
    setMessage("")

    const { error } = await supabase.from("inventory_items").delete().eq("id", id)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setItems((prev) => prev.filter((item) => item.id !== id))
    setUsageList((prev) => prev.filter((usage) => usage.item_id !== id))
    setPhotoMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

    if (inlineEditingId === id) {
      cancelInlineEdit()
    }

    if (categoryExpandedItemId === id) {
      setCategoryExpandedItemId(null)
      categoryDetailReturnFocusIdRef.current = null
    }

    setMessage("Item deleted.")
  }

  const useInventory = async (
    itemId: string,
    qty: number,
    jobId: string,
    jobLabel: string,
  ): Promise<string | null> => {
    setErrorMessage("")
    setMessage("")

    if (!user) {
      const msg = "You must be logged in to record usage."
      setErrorMessage(msg)
      return msg
    }

    const item = items.find((i) => i.id === itemId)
    if (!item) return "Item not found."

    const currentQty = Number(item.quantity_on_hand || 0)

    if (qty <= 0) {
      const msg = "Usage quantity must be greater than 0."
      setErrorMessage(msg)
      return msg
    }

    if (qty > currentQty) {
      const msg = "You cannot use more stock than you have."
      setErrorMessage(msg)
      return msg
    }

    if (!jobId || !jobLabel.trim()) {
      const msg = "Select a job before recording usage."
      setErrorMessage(msg)
      return msg
    }

    const { data: insertedUsage, error: usageError } = await supabase
      .from("inventory_usage")
      .insert([
        {
          item_id: itemId,
          user_id: user.id,
          job_id: jobId,
          job_name: jobLabel.trim(),
          quantity_used: qty,
        },
      ])
      .select()
      .single()

    if (usageError || !insertedUsage) {
      const msg = getActionableSupabaseError(usageError?.message || "Failed to record usage.")
      setErrorMessage(msg)
      return msg
    }

    const newQty = currentQty - qty

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newQty })
      .eq("id", itemId)

    if (updateError) {
      const msg = getActionableSupabaseError(updateError.message)
      setErrorMessage(msg)
      return msg
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === itemId ? { ...inventoryItem, quantity_on_hand: newQty } : inventoryItem
      )
    )
    setUsageList((prev) => [insertedUsage as UsageRow, ...prev])
    setMessage("Usage recorded.")
    return null
  }

  const openHoldModal = (item: InventoryItem) => {
    setSelectedItem(item)
    setErrorMessage("")
    setHoldModalOpen(true)
  }

  const releaseItemHold = async (itemId: string) => {
    setErrorMessage("")
    setMessage("")

    const { id, error } = await releaseItemHoldRpc(itemId)
    if (error || !id) {
      setErrorMessage(error || "Failed to release hold.")
      return
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === itemId
          ? {
              ...inventoryItem,
              hold_last_name: null,
              hold_at: null,
              hold_customer_id: null,
              hold_job_id: null,
            }
          : inventoryItem,
      ),
    )
    setMessage("Hold released. Item is available to show.")
  }

  const undoUsage = async (usageId: string) => {
    if (undoingUsageId) return

    setUndoingUsageId(usageId)
    setErrorMessage("")
    setMessage("")

    const { data: deletedRows, error: deleteError } = await supabase
      .from("inventory_usage")
      .delete()
      .eq("id", usageId)
      .select("id, item_id, quantity_used")

    if (deleteError) {
      setErrorMessage(deleteError.message)
      setUndoingUsageId(null)
      return
    }

    if (!deletedRows || deletedRows.length !== 1) {
      setErrorMessage("Usage could not be undone. No matching usage row was deleted.")
      setUndoingUsageId(null)
      return
    }

    const deleted = deletedRows[0]
    const restoredItemId = deleted.item_id as string
    const restoredQty = Number(deleted.quantity_used || 0)

    const item = items.find((i) => i.id === restoredItemId)
    if (!item) {
      setErrorMessage("Usage row was deleted, but the inventory item could not be found to restore quantity.")
      setUsageList((prev) => prev.filter((usage) => usage.id !== deleted.id))
      setUndoingUsageId(null)
      return
    }

    const newQty = Number(item.quantity_on_hand || 0) + restoredQty

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newQty })
      .eq("id", restoredItemId)

    if (updateError) {
      setErrorMessage(updateError.message)
      setUndoingUsageId(null)
      return
    }

    setUsageList((prev) => prev.filter((usage) => usage.id !== deleted.id))
    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === restoredItemId
          ? { ...inventoryItem, quantity_on_hand: newQty }
          : inventoryItem,
      ),
    )
    setMessage("Usage undone.")
    setUndoingUsageId(null)
  }

  const markSold = async (id: string) => {
    setErrorMessage("")
    setMessage("")

    const itemToMark = items.find((item) => item.id === id)
    if (!itemToMark) return

    // Avoid overwriting the undo snapshot with status "sold" if Mark Sold is clicked again.
    if ((itemToMark.status || "").toLowerCase() === "sold") {
      setMessage("Item is already marked as sold.")
      return
    }

    const previousStatus = itemToMark.status || "active"
    const previousQty =
      inlineEditingId === id && inlineDraft
        ? Number(inlineDraft.quantity_on_hand || 0)
        : Number(itemToMark.quantity_on_hand || 0)

    const { error } = await supabase
      .from("inventory_items")
      .update({ status: "sold", quantity_on_hand: 0 })
      .eq("id", id)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSoldUndoMap((prev) => {
      // Keep the first pre-sold snapshot so a second click can't poison undo.
      if (prev[id]) return prev
      return {
        ...prev,
        [id]: {
          status: previousStatus,
          quantity_on_hand: previousQty,
        },
      }
    })

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "sold", quantity_on_hand: 0 } : item))
    )
    if (inlineEditingId === id) {
      setInlineDraft((prev) => (prev ? { ...prev, quantity_on_hand: "0" } : prev))
    }
    setMessage("Item marked as sold.")
  }

  const undoMarkSold = async (id: string) => {
    setErrorMessage("")
    setMessage("")

    const snapshot = soldUndoMap[id]
    if (!snapshot) {
      setErrorMessage("No recent sold action to undo for this item.")
      return
    }

    // Never restore "sold" — that means the snapshot was overwritten after a repeat Mark Sold.
    const restoredStatus =
      (snapshot.status || "").toLowerCase() === "sold" ? "active" : snapshot.status || "active"
    const restoredQty = Number(snapshot.quantity_on_hand || 0)

    const { error } = await supabase
      .from("inventory_items")
      .update({
        status: restoredStatus,
        quantity_on_hand: restoredQty,
      })
      .eq("id", id)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: restoredStatus, quantity_on_hand: restoredQty }
          : item
      )
    )
    if (inlineEditingId === id) {
      setInlineDraft((prev) =>
        prev ? { ...prev, quantity_on_hand: String(restoredQty) } : prev,
      )
    }
    setSoldUndoMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setMessage("Mark sold undone.")
  }

  const uploadMorePhotos = async (itemId: string, e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    setUploadingItemId(itemId)
    setErrorMessage("")
    setMessage("")

    try {
      const uploadedUrls = await uploadPhotos(itemId, files)
      if (uploadedUrls.length) {
        setPhotoMap((prev) => ({
          ...prev,
          [itemId]: [...(prev[itemId] || []), ...uploadedUrls],
        }))
      } else {
        await loadPhotosForItem(itemId)
      }
      setMessage("Photos uploaded.")
    } catch (error: any) {
      setErrorMessage(error.message)
    }

    setUploadingItemId(null)
  }

  const setViewMode = (mode: InventoryViewMode) => {
    inventoryViewTouchedRef.current = true
    setInventoryViewMode(mode)
    safeSetItem("local", INVENTORY_VIEW_STORAGE_KEY, mode)
    if (mode === "list") {
      setCategoryExpandedItemId(null)
      categoryDetailReturnFocusIdRef.current = null
    }
  }

  const restoreCategoryCardFocus = (itemId: string | null) => {
    if (!itemId) return
    const node = categoryCardRefs.current.get(itemId)
    if (node) {
      node.focus()
      return
    }
    const fallback = document.querySelector<HTMLElement>(
      `[data-inventory-item-id="${CSS.escape(itemId)}"]`,
    )
    fallback?.focus()
  }

  const openCategoryItemDetail = (itemId: string) => {
    categoryDetailReturnFocusIdRef.current = itemId
    setCategoryExpandedItemId(itemId)
  }

  const closeCategoryItemDetail = () => {
    setCategoryExpandedItemId(null)
  }

  const handleCloseCategoryItem = () => {
    if (inlineSaving) return
    const returnFocusId =
      categoryDetailReturnFocusIdRef.current || categoryExpandedItemId
    cancelInlineEdit()
    closeCategoryItemDetail()
    categoryDetailReturnFocusIdRef.current = null
    if (detailPresentation === "modal") {
      requestAnimationFrame(() => restoreCategoryCardFocus(returnFocusId))
    }
  }

  const startCategoryInlineEdit = (item: InventoryItem) => {
    openCategoryItemDetail(item.id)
    startInlineEdit(item)
  }

  const toggleBrowseGroup = (groupKey: string) => {
    setCollapsedBrowseGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const deleteItemPhoto = async (itemId: string, url: string) => {
    const filePath = url.split("/storage/v1/object/public/inventory-photos/")[1]?.replace(/"/g, "")
    if (!filePath) {
      alert("Invalid photo path.")
      return
    }

    const { error } = await supabase.storage.from("inventory-photos").remove([filePath])
    if (error) {
      alert(error.message)
      return
    }

    setPhotoMap((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || []).filter((photoUrl) => photoUrl !== url),
    }))
  }

  const buildInventoryItemCardProps = (item: InventoryItem) => {
    const isInlineEditing = inlineEditingId === item.id && !!inlineDraft

    return {
      item,
      categoryName: item.category_id ? categoryNameById.get(item.category_id) || "" : "",
      subcategoryName: item.subcategory_id ? subcategoryNameById.get(item.subcategory_id) || "" : "",
      isInlineEditing,
      inlineDraft: isInlineEditing ? inlineDraft : null,
      inlineSaving,
      categories,
      subcategories,
      quantityTypes,
      photos: photoMap[item.id] || [],
      itemUsage: usageList.filter((usage) => usage.item_id === item.id).slice(0, 5),
      showSoldUndo: !!soldUndoMap[item.id],
      isUploadingPhotos: uploadingItemId === item.id,
      formatCurrency,
      canUndoUsage: (usage: { user_id?: string | null }) =>
        canUndoSharedUsage({
          usageUserId: usage.user_id,
          currentUserId: user?.id,
          role: profile?.role,
        }),
      undoingUsageId,
      onUpdateDraft: updateInlineDraft,
      onSave: () => void saveInlineEdit(item),
      onCancel: cancelInlineEdit,
      onStartEdit: () => startInlineEdit(item),
      onMarkSold: () => void markSold(item.id),
      onUndoMarkSold: () => void undoMarkSold(item.id),
      onDelete: () => void deleteItem(item.id),
      onUse: () => {
        setSelectedItem(item)
        setUseModalOpen(true)
      },
      onHold: () => openHoldModal(item),
      onReleaseHold: () => void releaseItemHold(item.id),
      onUndoUsage: (usageId: string) => void undoUsage(usageId),
      onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void uploadMorePhotos(item.id, e),
      onPhotoClick: setActiveImage,
      onPhotoDelete: (url: string) => void deleteItemPhoto(item.id, url),
    }
  }

  const renderInventoryItem = (item: InventoryItem) => (
    <InventoryItemCard key={item.id} {...buildInventoryItemCardProps(item)} />
  )

  const renderCategoryGridItem = (item: InventoryItem) => {
    const isInlineEditing = inlineEditingId === item.id && !!inlineDraft
    const isExpanded = categoryExpandedItemId === item.id
    const categoryName = item.category_id ? categoryNameById.get(item.category_id) || "" : ""
    const subcategoryName = item.subcategory_id ? subcategoryNameById.get(item.subcategory_id) || "" : ""
    const photos = photoMap[item.id] || []

    // Expand presentation: replace the compact card with an inline full-width panel.
    if (isCategoryExpandPresentation && (isExpanded || isInlineEditing)) {
      const cardProps = buildInventoryItemCardProps(item)

      return (
        <div key={item.id} className="inventory-item-grid-full">
          <CategoryExpandedItemPanel
            {...cardProps}
            photos={photos}
            categoryName={categoryName}
            subcategoryName={subcategoryName}
            onClose={handleCloseCategoryItem}
          />
        </div>
      )
    }

    // Modal presentation keeps every compact card in the grid; details render once outside.
    return (
      <InventoryCategoryGridCard
        key={item.id}
        ref={(node) => {
          if (node) categoryCardRefs.current.set(item.id, node)
          else categoryCardRefs.current.delete(item.id)
        }}
        item={item}
        categoryName={categoryName}
        subcategoryName={subcategoryName}
        photos={photos}
        formatCurrency={formatCurrency}
        isUploadingPhotos={uploadingItemId === item.id}
        onOpenDetail={() => openCategoryItemDetail(item.id)}
        onStartEdit={() => startCategoryInlineEdit(item)}
        onMarkSold={() => void markSold(item.id)}
        onDelete={() => void deleteItem(item.id)}
        onUse={() => {
          setSelectedItem(item)
          setUseModalOpen(true)
        }}
        onHold={() => openHoldModal(item)}
        onReleaseHold={() => void releaseItemHold(item.id)}
        onUploadPhotos={(e) => void uploadMorePhotos(item.id, e)}
      />
    )
  }

  const categoryModalItem =
    isCategoryModalPresentation && categoryExpandedItemId
      ? filteredItems.find((item) => item.id === categoryExpandedItemId) || null
      : null

  const categoryNestedLayerActive = !!(activeImage || holdModalOpen || useModalOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return

      if (activeImage) {
        event.preventDefault()
        setActiveImage(null)
        return
      }

      if (holdModalOpen) {
        event.preventDefault()
        setHoldModalOpen(false)
        return
      }

      if (useModalOpen) {
        event.preventDefault()
        setUseModalOpen(false)
        return
      }

      if (isCategoryModalPresentation && categoryExpandedItemId && !inlineSaving) {
        event.preventDefault()
        handleCloseCategoryItem()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    activeImage,
    holdModalOpen,
    useModalOpen,
    isCategoryModalPresentation,
    categoryExpandedItemId,
    inlineSaving,
  ])

  return (
  <main>
      <div className={`stats ${hidePrices ? "stats-no-pricing" : ""}`}>
        <div className="stat">
          <div className="stat-label">Items</div>
          <div className="stat-value">{items.length}</div>
        </div>
        {!hidePrices && (
          <div className="stat">
            <div className="stat-label">Inventory Value</div>
            <div className="stat-value">${Math.round(totalValue).toLocaleString()}</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Sold</div>
          <div className="stat-value">{soldCount}</div>
        </div>
      </div>

      {message && <Notice tone="success" className="page-feedback">{message}</Notice>}
      {errorMessage && <Notice className="page-feedback">{errorMessage}</Notice>}

      <section className="inventory-section">
          <Toolbar sticky>
            <SearchField
              placeholder="Search name, SKU, category, subcategory, location, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ViewToggle
              ariaLabel="Inventory view mode"
              options={[
                {
                  id: "list",
                  label: "List",
                  active: !isCategoryView,
                  onSelect: () => setViewMode("list"),
                },
                {
                  id: "category",
                  label: "Category",
                  active: isCategoryView,
                  onSelect: () => setViewMode("category"),
                },
              ]}
            />
            <Button variant="primary" className="toolbar-add-btn" onClick={openAddForm}>
              Add Inventory
            </Button>
          </Toolbar>

          <div className={`category-picker-card ${categoryPickerCollapsed ? "category-picker-collapsed" : ""}`}>
            <div className="category-picker-top">
              <div className="category-picker-header">
                <h3>{categoryPickerCollapsed ? "Category filter" : "Choose a category"}</h3>
                {!categoryPickerCollapsed && (
                  <p className="subtext">
                    Start by selecting a category to view matching inventory, or choose all inventory.
                  </p>
                )}
                {categoryPickerCollapsed && (
                  <p className="category-picker-summary">
                    <span className="category-picker-summary-label">{browseFilterSummary}</span>
                    {hasSelectedInventoryView && (
                      <span className="category-picker-summary-meta">
                        {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="btn-secondary btn-small category-picker-toggle"
                onClick={() => setCategoryPickerCollapsed((collapsed) => !collapsed)}
                aria-expanded={!categoryPickerCollapsed}
              >
                {categoryPickerCollapsed ? "Show" : "Minimize"}
              </button>
            </div>

            {!categoryPickerCollapsed && (
              <div className="category-grid">
                <button
                  type="button"
                  className={`category-chip ${categoryFilter === "all" ? "category-chip-active" : ""}`}
                  onClick={() => selectCategory("all")}
                >
                  <span className="category-chip-content">
                    <span className="category-chip-label">View All Inventory</span>
                    <span className="category-chip-meta">{items.length} item{items.length === 1 ? "" : "s"}</span>
                  </span>
                </button>

                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`category-chip ${categoryFilter === cat.id ? "category-chip-active" : ""}`}
                    onClick={() => selectCategory(cat.id)}
                  >
                    <span className="category-chip-content">
                      <span className="category-chip-label">{cat.name}</span>
                      <span className="category-chip-meta">
                        {itemCountsByCategory.get(cat.id) || 0} item
                        {(itemCountsByCategory.get(cat.id) || 0) === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                ))}

                {!settingMatsCategory && (
                  <button
                    type="button"
                    className="category-chip category-chip-add"
                    disabled={settingMatsBootstrapping || loading}
                    onClick={() => void handleSettingMatsCategory()}
                  >
                    <span className="category-chip-content">
                      <span className="category-chip-label">{SETTING_MATS_CATEGORY_NAME}</span>
                      <span className="category-chip-meta">
                        {settingMatsBootstrapping ? "Adding…" : "Setting materials — click to add category"}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {!categoryPickerCollapsed && categoryFilter !== "all" && categoryFilter && (
            <div className="subcategory-picker-card">
              <div className="subcategory-picker-header">
                <h4>Subcategory (optional)</h4>
                <p className="subtext">
                  Narrow {selectedCategoryName} inventory, or leave on &ldquo;All&rdquo; to see every item in this category.
                </p>
              </div>
              <div className="subcategory-grid">
                <button
                  type="button"
                  className={`category-chip subcategory-chip ${!subcategoryFilter ? "subcategory-chip-active" : ""}`}
                  onClick={() => setSubcategoryFilter("")}
                >
                  All in {selectedCategoryName}
                </button>
                {uncategorizedCountInView > 0 && (
                  <button
                    type="button"
                    className={`category-chip subcategory-chip ${subcategoryFilter === "none" ? "subcategory-chip-active" : ""}`}
                    onClick={() => setSubcategoryFilter("none")}
                  >
                    No subcategory ({uncategorizedCountInView})
                  </button>
                )}
                {subcategoriesInView.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={`category-chip subcategory-chip ${subcategoryFilter === sub.id ? "subcategory-chip-active" : ""}`}
                    onClick={() => setSubcategoryFilter(sub.id)}
                  >
                    {sub.name} ({itemCountsBySubcategory.get(sub.id) || 0})
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <EmptyState>Loading inventory...</EmptyState>
          ) : !hasSelectedInventoryView && !isAddingNew ? (
            <EmptyState>Select a category above to start browsing inventory.</EmptyState>
          ) : filteredItems.length === 0 && !isAddingNew ? (
            <EmptyState>
              No items found in {selectedViewLabel || "this view"}. Try another category or refine your filters.
            </EmptyState>
          ) : (
            <>
              {isAddingNew && inlineDraft && (
                <div key={NEW_ITEM_DRAFT_ID} className="item-card item-card-new">
                  <div className="item-top">
                    <div>
                      <input
                        className="inline-input"
                        value={inlineDraft.product_name}
                        onChange={(e) => updateInlineDraft("product_name", e.target.value)}
                        placeholder="Product name"
                      />
                      <div className="badges">
                        <div className="inline-category-fields">
                          <select
                            className="inline-input"
                            value={inlineDraft.category_id}
                            onChange={(e) => updateInlineDraft("category_id", e.target.value)}
                            aria-label="Category"
                          >
                            <option value="">Select category</option>
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="inline-input"
                            value={inlineDraft.subcategory_id}
                            onChange={(e) => updateInlineDraft("subcategory_id", e.target.value)}
                            disabled={!inlineDraft.category_id}
                            aria-label="Subcategory"
                          >
                            <option value="">No subcategory</option>
                            {subcategories
                              .filter((sub) => sub.category_id === inlineDraft.category_id)
                              .map((sub) => (
                                <option key={sub.id} value={sub.id}>
                                  {sub.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        <span className="badge">No SKU</span>
                      </div>
                    </div>
                    {!hidePrices && (
                      <div className="item-price">
                        <div className="small" style={{ marginTop: 0 }}>Unit Cost</div>
                        <input
                          className="inline-input"
                          type="number"
                          value={inlineDraft.unit_cost}
                          onChange={(e) => updateInlineDraft("unit_cost", e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="item-kpis">
                    <div className="item-kpi">
                      <div className="item-kpi-label">Quantity on Hand</div>
                      <div className="inline-quantity-fields">
                        <input
                          className="inline-input"
                          type="number"
                          value={inlineDraft.quantity_on_hand}
                          onChange={(e) => updateInlineDraft("quantity_on_hand", e.target.value)}
                        />
                        <select
                          className="inline-input"
                          value={inlineDraft.quantity_type}
                          onChange={(e) => updateInlineDraft("quantity_type", e.target.value)}
                          aria-label="Quantity type"
                        >
                          <option value="">Select quantity type</option>
                          {quantityTypes.map((qty) => (
                            <option key={qty.id} value={qty.name}>
                              {qty.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="item-kpi item-kpi-status">
                      <div className="item-kpi-label">Location</div>
                      <input
                        className="inline-input"
                        value={inlineDraft.warehouse_location}
                        onChange={(e) => updateInlineDraft("warehouse_location", e.target.value)}
                        placeholder="Warehouse location"
                      />
                    </div>
                  </div>

                  <ItemDimensionsFields
                    categoryId={inlineDraft.category_id}
                    categories={categories}
                    lengthInches={inlineDraft.length_inches}
                    widthInches={inlineDraft.width_inches}
                    squareFeet={inlineDraft.square_feet}
                    isEditing
                    onUpdate={updateInlineDraft}
                  />

                  <div className="meta-grid">
                    {!hidePrices && (
                      <div>
                        <strong>Total Value:</strong>{" "}
                        {formatCurrency(
                          Number(inlineDraft.quantity_on_hand || 0) * Number(inlineDraft.unit_cost || 0),
                        )}
                      </div>
                    )}
                    <div>
                      <strong>Status:</strong> active
                    </div>
                  </div>

                  <div className="meta-grid meta-grid-secondary section-gap">
                    <div>
                      <strong>Created:</strong> New item
                    </div>
                    <div>
                      <strong>Notes:</strong>{" "}
                      <textarea
                        className="inline-textarea"
                        value={inlineDraft.notes}
                        onChange={(e) => updateInlineDraft("notes", e.target.value)}
                        placeholder="Notes"
                      />
                    </div>
                  </div>

                  <div className="section-gap">
                    <label>Photos</label>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={(e) => setNewItemFiles(Array.from(e.target.files || []))}
                    />
                    <div className="small">
                      {newItemFiles.length
                        ? `${newItemFiles.length} file(s) selected`
                        : "Optional photos to upload on save."}
                    </div>
                  </div>

                  <div className="action-row">
                    <button
                      className="btn-primary btn-small"
                      disabled={inlineSaving}
                      onClick={() => void saveNewItem()}
                    >
                      {inlineSaving ? "Saving..." : "Save"}
                    </button>
                    <button className="btn-secondary btn-small" disabled={inlineSaving} onClick={cancelInlineEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isCategoryView ? (
                <div className="category-view">
                  {groupedInventory.map((categoryGroup) => {
                    const categoryGroupKey = `cat:${categoryGroup.key}`
                    const categoryCollapsed = collapsedBrowseGroups.has(categoryGroupKey)

                    return (
                      <div key={categoryGroup.key} className="browse-category-group">
                        <button
                          type="button"
                          className="browse-group-header"
                          onClick={() => toggleBrowseGroup(categoryGroupKey)}
                          aria-expanded={!categoryCollapsed}
                        >
                          <span className="browse-group-title">{categoryGroup.name}</span>
                          <span className="browse-group-meta">
                            {categoryGroup.itemCount} item{categoryGroup.itemCount === 1 ? "" : "s"}
                          </span>
                        </button>
                        {!categoryCollapsed && (
                          <div className="browse-group-body">
                            {categoryGroup.subcategories.map((subGroup) => {
                              const subGroupKey = `sub:${categoryGroup.key}:${subGroup.key}`
                              const subCollapsed = collapsedBrowseGroups.has(subGroupKey)

                              return (
                                <div key={subGroup.key} className="browse-subcategory-group">
                                  <button
                                    type="button"
                                    className="browse-subcategory-header"
                                    onClick={() => toggleBrowseGroup(subGroupKey)}
                                    aria-expanded={!subCollapsed}
                                  >
                                    <span className="browse-subcategory-title">{subGroup.name}</span>
                                    <span className="browse-group-meta">
                                      {subGroup.items.length} item{subGroup.items.length === 1 ? "" : "s"}
                                    </span>
                                  </button>
                                  {!subCollapsed && (
                                    <div className="inventory-item-grid browse-subcategory-items">
                                      {subGroup.items.map(renderCategoryGridItem)}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="list">
                  {filteredItems.map(renderInventoryItem)}
                </div>
              )}
            </>
          )}
      </section>

      {categoryModalItem && (
        <CategoryItemDetailModal
          open
          nestedLayerActive={categoryNestedLayerActive}
          inlineSaving={inlineSaving}
          onClose={handleCloseCategoryItem}
        >
          <CategoryExpandedItemPanel
            {...buildInventoryItemCardProps(categoryModalItem)}
            photos={photoMap[categoryModalItem.id] || []}
            categoryName={
              categoryModalItem.category_id
                ? categoryNameById.get(categoryModalItem.category_id) || ""
                : ""
            }
            subcategoryName={
              categoryModalItem.subcategory_id
                ? subcategoryNameById.get(categoryModalItem.subcategory_id) || ""
                : ""
            }
            onClose={handleCloseCategoryItem}
          />
        </CategoryItemDetailModal>
      )}

          {activeImage && (
        <div
          onClick={() => setActiveImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            cursor: "pointer",
            padding: "24px",
          }}
        >
          <img
            src={activeImage}
            alt="Full size inventory"
            style={{
              maxWidth: "95%",
              maxHeight: "95%",
              borderRadius: "12px",
            }}
          />
        </div>
      )}

      {holdModalOpen && selectedItem && (
        <HoldItemModal
          itemId={selectedItem.id}
          itemName={selectedItem.product_name}
          onClose={() => setHoldModalOpen(false)}
          onPlaced={(result) => {
            setHoldModalOpen(false)
            if (result.refreshRequired) {
              setMessage("Hold placed.")
              void loadAll()
              return
            }
            setItems((prev) =>
              prev.map((inventoryItem) =>
                inventoryItem.id === result.itemId
                  ? {
                      ...inventoryItem,
                      hold_customer_id: result.holdCustomerId,
                      hold_job_id: result.holdJobId,
                      hold_last_name: result.holdLastName,
                      hold_at: result.holdAt,
                    }
                  : inventoryItem,
              ),
            )
            setMessage(
              `Item placed on hold for ${result.holdLastName || "customer"}.`,
            )
          }}
        />
      )}

      {useModalOpen && selectedItem && (
        <UseInventoryModal
          itemName={selectedItem.product_name}
          onClose={() => setUseModalOpen(false)}
          onConfirm={async ({ quantity, jobId, jobLabel }) => {
            const error = await useInventory(selectedItem.id, quantity, jobId, jobLabel)
            if (error) throw new Error(formatPhase2Error(error) || error)
            setUseModalOpen(false)
          }}
        />
      )}
    </main>
  )
}
