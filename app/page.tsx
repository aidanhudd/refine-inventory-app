"use client"

import { ChangeEvent, useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabaseClient"
import { useAuth } from "./components/AuthProvider"
import InventoryItemCard from "./components/InventoryItemCard"
import InventoryCategoryGridCard from "./components/InventoryCategoryGridCard"
import CategoryExpandedItemPanel from "./components/CategoryExpandedItemPanel"
import ItemDimensionsFields from "./components/ItemDimensionsFields"
import {
  buildDimensionPayload,
  calculateSquareFeetFromStrings,
  categoryIdSupportsDimensions,
  formatSquareFeetNumber,
} from "../lib/inventoryDimensions"

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
  created_at: string | null
  length_inches: number | null
  width_inches: number | null
  square_feet: number | null
}

type UsageRow = {
  id: string
  item_id: string
  user_id: string | null
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

type InventoryViewMode = "list" | "category"

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

  if (lower.includes("row-level security")) {
    return "Permission blocked by Supabase RLS. Confirm you are logged in and that inventory_usage policies are applied."
  }

  if (lower.includes("permission denied") && lower.includes("inventory_items")) {
    return "Permission denied on inventory_items update. Check RLS/table permissions for authenticated users."
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
  const { user } = useAuth()
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
const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
const [useQty, setUseQty] = useState("")
const [useJob, setUseJob] = useState("")
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)
  const [inlineDraft, setInlineDraft] = useState<InlineEditForm | null>(null)
  const [inlineSaving, setInlineSaving] = useState(false)
  const [soldUndoMap, setSoldUndoMap] = useState<Record<string, SoldUndoSnapshot>>({})
  const [settingMatsBootstrapping, setSettingMatsBootstrapping] = useState(false)
  const [inventoryViewMode, setInventoryViewMode] = useState<InventoryViewMode>("list")
  const [collapsedBrowseGroups, setCollapsedBrowseGroups] = useState<Set<string>>(() => new Set())
  const [categoryExpandedItemId, setCategoryExpandedItemId] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(INVENTORY_VIEW_STORAGE_KEY)
    if (stored === "list" || stored === "category") {
      setInventoryViewMode(stored)
    }
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setErrorMessage("")

    const [itemsRes, categoriesRes, subcategoriesRes, quantityTypesRes, usageRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name", { ascending: true }),
      supabase.from("subcategories").select("*").order("name", { ascending: true }),
      supabase.from("quantity_types").select("*").order("name", { ascending: true }),
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
    ])

    if (itemsRes.error) setErrorMessage(getActionableSupabaseError(itemsRes.error.message))
    if (categoriesRes.error) setErrorMessage(categoriesRes.error.message)
    if (subcategoriesRes.error) setErrorMessage(getActionableSupabaseError(subcategoriesRes.error.message))
    if (quantityTypesRes.error) setErrorMessage(quantityTypesRes.error.message)
    if (usageRes.error) setErrorMessage(usageRes.error.message)

    const loadedItems = itemsRes.data || []
    setItems(loadedItems)
    setCategories(categoriesRes.data || [])
    setSubcategories(subcategoriesRes.data || [])
    setQuantityTypes(quantityTypesRes.data || [])
    setUsageList((usageRes.data as UsageRow[]) || [])

    await loadPhotosForItems(loadedItems)
    setLoading(false)
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
      setCategoryExpandedItemId(null)
    }
  }, [filteredItems, categoryExpandedItemId])

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
    if (!inlineDraft) return

    if (!inlineDraft.product_name.trim()) {
      setErrorMessage("Product name is required.")
      return
    }

    const categoryValidationError = validateCategorySubcategory(
      inlineDraft.category_id,
      inlineDraft.subcategory_id,
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
      inlineDraft.category_id,
      categories,
      inlineDraft.length_inches,
      inlineDraft.width_inches,
    )

    const payload = {
      sku: null,
      product_name: inlineDraft.product_name,
      category_id: inlineDraft.category_id || null,
      subcategory_id: inlineDraft.subcategory_id || null,
      quantity_on_hand: Number(inlineDraft.quantity_on_hand || 0),
      quantity_type: inlineDraft.quantity_type || null,
      unit_cost: Number(inlineDraft.unit_cost || 0),
      warehouse_location: inlineDraft.warehouse_location || null,
      notes: inlineDraft.notes || null,
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
      setItems((prev) => [data as InventoryItem, ...prev])
      setMessage("Item saved successfully.")
      cancelInlineEdit()
    } catch (uploadError: any) {
      setItems((prev) => [data as InventoryItem, ...prev])
      setErrorMessage(`Item saved, but photo upload failed: ${uploadError.message}`)
      cancelInlineEdit()
    }

    setInlineSaving(false)
  }

  const saveInlineEdit = async (item: InventoryItem) => {
    if (!inlineDraft) return

    if (!inlineDraft.product_name.trim()) {
      setErrorMessage("Product name is required.")
      return
    }

    const categoryValidationError = validateCategorySubcategory(
      inlineDraft.category_id,
      inlineDraft.subcategory_id,
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
      inlineDraft.category_id,
      categories,
      inlineDraft.length_inches,
      inlineDraft.width_inches,
    )

    const payload = {
      product_name: inlineDraft.product_name,
      category_id: inlineDraft.category_id || null,
      subcategory_id: inlineDraft.subcategory_id || null,
      quantity_on_hand: Number(inlineDraft.quantity_on_hand || 0),
      quantity_type: inlineDraft.quantity_type || null,
      unit_cost: Number(inlineDraft.unit_cost || 0),
      warehouse_location: inlineDraft.warehouse_location || null,
      notes: inlineDraft.notes || null,
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

    setItems((prev) =>
      prev.map((existingItem) =>
        existingItem.id === item.id ? ({ ...existingItem, ...updatedItem } as InventoryItem) : existingItem
      )
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
    }

    setMessage("Item deleted.")
  }

  const useInventory = async (itemId: string, qty: number, jobName: string) => {
    setErrorMessage("")
    setMessage("")

    if (!user) {
      setErrorMessage("You must be logged in to record usage.")
      return
    }

    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const currentQty = Number(item.quantity_on_hand || 0)

    if (qty <= 0) {
      setErrorMessage("Usage quantity must be greater than 0.")
      return
    }

    if (qty > currentQty) {
      setErrorMessage("You cannot use more stock than you have.")
      return
    }

    const { data: insertedUsage, error: usageError } = await supabase
      .from("inventory_usage")
      .insert([
        {
          item_id: itemId,
          user_id: user.id,
          job_name: jobName,
          quantity_used: qty,
        },
      ])
      .select()
      .single()

    if (usageError || !insertedUsage) {
      setErrorMessage(getActionableSupabaseError(usageError?.message || "Failed to record usage."))
      return
    }

    const newQty = currentQty - qty

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newQty })
      .eq("id", itemId)

    if (updateError) {
      setErrorMessage(getActionableSupabaseError(updateError.message))
      return
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === itemId ? { ...inventoryItem, quantity_on_hand: newQty } : inventoryItem
      )
    )
    setUsageList((prev) => [insertedUsage as UsageRow, ...prev])
    setMessage("Usage recorded.")
  }

  const undoUsage = async (usageId: string, itemId: string, qty: number) => {
    setErrorMessage("")
    setMessage("")

    const { error: deleteError } = await supabase
      .from("inventory_usage")
      .delete()
      .eq("id", usageId)

    if (deleteError) {
      setErrorMessage(deleteError.message)
      return
    }

    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const newQty = Number(item.quantity_on_hand || 0) + Number(qty || 0)

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newQty })
      .eq("id", itemId)

    if (updateError) {
      setErrorMessage(updateError.message)
      return
    }

    setUsageList((prev) => prev.filter((usage) => usage.id !== usageId))
    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === itemId ? { ...inventoryItem, quantity_on_hand: newQty } : inventoryItem
      )
    )
    setMessage("Usage undone.")
  }

  const markSold = async (id: string) => {
    setErrorMessage("")
    setMessage("")

    const itemToMark = items.find((item) => item.id === id)
    if (!itemToMark) return

    const { error } = await supabase
      .from("inventory_items")
      .update({ status: "sold", quantity_on_hand: 0 })
      .eq("id", id)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSoldUndoMap((prev) => ({
      ...prev,
      [id]: {
        status: itemToMark.status || "active",
        quantity_on_hand: Number(itemToMark.quantity_on_hand || 0),
      },
    }))

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "sold", quantity_on_hand: 0 } : item))
    )
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

    const { error } = await supabase
      .from("inventory_items")
      .update({
        status: snapshot.status,
        quantity_on_hand: snapshot.quantity_on_hand,
      })
      .eq("id", id)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: snapshot.status, quantity_on_hand: snapshot.quantity_on_hand }
          : item
      )
    )
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
    setInventoryViewMode(mode)
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, mode)
    if (mode === "list") {
      setCategoryExpandedItemId(null)
    }
  }

  const openCategoryItemDetail = (itemId: string) => {
    setCategoryExpandedItemId(itemId)
  }

  const closeCategoryItemDetail = () => {
    setCategoryExpandedItemId(null)
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
      onUndoUsage: (usageId: string, qty: number) => void undoUsage(usageId, item.id, qty),
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

    if (isExpanded) {
      const cardProps = buildInventoryItemCardProps(item)

      return (
        <div key={item.id} className="inventory-item-grid-full">
          <CategoryExpandedItemPanel
            {...cardProps}
            photos={photos}
            categoryName={categoryName}
            subcategoryName={subcategoryName}
            onClose={closeCategoryItemDetail}
          />
        </div>
      )
    }

    if (isInlineEditing) {
      return (
        <div key={item.id} className="inventory-item-grid-full">
          <InventoryItemCard {...buildInventoryItemCardProps(item)} />
        </div>
      )
    }

    return (
      <InventoryCategoryGridCard
        key={item.id}
        item={item}
        categoryName={categoryName}
        subcategoryName={subcategoryName}
        photos={photos}
        formatCurrency={formatCurrency}
        isUploadingPhotos={uploadingItemId === item.id}
        onOpenDetail={() => openCategoryItemDetail(item.id)}
        onStartEdit={() => startInlineEdit(item)}
        onMarkSold={() => void markSold(item.id)}
        onDelete={() => void deleteItem(item.id)}
        onUse={() => {
          setSelectedItem(item)
          setUseModalOpen(true)
        }}
        onUploadPhotos={(e) => void uploadMorePhotos(item.id, e)}
      />
    )
  }

  return (
  <main>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Items</div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Inventory Value</div>
          <div className="stat-value">${Math.round(totalValue).toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sold</div>
          <div className="stat-value">{soldCount}</div>
        </div>
      </div>

      {message && <div className="success page-feedback">{message}</div>}
      {errorMessage && <div className="notice page-feedback">{errorMessage}</div>}

      <section className="inventory-section">
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search name, SKU, category, subcategory, location, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="toolbar-view-toggle" role="group" aria-label="Inventory view mode">
              <button
                type="button"
                className={`toolbar-view-btn ${!isCategoryView ? "toolbar-view-btn-active" : ""}`}
                onClick={() => setViewMode("list")}
                aria-pressed={!isCategoryView}
              >
                List
              </button>
              <button
                type="button"
                className={`toolbar-view-btn ${isCategoryView ? "toolbar-view-btn-active" : ""}`}
                onClick={() => setViewMode("category")}
                aria-pressed={isCategoryView}
              >
                Category
              </button>
            </div>
            <button type="button" className="btn-primary toolbar-add-btn" onClick={openAddForm}>
              Add Inventory
            </button>
          </div>

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
            <div className="empty">Loading inventory...</div>
          ) : !hasSelectedInventoryView && !isAddingNew ? (
            <div className="empty">Select a category above to start browsing inventory.</div>
          ) : filteredItems.length === 0 && !isAddingNew ? (
            <div className="empty">
              No items found in {selectedViewLabel || "this view"}. Try another category or refine your filters.
            </div>
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
                    <div className="item-price">
                      <div className="small" style={{ marginTop: 0 }}>Unit Cost</div>
                      <input
                        className="inline-input"
                        type="number"
                        value={inlineDraft.unit_cost}
                        onChange={(e) => updateInlineDraft("unit_cost", e.target.value)}
                      />
                    </div>
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
                    <div>
                      <strong>Total Value:</strong>{" "}
                      {formatCurrency(
                        Number(inlineDraft.quantity_on_hand || 0) * Number(inlineDraft.unit_cost || 0),
                      )}
                    </div>
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
            zIndex: 9999,
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

      {useModalOpen && selectedItem && (
        <div
          onClick={() => setUseModalOpen(false)}
          className="modal-overlay"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="modal-panel"
          >
            <h3>Use — {selectedItem.product_name}</h3>

            <input
              type="number"
              placeholder="Quantity"
              value={useQty}
              onChange={(e) => setUseQty(e.target.value)}
              style={{ width: "100%", marginBottom: "10px" }}
            />

            <input
              placeholder="Job Name"
              value={useJob}
              onChange={(e) => setUseJob(e.target.value)}
              style={{ width: "100%", marginBottom: "10px" }}
            />

            <div className="modal-actions">
              <button onClick={() => setUseModalOpen(false)}>
                Cancel
              </button>

              <button
                onClick={async () => {
                  const qty = Number(useQty)
                  if (!qty || !useJob) {
                    alert("Enter quantity and job")
                    return
                  }

                  await useInventory(selectedItem.id, qty, useJob)

                  setUseQty("")
                  setUseJob("")
                  setUseModalOpen(false)
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
    
