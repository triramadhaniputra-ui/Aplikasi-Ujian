import React, { useEffect, useState } from 'react';
import { BookOpen, Edit3, Plus, School, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type { ClassGroup, Subject, UserAccount } from '../types';

interface MasterDataPageProps {
  mode: 'kelas' | 'mapel';
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const MasterDataPage: React.FC<MasterDataPageProps> = ({ mode, onToast }) => {
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

  // Class fields
  const [className, setClassName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(7);
  const [homeroomId, setHomeroomId] = useState<number | ''>('');

  // Subject fields
  const [subCode, setSubCode] = useState('');
  const [subName, setSubName] = useState('');
  const [subKkm, setSubKkm] = useState(75);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cRes, sRes, tRes] = await Promise.all([
        apiFetch<ClassGroup[]>('/api/classes'),
        apiFetch<Subject[]>('/api/subjects'),
        apiFetch<UserAccount[]>('/api/users?role=guru'),
      ]);
      setClasses(cRes);
      setSubjects(sRes);
      setTeachers(tRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const openCreate = () => {
    setEditingId(null);
    setClassName('');
    setGradeLevel(7);
    setHomeroomId('');
    setSubCode('');
    setSubName('');
    setSubKkm(75);
    setModalOpen(true);
  };

  const openEditClass = (c: ClassGroup) => {
    setEditingId(c.id);
    setClassName(c.name);
    setGradeLevel(c.grade_level);
    setHomeroomId(c.homeroom_teacher_id || '');
    setModalOpen(true);
  };

  const openEditSubject = (s: Subject) => {
    setEditingId(s.id);
    setSubCode(s.code);
    setSubName(s.name);
    setSubKkm(s.kkm);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'kelas') {
        const body = {
          name: className,
          grade_level: Number(gradeLevel),
          homeroom_teacher_id: homeroomId ? Number(homeroomId) : null,
        };
        if (editingId) {
          await apiFetch(`/api/classes/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
          onToast('success', 'Data kelas berhasil diperbarui.');
        } else {
          await apiFetch('/api/classes', { method: 'POST', body: JSON.stringify(body) });
          onToast('success', 'Kelas baru berhasil ditambahkan.');
        }
      } else {
        const body = { code: subCode, name: subName, kkm: Number(subKkm) };
        if (editingId) {
          await apiFetch(`/api/subjects/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
          onToast('success', 'Mata pelajaran berhasil diperbarui.');
        } else {
          await apiFetch('/api/subjects', { method: 'POST', body: JSON.stringify(body) });
          onToast('success', 'Mata pelajaran baru berhasil ditambahkan.');
        }
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan data.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const endpoint = mode === 'kelas' ? `/api/classes/${deleteTarget.id}` : `/api/subjects/${deleteTarget.id}`;
      await apiFetch(endpoint, { method: 'DELETE' });
      onToast('success', `${deleteTarget.label} berhasil dihapus.`);
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menghapus data.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            {mode === 'kelas' ? <School className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {mode === 'kelas' ? 'Manajemen Data Kelas' : 'Manajemen Mata Pelajaran'}
            </h2>
            <p className="text-xs text-slate-500">
              {mode === 'kelas'
                ? 'Kelola rombongan belajar dan wali kelas SMP Negeri 41 Muaro Jambi.'
                : 'Kelola daftar mata pelajaran dan standar nilai minimum (KKM).'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          {mode === 'kelas' ? 'Tambah Kelas' : 'Tambah Mata Pelajaran'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Memuat data...</div>
        ) : mode === 'kelas' ? (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-medium">Nama Kelas</th>
                <th className="py-3 px-4 font-medium">Tingkat</th>
                <th className="py-3 px-4 font-medium">Wali Kelas</th>
                <th className="py-3 px-4 font-medium">Jumlah Siswa</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classes.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-semibold text-slate-900">{c.name}</td>
                  <td className="py-3 px-4 text-slate-600">Kelas {c.grade_level}</td>
                  <td className="py-3 px-4 text-slate-700">{c.homeroom_teacher_name || 'Belum ditetapkan'}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-800">{c.student_count ?? 0} siswa</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button type="button" onClick={() => openEditClass(c)} className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-blue-50">
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: c.id, label: `Kelas ${c.name}` })}
                      className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-red-50 ml-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-medium">Kode</th>
                <th className="py-3 px-4 font-medium">Nama Mata Pelajaran</th>
                <th className="py-3 px-4 font-medium">Standar KKM</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-blue-700">{s.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{s.name}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-700">{s.kkm}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button type="button" onClick={() => openEditSubject(s)} className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-blue-50">
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: s.id, label: s.name })}
                      className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-red-50 ml-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">
                {editingId
                  ? mode === 'kelas'
                    ? 'Edit Kelas'
                    : 'Edit Mata Pelajaran'
                  : mode === 'kelas'
                  ? 'Tambah Kelas Baru'
                  : 'Tambah Mata Pelajaran'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {mode === 'kelas' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Kelas</label>
                    <input
                      type="text"
                      required
                      placeholder="Contoh: IX-C"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tingkat Kelas</label>
                    <select
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                    >
                      <option value={7}>Tingkat VII</option>
                      <option value={8}>Tingkat VIII</option>
                      <option value={9}>Tingkat IX</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Wali Kelas</label>
                    <select
                      value={homeroomId}
                      onChange={(e) => setHomeroomId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="">-- Belum Ditetapkan --</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Kode Mapel</label>
                    <input
                      type="text"
                      required
                      placeholder="Contoh: PRAK"
                      value={subCode}
                      onChange={(e) => setSubCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Mata Pelajaran</label>
                    <input
                      type="text"
                      required
                      placeholder="Contoh: Prakarya & Informatika"
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nilai KKM Default</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      required
                      value={subKkm}
                      onChange={(e) => setSubKkm(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                    />
                  </div>
                </>
              )}

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
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Konfirmasi Hapus"
        message={`Hapus ${deleteTarget?.label}? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
