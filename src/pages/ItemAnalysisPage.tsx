import React, { useEffect, useState } from 'react';
import { BarChart3, Info } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { MathText } from '../components/MathText';
import type { Exam, ItemAnalysisRow } from '../types';

interface ItemAnalysisResponse {
  exam: {
    id: number;
    title: string;
    subject_name: string;
    participant_count: number;
  };
  items: ItemAnalysisRow[];
}

interface ItemAnalysisPageProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const ItemAnalysisPage: React.FC<ItemAnalysisPageProps> = ({ onToast }) => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | ''>('');
  const [analysis, setAnalysis] = useState<ItemAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Exam[]>('/api/exams')
      .then((res) => {
        setExams(res);
        if (res.length > 0) setSelectedExamId(res[0].id);
        else setLoading(false);
      })
      .catch((err) => {
        onToast('error', err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    setLoading(true);
    apiFetch<ItemAnalysisResponse>(`/api/analytics/item-analysis/${selectedExamId}`)
      .then(setAnalysis)
      .catch((err) => onToast('error', err instanceof Error ? err.message : 'Gagal menganalisis butir soal.'))
      .finally(() => setLoading(false));
  }, [selectedExamId]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Analisis Kualitas Butir Soal</h2>
            <p className="text-xs text-slate-500">
              Evaluasi otomatis tingkat kesukaran, daya pembeda (Kelley 27%), dan efektivitas pengecoh.
            </p>
          </div>
        </div>
        <select
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(Number(e.target.value))}
          className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white max-w-sm"
        >
          {exams.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
      </div>

      {/* Methodology Note */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div>
            <strong className="text-slate-800">Metodologi Statistik Klasik:</strong>{' '}
            Tingkat Kesukaran (<span className="font-mono">P = ΣSkor / (N × Bobot)</span>): Mudah (&gt;0.70), Sedang
            (0.30–0.70), Sukar (&lt;0.30).
          </div>
          <div>
            Daya Pembeda (<span className="font-mono">D = P_atas − P_bawah</span> menggunakan 27% kelompok atas &amp;
            bawah): Sangat Baik (≥0.40), Baik (0.30–0.39), Cukup (0.20–0.29), Jelek (&lt;0.20). Pengecoh dianggap
            berfungsi apabila dipilih minimal 5% peserta (dihitung ketika jumlah peserta memadai ≥4–5 siswa).
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500 rounded-xl border border-slate-200 bg-white">
          Menghitung statistik butir soal...
        </div>
      ) : !analysis || analysis.items.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
          Ujian belum memiliki butir soal yang tertaut.
        </div>
      ) : (
        <div className="space-y-4">
          {analysis.exam.participant_count === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Belum ada siswa yang menyelesaikan ujian ini ({analysis.exam.participant_count} peserta). Statistik
              kesukaran, daya pembeda, dan pengecoh akan terhitung otomatis setelah ada pengumpulan jawaban.
            </div>
          )}

          {analysis.items.map((item) => (
            <div key={item.question_id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-bold text-slate-900">Butir #{item.order_index}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.topic}</span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase">{item.type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{item.participant_count} peserta</span>
                  </div>
                  <div className="text-sm text-slate-900">
                    <MathText text={item.prompt} />
                  </div>
                </div>

                <div className="shrink-0">
                  <span
                    className={`inline-block px-3 py-1 rounded-md text-xs font-semibold border ${
                      item.recommendation === 'Dipertahankan'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : item.recommendation === 'Direvisi'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : item.recommendation === 'Dibuang'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}
                  >
                    Rekomendasi: {item.recommendation}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs border-y border-slate-100 py-3">
                <div>
                  <span className="text-slate-400 block">Benar / Salah / Kosong</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-800">
                    {item.correct_pct}% / {item.wrong_pct}% / {item.blank_count}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Tingkat Kesukaran (P)</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {item.difficulty_index} ({item.difficulty_label})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Daya Pembeda (D)</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {item.discrimination_index !== null
                      ? `${item.discrimination_index} (${item.discrimination_label})`
                      : item.discrimination_label}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400 block">Pengecoh Tidak Berfungsi</span>
                  <span className="font-medium text-slate-800">
                    {item.ineffective_distractors.length > 0
                      ? `Opsi ${item.ineffective_distractors.join(', ')} (<5% pemilih)`
                      : item.distractors.length > 0
                      ? 'Semua opsi pengecoh berfungsi baik'
                      : 'N/A (Non-PG)'}
                  </span>
                </div>
              </div>

              {item.distractors.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {item.distractors.map((d) => (
                    <div
                      key={d.key}
                      className={`p-2.5 rounded-lg border text-xs ${
                        d.is_correct
                          ? 'border-emerald-300 bg-emerald-50/60'
                          : !d.effective
                          ? 'border-amber-200 bg-amber-50/50'
                          : 'border-slate-200 bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono font-semibold">
                        <span>
                          Opsi {d.key} {d.is_correct ? '(Kunci)' : ''}
                        </span>
                        <span className="tabular-nums">
                          {d.count} ({d.pct}%)
                        </span>
                      </div>
                      <div className="text-slate-600 truncate mt-0.5">{d.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
