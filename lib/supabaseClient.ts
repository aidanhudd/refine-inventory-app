import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://trvobbrhkydjxilpiwzv.supabase.co'
const supabaseAnonKey = 'sb_publishable__x1WFFbaZmAEZF5GrOB4Gg_0X20jv65'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
