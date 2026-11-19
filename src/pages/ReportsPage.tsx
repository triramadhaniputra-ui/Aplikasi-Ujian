import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportToCsv, exportToExcel, exportToPdf } from '../lib/exportUtils';
import type { ClassGroup, Exam, Subject } from '../types';

type ReportType =
  | 'rekap_semua'
  | 'rekap_kelas'
  | 'rekap_mapel'
  | 'hasil_siswa'
  | 'analisis_butir'
  | 'pelanggaran'
  | 'belum_ujian'
  | 'belum_tuntas';

const REPORT_TYPES: Array<{ value: ReportType; label: string }> = [
  { value: 'rekap_semua', label: 'Rekap Nilai Seluruh Siswa' },
  { value: 'rekap_kelas', label: 'Rekap Nilai per Kelas' },
  { value: 'rekap_mapel', label: 'Rekap Nilai per Mata Pelajaran' },
  { value: 'hasil_siswa', label: 'Hasil Ujian per Siswa' },
  { value: 'analisis_butir', label: 'Analisis Butir Soal' },
  { value: 'pelanggaran', label: 'Laporan Pelanggaran Ujian' },
  { value: 'belum_ujian', label: 'Daftar Siswa Belum Mengikuti Ujian' },
  { value: 'belum_tuntas', label: 'Daftar Siswa Belum Tuntas (Remedial)' },
];

interface ReportsPageProps {
  schoolName: string;
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({ schoolName, onToast }) => {
  const [reportType, setReportType] = useState<ReportType>('rekap_semua');
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [examId, setExamId] = useState('all');
  const [classId, setClassId] = useState('all');
  const [subjectId, setSubjectId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<Exam[]>('/api/exams'),
      apiFetch<ClassGroup[]>('/api/classes'),
      apiFetch<Subject[]>('/api/subjects'),
    ])
      .then(([e, c, s]) => {
        setExams(e);
        setClasses(c);
        setSubjects(s);
      })
      .catch(() => {});
  }, []);

  const loadReport = async () => {
    setLoading(true);
    try {
      if (reportType === 'analisis_butir') {
        const targetExam = examId !== 'all' ? Number(examId) : exams[0]?.id;
        if (!targetExam) {
          setRows([]);
          setLoading(false);
          return;
        }
        const res = await apiFetch<{ items: Array<Record<string, unknown>> }>(
          `/api/analytics/item-analysis/${targetExam}`
        );
        setRows(
          res.items.map((it) => ({
            nomor: it.order_index,
            materi: it.topic,
            jenis: it.type,
            peserta: it.participant_count,
            persen_benar: `${it.correct_pct}%`,
            indeks_kesukaran: `${it.difficulty_index} (${it.difficulty_label})`,
            daya_pembeda:
              it.discrimination_index !== null
                ? `${it.discrimination_index} (${it.discrimination_label})`
                : it.discrimination_label,
            rekomendasi: it.recommendation,
          }))
        );
      } else {
        const res = await apiFetch<{ rows: Array<Record<string, unknown>> }>(
          `/api/reports/export-data?type=${reportType}&exam_id=${examId}&class_id=${classId}&subject_id=${subjectId}&date_from=${dateFrom}&date_to=${dateTo}`
        );
        setRows(res.rows);
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat data laporan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [reportType, examId, classId, subjectId, dateFrom, dateTo, exams.length]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const reportTitle = REPORT_TYPES.find((r) => r.value === reportType)?.label || 'Laporan';

  const handleExport = (fmt: 'xlsx' | 'csv' | 'pdf') => {
    if (rows.length === 0) {
      onToast('error', 'Tidak ada baris data untuk diekspor.');
      return;
    }
    const slug = `Laporan_${reportType}_${new Date().toISOString().slice(0, 10)}`;
    if (fmt === 'xlsx') exportToExcel(rows, reportTitle, slug);
    else if (fmt === 'csv') exportToCsv(rows, slug);
    else {
      const headers = columns.map((c) => c.replace(/_/g, ' ').toUpperCase());
      const body = rows.map((r) => columns.map((c) => String(r[c] ?? '-')));
      exportToPdf(reportTitle, `Periode: ${dateFrom || 'Semua'} s.d. ${dateTo || 'Sekarang'}`, headers, body, slug, schoolName);
    }
    onToast('success', `Laporan berhasil diekspor ke format ${fmt.toUpperCase()}.`);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Pusat Laporan & Export Data</h2>
            <p className="text-xs text-slate-500">
              Unduh rekapitulasi nilai, pelanggaran, ketuntasan, dan analisis soal dalam format Excel, CSV, atau PDF.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              <Printer className="h-3.5 w-3.5" />
              Cetak
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Jenis Laporan</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Ujian</label>
            <select
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Ujian</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Kelas</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Kelas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Dari Tanggal</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Sampai Tanggal</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
            />
          </div>
        </div>
      </div>

      {/* Report Table Preview */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden print-only-full">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{reportTitle}</h3>
            <p className="text-xs text-slate-500">{schoolName}</p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">{rows.length} baris</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Menyiapkan data laporan...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Belum ada data untuk kriteria laporan ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  {columns.map((col) => (
                    <th key={col} className="py-2.5 px-3 font-semibold uppercase whitespace-nowrap">
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {columns.map((col) => (
                      <td key={col} className="py-2.5 px-3 text-slate-800 whitespace-nowrap">
                        {String(r[col] ?? '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
