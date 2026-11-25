import type { User } from '@supabase/supabase-js'
import { getSupabase } from './supabase'
import type { Profile, UserRole } from './types'

export async function ensureRecruitmentProfile(user: User): Promise<Profile> {
  const supabase = getSupabase()
  const email = user.email || ''
  const requestedRole = user.user_metadata?.role
  const role: UserRole = requestedRole === 'recruiter' ? 'recruiter' : 'talent'

  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()
  if (readError) throw readError
  if (existing) return existing

  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: user.id, email, role })
    .select()
    .single()
  if (error) {
    const { data: createdByAnotherRequest, error: retryError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    if (retryError) throw retryError
    if (createdByAnotherRequest) return createdByAnotherRequest
    throw error
  }
  return data
}

export async function uploadRecruitmentFile(
  bucket: 'profile-photos' | 'resumes' | 'company-logos' | 'demo-reels',
  userId: string,
  file: File,
): Promise<string> {
  const supabase = getSupabase()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error

  if (bucket === 'resumes' || bucket === 'demo-reels') return path
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export async function getResumeLink(path: string): Promise<string> {
  const { data, error } = await getSupabase()
    .storage.from('resumes')
    .createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}
