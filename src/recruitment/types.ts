export type UserRole = 'recruiter' | 'talent'
export type VacancyStatus = 'open' | 'closed'
export type ApplicationStatus = 'pending' | 'shortlisted' | 'rejected' | 'hired'

export type Profile = {
  id: string
  email: string
  role: UserRole
  created_at: string
}

export type RecruiterProfile = {
  id: string
  user_id: string
  company_name: string
  company_logo: string | null
  bio: string | null
}

export type TalentProfile = {
  id: string
  user_id: string
  full_name: string
  profile_photo: string | null
  bio: string | null
  primary_role: string
  skills: string[]
  experience_level: string
  years_of_experience: number | null
  languages: string[]
  location: string | null
  portfolio_link: string | null
  demo_reel_link: string | null
  resume_url: string | null
  social_links: Record<string, string>
}

export type JobVacancy = {
  id: string
  recruiter_id: string
  job_title: string
  category: string
  project_name: string
  project_type: string
  location: string
  workplace_type: 'Remote' | 'Hybrid' | 'Onsite'
  experience_required: string
  salary_range: string
  description: string
  required_skills: string[]
  deadline: string
  contact_details: string
  status: VacancyStatus
  created_at: string
}

export type JobApplication = {
  id: string
  job_id: string
  applicant_id: string
  cover_letter: string
  portfolio_link: string | null
  resume_link: string | null
  status: ApplicationStatus
  applied_at: string
}

export type SavedJob = {
  id: string
  user_id: string
  job_id: string
}

export type RecruitmentMessage = {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  created_at: string
}

export type RecruitmentNotification = {
  id: string
  user_id: string
  title: string
  message: string
  read_status: boolean
  created_at: string
}

type Table<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>
      recruiter_profiles: Table<RecruiterProfile>
      talent_profiles: Table<TalentProfile>
      job_vacancies: Table<JobVacancy>
      job_applications: Table<JobApplication>
      saved_jobs: Table<SavedJob>
      messages: Table<RecruitmentMessage>
      notifications: Table<RecruitmentNotification>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export const JOB_CATEGORIES = [
  'Director',
  'Assistant Director',
  'Producer',
  'Screenwriter',
  'Cinematographer',
  'Editor',
  'VFX Artist',
  'Animator',
  'Actor',
  'Actress',
  'Music Director',
  'Sound Designer',
  'Costume Designer',
  'Makeup Artist',
  'Photographer',
  'Production Assistant',
  'Other',
] as const

export const PAGE_SIZE = 8
