import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ensureRecruitmentProfile, getResumeLink, uploadRecruitmentFile } from './recruitmentService'
import { getSupabase, supabaseConfigured } from './supabase'
import { useRecruitmentRealtime } from './useRecruitmentRealtime'
import {
  JOB_CATEGORIES,
  PAGE_SIZE,
  type ApplicationStatus,
  type JobApplication,
  type JobVacancy,
  type Profile,
  type RecruiterProfile,
  type RecruitmentMessage,
  type RecruitmentNotification,
  type TalentProfile,
  type UserRole,
} from './types'
import './RecruitmentHub.css'

type Section = 'find' | 'hire' | 'vacancies' | 'applications' | 'talent' | 'messages' | 'profile'
type ApplicationWithDetails = JobApplication & {
  job?: JobVacancy
  talent?: TalentProfile
}

const EMPTY_VACANCY = {
  job_title: '',
  category: 'Director',
  project_name: '',
  project_type: 'Film',
  location: '',
  workplace_type: 'Onsite' as JobVacancy['workplace_type'],
  experience_required: '',
  salary_range: '',
  description: '',
  required_skills: '',
  deadline: '',
  contact_details: '',
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const details = error as { code?: unknown; message?: unknown; details?: unknown }
    if (details.code === 'PGRST205' || details.code === '42P01') {
      return 'Recruitment Hub database tables are missing. Apply supabase/migrations/20261124000000_recruitment_hub.sql in the Supabase SQL Editor, then retry.'
    }
    if (typeof details.message === 'string') {
      const suffix = typeof details.details === 'string' && details.details
        ? ` (${details.details})`
        : ''
      return `${details.message}${suffix}`
    }
  }
  return 'Something went wrong. Please try again.'
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function AuthPanel() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [role, setRole] = useState<UserRole>('talent')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const supabase = getSupabase()
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { role } },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in to continue.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
      }
    } catch (requestError) {
      setError(messageOf(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rh-auth-card">
      <p className="rh-kicker">Your next scene starts here</p>
      <h1>Meet your next collaborator.</h1>
      <p className="rh-muted">Connect the people who make great productions happen.</p>
      <div className="rh-auth-tabs" role="tablist" aria-label="Account action">
        <button className={mode === 'signin' ? 'is-active' : ''} onClick={() => setMode('signin')} type="button">Sign in</button>
        <button className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')} type="button">Create account</button>
      </div>
      <form className="rh-form" onSubmit={submit}>
        {mode === 'signup' && (
          <label className="rh-field">
            <span>I am here to</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="talent">Find work</option>
              <option value="recruiter">Hire crew</option>
            </select>
          </label>
        )}
        <label className="rh-field">
          <span>Email</span>
          <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="rh-field">
          <span>Password</span>
          <input autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="rh-button rh-button-primary" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {notice && <p className="rh-notice" role="status">{notice}</p>}
      {error && <p className="rh-error" role="alert">{error}</p>}
    </section>
  )
}

function ProfileSetup({
  role,
  userId,
  initialProfile,
  onComplete,
}: {
  role: UserRole
  userId: string
  initialProfile?: RecruiterProfile | TalentProfile | null
  onComplete: (profile: RecruiterProfile | TalentProfile) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    company_name: '',
    full_name: '',
    primary_role: 'Actor',
    bio: '',
    skills: '',
    experience_level: 'Entry',
    years_of_experience: '',
    languages: '',
    location: '',
    portfolio_link: '',
    demo_reel_link: '',
    social_links: '',
  })
  useEffect(() => {
    if (role === 'recruiter' && initialProfile && 'company_name' in initialProfile) {
      setForm((current) => ({ ...current, company_name: initialProfile.company_name, bio: initialProfile.bio || '' }))
    } else if (role === 'talent' && initialProfile && 'full_name' in initialProfile) {
      setForm((current) => ({
        ...current,
        full_name: initialProfile.full_name,
        primary_role: initialProfile.primary_role,
        bio: initialProfile.bio || '',
        skills: asList(initialProfile.skills).join(', '),
        experience_level: initialProfile.experience_level,
        years_of_experience: initialProfile.years_of_experience?.toString() || '',
        languages: asList(initialProfile.languages).join(', '),
        location: initialProfile.location || '',
        portfolio_link: initialProfile.portfolio_link || '',
        demo_reel_link: initialProfile.demo_reel_link || '',
        social_links: Object.entries(initialProfile.social_links || {}).map(([label, url]) => `${label}|${url}`).join('\n'),
      }))
    }
  }, [role, initialProfile])
  const [photo, setPhoto] = useState<File | null>(null)
  const [resume, setResume] = useState<File | null>(null)
  const [logo, setLogo] = useState<File | null>(null)

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const supabase = getSupabase()
      if (role === 'recruiter') {
        const existing = initialProfile && 'company_name' in initialProfile ? initialProfile : null
        let companyLogo = existing?.company_logo || null
        if (logo) companyLogo = await uploadRecruitmentFile('company-logos', userId, logo)
        const payload = {
          user_id: userId,
          company_name: form.company_name.trim(),
          company_logo: companyLogo,
          bio: form.bio.trim() || null,
        }
        const { data, error: saveError } = await supabase
          .from('recruiter_profiles').upsert(payload, { onConflict: 'user_id' }).select().single()
        if (saveError) throw saveError
        onComplete(data)
      } else {
        const existing = initialProfile && 'full_name' in initialProfile ? initialProfile : null
        let profilePhoto = existing?.profile_photo || null
        let resumeUrl = existing?.resume_url || null
        if (photo) profilePhoto = await uploadRecruitmentFile('profile-photos', userId, photo)
        if (resume) resumeUrl = await uploadRecruitmentFile('resumes', userId, resume)
        const socialLinks = Object.fromEntries(
          form.social_links.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter(([label, url]) => label && url),
        )
        const payload = {
          user_id: userId,
          full_name: form.full_name.trim(),
          profile_photo: profilePhoto,
          bio: form.bio.trim() || null,
          primary_role: form.primary_role.trim(),
          skills: form.skills.split(',').map((item) => item.trim()).filter(Boolean),
          experience_level: form.experience_level,
          years_of_experience: form.years_of_experience ? Number(form.years_of_experience) : null,
          languages: form.languages.split(',').map((item) => item.trim()).filter(Boolean),
          location: form.location.trim() || null,
          portfolio_link: form.portfolio_link.trim() || null,
          demo_reel_link: form.demo_reel_link.trim() || null,
          resume_url: resumeUrl,
          social_links: socialLinks,
        }
        const { data, error: saveError } = await supabase
          .from('talent_profiles').upsert(payload, { onConflict: 'user_id' }).select().single()
        if (saveError) throw saveError
        onComplete(data)
      }
    } catch (requestError) {
      setError(messageOf(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rh-panel rh-profile-setup">
      <p className="rh-kicker">First things first</p>
      <h2>{role === 'recruiter' ? 'Set up your production profile' : 'Build your talent profile'}</h2>
      <p className="rh-muted">A few details help the right people find you.</p>
      <form className="rh-form rh-form-grid" onSubmit={submit}>
        {role === 'recruiter' ? (
          <>
            <label className="rh-field"><span>Company / production name</span><input required value={form.company_name} onChange={(event) => update('company_name', event.target.value)} /></label>
            <label className="rh-field"><span>Company logo</span><input accept="image/*" type="file" onChange={(event) => setLogo(event.target.files?.[0] || null)} /></label>
            <label className="rh-field rh-field-wide"><span>About your production</span><textarea rows={4} value={form.bio} onChange={(event) => update('bio', event.target.value)} /></label>
          </>
        ) : (
          <>
            <label className="rh-field"><span>Full name</span><input required value={form.full_name} onChange={(event) => update('full_name', event.target.value)} /></label>
            <label className="rh-field"><span>Primary role</span><select value={form.primary_role} onChange={(event) => update('primary_role', event.target.value)}>{JOB_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="rh-field"><span>Experience level</span><select value={form.experience_level} onChange={(event) => update('experience_level', event.target.value)}><option>Entry</option><option>Intermediate</option><option>Experienced</option><option>Expert</option></select></label>
            <label className="rh-field"><span>Years of experience</span><input min="0" type="number" value={form.years_of_experience} onChange={(event) => update('years_of_experience', event.target.value)} /></label>
            <label className="rh-field"><span>Location</span><input value={form.location} onChange={(event) => update('location', event.target.value)} /></label>
            <label className="rh-field"><span>Languages (comma-separated)</span><input value={form.languages} onChange={(event) => update('languages', event.target.value)} /></label>
            <label className="rh-field rh-field-wide"><span>Bio</span><textarea rows={4} value={form.bio} onChange={(event) => update('bio', event.target.value)} /></label>
            <label className="rh-field"><span>Skills (comma-separated)</span><input placeholder="Lighting, editing, ..." value={form.skills} onChange={(event) => update('skills', event.target.value)} /></label>
            <label className="rh-field"><span>Profile photo</span><input accept="image/*" type="file" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></label>
            <label className="rh-field"><span>Portfolio link</span><input type="url" value={form.portfolio_link} onChange={(event) => update('portfolio_link', event.target.value)} /></label>
            <label className="rh-field"><span>Demo reel link</span><input type="url" value={form.demo_reel_link} onChange={(event) => update('demo_reel_link', event.target.value)} /></label>
            <label className="rh-field"><span>Resume file</span><input accept=".pdf,.doc,.docx" type="file" onChange={(event) => setResume(event.target.files?.[0] || null)} /></label>
            <label className="rh-field"><span>Social links (one Label|URL per line)</span><textarea rows={2} placeholder={'Instagram|https://…'} value={form.social_links} onChange={(event) => update('social_links', event.target.value)} /></label>
          </>
        )}
        <div className="rh-field-wide"><button className="rh-button rh-button-primary" disabled={busy} type="submit">{busy ? 'Saving profile…' : 'Save profile'}</button></div>
      </form>
      {error && <p className="rh-error" role="alert">{error}</p>}
    </section>
  )
}

function VacancyEditor({
  initial,
  onSave,
  onCancel,
  busy,
}: {
  initial?: JobVacancy
  onSave: (values: typeof EMPTY_VACANCY) => Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  const [form, setForm] = useState({
    ...EMPTY_VACANCY,
    ...(initial
      ? {
          ...initial,
          required_skills: asList(initial.required_skills).join(', '),
        }
      : {}),
  })
  const [error, setError] = useState('')
  const change = (key: keyof typeof EMPTY_VACANCY, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (form.deadline < new Date().toISOString().slice(0, 10)) {
      setError('Choose a deadline that is today or later.')
      return
    }
    try {
      await onSave(form)
    } catch (saveError) {
      setError(messageOf(saveError))
    }
  }

  return (
    <form className="rh-form rh-form-grid rh-panel" onSubmit={submit}>
      <div className="rh-field-wide"><p className="rh-kicker">{initial ? 'Update listing' : 'Production call sheet'}</p><h2>{initial ? 'Edit vacancy' : 'Create a vacancy'}</h2></div>
      <label className="rh-field"><span>Job title</span><input required value={form.job_title} onChange={(event) => change('job_title', event.target.value)} /></label>
      <label className="rh-field"><span>Category</span><select value={form.category} onChange={(event) => change('category', event.target.value)}>{JOB_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label className="rh-field"><span>Project name</span><input required value={form.project_name} onChange={(event) => change('project_name', event.target.value)} /></label>
      <label className="rh-field"><span>Project type</span><input required placeholder="Film, series, commercial…" value={form.project_type} onChange={(event) => change('project_type', event.target.value)} /></label>
      <label className="rh-field"><span>Location</span><input required value={form.location} onChange={(event) => change('location', event.target.value)} /></label>
      <label className="rh-field"><span>Workplace</span><select value={form.workplace_type} onChange={(event) => change('workplace_type', event.target.value)}><option>Onsite</option><option>Hybrid</option><option>Remote</option></select></label>
      <label className="rh-field"><span>Experience required</span><input value={form.experience_required} onChange={(event) => change('experience_required', event.target.value)} /></label>
      <label className="rh-field"><span>Salary range</span><input value={form.salary_range} onChange={(event) => change('salary_range', event.target.value)} /></label>
      <label className="rh-field"><span>Application deadline</span><input required min={new Date().toISOString().slice(0, 10)} type="date" value={form.deadline} onChange={(event) => change('deadline', event.target.value)} /></label>
      <label className="rh-field"><span>Required skills (comma-separated)</span><input value={form.required_skills} onChange={(event) => change('required_skills', event.target.value)} /></label>
      <label className="rh-field rh-field-wide"><span>Project description</span><textarea required minLength={20} rows={5} value={form.description} onChange={(event) => change('description', event.target.value)} /></label>
      <label className="rh-field rh-field-wide"><span>Contact details</span><input required value={form.contact_details} onChange={(event) => change('contact_details', event.target.value)} /></label>
      <div className="rh-field-wide rh-actions"><button className="rh-button rh-button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save vacancy'}</button><button className="rh-button" onClick={onCancel} type="button">Cancel</button></div>
      {error && <p className="rh-error rh-field-wide" role="alert">{error}</p>}
    </form>
  )
}

function VacancyCard({
  job,
  mine,
  isSaved,
  onApply,
  onSave,
  onEdit,
  onClose,
  onDelete,
  onApplicants,
}: {
  job: JobVacancy
  mine: boolean
  isSaved: boolean
  onApply: (job: JobVacancy) => void
  onSave: (job: JobVacancy) => void
  onEdit: (job: JobVacancy) => void
  onClose: (job: JobVacancy) => void
  onDelete: (job: JobVacancy) => void
  onApplicants: (job: JobVacancy) => void
}) {
  return (
    <article className="rh-card">
      <div className="rh-card-top"><span className="rh-tag">{job.category}</span><span className={`rh-status ${job.status}`}>{job.status}</span></div>
      <h3>{job.job_title}</h3>
      <p className="rh-muted">{job.project_name} · {job.project_type}</p>
      <div className="rh-meta"><span>{job.location}</span><span>{job.workplace_type}</span><span>Deadline {dateLabel(job.deadline)}</span></div>
      <p className="rh-card-copy">{job.description}</p>
      <div className="rh-tags">{asList(job.required_skills).map((skill) => <span className="rh-skill" key={skill}>{skill}</span>)}</div>
      <div className="rh-card-footer">
        {mine ? (
          <>
            <button className="rh-button" onClick={() => onEdit(job)} type="button">Edit</button>
            <button className="rh-button" onClick={() => onApplicants(job)} type="button">View applicants</button>
            <button className="rh-button" onClick={() => onClose(job)} type="button">{job.status === 'open' ? 'Close' : 'Reopen'}</button>
            <button className="rh-button rh-button-danger" onClick={() => onDelete(job)} type="button">Delete</button>
          </>
        ) : (
          <>
            <button className="rh-button" onClick={() => onSave(job)} type="button">{isSaved ? 'Saved' : 'Save job'}</button>
            <button className="rh-button rh-button-primary" disabled={job.status !== 'open'} onClick={() => onApply(job)} type="button">Apply</button>
          </>
        )}
      </div>
    </article>
  )
}

function TalentCard({ talent, onMessage }: { talent: TalentProfile; onMessage: (id: string) => void }) {
  return (
    <article className="rh-card rh-talent-card">
      {talent.profile_photo
        ? <img alt="" className="rh-avatar" src={talent.profile_photo} />
        : <div aria-hidden="true" className="rh-avatar rh-avatar-placeholder">{talent.full_name.slice(0, 1).toUpperCase()}</div>}
      <div className="rh-talent-head"><h3>{talent.full_name}</h3><span className="rh-tag">{talent.primary_role}</span></div>
      <p className="rh-muted">{talent.location || 'Location not specified'} · {talent.experience_level}</p>
      <p className="rh-card-copy">{talent.bio || 'No bio added yet.'}</p>
      <div className="rh-tags">{asList(talent.skills).map((skill) => <span className="rh-skill" key={skill}>{skill}</span>)}</div>
      <div className="rh-card-footer">
        {talent.portfolio_link && <a className="rh-button" href={talent.portfolio_link} rel="noreferrer" target="_blank">Portfolio</a>}
        {talent.demo_reel_link && <a className="rh-button" href={talent.demo_reel_link} rel="noreferrer" target="_blank">Demo reel</a>}
        <button className="rh-button rh-button-primary" onClick={() => onMessage(talent.user_id)} type="button">Message</button>
      </div>
    </article>
  )
}

export default function RecruitmentHub() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [recruiterProfile, setRecruiterProfile] = useState<RecruiterProfile | null>(null)
  const [talentProfile, setTalentProfile] = useState<TalentProfile | null>(null)
  const [section, setSection] = useState<Section>('find')
  const [jobs, setJobs] = useState<JobVacancy[]>([])
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([])
  const [talents, setTalents] = useState<TalentProfile[]>([])
  const [messages, setMessages] = useState<RecruitmentMessage[]>([])
  const [notifications, setNotifications] = useState<RecruitmentNotification[]>([])
  const [savedJobIds, setSavedJobIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingJob, setEditingJob] = useState<JobVacancy | null | undefined>(undefined)
  const [applyingJob, setApplyingJob] = useState<JobVacancy | null>(null)
  const [applicationText, setApplicationText] = useState({ cover_letter: '', portfolio_link: '', resume_link: '' })
  const [recipientId, setRecipientId] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [showSavedOnly, setShowSavedOnly] = useState(false)
  const [applicationJobFilter, setApplicationJobFilter] = useState('')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [profileLoadingError, setProfileLoadingError] = useState('')
  const role = profile?.role

  useEffect(() => {
    if (role) setSection(role === 'recruiter' ? 'hire' : 'find')
  }, [role])

  useEffect(() => {
    if (!supabaseConfigured) {
      setAuthLoading(false)
      return
    }
    const supabase = getSupabase()
    let active = true
    void supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      if (data.session?.user) {
        try {
          setProfile(await ensureRecruitmentProfile(data.session.user))
        } catch (profileError) {
          setProfileLoadingError(messageOf(profileError))
        }
      }
      if (active) setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
        setRecruiterProfile(null)
        setTalentProfile(null)
        return
      }
      window.setTimeout(() => {
        void ensureRecruitmentProfile(nextSession.user)
          .then((nextProfile) => {
            setProfile(nextProfile)
            setProfileLoadingError('')
          })
          .catch((profileError) => setProfileLoadingError(messageOf(profileError)))
      }, 0)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user || !profile) return
    let active = true
    const supabase = getSupabase()
    const loadRoleProfile = async () => {
      try {
        if (profile.role === 'recruiter') {
          const { data, error: queryError } = await supabase
            .from('recruiter_profiles').select('*').eq('user_id', session.user.id).maybeSingle()
          if (queryError) throw queryError
          if (active) setRecruiterProfile(data)
        } else {
          const { data, error: queryError } = await supabase
            .from('talent_profiles').select('*').eq('user_id', session.user.id).maybeSingle()
          if (queryError) throw queryError
          if (active) setTalentProfile(data)
        }
      } catch (profileError) {
        if (active) setError(messageOf(profileError))
      }
    }
    void loadRoleProfile()
    return () => { active = false }
  }, [session, profile])

  const refreshNotifications = useCallback(async () => {
    if (!session?.user) return
    const { data, error: queryError } = await getSupabase()
      .from('notifications').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(12)
    if (queryError) throw queryError
    setNotifications(data || [])
  }, [session])

  const loadSection = useCallback(async () => {
    if (!session?.user || !profile) return
    setLoading(true)
    setError('')
    try {
      const supabase = getSupabase()
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      if (section === 'find' || section === 'vacancies' || section === 'hire') {
        let query = supabase.from('job_vacancies').select('*', { count: 'exact' }).order('created_at', { ascending: false })
        if (section === 'vacancies' || section === 'hire') {
          query = query.eq('recruiter_id', session.user.id)
        } else {
          query = query.eq('status', 'open').gte('deadline', new Date().toISOString().slice(0, 10))
          if (categoryFilter) query = query.eq('category', categoryFilter)
          if (search.trim()) {
            const term = search.trim().replace(/[,%()\\]/g, '\\$&')
            query = query.or(
              `job_title.ilike.%${term}%,project_name.ilike.%${term}%,location.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%`,
            )
          }
          if (showSavedOnly) {
            const { data: saved, error: savedError } = await supabase
              .from('saved_jobs').select('job_id').eq('user_id', session.user.id)
            if (savedError) throw savedError
            const ids = (saved || []).map((item) => item.job_id)
            query = ids.length ? query.in('id', ids) : query.eq('id', '00000000-0000-0000-0000-000000000000')
          }
        }
        const { data, count, error: queryError } = await query.range(from, to)
        if (queryError) throw queryError
        setJobs(data || [])
        setTotal(count || 0)
        const { data: saved, error: savedError } = await supabase.from('saved_jobs').select('job_id').eq('user_id', session.user.id)
        if (savedError) throw savedError
        setSavedJobIds((saved || []).map((item) => item.job_id))
      } else if (section === 'applications') {
        let query = supabase.from('job_applications').select('*', { count: 'exact' }).order('applied_at', { ascending: false })
        let jobRows: JobVacancy[] = []
        let talentRows: TalentProfile[] = []
        if (profile.role === 'talent') {
          query = query.eq('applicant_id', session.user.id)
        } else {
          const { data: ownedJobs, error: jobsError } = await supabase.from('job_vacancies').select('*').eq('recruiter_id', session.user.id)
          if (jobsError) throw jobsError
          jobRows = ownedJobs || []
          const ids = jobRows.map((job) => job.id)
          query = ids.length ? query.in('job_id', ids) : query.eq('job_id', '00000000-0000-0000-0000-000000000000')
          if (applicationJobFilter && ids.includes(applicationJobFilter)) query = query.eq('job_id', applicationJobFilter)
        }
        const { data, count, error: queryError } = await query.range(from, to)
        if (queryError) throw queryError
        const rows = data || []
        if (profile.role === 'talent') {
          const ids = [...new Set(rows.map((item) => item.job_id))]
          if (ids.length) {
            const { data: relatedJobs, error: relatedError } = await supabase.from('job_vacancies').select('*').in('id', ids)
            if (relatedError) throw relatedError
            jobRows = relatedJobs || []
          }
        } else {
          const applicantIds = [...new Set(rows.map((item) => item.applicant_id))]
          if (applicantIds.length) {
            const { data: talentsFound, error: talentError } = await supabase.from('talent_profiles').select('*').in('user_id', applicantIds)
            if (talentError) throw talentError
            talentRows = talentsFound || []
          }
        }
        setApplications(rows.map((application) => ({
          ...application,
          job: jobRows.find((job) => job.id === application.job_id),
          talent: talentRows.find((talent) => talent.user_id === application.applicant_id),
        })))
        setTotal(count || 0)
      } else if (section === 'talent') {
        let query = supabase.from('talent_profiles').select('*', { count: 'exact' }).order('full_name')
        if (search.trim()) {
          const term = search.trim().replace(/[,%()\\]/g, '\\$&')
          query = query.or(`full_name.ilike.%${term}%,primary_role.ilike.%${term}%,location.ilike.%${term}%`)
        }
        const { data, count, error: queryError } = await query.range(from, to)
        if (queryError) throw queryError
        setTalents(data || [])
        setTotal(count || 0)
      } else if (section === 'messages') {
        const { data, error: queryError } = await supabase.from('messages').select('*')
          .or(`sender_id.eq.${session.user.id},receiver_id.eq.${session.user.id}`)
          .order('created_at', { ascending: true })
        if (queryError) throw queryError
        setMessages(data || [])
        setTotal(data?.length || 0)
      }
      await refreshNotifications()
    } catch (loadError) {
      setError(messageOf(loadError))
    } finally {
      setLoading(false)
    }
  }, [session, profile, page, section, categoryFilter, search, showSavedOnly, refreshNotifications, applicationJobFilter])

  useEffect(() => {
    void loadSection()
  }, [loadSection])

  const refreshRealtime = useCallback(() => {
    void loadSection()
  }, [loadSection])
  useRecruitmentRealtime(session?.user.id, refreshRealtime)

  const notifySuccess = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3500)
  }

  const saveVacancy = async (values: typeof EMPTY_VACANCY) => {
    if (!session?.user) return
    setBusy(true)
    try {
      const payload = {
        job_title: values.job_title.trim(),
        category: values.category,
        project_name: values.project_name.trim(),
        project_type: values.project_type.trim(),
        location: values.location.trim(),
        workplace_type: values.workplace_type,
        experience_required: values.experience_required.trim(),
        salary_range: values.salary_range.trim(),
        description: values.description.trim(),
        required_skills: values.required_skills.split(',').map((item) => item.trim()).filter(Boolean),
        deadline: values.deadline,
        contact_details: values.contact_details.trim(),
      }
      const supabase = getSupabase()
      const result = editingJob
        ? await supabase.from('job_vacancies').update(payload).eq('id', editingJob.id)
        : await supabase.from('job_vacancies').insert({ ...payload, recruiter_id: session.user.id })
      if (result.error) throw result.error
      setEditingJob(undefined)
      setSection('vacancies')
      notifySuccess(editingJob ? 'Vacancy updated.' : 'Vacancy published.')
      await loadSection()
    } catch (saveError) {
      throw saveError
    } finally {
      setBusy(false)
    }
  }

  const toggleSaved = async (job: JobVacancy) => {
    if (!session?.user) return
    setBusy(true)
    setError('')
    try {
      const supabase = getSupabase()
      const isSaved = savedJobIds.includes(job.id)
      const result = isSaved
        ? await supabase.from('saved_jobs').delete().eq('user_id', session.user.id).eq('job_id', job.id)
        : await supabase.from('saved_jobs').insert({ user_id: session.user.id, job_id: job.id })
      if (result.error) throw result.error
      setSavedJobIds((current) => isSaved ? current.filter((id) => id !== job.id) : [...current, job.id])
      notifySuccess(isSaved ? 'Job removed from saved.' : 'Job saved for later.')
      if (showSavedOnly) await loadSection()
    } catch (saveError) {
      setError(messageOf(saveError))
    } finally {
      setBusy(false)
    }
  }

  const applyForJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session?.user || !applyingJob) return
    setBusy(true)
    setError('')
    try {
      const { error: applyError } = await getSupabase().from('job_applications').insert({
        job_id: applyingJob.id,
        applicant_id: session.user.id,
        cover_letter: applicationText.cover_letter.trim(),
        portfolio_link: applicationText.portfolio_link.trim() || null,
        resume_link: applicationText.resume_link.trim() || talentProfile?.resume_url || null,
      })
      if (applyError) throw applyError
      setApplyingJob(null)
      setApplicationText({ cover_letter: '', portfolio_link: '', resume_link: '' })
      notifySuccess('Application sent. You can track it in My Applications.')
      await loadSection()
    } catch (applyError) {
      setError(messageOf(applyError))
    } finally {
      setBusy(false)
    }
  }

  const updateVacancy = async (job: JobVacancy, operation: 'close' | 'delete') => {
    if (!window.confirm(operation === 'delete' ? 'Permanently delete this vacancy and its applications?' : `${job.status === 'open' ? 'Close' : 'Reopen'} this vacancy?`)) return
    setBusy(true)
    try {
      const result = operation === 'delete'
        ? await getSupabase().from('job_vacancies').delete().eq('id', job.id)
        : await getSupabase().from('job_vacancies').update({ status: job.status === 'open' ? 'closed' : 'open' }).eq('id', job.id)
      if (result.error) throw result.error
      notifySuccess(operation === 'delete' ? 'Vacancy deleted.' : 'Vacancy status updated.')
      await loadSection()
    } catch (updateError) {
      setError(messageOf(updateError))
    } finally {
      setBusy(false)
    }
  }

  const changeApplicationStatus = async (application: JobApplication, status: ApplicationStatus) => {
    setBusy(true)
    try {
      const { error: updateError } = await getSupabase().from('job_applications').update({ status }).eq('id', application.id)
      if (updateError) throw updateError
      notifySuccess(`Candidate ${status}.`)
      await loadSection()
    } catch (updateError) {
      setError(messageOf(updateError))
    } finally {
      setBusy(false)
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session?.user || !recipientId.trim() || !draftMessage.trim()) return
    setBusy(true)
    try {
      const { error: sendError } = await getSupabase().from('messages').insert({
        sender_id: session.user.id,
        receiver_id: recipientId.trim(),
        content: draftMessage.trim(),
      })
      if (sendError) throw sendError
      setDraftMessage('')
      await loadSection()
    } catch (sendError) {
      setError(messageOf(sendError))
    } finally {
      setBusy(false)
    }
  }

  const markNotificationRead = async (item: RecruitmentNotification) => {
    if (item.read_status) return
    try {
      const { error: updateError } = await getSupabase().from('notifications').update({ read_status: true }).eq('id', item.id)
      if (updateError) throw updateError
      setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, read_status: true } : notification))
    } catch (updateError) {
      setError(messageOf(updateError))
    }
  }

  const signOut = async () => {
    const { error: signOutError } = await getSupabase().auth.signOut()
    if (signOutError) setError(signOutError.message)
  }

  const retryProfileSetup = async () => {
    if (!session?.user) return
    setProfileLoadingError('')
    try {
      setProfile(await ensureRecruitmentProfile(session.user))
    } catch (profileError) {
      setProfileLoadingError(messageOf(profileError))
    }
  }

  const setupComplete = role === 'recruiter' ? recruiterProfile !== null : talentProfile !== null
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read_status).length, [notifications])
  const sections: { id: Section; label: string; icon: string }[] = role === 'recruiter'
    ? [
        { id: 'hire', label: 'Hire Crew', icon: '＋' },
        { id: 'vacancies', label: 'My Vacancies', icon: '▤' },
        { id: 'applications', label: 'My Applications', icon: '◎' },
        { id: 'talent', label: 'Talent Directory', icon: '✳' },
        { id: 'messages', label: 'Messages', icon: '✉' },
        { id: 'profile', label: 'My Profile', icon: '◉' },
      ]
    : [
        { id: 'find', label: 'Find Work', icon: '⌕' },
        { id: 'applications', label: 'My Applications', icon: '▤' },
        { id: 'messages', label: 'Messages', icon: '✉' },
        { id: 'profile', label: 'My Profile', icon: '◉' },
      ]

  const changeSection = (next: Section) => {
    setSection(next)
    setPage(0)
    setError('')
    setEditingJob(undefined)
    setApplyingJob(null)
    setIsEditingProfile(false)
    if (next !== 'applications' || section === 'applications') setApplicationJobFilter('')
  }

  const openMessages = (id: string) => {
    setRecipientId(id)
    changeSection('messages')
  }

  const startResumeDownload = async (path: string) => {
    try {
      const link = await getResumeLink(path)
      window.open(link, '_blank', 'noopener,noreferrer')
    } catch (linkError) {
      setError(messageOf(linkError))
    }
  }

  if (!supabaseConfigured) {
    return (
      <main className="rh-shell">
        <section className="rh-panel rh-config-notice">
          <p className="rh-kicker">Recruitment Hub</p>
          <h1>Connect your Supabase project</h1>
          <p className="rh-muted">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your local environment, then apply the migration in <code>supabase/migrations</code>.</p>
          <p className="rh-error">Never add a Supabase secret/service-role key to frontend environment variables.</p>
        </section>
      </main>
    )
  }

  if (authLoading) return <main className="rh-shell"><div className="rh-loading">Loading Recruitment Hub…</div></main>
  if (!session) {
    return (
      <main className="rh-shell">
        <header className="rh-hero"><p className="rh-kicker">AI Scriptify · Recruitment</p><h1>Good stories need great crews.</h1><p>Discover opportunities, build your crew, and bring the next production to life.</p></header>
        <AuthPanel />
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="rh-shell">
        <section className="rh-panel rh-config-notice" aria-live="polite">
          <p className="rh-kicker">Recruitment Hub setup</p>
          <h1>{profileLoadingError ? 'Could not prepare your profile' : 'Preparing your secure profile…'}</h1>
          {profileLoadingError
            ? <>
                <p className="rh-error" role="alert">{profileLoadingError}</p>
                <p className="rh-muted">In Supabase, open SQL Editor and run the Recruitment Hub migration from this project. After it completes, retry here.</p>
                <div className="rh-actions">
                  <button className="rh-button rh-button-primary" onClick={() => void retryProfileSetup()} type="button">Retry</button>
                  <button className="rh-button" onClick={() => void signOut()} type="button">Sign out</button>
                </div>
              </>
            : <p className="rh-muted">Checking your Recruitment Hub account…</p>}
        </section>
      </main>
    )
  }
  if (!setupComplete) {
    return (
      <main className="rh-shell">
        <div className="rh-user-bar"><span>{session.user.email}</span><button className="rh-button" onClick={() => void signOut()} type="button">Sign out</button></div>
        <ProfileSetup role={profile.role} userId={session.user.id} onComplete={(saved) => {
          if ('company_name' in saved) setRecruiterProfile(saved)
          else setTalentProfile(saved)
        }} initialProfile={profile.role === 'recruiter' ? recruiterProfile : talentProfile} />
      </main>
    )
  }

  const sectionTitle: Record<Section, string> = {
    find: 'Find your next role',
    hire: 'Build your dream crew',
    vacancies: 'My vacancies',
    applications: role === 'recruiter' ? 'Candidate applications' : 'My applications',
    talent: 'Talent directory',
    messages: 'Production messages',
    profile: 'Your profile',
  }

  return (
    <main className="rh-shell">
      <header className="rh-header">
        <div className="rh-header-brand"><span className="rh-mark">RH</span><div><p className="rh-kicker">AI Scriptify</p><h1>Recruitment Hub</h1></div></div>
        <div className="rh-user-bar">
          <button className="rh-button rh-notification-button" onClick={() => setShowNotifications((shown) => !shown)} type="button" aria-expanded={showNotifications}>
            Notifications{unreadCount > 0 && <span className="rh-count">{unreadCount}</span>}
          </button>
          <span className="rh-user-email">{session.user.email}</span>
          <button className="rh-button" onClick={() => void signOut()} type="button">Sign out</button>
        </div>
        {showNotifications && <aside className="rh-notifications"><h3>Notifications</h3>{notifications.length ? notifications.map((item) => <button className={`rh-notification ${item.read_status ? 'is-read' : ''}`} key={item.id} onClick={() => void markNotificationRead(item)} type="button"><strong>{item.title}</strong><span>{item.message}</span><small>{dateLabel(item.created_at)}</small></button>) : <p className="rh-muted">You're all caught up.</p>}</aside>}
      </header>

      <div className="rh-layout">
        <nav className="rh-nav" aria-label="Recruitment">
          <p className="rh-nav-label">Your workspace</p>
          {sections.map((item) => <button className={`rh-nav-item ${section === item.id ? 'is-active' : ''}`} key={item.id} onClick={() => changeSection(item.id)} type="button"><span>{item.icon}</span>{item.label}</button>)}
          <div className="rh-nav-note"><span className="rh-record-dot" />{role === 'recruiter' ? recruiterProfile?.company_name : talentProfile?.primary_role}</div>
        </nav>

        <section className="rh-main">
          <div className="rh-section-heading">
            <div><p className="rh-kicker">{role === 'recruiter' ? 'Hire crew portal' : 'Find work portal'}</p><h2>{sectionTitle[section]}</h2></div>
            {section === 'vacancies' && role === 'recruiter' && <button className="rh-button rh-button-primary" onClick={() => setEditingJob(null)} type="button">＋ Create vacancy</button>}
          </div>
          {notice && <p className="rh-notice" role="status">{notice}</p>}
          {error && <p className="rh-error" role="alert">{error}</p>}
          {loading && <p className="rh-loading-inline">Updating your production board…</p>}

          {(section === 'find' || section === 'talent') && (
            <form className="rh-searchbar" onSubmit={(event) => { event.preventDefault(); setPage(0); void loadSection() }}>
              <input aria-label="Search" placeholder={section === 'talent' ? 'Search names, roles, or locations…' : 'Search job titles…'} value={search} onChange={(event) => setSearch(event.target.value)} />
              {section === 'find' && <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(0) }}><option value="">All categories</option>{JOB_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>}
              {section === 'find' && <label className="rh-check"><input checked={showSavedOnly} onChange={(event) => { setShowSavedOnly(event.target.checked); setPage(0) }} type="checkbox" /> Saved only</label>}
              <button className="rh-button rh-button-primary" type="submit">Search</button>
            </form>
          )}

          {editingJob !== undefined && role === 'recruiter' && (
            <VacancyEditor initial={editingJob || undefined} busy={busy} onCancel={() => setEditingJob(undefined)} onSave={saveVacancy} />
          )}

          {(section === 'find' || section === 'vacancies') && (
            jobs.length ? <div className="rh-card-grid">{jobs.map((job) => <VacancyCard key={job.id} job={job} mine={role === 'recruiter'} isSaved={savedJobIds.includes(job.id)} onApply={(selected) => { setApplyingJob(selected); setError('') }} onSave={(selected) => void toggleSaved(selected)} onEdit={(selected) => setEditingJob(selected)} onClose={(selected) => void updateVacancy(selected, 'close')} onDelete={(selected) => void updateVacancy(selected, 'delete')} onApplicants={(selected) => { setApplicationJobFilter(selected.id); changeSection('applications') }} />)}</div>
              : !loading && <div className="rh-empty"><span>✳</span><h3>{section === 'vacancies' ? 'No vacancies yet' : 'No opportunities found'}</h3><p>{section === 'vacancies' ? 'Create your first listing to invite the right crew.' : 'Try a different search or check back soon.'}</p></div>
          )}

          {section === 'hire' && (
            <div className="rh-hire-panel">
              <div className="rh-hire-copy"><p className="rh-kicker">Call action</p><h3>Make your next production happen.</h3><p>Post a vacancy, review incoming applications, and connect with exceptional film and media talent.</p><button className="rh-button rh-button-primary" onClick={() => { setSection('vacancies'); setEditingJob(null) }} type="button">＋ Create a vacancy</button></div>
              <div className="rh-hire-stat"><strong>{jobs.length}</strong><span>active / recent vacancies on this page</span></div>
            </div>
          )}

          {section === 'applications' && (
            applications.length ? <div className="rh-stack">{applications.map((application) => <article className="rh-card rh-application" key={application.id}>
              <div className="rh-card-top"><span className="rh-tag">{application.job?.job_title || `Vacancy ${application.job_id.slice(0, 8)}`}</span><span className={`rh-status ${application.status}`}>{application.status}</span></div>
              {role === 'recruiter' && application.talent && <><h3>{application.talent.full_name} · {application.talent.primary_role}</h3><p className="rh-muted">{application.talent.location || 'Location not specified'} · {application.talent.experience_level}</p></>}
              <p className="rh-card-copy">{application.cover_letter}</p>
              <div className="rh-meta"><span>Applied {dateLabel(application.applied_at)}</span>{application.portfolio_link && <a href={application.portfolio_link} rel="noreferrer" target="_blank">Portfolio</a>}{application.resume_link && (application.resume_link.startsWith('http') ? <a href={application.resume_link} rel="noreferrer" target="_blank">Resume</a> : <button className="rh-text-button" onClick={() => void startResumeDownload(application.resume_link!)} type="button">Open resume</button>)}</div>
              <div className="rh-card-footer">{role === 'recruiter' ? <><button className="rh-button" onClick={() => void changeApplicationStatus(application, 'shortlisted')} type="button">Shortlist</button><button className="rh-button" onClick={() => void changeApplicationStatus(application, 'rejected')} type="button">Reject</button><button className="rh-button rh-button-primary" onClick={() => void changeApplicationStatus(application, 'hired')} type="button">Hire</button>{application.talent && <button className="rh-button" onClick={() => openMessages(application.applicant_id)} type="button">Message candidate</button>}</> : application.job?.recruiter_id && <span className="rh-muted">Your application is being reviewed.</span>}</div>
            </article>)}</div> : !loading && <div className="rh-empty"><span>◎</span><h3>No applications yet</h3><p>{role === 'recruiter' ? 'Applications for your vacancies will appear here.' : 'Apply to an opportunity and track its progress here.'}</p></div>
          )}

          {section === 'talent' && (
            role === 'recruiter'
              ? talents.length ? <div className="rh-card-grid">{talents.map((talent) => <TalentCard key={talent.id} talent={talent} onMessage={openMessages} />)}</div>
                : !loading && <div className="rh-empty"><span>✳</span><h3>No talent profiles found</h3><p>Change your search to discover more crew.</p></div>
              : <div className="rh-empty"><span>✳</span><h3>Talent directory is for recruiters</h3><p>Explore open roles in Find Work.</p></div>
          )}

          {section === 'messages' && (
            <div className="rh-messages-layout">
              <aside className="rh-conversations"><h3>Conversations</h3>{[...new Set(messages.map((message) => message.sender_id === session.user.id ? message.receiver_id : message.sender_id))].map((id) => <button className={`rh-conversation ${recipientId === id ? 'is-active' : ''}`} key={id} onClick={() => setRecipientId(id)} type="button"><span className="rh-avatar rh-avatar-placeholder">{id.slice(0, 1).toUpperCase()}</span><span>Production contact<small>{id.slice(0, 8)}…</small></span></button>)}{!messages.length && <p className="rh-muted">Start a conversation from a talent or application card.</p>}</aside>
              <div className="rh-chat"><div className="rh-chat-messages">{messages.filter((message) => !recipientId || message.sender_id === recipientId || message.receiver_id === recipientId).map((message) => <div className={`rh-bubble ${message.sender_id === session.user.id ? 'mine' : ''}`} key={message.id}><p>{message.content}</p><small>{message.sender_id === session.user.id ? 'You' : message.sender_id.slice(0, 8)} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.created_at))}</small></div>)}{!messages.length && <p className="rh-muted">Messages with your collaborators will show here.</p>}</div>
                <form className="rh-message-form" onSubmit={sendMessage}><input aria-label="Recipient user ID" placeholder="Recipient user ID" required value={recipientId} onChange={(event) => setRecipientId(event.target.value)} /><input aria-label="Message" maxLength={5000} placeholder="Write a message…" required value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} /><button className="rh-button rh-button-primary" disabled={busy} type="submit">Send</button></form>
              </div>
            </div>
          )}

          {section === 'profile' && (
            <div className="rh-panel rh-profile-summary">
              {role === 'talent' && talentProfile ? <><h3>{talentProfile.full_name}</h3><p className="rh-muted">{talentProfile.primary_role} · {talentProfile.location}</p><p>{talentProfile.bio}</p><p>Skills: {asList(talentProfile.skills).join(', ') || 'Not added'}</p>              <button className="rh-button" onClick={() => setIsEditingProfile(true)} type="button">Edit profile</button></> :
                  recruiterProfile && <><h3>{recruiterProfile.company_name}</h3><p>{recruiterProfile.bio || 'Add a bio to tell candidates about your production.'}</p><button className="rh-button" onClick={() => setIsEditingProfile(true)} type="button">Edit profile</button></>}
                {isEditingProfile && <ProfileSetup role={profile.role} userId={session.user.id} initialProfile={profile.role === 'recruiter' ? recruiterProfile : talentProfile} onComplete={(saved) => { if ('company_name' in saved) setRecruiterProfile(saved); else setTalentProfile(saved); setIsEditingProfile(false) }} />}
            </div>
          )}

          {total > PAGE_SIZE && section !== 'messages' && <div className="rh-pagination"><button className="rh-button" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)} type="button">← Previous</button><span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span><button className="rh-button" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((current) => current + 1)} type="button">Next →</button></div>}
        </section>
      </div>

      {applyingJob && <div className="rh-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setApplyingJob(null) }}>      <section aria-labelledby="rh-apply-title" aria-modal="true" className="rh-modal" role="dialog"><button aria-label="Close application" className="rh-modal-close" onClick={() => setApplyingJob(null)} type="button">×</button><p className="rh-kicker">Submit your application</p><h2 id="rh-apply-title">{applyingJob.job_title}</h2><form className="rh-form" onSubmit={applyForJob}><label className="rh-field"><span>Cover letter</span><textarea minLength={20} required rows={6} value={applicationText.cover_letter} onChange={(event) => setApplicationText((current) => ({ ...current, cover_letter: event.target.value }))} /></label><label className="rh-field"><span>Portfolio link</span><input type="url" value={applicationText.portfolio_link} onChange={(event) => setApplicationText((current) => ({ ...current, portfolio_link: event.target.value }))} /></label><label className="rh-field"><span>Resume link (leave blank to use profile resume)</span><input type="url" value={applicationText.resume_link} onChange={(event) => setApplicationText((current) => ({ ...current, resume_link: event.target.value }))} /></label>{error && <p className="rh-error" role="alert">{error}</p>}<button className="rh-button rh-button-primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send application'}</button></form></section></div>}
    </main>
  )
}
