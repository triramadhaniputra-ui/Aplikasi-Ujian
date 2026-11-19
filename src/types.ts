export type UserRole = 'admin' | 'guru' | 'pengawas' | 'siswa';
export type UserStatus = 'aktif' | 'nonaktif';

export type QuestionType =
  | 'pg'
  | 'pg_kompleks'
  | 'benar_salah'
  | 'menjodohkan'
  | 'isian_singkat'
  | 'esai';

export type DifficultyLevel = 'mudah' | 'sedang' | 'sukar';
export type MediaType = 'none' | 'image' | 'audio' | 'video';

export interface QuestionOption {
  key: string;
  text: string;
  image_url?: string;
}

export interface MatchingPair {
  id: string;
  left: string;
  right: string;
}

export interface Question {
  id: number;
  subject_id: number;
  subject_name?: string;
  subject_code?: string;
  grade_level: number;
  topic: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  weight: number;
  prompt: string;
  media_type: MediaType;
  media_url: string;
  options: QuestionOption[] | MatchingPair[];
  correct_answer?: unknown;
  scoring_rule?: {
    mode?: 'all_or_nothing' | 'partial';
    variations?: string[];
    case_sensitive?: boolean;
    rubric?: string;
  };
  explanation?: string;
  created_by: number;
  created_at: string;
}

export interface ClassGroup {
  id: number;
  name: string;
  grade_level: number;
  homeroom_teacher_id: number | null;
  homeroom_teacher_name?: string;
  student_count?: number;
}

export interface Subject {
  id: number;
  code: string;
  name: string;
  kkm: number;
}

export interface UserAccount {
  id: number;
  username: string;
  role: UserRole;
  full_name: string;
  nip_nis: string;
  class_id: number | null;
  class_name?: string;
  subject_ids: number[];
  status: UserStatus;
  photo_url: string;
  created_at: string;
}

export interface LoginHistoryEntry {
  id: number;
  user_id: number | null;
  username: string;
  role: string;
  ip_address: string;
  user_agent: string;
  status: 'success' | 'failed';
  timestamp: string;
}

export interface Exam {
  id: number;
  title: string;
  subject_id: number;
  subject_name?: string;
  subject_code?: string;
  teacher_id: number;
  teacher_name?: string;
  class_ids: number[];
  class_names?: string[];
  exam_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  question_count: number;
  kkm: number;
  token: string;
  exam_password: string;
  max_attempts: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_navigation: boolean;
  allow_back: boolean;
  show_result_after: boolean;
  require_webcam: boolean;
  status: 'draft' | 'aktif' | 'selesai';
  created_at: string;
  assigned_question_count?: number;
}

export interface ExamAttemptSummary {
  id: number;
  exam_id: number;
  exam_title?: string;
  subject_name?: string;
  student_id: number;
  student_name?: string;
  student_nis?: string;
  class_id?: number | null;
  class_name?: string;
  attempt_number: number;
  status: 'belum_mulai' | 'sedang_mengerjakan' | 'selesai' | 'terindikasi_pelanggaran';
  started_at: string | null;
  expires_at: string | null;
  finished_at: string | null;
  answered_count: number;
  total_questions: number;
  violation_count: number;
  flagged_for_review: boolean;
  proctor_notes: string;
  proctor_action: 'none' | 'peringatan' | 'lanjut_diawasi' | 'hentikan_sementara' | 'diskualifikasi';
  webcam_verified: boolean;
  webcam_snapshot_url: string;
  total_score: number;
  max_score: number;
  final_grade: number;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  is_passed: boolean;
  essay_graded: boolean;
}

export interface ViolationLog {
  id: number;
  attempt_id: number;
  exam_id: number;
  student_id: number;
  student_name?: string;
  student_nis?: string;
  class_name?: string;
  exam_title?: string;
  event_type: string;
  severity: 'info' | 'warning_1' | 'warning_2' | 'warning_3';
  description: string;
  evidence_image: string;
  created_at: string;
}

export interface SystemSettings {
  school_name: string;
  school_logo: string;
  academic_year: string;
  semester: string;
  default_kkm: number;
  default_duration: number;
  auto_logout_minutes: number;
  require_webcam: boolean;
  max_violations: number;
  tab_switch_detection: boolean;
  allow_token_auto_rotate: boolean;
  notifications_enabled: boolean;
  role_permissions: Record<UserRole, string[]>;
}

export interface ItemAnalysisRow {
  question_id: number;
  order_index: number;
  prompt: string;
  type: QuestionType;
  topic: string;
  weight: number;
  participant_count: number;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  correct_pct: number;
  wrong_pct: number;
  difficulty_index: number;
  difficulty_label: 'Mudah' | 'Sedang' | 'Sukar';
  discrimination_index: number | null;
  discrimination_label: 'Sangat Baik' | 'Baik' | 'Cukup' | 'Jelek' | 'Data Belum Memadai';
  distractors: Array<{
    key: string;
    text: string;
    count: number;
    pct: number;
    is_correct: boolean;
    effective: boolean;
  }>;
  ineffective_distractors: string[];
  recommendation: 'Dipertahankan' | 'Direvisi' | 'Dibuang' | 'Menunggu Peserta';
}
