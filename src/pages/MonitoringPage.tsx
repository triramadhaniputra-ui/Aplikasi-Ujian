import React, { useEffect, useRef, useState } from 'react';
import { Eye, Info, Radio, Search, ShieldAlert, X } from 'lucide-react';
import { apiFetch, buildWsUrl } from '../lib/api';
import type { ClassGroup, Exam, ExamAttemptSummary, ViolationLog } from '../types';

interface MonitoringPageProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const MonitoringPage: React.FC<MonitoringPageProps> = ({ onToast }) => {
  const [rows, setRows] = useState<ExamAttemptSummary[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  const [examFilter, setExamFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [selectedRow, setSelectedRow] = useState<ExamAttemptSummary | null>(null);
  const [detailLogs, setDetailLogs] = useState<ViolationLog[]>([]);
  const [proctorNotes, setProctorNotes] = useState('');
  const [proctorAction, setProctorAction] = useState<string>('none');
  const [clearFlag, setClearFlag] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const loadMonitoring = async () => {
    try {
      const [mRes, eRes, cRes] = await Promise.all([
        apiFetch<ExamAttemptSummary[]>(
          `/api/monitoring?exam_id=${examFilter}&class_id=${classFilter}&search=${encodeURIComponent(search)}`
        ),
        apiFetch<Exam[]>('/api/exams'),
        apiFetch<ClassGroup[]>('/api/classes'),
      ]);
      setRows(mRes);
      setExams(eRes);
      setClasses(cRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat data monitoring.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMonitoring();
  }, [examFilter, classFilter]);

  useEffect(() => {
    let closed = false;
    const connect = () => {
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          setTimeout(connect, 3000);
        }
      };
      ws.onmessage = () => {
        loadMonitoring();
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, [examFilter, classFilter]);

  const openDetailModal = async (row: ExamAttemptSummary) => {
    setSelectedRow(row);
    setProctorNotes(row.proctor_notes || '');
    setProctorAction(row.proctor_action || 'none');
    setClearFlag(false);
    if (row.id > 0) {
      try {
        const logs = await apiFetch<ViolationLog[]>(`/api/monitoring/attempts/${row.id}/logs`);
        setDetailLogs(logs);
      } catch {
        setDetailLogs([]);
      }
    } else {
      setDetailLogs([]);
    }
  };

  const handleSaveProctorAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow || selectedRow.id <= 0) return;
    try {
      await apiFetch(`/api/monitoring/attempts/${selectedRow.id}/proctor`, {
        method: 'POST',
        body: JSON.stringify({
          proctor_notes: proctorNotes,
          proctor_action: proctorAction,
          clear_flag: clearFlag,
        }),
      });
      onToast('success', 'Catatan dan tindakan pengawas berhasil disimpan.');
      setSelectedRow(null);
      loadMonitoring();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan tindakan pengawas.');
    }
  };

  const computeRemainingText = (expiresAt: string | null, status: string) => {
    if (status === 'selesai') return '00:00';
    if (!expiresAt) return '—';
    const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.student_name || '').toLowerCase().includes(q) ||
      (r.student_nis || '').toLowerCase().includes(q)
    );
  });

  const statusMeta = (st: ExamAttemptSummary['status'], flagged: boolean) => {
    if (flagged || st === 'terindikasi_pelanggaran') {
      return { label: 'Indikasi Pelanggaran', cls: 'bg-red-50 text-red-700 border-red-200' };
    }
    if (st === 'selesai') {
      return { label: 'Selesai', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (st === 'sedang_mengerjakan') {
      return { label: 'Sedang Mengerjakan', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    return { label: 'Belum Mulai', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  };

  return (
    <div className="space-y-5">
      {/* Header & Honest Capability Note */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Monitoring Ujian Real-Time</h2>
              <span className="text-xs font-mono text-slate-500">
                · WebSocket {wsConnected ? 'Terhubung' : 'Menghubungkan...'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Pantau progres pengerjaan, sisa waktu, dan log fokus peserta secara langsung.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px]">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari NIS atau nama siswa..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300"
            />
          </div>
          <select
            value={examFilter}
            onChange={(e) => setExamFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="all">Semua Ujian Aktif</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
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

      {/* Transparency Note about Browser Monitoring Scope */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-2.5 text-xs text-slate-600">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-800">Cakupan Pengawasan Browser:</strong> Sistem mendeteksi perpindahan tab,
          kehilangan fokus jendela, keluar layar penuh, dan sesi ganda secara otomatis di browser. Browser standar tidak
          dapat mengunci sistem operasi secara penuh; keputusan sanksi tetap memerlukan tinjauan pengawas (tidak
          menggugurkan otomatis hanya dari 1 indikator).
        </div>
      </div>

      {/* Monitoring Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Memuat daftar peserta ujian...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Tidak ada peserta yang sesuai dengan filter monitoring.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="py-3 px-4 font-medium">No. Peserta</th>
                  <th className="py-3 px-4 font-medium">Nama Siswa</th>
                  <th className="py-3 px-4 font-medium">Kelas</th>
                  <th className="py-3 px-4 font-medium">Ujian</th>
                  <th className="py-3 px-4 font-medium">Mulai</th>
                  <th className="py-3 px-4 font-medium">Sisa Waktu</th>
                  <th className="py-3 px-4 font-medium">Progres Soal</th>
                  <th className="py-3 px-4 font-medium">Pelanggaran</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const pct =
                    r.total_questions > 0
                      ? Math.round((r.answered_count / r.total_questions) * 100)
                      : 0;
                  const st = statusMeta(r.status, r.flagged_for_review);
                  return (
                    <tr key={`${r.exam_id}-${r.student_id}`} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                        {r.student_nis}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{r.student_name}</td>
                      <td className="py-3 px-4 text-slate-700">{r.class_name}</td>
                      <td className="py-3 px-4 text-slate-600 max-w-[180px] truncate" title={r.exam_title}>
                        {r.exam_title}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500">
                        {r.started_at ? new Date(r.started_at).toLocaleTimeString('id-ID') : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-slate-800">
                        {computeRemainingText(r.expires_at, r.status)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-xs text-slate-700">
                            {r.answered_count}/{r.total_questions} ({pct}%)
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs">
                        <span className={r.violation_count > 0 ? 'font-bold text-red-600' : 'text-slate-500'}>
                          {r.violation_count}x
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-semibold ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openDetailModal(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Aktivitas
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity & Proctor Action Modal */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Log Pengawasan: {selectedRow.student_name} ({selectedRow.student_nis})
                </h3>
                <p className="text-xs text-slate-500">
                  Kelas {selectedRow.class_name} · {selectedRow.exam_title}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedRow(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedRow.webcam_snapshot_url && (
              <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-3">
                <img
                  src={selectedRow.webcam_snapshot_url}
                  alt="Verifikasi wajah peserta"
                  className="h-16 w-20 rounded object-cover border border-slate-300"
                />
                <div className="text-xs text-slate-600">
                  <div className="font-semibold text-slate-800">Foto Verifikasi Awal Webcam</div>
                  <div>Diambil dengan persetujuan peserta sebelum ujian dimulai.</div>
                </div>
              </div>
            )}

            <div className="mb-5">
              <h4 className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                Riwayat Kejadian & Pelanggaran ({detailLogs.length})
              </h4>
              {detailLogs.length === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-slate-200 text-xs text-slate-500 text-center">
                  {selectedRow.id === 0
                    ? 'Peserta belum memulai ujian.'
                    : 'Tidak ada pelanggaran tercatat pada sesi ini.'}
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3">
                  {detailLogs.map((log) => (
                    <div key={log.id} className="text-xs border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="flex justify-between font-medium text-slate-800">
                        <span>{log.description}</span>
                        <span className="font-mono text-slate-400">
                          {new Date(log.created_at).toLocaleTimeString('id-ID')}
                        </span>
                      </div>
                      {log.evidence_image && (
                        <img
                          src={log.evidence_image}
                          alt="Bukti kamera kejadian"
                          className="mt-1.5 h-14 rounded border border-slate-200"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedRow.id > 0 && (
              <form onSubmit={handleSaveProctorAction} className="space-y-3 border-t border-slate-200 pt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tindakan Pengawas (Dikirim ke Layar Peserta)
                  </label>
                  <select
                    value={proctorAction}
                    onChange={(e) => setProctorAction(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="none">Tidak Ada Tindakan Khusus</option>
                    <option value="peringatan">Kirim Peringatan Tertulis</option>
                    <option value="lanjut_diawasi">Izinkan Lanjut dalam Pengawasan</option>
                    <option value="hentikan_sementara">Hentikan Sesi Sementara</option>
                    <option value="diskualifikasi">Tandai Diskualifikasi (Kebijakan Sekolah)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Pengawasan</label>
                  <textarea
                    rows={2}
                    value={proctorNotes}
                    onChange={(e) => setProctorNotes(e.target.value)}
                    placeholder="Contoh: Siswa dikonfirmasi mengalami kendala koneksi, lanjutkan ujian."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                {selectedRow.flagged_for_review && (
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearFlag}
                      onChange={(e) => setClearFlag(e.target.checked)}
                    />
                    <span>Hapus tanda pemeriksaan setelah klarifikasi pengawas</span>
                  </label>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRow(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                  >
                    Tutup
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                  >
                    Simpan Tindakan Pengawas
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
