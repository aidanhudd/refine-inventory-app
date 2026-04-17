"use client"

import { ChangeEvent, useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabaseClient"

type Category = {
  id: string
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
  quantity_on_hand: number | null
  quantity_type: string | null
  unit_cost: number | null
  warehouse_location: string | null
  notes: string | null
  status: string | null
  created_at: string | null
}

type PhotoMap = Record<string, string[]>

export default function Home() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [quantityTypes, setQuantityTypes] = useState<QuantityType[]>([])
  const [photoMap, setPhotoMap] = useState<PhotoMap>({})
  const [activeImage, setActiveImage] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    const { data: itemsData } = await supabase.from("inventory_items").select("*")
    const { data: catData } = await supabase.from("categories").select("*")
    const { data: qtyData } = await supabase.from("quantity_types").select("*")

    setItems(itemsData || [])
    setCategories(catData || [])
    setQuantityTypes(qtyData || [])

    await loadPhotos(itemsData || [])
  }

  const loadPhotos = async (items: InventoryItem[]) => {
    const map: PhotoMap = {}

    for (const item of items) {
      const { data } = await supabase.storage
        .from("inventory-photos")
        .list(item.id)

      if (data) {
        map[item.id] = data.map((file) => {
          return supabase.storage
            .from("inventory-photos")
            .getPublicUrl(`${item.id}/${file.name}`).data.publicUrl
        })
      }
    }

    setPhotoMap(map)
  }

  return (
    <main>
      <h1>Inventory</h1>

      <div>
        {items.map((item) => {
          const photos = photoMap[item.id] || []

          return (
            <div key={item.id} style={{ marginBottom: 30 }}>
              <h3>{item.product_name}</h3>

              {/* PHOTOS */}
              <div style={{ display: "flex", gap: 10 }}>
                {photos.map((url) => (
                  <img
                    key={url}
                    src={url}
                    style={{
                      width: 100,
                      height: 100,
                      objectFit: "cover",
                      cursor: "pointer",
                      borderRadius: 8,
                    }}
                    onClick={() => setActiveImage(url)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* FULLSCREEN IMAGE VIEWER */}
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
          }}
        >
          <img
            src={activeImage}
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: 12,
            }}
          />
        </div>
      )}
    </main>
  )
}
