import { useEffect } from 'react'
import { getSupabase } from './supabase'

export function useRecruitmentRealtime(
  userId: string | undefined,
  onChange: () => void,
): void {
  useEffect(() => {
    if (!userId) return
    const supabase = getSupabase()
    const channel = supabase
      .channel(`recruitment-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_applications' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        onChange,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, onChange])
}
