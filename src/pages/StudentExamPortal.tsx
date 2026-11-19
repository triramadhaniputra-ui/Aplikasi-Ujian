import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Camera,
  CheckCircle2,
  Clock,
  Flag,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  apiFetch,
  buildWsUrl,
  getExamSessionToken,
  setExamSessionToken,
} from '../lib/api';
import { MathText } from '../components/MathText';
import { ConfirmModal } from '../components/ConfirmModal';
import type { QuestionOption } from '../types';

interface StudentExamCard {
  id: number;
  title: string;
  subject_name: string;
  subject_code: string;
  teacher_name: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  question_count: number;
  kkm: number;
  has_password: boolean;
  max_attempts: number;
  attempts_used: number;
  active_attempt_id: number | null;
  last_attempt: {
    id: number;
    status: string;
    final_grade: number | null;
    is_passed: boolean | null;
  } | null;
  require_webcam: boolean;
  show_result_after: boolean;
  schedule_state: 'open' | 'upcoming' | 'closed';
}

interface StudentResultRow {
  id: number;
  exam_id: number;
  exam_title: string;
  subject_name: string;
  started_at: string;
  finished_at: string;
  show_result_after: boolean;
  kkm: number;
  final_grade: number | null;
  total_score: number | null;
  max_score: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  blank_count: number | null;
  is_passed: boolean | null;
  essay_graded: boolean;
}

interface RunnerQuestion {
  index: number;
  id: number;
  type: 'pg' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan' | 'isian_singkat' | 'esai';
  topic: string;
  weight: number;
  prompt: string;
  media_type: 'none' | 'image' | 'audio' | 'video';
  media_url: string;
  options: Array<QuestionOption | { id: string; left: string }>;
  right_choices?: string[];
}

interface AttemptInfo {
  id: number;
  exam_id: number;
  exam_title: string;
  subject_name: string;
  student_name: string;
  student_nis: string;
  class_name: string;
  allow_navigation: boolean;
  allow_back: boolean;
  require_webcam: boolean;
  violation_count: number;
  proctor_action: string;
  proctor_notes: string;
  remaining_seconds: number;
  max_violations: number;
  tab_switch_detection: boolean;
}

interface StudentExamPortalProps {
  activeSection: 'ujian_siswa' | 'hasil_siswa';
  onExamActiveChange: (active: boolean) => void;
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const StudentExamPortal: React.FC<StudentExamPortalProps> = ({
  activeSection,
  onExamActiveChange,
  onToast,
}) => {
  const [exams, setExams] = useState<StudentExamCard[]>([]);
  const [results, setResults] = useState<StudentResultRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Lobby state
  const [selectedExam, setSelectedExam] = useState<StudentExamCard | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [integrityAgreed, setIntegrityAgreed] = useState(false);
  const [webcamConsent, setWebcamConsent] = useState(false);
  const [webcamSnapshot, setWebcamSnapshot] = useState('');
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Active Exam Runner state
  const [attemptInfo, setAttemptInfo] = useState<AttemptInfo | null>(null);
  const [questions, setQuestions] = useState<RunnerQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, { answer: unknown; is_marked: boolean }>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string>('Tersimpan');
  const [warningModal, setWarningModal] = useState<{ title: string; body: string; severe: boolean } | null>(null);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [proctorBanner, setProctorBanner] = useState<string>('');

  // Submission summary state
  const [submittedSummary, setSubmittedSummary] = useState<{
    exam_title: string;
    show_result_after: boolean;
    result: {
      final_grade: number;
      total_score: number;
      max_score: number;
      correct_count: number;
      wrong_count: number;
      blank_count: number;
      is_passed: boolean;
      essay_graded: boolean;
      kkm: number;
    } | null;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const lastViolationRef = useRef<number>(0);
  const timeWarnedRef = useRef<{ ten: boolean; five: boolean; one: boolean }>({
    ten: false,
    five: false,
    one: false,
  });

  const loadList = async () => {
    setLoading(true);
    try {
      const [eRes, rRes] = await Promise.all([
        apiFetch<StudentExamCard[]>('/api/student/exams'),
        apiFetch<StudentResultRow[]>('/api/student/results'),
      ]);
      setExams(eRes);
      setResults(rRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [activeSection]);

  // Cleanup webcam stream when leaving lobby
  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      setWebcamStream(null);
    }
  };

  const startWebcamPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setWebcamStream(stream);
      setWebcamConsent(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch {
      onToast('error', 'Izin kamera ditolak atau perangkat kamera tidak tersedia.');
    }
  };

  const captureWebcamSnapshot = (): string => {
    if (!videoRef.current || !webcamStream) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(videoRef.current, 0, 0, 320, 240);
    return canvas.toDataURL('image/jpeg', 0.65);
  };

  const openLobby = (ex: StudentExamCard) => {
    setSelectedExam(ex);
    setTokenInput('');
    setPasswordInput('');
    setIntegrityAgreed(false);
    setWebcamConsent(false);
    setWebcamSnapshot('');
    setSubmittedSummary(null);
  };

  const enterExamAttempt = async (attemptId: number) => {
    try {
      const sessToken = getExamSessionToken(attemptId);
      const res = await apiFetch<{
        attempt: AttemptInfo;
        questions: RunnerQuestion[];
        saved_answers: Record<number, { answer: unknown; is_marked: boolean }>;
      }>(`/api/student/attempts/${attemptId}?session_token=${encodeURIComponent(sessToken)}`);

      setAttemptInfo(res.attempt);
      setQuestions(res.questions);
      setAnswers(res.saved_answers || {});
      setCurrentIdx(0);
      setRemainingSec(res.attempt.remaining_seconds);
      setSelectedExam(null);
      stopWebcam();
      timeWarnedRef.current = { ten: false, five: false, one: false };
      onExamActiveChange(true);

      // Try requesting fullscreen gently
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // Optional fullscreen
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal membuka lembar ujian.');
    }
  };

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam) return;
    if (!integrityAgreed) {
      onToast('error', 'Anda wajib menyetujui pernyataan integritas akademik terlebih dahulu.');
      return;
    }
    if (selectedExam.require_webcam && !webcamConsent) {
      onToast('error', 'Ujian ini memerlukan verifikasi kamera dengan persetujuan Anda.');
      return;
    }

    const snap = webcamConsent ? captureWebcamSnapshot() || webcamSnapshot : '';
    try {
      const existingSess = selectedExam.active_attempt_id
        ? getExamSessionToken(selectedExam.active_attempt_id)
        : '';
      const res = await apiFetch<{ attempt_id: number; session_token: string }>(
        `/api/student/exams/${selectedExam.id}/start`,
        {
          method: 'POST',
          body: JSON.stringify({
            token: tokenInput,
            exam_password: passwordInput,
            webcam_snapshot: snap,
            browser_session_key: existingSess,
          }),
        }
      );
      setExamSessionToken(res.attempt_id, res.session_token);
      await enterExamAttempt(res.attempt_id);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memulai ujian.');
    }
  };

  const handleFinishExam = async (autoExpired = false) => {
    if (!attemptInfo) return;
    try {
      const res = await apiFetch<{
        show_result_after: boolean;
        result: {
          final_grade: number;
          total_score: number;
          max_score: number;
          correct_count: number;
          wrong_count: number;
          blank_count: number;
          is_passed: boolean;
          essay_graded: boolean;
          kkm: number;
        } | null;
      }>(`/api/student/attempts/${attemptInfo.id}/finish`, {
        method: 'POST',
      });

      const title = attemptInfo.exam_title;
      setAttemptInfo(null);
      setConfirmFinishOpen(false);
      setWarningModal(null);
      onExamActiveChange(false);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      setSubmittedSummary({
        exam_title: title,
        show_result_after: res.show_result_after,
        result: res.result,
      });
      if (autoExpired) {
        onToast('error', 'Waktu ujian habis. Jawaban terakhir Anda otomatis dikumpulkan.');
      } else {
        onToast('success', 'Ujian selesai dan jawaban berhasil disimpan.');
      }
      loadList();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengirim jawaban ujian.');
    }
  };

  // Countdown timer + time warnings (10m, 5m, 1m)
  useEffect(() => {
    if (!attemptInfo) return;
    const timer = setInterval(() => {
      setRemainingSec((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 600 && !timeWarnedRef.current.ten) {
          timeWarnedRef.current.ten = true;
          onToast('error', 'Perhatian: Sisa waktu ujian tinggal 10 menit.');
        } else if (next === 300 && !timeWarnedRef.current.five) {
          timeWarnedRef.current.five = true;
          onToast('error', 'Perhatian: Sisa waktu ujian tinggal 5 menit.');
        } else if (next === 60 && !timeWarnedRef.current.one) {
          timeWarnedRef.current.one = true;
          onToast('error', 'Peringatan: Sisa waktu tinggal 1 menit! Segera periksa jawaban.');
        } else if (next === 0) {
          clearInterval(timer);
          handleFinishExam(true);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [attemptInfo?.id]);

  // Anti-cheat browser focus / tab switch / copy protection + WebSocket proctor channel
  useEffect(() => {
    if (!attemptInfo) return;

    const recordViolation = async (eventType: string, description: string) => {
      const now = Date.now();
      if (now - lastViolationRef.current < 2500) return; // debounce rapid blur+visibilitychange
      lastViolationRef.current = now;
      try {
        const res = await apiFetch<{
          violation_count: number;
          severity: string;
          flagged_for_review: boolean;
        }>(`/api/student/attempts/${attemptInfo.id}/violation`, {
          method: 'POST',
          body: JSON.stringify({ event_type: eventType, description }),
        });

        setAttemptInfo((prev) =>
          prev ? { ...prev, violation_count: res.violation_count } : prev
        );

        if (res.violation_count === 1) {
          setWarningModal({
            title: 'Peringatan Pertama: Aktivitas Fokus Tercatat',
            body: `${description} Harap tetap berada pada halaman ujian.`,
            severe: false,
          });
        } else if (res.violation_count === 2) {
          setWarningModal({
            title: 'Peringatan Kedua (Serius)',
            body: `Anda terdeteksi meninggalkan fokus ujian sebanyak 2 kali. Pelanggaran berikutnya akan ditandai untuk pemeriksaan pengawas.`,
            severe: true,
          });
        } else {
          setWarningModal({
            title: 'Tercatat untuk Pemeriksaan Pengawas',
            body: `Pelanggaran ke-${res.violation_count} telah dicatat dalam log pengawasan dan dilaporkan kepada pengawas ujian.`,
            severe: true,
          });
        }
      } catch {
        // ignore network hiccup
      }
    };

    const handleVisibility = () => {
      if (document.hidden && attemptInfo.tab_switch_detection) {
        recordViolation('tab_switch', 'Peserta berpindah tab atau meminimalkan jendela browser.');
      }
    };

    const handleBlur = () => {
      if (attemptInfo.tab_switch_detection) {
        recordViolation('window_blur', 'Jendela ujian kehilangan fokus aktif.');
      }
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleCopy = (e: ClipboardEvent) => e.preventDefault();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopy);

    // WebSocket for live proctor directives
    const ws = new WebSocket(buildWsUrl(attemptInfo.id));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          event: string;
          payload: { proctor_action?: string; proctor_notes?: string };
        };
        if (msg.event === 'proctor:action') {
          const note = msg.payload.proctor_notes || '';
          const act = msg.payload.proctor_action || '';
          setProctorBanner(`Pesan Pengawas (${act}): ${note}`);
          if (act === 'hentikan_sementara' || act === 'diskualifikasi') {
            onToast('error', 'Sesi ujian Anda dihentikan sementara oleh pengawas.');
            setAttemptInfo(null);
            onExamActiveChange(false);
          }
        }
      } catch {
        // ignore
      }
    };

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopy);
      ws.close();
    };
  }, [attemptInfo?.id]);

  const saveAnswer = async (questionId: number, nextAnswer: unknown, nextMarked?: boolean) => {
    if (!attemptInfo) return;
    const prevMarked = answers[questionId]?.is_marked ?? false;
    const finalMarked = nextMarked !== undefined ? nextMarked : prevMarked;
    const finalAns = nextAnswer !== undefined ? nextAnswer : answers[questionId]?.answer ?? null;

    setAnswers((prev) => ({
      ...prev,
      [questionId]: { answer: finalAns, is_marked: finalMarked },
    }));
    setSaveStatus('Menyimpan...');

    try {
      await apiFetch(`/api/student/attempts/${attemptInfo.id}/answer`, {
        method: 'PUT',
        body: JSON.stringify({
          question_id: questionId,
          answer: finalAns,
          is_marked: finalMarked,
          session_token: getExamSessionToken(attemptInfo.id),
        }),
      });
      setSaveStatus(`Tersimpan ${new Date().toLocaleTimeString('id-ID')}`);
    } catch (err) {
      setSaveStatus('Gagal sinkron');
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan jawaban.');
    }
  };

  const formatClock = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ========================
  // VIEW: DISTRACTION-FREE EXAM RUNNER
  // ========================
  if (attemptInfo && questions.length > 0) {
    const currentQ = questions[currentIdx];
    const currentAns = answers[currentQ.id]?.answer;
    const currentMarked = answers[currentQ.id]?.is_marked ?? false;
    const answeredCount = questions.filter((q) => {
      const a = answers[q.id]?.answer;
      if (a === null || a === undefined || a === '') return false;
      if (Array.isArray(a) && a.length === 0) return false;
      if (typeof a === 'object' && !Array.isArray(a) && Object.keys(a as object).length === 0) return false;
      return true;
    }).length;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col select-none">
        {/* Focused Exam Top Bar */}
        <header className="bg-[#0A192F] text-white px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4 border-b border-white/10">
          <div className="min-w-0">
            <div className="text-xs text-blue-300 font-medium truncate">
              {attemptInfo.subject_name} · {attemptInfo.student_name} ({attemptInfo.student_nis})
            </div>
            <h1 className="text-sm sm:text-base font-bold truncate">{attemptInfo.exam_title}</h1>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:block text-right text-xs">
              <div className="text-slate-300">Status Simpan</div>
              <div className="font-mono text-emerald-300">{saveStatus}</div>
            </div>

            <div
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono tabular-nums text-base font-bold ${
                remainingSec <= 60
                  ? 'bg-red-600 text-white'
                  : remainingSec <= 300
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-[#112240] text-white border border-white/15'
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>{formatClock(remainingSec)}</span>
            </div>
          </div>
        </header>

        {proctorBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs font-medium text-amber-900 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            <span>{proctorBanner}</span>
          </div>
        )}

        {/* Main Exam Workspace */}
        <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Question Stage */}
          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-md bg-slate-900 text-white font-mono text-xs font-bold">
                  Soal No. {currentQ.index} / {questions.length}
                </span>
                <span className="text-xs text-slate-500">
                  {currentQ.topic} · Bobot {currentQ.weight}
                </span>
              </div>

              <button
                type="button"
                onClick={() => saveAnswer(currentQ.id, currentAns, !currentMarked)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  currentMarked
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Flag className="h-3.5 w-3.5" />
                {currentMarked ? 'Ditandai Ragu' : 'Tandai Soal'}
              </button>
            </div>

            {/* Prompt & Media */}
            <div className="text-base text-slate-900 leading-relaxed">
              <MathText text={currentQ.prompt} />
            </div>

            {currentQ.media_type === 'image' && currentQ.media_url && (
              <img
                src={currentQ.media_url}
                alt="Ilustrasi soal"
                referrerPolicy="no-referrer"
                className="max-h-72 rounded-lg border border-slate-200 object-contain"
              />
            )}
            {currentQ.media_type === 'audio' && currentQ.media_url && (
              <audio controls src={currentQ.media_url} className="w-full" />
            )}
            {currentQ.media_type === 'video' && currentQ.media_url && (
              <video controls src={currentQ.media_url} className="w-full max-h-72 rounded-lg" />
            )}

            {/* Answer Controls by Question Type */}
            <div className="space-y-2.5">
              {(currentQ.type === 'pg' || currentQ.type === 'benar_salah') &&
                (currentQ.options as QuestionOption[]).map((opt, oIdx) => {
                  const selected = String(currentAns ?? '') === opt.key;
                  const displayLetter =
                    currentQ.type === 'pg' ? String.fromCharCode(65 + oIdx) : opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => saveAnswer(currentQ.id, opt.key)}
                      className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
                        selected
                          ? 'border-blue-600 bg-blue-50/70 text-slate-900'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                      }`}
                    >
                      <span
                        className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
                          selected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {displayLetter}
                      </span>
                      <div className="flex-1 space-y-2 pt-0.5">
                        {opt.text && (
                          <div className="text-sm">
                            <MathText text={opt.text} />
                          </div>
                        )}
                        {opt.image_url && (
                          <img
                            src={opt.image_url}
                            alt={`Gambar opsi ${displayLetter}`}
                            referrerPolicy="no-referrer"
                            className="max-h-44 rounded-lg border border-slate-200 bg-white object-contain"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}

              {currentQ.type === 'pg_kompleks' &&
                (currentQ.options as QuestionOption[]).map((opt, oIdx) => {
                  const arr = Array.isArray(currentAns) ? (currentAns as string[]) : [];
                  const checked = arr.includes(opt.key);
                  const toggle = () => {
                    const next = checked ? arr.filter((k) => k !== opt.key) : [...arr, opt.key];
                    saveAnswer(currentQ.id, next);
                  };
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={toggle}
                      className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
                        checked
                          ? 'border-blue-600 bg-blue-50/70 text-slate-900'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="mt-1 h-4 w-4 accent-blue-600"
                      />
                      <span className="text-xs font-mono font-bold text-slate-500 mt-0.5">
                        {String.fromCharCode(65 + oIdx)}.
                      </span>
                      <div className="flex-1 space-y-2">
                        {opt.text && (
                          <div className="text-sm">
                            <MathText text={opt.text} />
                          </div>
                        )}
                        {opt.image_url && (
                          <img
                            src={opt.image_url}
                            alt={`Gambar opsi ${String.fromCharCode(65 + oIdx)}`}
                            referrerPolicy="no-referrer"
                            className="max-h-44 rounded-lg border border-slate-200 bg-white object-contain"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}

              {currentQ.type === 'menjodohkan' && (
                <div className="space-y-3">
                  {(currentQ.options as Array<{ id: string; left: string }>).map((pair) => {
                    const currentMap =
                      currentAns && typeof currentAns === 'object'
                        ? (currentAns as Record<string, string>)
                        : {};
                    return (
                      <div
                        key={pair.id}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center p-3 rounded-xl border border-slate-200 bg-slate-50/60"
                      >
                        <div className="text-sm font-medium text-slate-800">{pair.left}</div>
                        <select
                          value={currentMap[pair.id] || ''}
                          onChange={(e) =>
                            saveAnswer(currentQ.id, { ...currentMap, [pair.id]: e.target.value })
                          }
                          className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                        >
                          <option value="">-- Pilih Pasangan --</option>
                          {(currentQ.right_choices || []).map((rc) => (
                            <option key={rc} value={rc}>
                              {rc}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              {currentQ.type === 'isian_singkat' && (
                <input
                  type="text"
                  value={String(currentAns ?? '')}
                  onChange={(e) => saveAnswer(currentQ.id, e.target.value)}
                  placeholder="Ketik jawaban singkat Anda di sini..."
                  className="w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}

              {currentQ.type === 'esai' && (
                <textarea
                  rows={6}
                  value={String(currentAns ?? '')}
                  onChange={(e) => saveAnswer(currentQ.id, e.target.value)}
                  placeholder="Tuliskan uraian jawaban lengkap Anda di sini..."
                  className="w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}
            </div>

            {/* Bottom Navigation Controls */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <button
                type="button"
                disabled={currentIdx === 0 || !attemptInfo.allow_back}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                Sebelumnya
              </button>

              {currentIdx < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
                >
                  Berikutnya
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmFinishOpen(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Selesai Ujian
                </button>
              )}
            </div>
          </div>

          {/* Question Navigation Panel */}
          <div className="lg:col-span-4 space-y-4">
            {attemptInfo.allow_navigation && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Navigasi Nomor Soal</h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {answeredCount}/{questions.length} terjawab
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {questions.map((q, idx) => {
                    const ans = answers[q.id]?.answer;
                    const marked = answers[q.id]?.is_marked;
                    const hasAns =
                      ans !== null &&
                      ans !== undefined &&
                      ans !== '' &&
                      (!Array.isArray(ans) || ans.length > 0) &&
                      (typeof ans !== 'object' || Array.isArray(ans) || Object.keys(ans as object).length > 0);
                    const isCurrent = idx === currentIdx;
                    const disabled = !attemptInfo.allow_back && idx < currentIdx;

                    let cls = 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50';
                    if (marked) cls = 'bg-amber-400 border-amber-500 text-slate-950 font-bold';
                    else if (hasAns) cls = 'bg-[#2563EB] border-[#2563EB] text-white font-semibold';

                    return (
                      <button
                        key={q.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setCurrentIdx(idx)}
                        className={`h-10 rounded-lg border font-mono text-xs transition-colors disabled:opacity-40 ${cls} ${
                          isCurrent ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                        }`}
                      >
                        {q.index}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-[#2563EB]" />
                    <span>Dijawab</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-amber-400" />
                    <span>Ragu-ragu</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border border-slate-300 bg-white" />
                    <span>Kosong</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setConfirmFinishOpen(true)}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  Kumpulkan & Akhiri Ujian
                </button>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 space-y-1.5">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                Status Pengawasan Fokus
              </div>
              <div>
                Pelanggaran tercatat:{' '}
                <span className="font-mono font-bold text-slate-900">
                  {attemptInfo.violation_count} / {attemptInfo.max_violations}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Tetap berada di halaman ini. Perpindahan tab atau jendela dicatat otomatis oleh sistem.
              </p>
            </div>
          </div>
        </div>

        {/* Warning Overlay Modal */}
        {warningModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-2xl p-6">
              <div className="flex items-start gap-3">
                <div
                  className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                    warningModal.severe ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{warningModal.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{warningModal.body}</p>
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setWarningModal(null)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Saya Mengerti, Lanjutkan Ujian
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          open={confirmFinishOpen}
          title="Konfirmasi Pengumpulan Ujian"
          message={`Anda telah menjawab ${answeredCount} dari ${questions.length} soal. Setelah dikumpulkan, jawaban tidak dapat diubah kembali. Lanjutkan?`}
          confirmLabel="Ya, Kumpulkan Sekarang"
          onConfirm={() => handleFinishExam(false)}
          onCancel={() => setConfirmFinishOpen(false)}
        />
      </div>
    );
  }

  // ========================
  // VIEW: POST-EXAM SUBMISSION SUMMARY
  // ========================
  if (submittedSummary) {
    return (
      <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Ujian Berhasil Dikumpulkan</h2>
            <p className="text-sm text-slate-500">{submittedSummary.exam_title}</p>
          </div>
        </div>

        {submittedSummary.show_result_after && submittedSummary.result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs text-slate-500">Nilai Akhir</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-blue-600 mt-1">
                  {submittedSummary.result.final_grade}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs text-slate-500">Benar</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 mt-1">
                  {submittedSummary.result.correct_count}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs text-slate-500">Salah / Kosong</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-800 mt-1">
                  {submittedSummary.result.wrong_count} / {submittedSummary.result.blank_count}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs text-slate-500">Status KKM ({submittedSummary.result.kkm})</div>
                <div
                  className={`text-sm font-bold mt-2 ${
                    submittedSummary.result.is_passed ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {submittedSummary.result.is_passed ? 'Tuntas (Lulus)' : 'Belum Tuntas'}
                </div>
              </div>
            </div>
            {!submittedSummary.result.essay_graded && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Catatan: Ujian ini memuat soal uraian/esai. Nilai akhir akan disesuaikan setelah guru memeriksa esai.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-4">
            Seluruh jawaban Anda telah tersimpan aman di server. Nilai akan diumumkan oleh guru pengampu setelah sesi ujian selesai.
          </p>
        )}

        <button
          type="button"
          onClick={() => setSubmittedSummary(null)}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
        >
          Kembali ke Daftar Ujian
        </button>
      </div>
    );
  }

  // ========================
  // VIEW: PRE-EXAM LOBBY (TOKEN + INTEGRITY + WEBCAM)
  // ========================
  if (selectedExam) {
    return (
      <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold text-blue-600">{selectedExam.subject_name}</p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">{selectedExam.title}</h2>
            <p className="text-xs text-slate-500 mt-1">
              Durasi {selectedExam.duration_minutes} menit · {selectedExam.question_count} soal · KKM {selectedExam.kkm}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopWebcam();
              setSelectedExam(null);
            }}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Kembali
          </button>
        </div>

        {/* Tata Tertib Ujian */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs text-slate-700">
          <h3 className="font-bold text-slate-900 text-sm">Tata Tertib Ujian Digital</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Peserta wajib mengerjakan ujian secara mandiri, jujur, dan tanpa membuka referensi lain yang dilarang.</li>
            <li>Sistem mencatat aktivitas perpindahan tab, kehilangan fokus browser, dan sesi ganda ke log pengawas.</li>
            <li>Jawaban tersimpan otomatis ke server setiap kali dipilih atau diubah.</li>
            <li>Apabila waktu habis, sistem otomatis menutup dan menyimpan jawaban terakhir yang terekam.</li>
          </ul>
        </div>

        <form onSubmit={handleStartExam} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Token Ujian (Dari Pengawas)
              </label>
              <div className="relative">
                <KeyRound className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                  placeholder="Contoh: MTK41A"
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-mono uppercase rounded-lg border border-slate-300"
                />
              </div>
            </div>
            {selectedExam.has_password && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password Ujian</label>
                <input
                  type="password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300"
                />
              </div>
            )}
          </div>

          {/* Optional Webcam Identity Verification */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <Camera className="h-4 w-4 text-blue-600" />
                <span>
                  Verifikasi Kamera Peserta ({selectedExam.require_webcam ? 'Diwajibkan' : 'Opsional'})
                </span>
              </div>
              {!webcamStream && (
                <button
                  type="button"
                  onClick={startWebcamPreview}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                >
                  Aktifkan Kamera
                </button>
              )}
            </div>
            {webcamStream && (
              <div className="flex items-center gap-4">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-24 w-32 rounded-lg bg-slate-900 object-cover border border-slate-300"
                />
                <p className="text-xs text-slate-600">
                  Kamera aktif. Foto verifikasi akan diambil sekali saat Anda menekan tombol Mulai Ujian.
                </p>
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer p-3 rounded-lg bg-blue-50/50 border border-blue-200">
            <input
              type="checkbox"
              checked={integrityAgreed}
              onChange={(e) => setIntegrityAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Pernyataan Integritas Akademik:</strong> Saya menyatakan siap mengerjakan ujian ini dengan jujur
              sesuai tata tertib SMP Negeri 41 Muaro Jambi.
            </span>
          </label>

          <button
            type="submit"
            className="w-full py-3 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors"
          >
            {selectedExam.active_attempt_id ? 'Lanjutkan Sesi Ujian' : 'Konfirmasi & Mulai Ujian'}
          </button>
        </form>
      </div>
    );
  }

  // ========================
  // VIEW: STUDENT RESULTS TAB
  // ========================
  if (activeSection === 'hasil_siswa') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">Riwayat & Hasil Ujian Saya</h2>
          <p className="text-xs text-slate-500">Daftar ujian yang telah selesai Anda kerjakan.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Memuat riwayat nilai...</div>
          ) : results.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Anda belum memiliki riwayat ujian yang selesai.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="py-3 px-4 font-medium">Ujian</th>
                    <th className="py-3 px-4 font-medium">Mata Pelajaran</th>
                    <th className="py-3 px-4 font-medium">Selesai</th>
                    <th className="py-3 px-4 font-medium text-right">Nilai</th>
                    <th className="py-3 px-4 font-medium">Ketuntasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-medium text-slate-900">{r.exam_title}</td>
                      <td className="py-3 px-4 text-slate-600">{r.subject_name}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500">
                        {new Date(r.finished_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-right text-slate-900">
                        {r.show_result_after ? r.final_grade : 'Disembunyikan'}
                      </td>
                      <td className="py-3 px-4">
                        {!r.show_result_after ? (
                          <span className="text-xs text-slate-500">Menunggu Pengumuman</span>
                        ) : (
                          <span
                            className={`text-xs font-semibold ${
                              r.is_passed ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {r.is_passed ? `Tuntas (KKM ${r.kkm})` : `Belum Tuntas (<${r.kkm})`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========================
  // VIEW: AVAILABLE EXAMS LIST
  // ========================
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">Daftar Ujian Tersedia</h2>
          <p className="text-xs text-slate-500">
            Pilih jadwal ujian aktif untuk kelas Anda, lalu masukkan token dari pengawas.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500 rounded-xl border border-slate-200 bg-white">
          Memuat daftar ujian...
        </div>
      ) : exams.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
          Belum ada ujian yang dijadwalkan untuk kelas Anda saat ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map((ex) => {
            const canEnter =
              ex.schedule_state === 'open' &&
              (Boolean(ex.active_attempt_id) || ex.attempts_used < ex.max_attempts);
            return (
              <div key={ex.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-blue-700">{ex.subject_name}</span>
                    <span
                      className={`font-semibold ${
                        ex.schedule_state === 'open'
                          ? 'text-emerald-600'
                          : ex.schedule_state === 'upcoming'
                          ? 'text-amber-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {ex.schedule_state === 'open'
                        ? 'Dibuka'
                        : ex.schedule_state === 'upcoming'
                        ? 'Akan Datang'
                        : 'Ditutup'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{ex.title}</h3>
                  <div className="text-xs text-slate-600 space-y-1 pt-1">
                    <div>
                      Jadwal: <span className="font-mono">{ex.exam_date}</span> ({ex.start_time}–{ex.end_time})
                    </div>
                    <div>
                      Durasi: <span className="font-mono">{ex.duration_minutes} menit</span> ·{' '}
                      <span className="font-mono">{ex.question_count}</span> soal · Percobaan:{' '}
                      <span className="font-mono">
                        {ex.attempts_used}/{ex.max_attempts}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  {ex.last_attempt && ex.last_attempt.final_grade !== null ? (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <Award className="h-4 w-4 text-blue-600" />
                      <span>Nilai Terakhir: </span>
                      <span className="font-mono text-slate-900">{ex.last_attempt.final_grade}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Guru: {ex.teacher_name}</span>
                  )}

                  <button
                    type="button"
                    disabled={!canEnter}
                    onClick={() => openLobby(ex)}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:bg-slate-200 disabled:text-slate-500 transition-colors"
                  >
                    {ex.active_attempt_id
                      ? 'Lanjutkan Ujian'
                      : ex.attempts_used >= ex.max_attempts
                      ? 'Selesai Dikerjakan'
                      : 'Ikuti Ujian'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
