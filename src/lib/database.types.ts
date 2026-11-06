
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor": string | null,"at": string,"id": number,"new_data": Json | null,"old_data": Json | null,"row_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"row_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"row_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_fkey"
      columns: ["actor"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"default_tracking": string,"id": string,"name": string,"next_seq": number,"tag_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"default_tracking"?: string,"id"?: string,"name": string,"next_seq"?: number,"tag_prefix": string
                  }
                  Update: {
                    "created_at"?: string,"default_tracking"?: string,"id"?: string,"name"?: string,"next_seq"?: number,"tag_prefix"?: string
                  }
                  Relationships: [
                    
                  ]
                },"clients": {
                  Row: {
                    "address": string | null,"alt_phone": string | null,"anniversary": string | null,"archived": boolean,"birthday": string | null,"city": string | null,"created_at": string,"created_by": string,"full_name": string,"id": string,"notes": string | null,"phone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"alt_phone"?: string | null,"anniversary"?: string | null,"archived"?: boolean,"birthday"?: string | null,"city"?: string | null,"created_at"?: string,"created_by"?: string,"full_name": string,"id"?: string,"notes"?: string | null,"phone": string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"alt_phone"?: string | null,"anniversary"?: string | null,"archived"?: boolean,"birthday"?: string | null,"city"?: string | null,"created_at"?: string,"created_by"?: string,"full_name"?: string,"id"?: string,"notes"?: string | null,"phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"custody_counters": {
                  Row: {
                    "last_no": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_no": number,"year": number
                  }
                  Update: {
                    "last_no"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"custody_items": {
                  Row: {
                    "description": string,"gross_weight_g": number | null,"id": string,"item_id": string | null,"metal": string,"purity": string | null,"qty": number,"receipt_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"gross_weight_g"?: number | null,"id"?: string,"item_id"?: string | null,"metal": string,"purity"?: string | null,"qty"?: number,"receipt_id": string,"sort_order"?: number
                  }
                  Update: {
                    "description"?: string,"gross_weight_g"?: number | null,"id"?: string,"item_id"?: string | null,"metal"?: string,"purity"?: string | null,"qty"?: number,"receipt_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "custody_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "custody_items_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: false
      referencedRelation: "custody_receipts"
      referencedColumns: ["id"]
    }
                  ]
                },"custody_photos": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"receipt_id": string,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"receipt_id": string,"storage_path": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"receipt_id"?: string,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "custody_photos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "custody_photos_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: false
      referencedRelation: "custody_receipts"
      referencedColumns: ["id"]
    }
                  ]
                },"custody_receipts": {
                  Row: {
                    "client_id": string,"id": string,"note": string | null,"receipt_no": string,"received_at": string,"received_by": string,"returned_at": string | null,"returned_by": string | null,"returned_note": string | null,"returned_to": string | null,"sale_id": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"id"?: string,"note"?: string | null,"receipt_no": string,"received_at"?: string,"received_by": string,"returned_at"?: string | null,"returned_by"?: string | null,"returned_note"?: string | null,"returned_to"?: string | null,"sale_id"?: string | null,"status"?: string
                  }
                  Update: {
                    "client_id"?: string,"id"?: string,"note"?: string | null,"receipt_no"?: string,"received_at"?: string,"received_by"?: string,"returned_at"?: string | null,"returned_by"?: string | null,"returned_note"?: string | null,"returned_to"?: string | null,"sale_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "custody_receipts_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "custody_receipts_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "custody_receipts_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "custody_receipts_returned_by_fkey"
      columns: ["returned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "custody_receipts_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sale_balances"
      referencedColumns: ["sale_id"]
    },{
      foreignKeyName: "custody_receipts_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"doc_counters": {
                  Row: {
                    "kind": string,"last_no": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"last_no": number,"year": number
                  }
                  Update: {
                    "kind"?: string,"last_no"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"employee_hr": {
                  Row: {
                    "address": string | null,"emergency_contact": string | null,"joined_on": string | null,"left_on": string | null,"monthly_salary": number | null,"national_id": string | null,"notes": string | null,"profile_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"emergency_contact"?: string | null,"joined_on"?: string | null,"left_on"?: string | null,"monthly_salary"?: number | null,"national_id"?: string | null,"notes"?: string | null,"profile_id": string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"emergency_contact"?: string | null,"joined_on"?: string | null,"left_on"?: string | null,"monthly_salary"?: number | null,"national_id"?: string | null,"notes"?: string | null,"profile_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "employee_hr_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_counters": {
                  Row: {
                    "last_no": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_no": number,"year": number
                  }
                  Update: {
                    "last_no"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"item_components": {
                  Row: {
                    "created_at": string,"created_by": string,"description": string | null,"gross_weight_g": number | null,"id": string,"item_id": string,"kind": string,"photo_path": string | null,"qty": number,"sort_order": number,"stone_weight_g": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"description"?: string | null,"gross_weight_g"?: number | null,"id"?: string,"item_id": string,"kind": string,"photo_path"?: string | null,"qty"?: number,"sort_order"?: number,"stone_weight_g"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"description"?: string | null,"gross_weight_g"?: number | null,"id"?: string,"item_id"?: string,"kind"?: string,"photo_path"?: string | null,"qty"?: number,"sort_order"?: number,"stone_weight_g"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_components_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_components_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"item_costs": {
                  Row: {
                    "cost_amount": number,"item_id": string,"notes": string | null,"purchase_date": string | null,"supplier": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_amount": number,"item_id": string,"notes"?: string | null,"purchase_date"?: string | null,"supplier"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "cost_amount"?: number,"item_id"?: string,"notes"?: string | null,"purchase_date"?: string | null,"supplier"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_costs_item_id_fkey"
      columns: ["item_id"]
isOneToOne: true
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"item_photos": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"item_id": string,"sort_order": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"item_id": string,"sort_order"?: number,"storage_path": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"item_id"?: string,"sort_order"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_photos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_photos_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "archived": boolean,"category_id": string,"created_at": string,"created_by": string,"description": string | null,"fixed_price": number | null,"gross_weight_g": number | null,"id": string,"legacy_tag": string | null,"low_stock_at": number | null,"making_charge": number,"making_type": string,"metal": string,"name": string,"net_weight_g": number | null,"purity": string | null,"qty_on_hand": number,"status": string,"stone_charge": number,"stone_weight_g": number,"tag": string,"tracking": string,"updated_at": string,"suggested_price": number | null
                  }
                  ComputedFields: "suggested_price"
                  Insert: {
                    "archived"?: boolean,"category_id": string,"created_at"?: string,"created_by": string,"description"?: string | null,"fixed_price"?: number | null,"gross_weight_g"?: number | null,"id"?: string,"legacy_tag"?: string | null,"low_stock_at"?: number | null,"making_charge"?: number,"making_type"?: string,"metal": string,"name": string,"net_weight_g"?: never,"purity"?: string | null,"qty_on_hand"?: number,"status"?: string,"stone_charge"?: number,"stone_weight_g"?: number,"tag": string,"tracking": string,"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"category_id"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"fixed_price"?: number | null,"gross_weight_g"?: number | null,"id"?: string,"legacy_tag"?: string | null,"low_stock_at"?: number | null,"making_charge"?: number,"making_type"?: string,"metal"?: string,"name"?: string,"net_weight_g"?: never,"purity"?: string | null,"qty_on_hand"?: number,"status"?: string,"stone_charge"?: number,"stone_weight_g"?: number,"tag"?: string,"tracking"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"melt_batches": {
                  Row: {
                    "batch_no": string,"cost_value": number,"created_at": string,"created_by": string,"id": string,"metal": string,"note": string | null,"outcome": string,"purity": string,"result_weight_g": number | null,"sold_amount": number | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null,"weight_g": number
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_no": string,"cost_value": number,"created_at"?: string,"created_by": string,"id"?: string,"metal": string,"note"?: string | null,"outcome": string,"purity": string,"result_weight_g"?: number | null,"sold_amount"?: number | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null,"weight_g": number
                  }
                  Update: {
                    "batch_no"?: string,"cost_value"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"metal"?: string,"note"?: string | null,"outcome"?: string,"purity"?: string,"result_weight_g"?: number | null,"sold_amount"?: number | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null,"weight_g"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "melt_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "melt_batches_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"metal_rates": {
                  Row: {
                    "created_at": string,"effective_on": string,"id": string,"metal": string,"purity": string,"rate_per_g": number,"set_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effective_on": string,"id"?: string,"metal": string,"purity": string,"rate_per_g": number,"set_by": string
                  }
                  Update: {
                    "created_at"?: string,"effective_on"?: string,"id"?: string,"metal"?: string,"purity"?: string,"rate_per_g"?: number,"set_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "metal_rates_set_by_fkey"
      columns: ["set_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"old_gold_receipts": {
                  Row: {
                    "deduction_pct": number,"description": string | null,"gross_weight_g": number,"id": string,"payment_id": string,"purity": string,"rate_per_g": number,"stone_weight_g": number,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "deduction_pct"?: number,"description"?: string | null,"gross_weight_g": number,"id"?: string,"payment_id": string,"purity": string,"rate_per_g": number,"stone_weight_g"?: number,"value": number
                  }
                  Update: {
                    "deduction_pct"?: number,"description"?: string | null,"gross_weight_g"?: number,"id"?: string,"payment_id"?: string,"purity"?: string,"rate_per_g"?: number,"stone_weight_g"?: number,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "old_gold_receipts_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"client_id": string | null,"created_at": string,"id": string,"method": string,"received_by": string,"reference": string | null,"sale_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"client_id"?: string | null,"created_at"?: string,"id"?: string,"method": string,"received_by": string,"reference"?: string | null,"sale_id": string
                  }
                  Update: {
                    "amount"?: number,"client_id"?: string | null,"created_at"?: string,"id"?: string,"method"?: string,"received_by"?: string,"reference"?: string | null,"sale_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "payments_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sale_balances"
      referencedColumns: ["sale_id"]
    },{
      foreignKeyName: "payments_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "active": boolean,"created_at": string,"full_name": string,"id": string,"phone": string | null,"role": string,"updated_at": string,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"full_name": string,"id": string,"phone"?: string | null,"role"?: string,"updated_at"?: string,"username": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"full_name"?: string,"id"?: string,"phone"?: string | null,"role"?: string,"updated_at"?: string,"username"?: string
                  }
                  Relationships: [
                    
                  ]
                },"purchase_items": {
                  Row: {
                    "deduction_pct": number,"description": string,"destination": string,"gross_weight_g": number | null,"id": string,"item_id": string | null,"metal": string,"purchase_id": string,"purity": string | null,"qty": number,"rate_per_g": number | null,"sort_order": number,"stone_weight_g": number,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "deduction_pct"?: number,"description": string,"destination": string,"gross_weight_g"?: number | null,"id"?: string,"item_id"?: string | null,"metal": string,"purchase_id": string,"purity"?: string | null,"qty"?: number,"rate_per_g"?: number | null,"sort_order"?: number,"stone_weight_g"?: number,"value": number
                  }
                  Update: {
                    "deduction_pct"?: number,"description"?: string,"destination"?: string,"gross_weight_g"?: number | null,"id"?: string,"item_id"?: string | null,"metal"?: string,"purchase_id"?: string,"purity"?: string | null,"qty"?: number,"rate_per_g"?: number | null,"sort_order"?: number,"stone_weight_g"?: number,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_items_purchase_id_fkey"
      columns: ["purchase_id"]
isOneToOne: false
      referencedRelation: "purchases"
      referencedColumns: ["id"]
    }
                  ]
                },"purchases": {
                  Row: {
                    "bought_by": string,"client_id": string,"created_at": string,"id": string,"method": string,"note": string | null,"purchase_no": string,"reference": string | null,"seller_id_note": string | null,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "bought_by": string,"client_id": string,"created_at"?: string,"id"?: string,"method": string,"note"?: string | null,"purchase_no": string,"reference"?: string | null,"seller_id_note"?: string | null,"total": number
                  }
                  Update: {
                    "bought_by"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"method"?: string,"note"?: string | null,"purchase_no"?: string,"reference"?: string | null,"seller_id_note"?: string | null,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchases_bought_by_fkey"
      columns: ["bought_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchases_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "purchases_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    }
                  ]
                },"salary_payments": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string,"id": string,"note": string | null,"paid_on": string,"profile_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string,"id"?: string,"note"?: string | null,"paid_on": string,"profile_id": string,"type": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"note"?: string | null,"paid_on"?: string,"profile_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "salary_payments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "salary_payments_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "created_at": string,"final_price": number,"id": string,"item_id": string,"item_name": string,"item_tag": string,"making_amount": number,"metal": string,"net_weight_g": number | null,"purity": string | null,"qty": number,"rate_per_g": number | null,"sale_id": string,"stone_amount": number,"suggested_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"final_price": number,"id"?: string,"item_id": string,"item_name": string,"item_tag": string,"making_amount"?: number,"metal": string,"net_weight_g"?: number | null,"purity"?: string | null,"qty"?: number,"rate_per_g"?: number | null,"sale_id": string,"stone_amount"?: number,"suggested_price": number
                  }
                  Update: {
                    "created_at"?: string,"final_price"?: number,"id"?: string,"item_id"?: string,"item_name"?: string,"item_tag"?: string,"making_amount"?: number,"metal"?: string,"net_weight_g"?: number | null,"purity"?: string | null,"qty"?: number,"rate_per_g"?: number | null,"sale_id"?: string,"stone_amount"?: number,"suggested_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sale_balances"
      referencedColumns: ["sale_id"]
    },{
      foreignKeyName: "sale_items_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_return_items": {
                  Row: {
                    "credit": number,"id": string,"item_id": string,"line_value": number,"qty": number,"return_id": string,"sale_item_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "credit": number,"id"?: string,"item_id": string,"line_value": number,"qty": number,"return_id": string,"sale_item_id": string
                  }
                  Update: {
                    "credit"?: number,"id"?: string,"item_id"?: string,"line_value"?: number,"qty"?: number,"return_id"?: string,"sale_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_return_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_return_items_return_id_fkey"
      columns: ["return_id"]
isOneToOne: false
      referencedRelation: "sale_returns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_return_items_sale_item_id_fkey"
      columns: ["sale_item_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_returns": {
                  Row: {
                    "applied_to_due": number,"client_id": string | null,"created_at": string,"credit": number,"deduction_pct": number,"exchange_amount": number,"exchange_used": number,"id": string,"reason": string,"refund_amount": number,"return_no": string,"returned_by": string,"sale_id": string,"settle": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_to_due"?: number,"client_id"?: string | null,"created_at"?: string,"credit": number,"deduction_pct"?: number,"exchange_amount"?: number,"exchange_used"?: number,"id"?: string,"reason": string,"refund_amount"?: number,"return_no": string,"returned_by": string,"sale_id": string,"settle": string
                  }
                  Update: {
                    "applied_to_due"?: number,"client_id"?: string | null,"created_at"?: string,"credit"?: number,"deduction_pct"?: number,"exchange_amount"?: number,"exchange_used"?: number,"id"?: string,"reason"?: string,"refund_amount"?: number,"return_no"?: string,"returned_by"?: string,"sale_id"?: string,"settle"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_returns_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "sale_returns_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_returns_returned_by_fkey"
      columns: ["returned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_returns_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sale_balances"
      referencedColumns: ["sale_id"]
    },{
      foreignKeyName: "sale_returns_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "client_id": string | null,"created_at": string,"discount_total": number,"id": string,"invoice_no": string,"note": string | null,"sold_by": string,"status": string,"subtotal": number,"total": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"created_at"?: string,"discount_total"?: number,"id"?: string,"invoice_no": string,"note"?: string | null,"sold_by": string,"status"?: string,"subtotal"?: number,"total"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "client_id"?: string | null,"created_at"?: string,"discount_total"?: number,"id"?: string,"invoice_no"?: string,"note"?: string | null,"sold_by"?: string,"status"?: string,"subtotal"?: number,"total"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_sold_by_fkey"
      columns: ["sold_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"shop_settings": {
                  Row: {
                    "address": string | null,"currency_code": string,"currency_symbol": string,"id": number,"invoice_prefix": string,"old_gold_deduction_pct": number,"phone": string | null,"phone_country_code": string,"shop_name": string,"timezone": string,"updated_at": string,"weight_unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"currency_code"?: string,"currency_symbol"?: string,"id"?: number,"invoice_prefix"?: string,"old_gold_deduction_pct"?: number,"phone"?: string | null,"phone_country_code"?: string,"shop_name"?: string,"timezone"?: string,"updated_at"?: string,"weight_unit"?: string
                  }
                  Update: {
                    "address"?: string | null,"currency_code"?: string,"currency_symbol"?: string,"id"?: number,"invoice_prefix"?: string,"old_gold_deduction_pct"?: number,"phone"?: string | null,"phone_country_code"?: string,"shop_name"?: string,"timezone"?: string,"updated_at"?: string,"weight_unit"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stock_check_items": {
                  Row: {
                    "check_id": string,"item_id": string,"seen_at": string,"seen_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "check_id": string,"item_id": string,"seen_at"?: string,"seen_by": string
                  }
                  Update: {
                    "check_id"?: string,"item_id"?: string,"seen_at"?: string,"seen_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_check_items_check_id_fkey"
      columns: ["check_id"]
isOneToOne: false
      referencedRelation: "stock_checks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_check_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_check_items_seen_by_fkey"
      columns: ["seen_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_checks": {
                  Row: {
                    "category_id": string | null,"completed_at": string | null,"completed_by": string | null,"expected": number | null,"found": number | null,"id": string,"started_at": string,"started_by": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"expected"?: number | null,"found"?: number | null,"id"?: string,"started_at"?: string,"started_by": string,"status"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"expected"?: number | null,"found"?: number | null,"id"?: string,"started_at"?: string,"started_by"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_checks_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_checks_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_checks_started_by_fkey"
      columns: ["started_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_moves": {
                  Row: {
                    "created_at": string,"created_by": string,"id": number,"item_id": string,"qty": number,"reason": string | null,"sale_id": string | null,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: never,"item_id": string,"qty": number,"reason"?: string | null,"sale_id"?: string | null,"type": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: never,"item_id"?: string,"qty"?: number,"reason"?: string | null,"sale_id"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_moves_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_moves_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_moves_sale_fk"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sale_balances"
      referencedColumns: ["sale_id"]
    },{
      foreignKeyName: "stock_moves_sale_fk"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "client_balances": {
                  Row: {
                    "balance": number | null,"client_id": string,"last_purchase_at": string | null,"total_paid": number | null,"total_purchases": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"sale_balances": {
                  Row: {
                    "balance": number | null,"client_id": string | null,"paid": number | null,"paid_out": number | null,"returned_credit": number | null,"sale_id": string,"status": string,"total": number
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "client_balances"
      referencedColumns: ["client_id"]
    },{
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "_melt_pool":
{ Args: Record<PropertyKey, never>; Returns: {
              "metal": string,"purity": string,"value": number,"weight_g": number
            }[]
                           },
"_next_doc_no":
{ Args: { "p_kind": string,"p_prefix": string }; Returns: string
                           },
"_record_payment":
{ Args: { "p": Json,"p_client_id": string,"p_sale_id": string,"p_uid": string }; Returns: number
                           },
"add_payment":
{ Args: { "p_payment": Json,"p_sale_id": string }; Returns: Json
                           },
"adjust_stock":
{ Args: { "p_item_id": string,"p_qty_delta"?: number,"p_reason": string,"p_type": string }; Returns: Json
                           },
"buy_from_client":
{ Args: { "p_client_id": string,"p_lines": Json,"p_method"?: string,"p_note"?: string,"p_reference"?: string,"p_seller_id_note"?: string }; Returns: Json
                           },
"complete_stock_check":
{ Args: { "p_check_id": string }; Returns: Json
                           },
"create_custody":
{ Args: { "p_client_id": string,"p_items": Json,"p_note"?: string,"p_sale_id"?: string }; Returns: Json
                           },
"create_sale":
{ Args: { "p_client_id"?: string,"p_lines": Json,"p_note"?: string,"p_payments"?: Json }; Returns: Json
                           },
"current_rate":
{ Args: { "p_metal": string,"p_purity": string }; Returns: number
                           },
"custody_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"dashboard_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"employee_performance":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "discount_total": number,"full_name": string,"profile_id": string,"sales_count": number,"sales_total": number
            }[]
                           },
"import_items":
{ Args: { "p_rows": Json }; Returns: Json
                           },
"is_active_user":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"item_margin":
{ Args: { "p_item_id": string }; Returns: Json
                           },
"melt_pool_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"price_for":
{ Args: { "p_fixed_price": number,"p_making_charge": number,"p_making_type": string,"p_metal": string,"p_net_weight_g": number,"p_purity": string,"p_stone_charge": number }; Returns: number
                           },
"rates_today":
{ Args: Record<PropertyKey, never>; Returns: {
              "effective_on": string,"is_today": boolean,"metal": string,"purity": string,"rate_per_g": number
            }[]
                           },
"receive_stock":
{ Args: { "p_cost"?: Json,"p_item"?: Json,"p_item_id"?: string,"p_qty"?: number }; Returns: Json
                           },
"record_melt":
{ Args: { "p_metal": string,"p_note"?: string,"p_outcome": string,"p_purity": string,"p_result_weight_g"?: number,"p_sold_amount"?: number,"p_weight_g": number }; Returns: Json
                           },
"release_custody":
{ Args: { "p_note"?: string,"p_presented_receipt_no": string,"p_receipt_id": string,"p_returned_to"?: string }; Returns: Json
                           },
"require_active_user":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"require_admin":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"return_sale_items":
{ Args: { "p_deduction_pct"?: number,"p_lines": Json,"p_reason": string,"p_sale_id": string,"p_settle": string }; Returns: Json
                           },
"search_clients":
{ Args: { "p_include_archived"?: boolean,"p_q"?: string }; Returns: {
              "address": string | null,
"alt_phone": string | null,
"anniversary": string | null,
"archived": boolean,
"birthday": string | null,
"city": string | null,
"created_at": string,
"created_by": string,
"full_name": string,
"id": string,
"notes": string | null,
"phone": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "clients"
        isOneToOne: false
        isSetofReturn: true
      } },
"search_items":
{ Args: { "p_category_id"?: string,"p_include_archived"?: boolean,"p_metal"?: string,"p_q"?: string,"p_status"?: string,"p_tracking"?: string }; Returns: {
              "archived": boolean,
"category_id": string,
"created_at": string,
"created_by": string,
"description": string | null,
"fixed_price": number | null,
"gross_weight_g": number | null,
"id": string,
"legacy_tag": string | null,
"low_stock_at": number | null,
"making_charge": number,
"making_type": string,
"metal": string,
"name": string,
"net_weight_g": number | null,
"purity": string | null,
"qty_on_hand": number,
"status": string,
"stone_charge": number,
"stone_weight_g": number,
"tag": string,
"tracking": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: false
        isSetofReturn: true
      } },
"set_metal_rates":
{ Args: { "p_effective_on"?: string,"p_rates": Json }; Returns: {
              "created_at": string,
"effective_on": string,
"id": string,
"metal": string,
"purity": string,
"rate_per_g": number,
"set_by": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "metal_rates"
        isOneToOne: false
        isSetofReturn: true
      } },
"shop_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"start_stock_check":
{ Args: { "p_category_id"?: string }; Returns: string
                           },
"stock_check_missing":
{ Args: { "p_check_id": string }; Returns: {
              "category": string,"item_id": string,"name": string,"net_weight_g": number,"tag": string
            }[]
                           },
"stock_check_scan":
{ Args: { "p_check_id": string,"p_tag": string }; Returns: Json
                           },
"suggested_price":
{ Args: { "i": Omit<Database["public"]['Tables']["items"]['Row'], Database["public"]['Tables']["items"]['ComputedFields']> }; Returns: number
                           },
"try_numeric":
{ Args: { "p": string }; Returns: number
                           },
"void_melt_batch":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"void_sale":
{ Args: { "p_reason": string,"p_sale_id": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
