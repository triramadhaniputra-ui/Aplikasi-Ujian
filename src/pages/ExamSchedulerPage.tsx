import React, { useEffect, useState } from 'react';
import { CalendarClock, Edit3, KeyRound, Plus, RefreshCw, Shuffle, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type { ClassGroup, Exam, Question, Subject, UserAccount } from '../types';

interface ExamSchedulerPageProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const ExamSchedulerPage: React.FC<ExamSchedulerPageProps> = ({ onToast }) => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [teachers, setTeachers] = useState<UserAccount[]>([]);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null);

  // Question picker modal
  const [pickerExam, setPickerExam] = useState<Exam | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [autoCount, setAutoCount] = useState(5);
  const [autoDiff, setAutoDiff] = useState('all');

  // Exam form fields
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<number>(1);
  const [teacherId, setTeacherId] = useState<number>(1);
  const [classIds, setClassIds] = useState<number[]>([]);
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('07:30');
  const [endTime, setEndTime] = useState('23:59');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [questionCount, setQuestionCount] = useState(10);
  const [kkm, setKkm] = useState(75);
  const [token, setToken] = useState('');
  const [examPassword, setExamPassword] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [allowNavigation, setAllowNavigation] = useState(true);
  const [allowBack, setAllowBack] = useState(true);
  const [showResultAfter, setShowResultAfter] = useState(true);
  const [requireWebcam, setRequireWebcam] = useState(false);
  const [status, setStatus] = useState<'draft' | 'aktif' | 'selesai'>('aktif');

  const loadData = async () => {
    setLoading(true);
    try {
      const [eRes, sRes, cRes, tRes, qRes] = await Promise.all([
        apiFetch<Exam[]>('/api/exams'),
        apiFetch<Subject[]>('/api/subjects'),
        apiFetch<ClassGroup[]>('/api/classes'),
        apiFetch<UserAccount[]>('/api/users?role=guru'),
        apiFetch<Question[]>('/api/questions'),
      ]);
      setExams(eRes);
      setSubjects(sRes);
      setClasses(cRes);
      setTeachers(tRes);
      setBankQuestions(qRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat jadwal ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreate = () => {
    setEditingExam(null);
    setTitle('');
    setSubjectId(subjects[0]?.id || 1);
    setTeacherId(teachers[0]?.id || 1);
    setClassIds(classes.filter((c) => c.grade_level === 9).map((c) => c.id));
    setExamDate(new Date().toISOString().slice(0, 10));
    setStartTime('07:30');
    setEndTime('23:59');
    setDurationMinutes(60);
    setQuestionCount(5);
    setKkm(75);
    setToken(Math.random().toString(36).substring(2, 8).toUpperCase());
    setExamPassword('');
    setMaxAttempts(1);
    setShuffleQuestions(true);
    setShuffleOptions(true);
    setAllowNavigation(true);
    setAllowBack(true);
    setShowResultAfter(true);
    setRequireWebcam(false);
    setStatus('aktif');
    setModalOpen(true);
  };

  const openEdit = (ex: Exam) => {
    setEditingExam(ex);
    setTitle(ex.title);
    setSubjectId(ex.subject_id);
    setTeacherId(ex.teacher_id);
    setClassIds(ex.class_ids);
    setExamDate(ex.exam_date);
    setStartTime(ex.start_time);
    setEndTime(ex.end_time);
    setDurationMinutes(ex.duration_minutes);
    setQuestionCount(ex.question_count);
    setKkm(ex.kkm);
    setToken(ex.token);
    setExamPassword(ex.exam_password || '');
    setMaxAttempts(ex.max_attempts);
    setShuffleQuestions(ex.shuffle_questions);
    setShuffleOptions(ex.shuffle_options);
    setAllowNavigation(ex.allow_navigation);
    setAllowBack(ex.allow_back);
    setShowResultAfter(ex.show_result_after);
    setRequireWebcam(ex.require_webcam);
    setStatus(ex.status);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      title,
      subject_id: subjectId,
      teacher_id: teacherId,
      class_ids: classIds,
      exam_date: examDate,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: durationMinutes,
      question_count: questionCount,
      kkm,
      token,
      exam_password: examPassword,
      max_attempts: maxAttempts,
      shuffle_questions: shuffleQuestions,
      shuffle_options: shuffleOptions,
      allow_navigation: allowNavigation,
      allow_back: allowBack,
      show_result_after: showResultAfter,
      require_webcam: requireWebcam,
      status,
      auto_pick: editingExam ? undefined : { count: questionCount, difficulty: 'all' },
    };

    try {
      if (editingExam) {
        await apiFetch(`/api/exams/${editingExam.id}`, { method: 'PUT', body: JSON.stringify(body) });
        onToast('success', 'Pengaturan jadwal ujian berhasil diperbarui.');
      } else {
        await apiFetch('/api/exams', { method: 'POST', body: JSON.stringify(body) });
        onToast('success', 'Jadwal ujian baru berhasil dibuat.');
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan jadwal ujian.');
    }
  };

  const handleRotateToken = async (examId: number) => {
    try {
      const res = await apiFetch<{ token: string }>(`/api/exams/${examId}/rotate-token`, { method: 'POST' });
      onToast('success', `Token ujian diperbarui: ${res.token}`);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memperbarui token.');
    }
  };

  const openQuestionPicker = async (ex: Exam) => {
    setPickerExam(ex);
    setAutoCount(ex.question_count || 5);
    try {
      const assigned = await apiFetch<Array<{ id: number }>>(`/api/exams/${ex.id}/questions`);
      setSelectedQuestionIds(assigned.map((q) => q.id));
    } catch {
      setSelectedQuestionIds([]);
    }
  };

  const handleAutoPick = async () => {
    if (!pickerExam) return;
    try {
      const res = await apiFetch<{ assigned_count: number }>(`/api/exams/${pickerExam.id}/questions`, {
        method: 'PUT',
        body: JSON.stringify({
          auto_pick: { subject_id: pickerExam.subject_id, difficulty: autoDiff, count: autoCount },
        }),
      });
      onToast('success', `${res.assigned_count} soal acak berhasil ditautkan ke ujian.`);
      setPickerExam(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengambil soal acak.');
    }
  };

  const handleSaveManualQuestions = async () => {
    if (!pickerExam) return;
    try {
      const res = await apiFetch<{ assigned_count: number }>(`/api/exams/${pickerExam.id}/questions`, {
        method: 'PUT',
        body: JSON.stringify({
          items: selectedQuestionIds.map((id) => ({ question_id: id })),
        }),
      });
      onToast('success', `${res.assigned_count} soal pilihan berhasil disimpan untuk ujian.`);
      setPickerExam(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan daftar soal.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/exams/${deleteTarget.id}`, { method: 'DELETE' });
      onToast('success', 'Jadwal ujian dihapus.');
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menghapus ujian.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Pengaturan & Penjadwalan Ujian</h2>
            <p className="text-xs text-slate-500">
              Atur jadwal, durasi, KKM, token masuk, pengacakan soal/opsi, serta paket butir soal.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          Buat Jadwal Ujian
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500 rounded-xl border border-slate-200 bg-white">
          Memuat jadwal ujian...
        </div>
      ) : exams.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm text-slate-600">Belum ada jadwal ujian dibuat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {exams.map((ex) => (
            <div key={ex.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-semibold text-blue-700">{ex.subject_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ex.teacher_name}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        ex.status === 'aktif'
                          ? 'text-emerald-600'
                          : ex.status === 'selesai'
                          ? 'text-slate-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {ex.status === 'aktif' ? 'Aktif' : ex.status === 'selesai' ? 'Selesai' : 'Draft'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{ex.title}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(ex)}
                    className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-blue-50"
                    title="Edit Pengaturan"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(ex)}
                    className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-red-50"
                    title="Hapus"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-y border-slate-100 py-3">
                <div>
                  <span className="text-slate-400 block">Tanggal & Waktu</span>
                  <span className="font-mono font-medium text-slate-800">{ex.exam_date}</span>
                  <span className="font-mono text-slate-500 block">
                    {ex.start_time}–{ex.end_time}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Durasi & KKM</span>
                  <span className="font-mono font-semibold text-slate-800">{ex.duration_minutes} mnt</span>
                  <span className="font-mono text-slate-500 block">KKM: {ex.kkm}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Kelas Peserta</span>
                  <span className="font-medium text-slate-800">{ex.class_names?.join(', ') || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Jumlah Soal</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {ex.assigned_question_count ?? ex.question_count} butir
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-slate-500">Token:</span>
                  <span className="font-mono text-sm font-bold tracking-wider text-slate-900 bg-slate-100 px-2.5 py-1 rounded">
                    {ex.token}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRotateToken(ex.id)}
                    className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-blue-50"
                    title="Acak Token Baru"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => openQuestionPicker(ex)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  Pilih / Acak Soal ({ex.assigned_question_count ?? 0})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Exam Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingExam ? 'Edit Pengaturan Ujian' : 'Buat Jadwal Ujian Baru'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Ujian</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Penilaian Akhir Semester – Matematika IX"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mata Pelajaran</label>
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Guru Pengampu</label>
                  <select
                    value={teacherId}
                    onChange={(e) => setTeacherId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Kelas Peserta</label>
                <div className="flex flex-wrap gap-3 p-3 rounded-lg border border-slate-200">
                  {classes.map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={classIds.includes(c.id)}
                        onChange={(e) =>
                          setClassIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                          )
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
                  <input
                    type="date"
                    required
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jam Mulai</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jam Berakhir</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    min={5}
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Target Jumlah Soal</label>
                  <input
                    type="number"
                    min={1}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">KKM</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={kkm}
                    onChange={(e) => setKkm(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Token Ujian</label>
                  <input
                    type="text"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Batas Percobaan</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Password Ujian (Opsional)
                  </label>
                  <input
                    type="text"
                    value={examPassword}
                    onChange={(e) => setExamPassword(e.target.value)}
                    placeholder="Kosongkan jika hanya pakai Token"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status Ujian</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'draft' | 'aktif' | 'selesai')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="draft">Draft (Belum Dibuka)</option>
                    <option value="aktif">Aktif (Terbuka Sesuai Jadwal)</option>
                    <option value="selesai">Selesai (Ditutup)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} />
                  <span>Acak urutan soal per siswa</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} />
                  <span>Acak opsi jawaban</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allowNavigation} onChange={(e) => setAllowNavigation(e.target.checked)} />
                  <span>Tampilkan panel navigasi nomor soal</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allowBack} onChange={(e) => setAllowBack(e.target.checked)} />
                  <span>Izinkan kembali ke soal sebelumnya</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showResultAfter} onChange={(e) => setShowResultAfter(e.target.checked)} />
                  <span>Tampilkan hasil langsung setelah selesai</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={requireWebcam} onChange={(e) => setRequireWebcam(e.target.checked)} />
                  <span>Aktifkan verifikasi & pantau webcam (dengan izin)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  Simpan Jadwal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Question Picker Modal */}
      {pickerExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Susun Soal: {pickerExam.title}</h3>
                <p className="text-xs text-slate-500">
                  Pilih soal secara manual atau ambil acak dari Bank Soal {pickerExam.subject_name}.
                </p>
              </div>
              <button type="button" onClick={() => setPickerExam(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Random Pick Bar */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-800">Ambil Acak:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={autoCount}
                  onChange={(e) => setAutoCount(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded border border-slate-300 bg-white font-mono"
                />
                <span>soal · Tingkat:</span>
                <select
                  value={autoDiff}
                  onChange={(e) => setAutoDiff(e.target.value)}
                  className="px-2 py-1 rounded border border-slate-300 bg-white"
                >
                  <option value="all">Semua Tingkat</option>
                  <option value="mudah">Mudah</option>
                  <option value="sedang">Sedang</option>
                  <option value="sukar">Sukar</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleAutoPick}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
              >
                Terapkan Ambil Acak
              </button>
            </div>

            {/* Manual Pick Checklist */}
            <div className="space-y-2 max-h-80 overflow-y-auto border border-slate-200 rounded-lg p-3">
              {bankQuestions
                .filter((q) => q.subject_id === pickerExam.subject_id)
                .map((q) => (
                  <label
                    key={q.id}
                    className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedQuestionIds.includes(q.id)}
                      onChange={(e) =>
                        setSelectedQuestionIds((prev) =>
                          e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                        )
                      }
                      className="mt-1"
                    />
                    <div className="text-xs flex-1">
                      <div className="text-slate-500 mb-0.5">
                        {q.topic} · {q.type.toUpperCase()} · {q.difficulty} · Bobot {q.weight}
                      </div>
                      <div className="text-slate-800 line-clamp-2">{q.prompt}</div>
                    </div>
                  </label>
                ))}
            </div>

            <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-200">
              <span className="text-xs font-mono text-slate-600">
                Terpilih manual: <strong>{selectedQuestionIds.length}</strong> butir soal
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPickerExam(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualQuestions}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  Simpan Pilihan Manual
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus Jadwal Ujian?"
        message={`Hapus ujian "${deleteTarget?.title}"? Seluruh data pengerjaan pada ujian ini juga akan terhapus.`}
        confirmLabel="Hapus Ujian"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
