import React, { useEffect, useState } from 'react';
import { Award, CheckCircle2, ClipboardEdit, Eye, X, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { DonutChart, SimpleBarChart } from '../components/Charts';
import { MathText } from '../components/MathText';
import type { ClassGroup, Exam, Subject } from '../types';

interface ResultAttemptRow {
  id: number;
  exam_id: number;
  exam_title: string;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  student_id: number;
  student_name: string;
  student_nis: string;
  class_id: number | null;
  class_name: string;
  started_at: string;
  finished_at: string;
  duration_minutes_taken: number;
  total_score: number;
  max_score: number;
  final_grade: number;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  is_passed: boolean;
  essay_graded: boolean;
  kkm: number;
  violation_count: number;
}

interface ResultsResponse {
  attempts: ResultAttemptRow[];
  summary: {
    total_participants: number;
    highest: number;
    lowest: number;
    mean: number;
    median: number;
    passed_count: number;
    failed_count: number;
    pass_rate: number;
    distribution: Array<{ label: string; count: number }>;
  };
}

interface AttemptDetailItem {
  order: number;
  question_id: number;
  type: string;
  topic: string;
  prompt: string;
  weight: number;
  correct_answer: unknown;
  scoring_rule: { rubric?: string };
  student_answer: unknown;
  is_correct: number | null;
  earned_score: number;
  teacher_feedback: string;
}

interface ResultsAnalyticsPageProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const ResultsAnalyticsPage: React.FC<ResultsAnalyticsPageProps> = ({ onToast }) => {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [examFilter, setExamFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');

  const [detailAttempt, setDetailAttempt] = useState<ResultAttemptRow | null>(null);
  const [detailItems, setDetailItems] = useState<AttemptDetailItem[]>([]);
  const [essayScores, setEssayScores] = useState<Record<number, { score: number; feedback: string }>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [res, eRes, cRes, sRes] = await Promise.all([
        apiFetch<ResultsResponse>(
          `/api/results?exam_id=${examFilter}&class_id=${classFilter}&subject_id=${subjectFilter}`
        ),
        apiFetch<Exam[]>('/api/exams'),
        apiFetch<ClassGroup[]>('/api/classes'),
        apiFetch<Subject[]>('/api/subjects'),
      ]);
      setData(res);
      setExams(eRes);
      setClasses(cRes);
      setSubjects(sRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat hasil ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [examFilter, classFilter, subjectFilter]);

  const openDetail = async (row: ResultAttemptRow) => {
    setDetailAttempt(row);
    try {
      const res = await apiFetch<{ items: AttemptDetailItem[] }>(`/api/results/${row.id}/detail`);
      setDetailItems(res.items);
      const map: Record<number, { score: number; feedback: string }> = {};
      for (const it of res.items) {
        if (it.type === 'esai') {
          map[it.question_id] = { score: it.earned_score, feedback: it.teacher_feedback || '' };
        }
      }
      setEssayScores(map);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat detail jawaban.');
    }
  };

  const handleSaveEssayGrades = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailAttempt) return;
    const grades = Object.entries(essayScores).map(([qid, val]) => ({
      question_id: Number(qid),
      earned_score: val.score,
      teacher_feedback: val.feedback,
    }));
    try {
      await apiFetch(`/api/results/${detailAttempt.id}/grade-essay`, {
        method: 'PUT',
        body: JSON.stringify({ grades }),
      });
      onToast('success', 'Nilai esai berhasil disimpan dan nilai akhir diperbarui.');
      setDetailAttempt(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan nilai esai.');
    }
  };

  const summary = data?.summary;
  const attempts = data?.attempts || [];

  // Class comparison bar data
  const classGrouped = new Map<string, number[]>();
  for (const a of attempts) {
    const arr = classGrouped.get(a.class_name) || [];
    arr.push(a.final_grade);
    classGrouped.set(a.class_name, arr);
  }
  const classAvgBars = Array.from(classGrouped.entries()).map(([cls, vals]) => ({
    label: cls,
    subLabel: `${vals.length} siswa`,
    value: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
  }));

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Award className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Hasil Ujian & Analisis Nilai</h2>
            <p className="text-xs text-slate-500">
              Rekap ketuntasan KKM, distribusi nilai, statistik kelas, serta penilaian esai guru.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={examFilter}
            onChange={(e) => setExamFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="all">Semua Ujian</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="all">Semua Mapel</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="all">Semua Kelas</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Kelas {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Class Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total Peserta', value: summary.total_participants },
            { label: 'Nilai Tertinggi', value: summary.highest },
            { label: 'Nilai Terendah', value: summary.lowest },
            { label: 'Rata-Rata', value: summary.mean },
            { label: 'Median', value: summary.median },
            { label: 'Ketuntasan', value: `${summary.pass_rate}%` },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900">
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts Row: Distribution, Pass Donut, Class Bar */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Distribusi Nilai Siswa</h3>
            <p className="text-xs text-slate-500 mb-3">Sebaran rentang skor 0–100</p>
            <SimpleBarChart
              data={summary.distribution.map((d) => ({ label: d.label, value: d.count }))}
              emptyText="Belum ada data distribusi."
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Persentase Ketuntasan KKM</h3>
            <p className="text-xs text-slate-500 mb-4">Perbandingan siswa tuntas dan belum tuntas</p>
            <DonutChart
              centerValue={`${summary.pass_rate}%`}
              centerLabel="Tuntas"
              data={[
                { label: 'Tuntas KKM', value: summary.passed_count, color: '#16A34A' },
                { label: 'Belum Tuntas', value: summary.failed_count, color: '#DC2626' },
              ]}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Rata-Rata Nilai per Kelas</h3>
            <p className="text-xs text-slate-500 mb-3">Perbandingan capaian antarkelas</p>
            <SimpleBarChart
              data={classAvgBars}
              maxVal={100}
              barColor="#0A192F"
              emptyText="Belum ada nilai kelas."
            />
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Memuat hasil ujian...</div>
        ) : attempts.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              Belum ada peserta yang menyelesaikan ujian pada filter ini.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Nilai otomatis akan muncul segera setelah siswa mengirim jawaban ujian.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="py-3 px-4 font-medium">NIS</th>
                  <th className="py-3 px-4 font-medium">Nama Siswa</th>
                  <th className="py-3 px-4 font-medium">Kelas</th>
                  <th className="py-3 px-4 font-medium">Ujian</th>
                  <th className="py-3 px-4 font-medium text-right">Benar / Salah / Kosong</th>
                  <th className="py-3 px-4 font-medium text-right">Durasi</th>
                  <th className="py-3 px-4 font-medium text-right">Nilai Akhir</th>
                  <th className="py-3 px-4 font-medium">Ketuntasan</th>
                  <th className="py-3 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attempts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">{a.student_nis}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{a.student_name}</td>
                    <td className="py-3 px-4 text-slate-700">{a.class_name}</td>
                    <td className="py-3 px-4 text-slate-600 max-w-[200px] truncate">{a.exam_title}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-slate-700">
                      <span className="text-emerald-600">{a.correct_count}</span> /{' '}
                      <span className="text-red-600">{a.wrong_count}</span> /{' '}
                      <span className="text-slate-400">{a.blank_count}</span>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-slate-600">
                      {a.duration_minutes_taken} mnt
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-sm font-bold text-right text-slate-900">
                      {a.final_grade}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            a.is_passed ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {a.is_passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {a.is_passed ? 'Lulus (Tuntas)' : `Belum Tuntas (<${a.kkm})`}
                        </span>
                        {!a.essay_graded && (
                          <span className="text-[11px] font-medium text-amber-600">
                            Esai perlu diperiksa
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openDetail(a)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        {!a.essay_graded ? <ClipboardEdit className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {!a.essay_graded ? 'Periksa Esai' : 'Rincian'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attempt Detail & Essay Grading Modal */}
      {detailAttempt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Lembar Jawaban: {detailAttempt.student_name} ({detailAttempt.class_name})
                </h3>
                <p className="text-xs text-slate-500">
                  {detailAttempt.exam_title} · Nilai Saat Ini:{' '}
                  <strong className="font-mono text-slate-900">{detailAttempt.final_grade}</strong> (Skor{' '}
                  {detailAttempt.total_score}/{detailAttempt.max_score})
                </p>
              </div>
              <button type="button" onClick={() => setDetailAttempt(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEssayGrades} className="space-y-4">
              {detailItems.map((it) => (
                <div key={it.question_id} className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Soal #{it.order} · {it.type.toUpperCase()} · {it.topic}
                    </span>
                    <span className="font-mono font-semibold text-slate-800">
                      Skor: {it.earned_score} / {it.weight}
                    </span>
                  </div>
                  <div className="text-sm text-slate-900">
                    <MathText text={it.prompt} />
                  </div>
                  <div className="text-xs bg-slate-50 border border-slate-200 rounded p-2.5">
                    <span className="font-semibold text-slate-700">Jawaban Siswa: </span>
                    <span className="font-mono text-slate-900">
                      {it.student_answer !== null && it.student_answer !== undefined
                        ? typeof it.student_answer === 'object'
                          ? JSON.stringify(it.student_answer)
                          : String(it.student_answer)
                        : '(Tidak dijawab)'}
                    </span>
                  </div>

                  {it.type === 'esai' ? (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-3 space-y-2">
                      {it.scoring_rule?.rubric && (
                        <div className="text-xs text-slate-700">
                          <strong>Rubrik:</strong> {it.scoring_rule.rubric}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 mb-1">
                            Nilai Esai (Maks {it.weight})
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={it.weight}
                            step={0.5}
                            value={essayScores[it.question_id]?.score ?? 0}
                            onChange={(e) =>
                              setEssayScores((prev) => ({
                                ...prev,
                                [it.question_id]: {
                                  score: Number(e.target.value),
                                  feedback: prev[it.question_id]?.feedback || '',
                                },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 text-sm rounded border border-slate-300 bg-white font-mono"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-700 mb-1">
                            Catatan Penilaian Guru
                          </label>
                          <input
                            type="text"
                            value={essayScores[it.question_id]?.feedback || ''}
                            onChange={(e) =>
                              setEssayScores((prev) => ({
                                ...prev,
                                [it.question_id]: {
                                  score: prev[it.question_id]?.score ?? 0,
                                  feedback: e.target.value,
                                },
                              }))
                            }
                            placeholder="Opsional: komentar guru..."
                            className="w-full px-2.5 py-1.5 text-sm rounded border border-slate-300 bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600">
                      Kunci: <span className="font-mono font-semibold text-emerald-700">{JSON.stringify(it.correct_answer)}</span>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDetailAttempt(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Tutup
                </button>
                {detailItems.some((i) => i.type === 'esai') && (
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                  >
                    Simpan Nilai Esai & Hitung Ulang
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
