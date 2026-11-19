import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SimpleBarChart } from '../components/Charts';
import type { UserRole, ViolationLog } from '../types';

interface SummaryResponse {
  stats: {
    total_students: number;
    total_teachers: number;
    total_subjects: number;
    total_questions: number;
    active_exams: number;
    finished_exams: number;
    students_in_exam: number;
    students_not_started: number;
    average_grade: number | null;
    finished_attempts: number;
    suspicious_count: number;
  };
  exam_stats: Array<{
    id: number;
    title: string;
    subject_code: string;
    subject_name: string;
    completed_count: number;
    ongoing_count: number;
    avg_grade: number | null;
  }>;
  recent_violations: ViolationLog[];
}

interface DashboardOverviewProps {
  role: UserRole;
  onNavigate: (tab: string) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ role, onNavigate }) => {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSummary = async () => {
    try {
      const res = await apiFetch<SummaryResponse>('/api/dashboard/summary');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat ringkasan dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse p-5" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || 'Data tidak tersedia.'}
      </div>
    );
  }

  const { stats, exam_stats, recent_violations } = data;

  const kpis = [
    { label: 'Total Siswa Aktif', value: stats.total_students, icon: GraduationCap, accent: 'text-blue-600 bg-blue-50', target: role === 'admin' ? 'siswa' : undefined },
    { label: 'Total Guru Pengampu', value: stats.total_teachers, icon: Users, accent: 'text-slate-700 bg-slate-100', target: role === 'admin' ? 'guru' : undefined },
    { label: 'Mata Pelajaran', value: stats.total_subjects, icon: BookOpen, accent: 'text-blue-600 bg-blue-50', target: role === 'admin' ? 'mapel' : undefined },
    { label: 'Total Bank Soal', value: stats.total_questions, icon: FileText, accent: 'text-slate-700 bg-slate-100', target: role !== 'pengawas' ? 'bank_soal' : undefined },
    { label: 'Ujian Aktif', value: stats.active_exams, icon: CalendarClock, accent: 'text-blue-600 bg-blue-50', target: role !== 'pengawas' ? 'jadwal_ujian' : 'monitoring' },
    { label: 'Ujian Selesai', value: stats.finished_exams, icon: CheckCircle2, accent: 'text-emerald-600 bg-emerald-50', target: role !== 'pengawas' ? 'hasil_ujian' : 'monitoring' },
    { label: 'Sedang Mengerjakan', value: stats.students_in_exam, icon: ClipboardCheck, accent: 'text-blue-600 bg-blue-50', target: 'monitoring' },
    { label: 'Belum Mengikuti Ujian', value: stats.students_not_started, icon: AlertTriangle, accent: 'text-amber-600 bg-amber-50', target: 'monitoring' },
  ];

  const activityData = exam_stats.map((e) => ({
    label: e.subject_code,
    subLabel: `${e.completed_count} selesai`,
    value: e.completed_count + e.ongoing_count,
  }));

  const gradeData = exam_stats
    .filter((e) => e.avg_grade !== null)
    .map((e) => ({
      label: e.subject_code,
      subLabel: `${e.completed_count} peserta`,
      value: Number(e.avg_grade || 0),
    }));

  return (
    <div className="space-y-6">
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const clickable = Boolean(kpi.target);
          return (
            <button
              key={kpi.label}
              type="button"
              disabled={!clickable}
              onClick={() => kpi.target && onNavigate(kpi.target)}
              className={`text-left rounded-xl border border-slate-200 bg-white p-5 transition-colors ${
                clickable ? 'hover:border-blue-400 cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{kpi.label}</span>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${kpi.accent}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {kpi.value}
              </div>
            </button>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Aktivitas Peserta Ujian</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Jumlah peserta aktif dan selesai per jadwal ujian
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {stats.finished_attempts} pengumpulan
            </span>
          </div>
          <SimpleBarChart
            data={activityData}
            emptyText="Belum ada aktivitas ujian yang berjalan."
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Statistik Nilai Rata-Rata</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Rata-rata nilai akhir dari seluruh ujian yang sudah dikumpulkan
              </p>
            </div>
            <span className="text-sm font-bold font-mono tabular-nums text-blue-600">
              {stats.average_grade !== null ? `${stats.average_grade}` : '—'}
            </span>
          </div>
          <SimpleBarChart
            data={gradeData}
            maxVal={100}
            barColor="#0A192F"
            emptyText="Nilai rata-rata akan tampil setelah ada siswa menyelesaikan ujian."
          />
        </div>
      </div>

      {/* Suspicious Activity Notification Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Notifikasi Aktivitas Mencurigakan
              </h3>
              <p className="text-xs text-slate-500">
                {stats.suspicious_count} sesi ditandai untuk pemeriksaan pengawas · Pemantauan fokus real-time
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('monitoring')}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Buka Monitoring Real-Time
          </button>
        </div>

        {recent_violations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            Belum ada catatan pelanggaran atau perpindahan fokus selama ujian berlangsung.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 pr-4 font-medium">Waktu</th>
                  <th className="py-2.5 pr-4 font-medium">Siswa</th>
                  <th className="py-2.5 pr-4 font-medium">Kelas</th>
                  <th className="py-2.5 pr-4 font-medium">Ujian</th>
                  <th className="py-2.5 pr-4 font-medium">Keterangan</th>
                  <th className="py-2.5 font-medium">Tingkat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent_violations.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                      {new Date(v.created_at).toLocaleTimeString('id-ID')}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">
                      {v.student_name}{' '}
                      <span className="text-xs font-mono text-slate-400">({v.student_nis})</span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{v.class_name || '-'}</td>
                    <td className="py-2.5 pr-4 text-slate-600 max-w-[200px] truncate">{v.exam_title}</td>
                    <td className="py-2.5 pr-4 text-slate-700">{v.description}</td>
                    <td className="py-2.5 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold ${
                          v.severity === 'warning_3'
                            ? 'text-red-600'
                            : v.severity === 'warning_2'
                            ? 'text-amber-600'
                            : 'text-slate-600'
                        }`}
                      >
                        {v.severity === 'warning_3'
                          ? 'Periksa Pengawas'
                          : v.severity === 'warning_2'
                          ? 'Peringatan 2'
                          : v.severity === 'warning_1'
                          ? 'Peringatan 1'
                          : 'Catatan'}
                      </span>
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
};
