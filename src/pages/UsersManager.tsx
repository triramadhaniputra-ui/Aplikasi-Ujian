import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  downloadStudentTemplate,
  downloadTeacherTemplate,
  exportToCsv,
  exportToExcel,
  parseSpreadsheetFile,
} from '../lib/exportUtils';
import { ConfirmModal } from '../components/ConfirmModal';
import type { ClassGroup, Subject, UserAccount, UserRole } from '../types';

interface ParsedTeacherRow {
  nip: string;
  nama: string;
  username: string;
  password: string;
  mapel: string;
  role: UserRole;
  status: 'aktif' | 'nonaktif';
}

interface UsersManagerProps {
  mode: 'siswa' | 'guru';
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const UsersManager: React.FC<UsersManagerProps> = ({ mode, onToast }) => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [roleFilter, setRoleFilter] = useState<string>(mode === 'siswa' ? 'siswa' : 'guru');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);

  // Teacher Excel upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [parsedTeacherRows, setParsedTeacherRows] = useState<ParsedTeacherRow[]>([]);
  const [importingTeacher, setImportingTeacher] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Form states
  const [fullName, setFullName] = useState('');
  const [nipNis, setNipNis] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(mode === 'siswa' ? 'siswa' : 'guru');
  const [classId, setClassId] = useState<number | ''>('');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [status, setStatus] = useState<'aktif' | 'nonaktif'>('aktif');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const teacherFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRoleFilter(mode === 'siswa' ? 'siswa' : 'guru');
  }, [mode]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, cRes, sRes] = await Promise.all([
        apiFetch<UserAccount[]>(
          `/api/users?role=${mode === 'siswa' ? 'siswa' : roleFilter}&class_id=${classFilter}&search=${encodeURIComponent(search)}`
        ),
        apiFetch<ClassGroup[]>('/api/classes'),
        apiFetch<Subject[]>('/api/subjects'),
      ]);
      setUsers(uRes);
      setClasses(cRes);
      setSubjects(sRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat data pengguna.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode, roleFilter, classFilter]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFullName('');
    setNipNis('');
    setUsername('');
    setPassword(mode === 'siswa' ? 'siswa123' : 'guru123');
    setRole(mode === 'siswa' ? 'siswa' : 'guru');
    setClassId(classes[0]?.id || '');
    setSubjectIds([]);
    setStatus('aktif');
    setModalOpen(true);
  };

  const openEditModal = (u: UserAccount) => {
    setEditingUser(u);
    setFullName(u.full_name);
    setNipNis(u.nip_nis);
    setUsername(u.username);
    setPassword('');
    setRole(u.role);
    setClassId(u.class_id || '');
    setSubjectIds(u.subject_ids || []);
    setStatus(u.status);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        full_name: fullName,
        nip_nis: nipNis,
        username,
        password: password || undefined,
        role,
        class_id: role === 'siswa' && classId ? Number(classId) : null,
        subject_ids: role === 'guru' ? subjectIds : [],
        status,
      };
      if (editingUser) {
        await apiFetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('success', 'Data pengguna berhasil diperbarui.');
      } else {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ ...payload, password: password || '123456' }),
        });
        onToast('success', 'Pengguna baru berhasil ditambahkan.');
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan pengguna.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      onToast('success', `${deleteTarget.full_name} berhasil dihapus.`);
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menghapus pengguna.');
    }
  };

  const normalizeRowKeys = (row: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      out[key.trim().toLowerCase().replace(/\s+/g, '_')] = String(val ?? '').trim();
    }
    return out;
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      const formatted = rows.map((raw) => {
        const r = normalizeRowKeys(raw);
        const nis = r.nis || r.nisn || r.nip || r.nip_nis || '';
        const nama = r.nama || r.nama_lengkap || r.full_name || '';
        const kelas = r.kelas || r.class || '';
        const uname = r.username || nis;
        return {
          nis,
          nama,
          kelas,
          username: uname,
          password: r.password || 'siswa123',
          status: (r.status || 'aktif').toLowerCase(),
          role: 'siswa' as UserRole,
        };
      });
      const res = await apiFetch<{ inserted: number; skipped: number }>('/api/users/import', {
        method: 'POST',
        body: JSON.stringify({ rows: formatted }),
      });
      onToast('success', `Impor selesai: ${res.inserted} berhasil, ${res.skipped} dilewati.`);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memproses file Excel/CSV.');
    } finally {
      e.target.value = '';
    }
  };

  const processTeacherSpreadsheet = async (file: File) => {
    try {
      const rows = await parseSpreadsheetFile(file);
      if (rows.length === 0) {
        onToast('error', 'Berkas Excel kosong atau tidak memiliki baris data.');
        return;
      }
      const parsed: ParsedTeacherRow[] = rows
        .map((raw) => {
          const r = normalizeRowKeys(raw);
          const nip = r.nip || r.nip_nis || r.nis || '';
          const nama = r.nama || r.nama_lengkap || r.full_name || '';
          const uname =
            r.username ||
            nip ||
            nama
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '.')
              .replace(/^\.+|\.+$/g, '');
          const rawRole = (r.peran || r.role || 'guru').toLowerCase();
          const validRole: UserRole =
            rawRole === 'pengawas' || rawRole === 'admin' || rawRole === 'guru' ? rawRole : 'guru';
          const mapel = r.mapel || r.mata_pelajaran || r.kode_mapel || r.subject || '';
          const rowStatus: 'aktif' | 'nonaktif' =
            (r.status || 'aktif').toLowerCase() === 'nonaktif' ? 'nonaktif' : 'aktif';
          return {
            nip,
            nama,
            username: uname,
            password: r.password || (validRole === 'pengawas' ? 'pengawas123' : 'guru123'),
            mapel,
            role: validRole,
            status: rowStatus,
          };
        })
        .filter((row) => row.nama || row.nip || row.username);

      if (parsed.length === 0) {
        onToast('error', 'Tidak ada data guru valid yang ditemukan dalam berkas.');
        return;
      }
      setUploadFileName(file.name);
      setParsedTeacherRows(parsed);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal membaca berkas Excel/CSV.');
    }
  };

  const handleTeacherFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processTeacherSpreadsheet(file);
    }
    e.target.value = '';
  };

  const handleConfirmTeacherImport = async () => {
    if (parsedTeacherRows.length === 0) return;
    setImportingTeacher(true);
    try {
      const res = await apiFetch<{ inserted: number; skipped: number }>('/api/users/import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsedTeacherRows }),
      });
      onToast(
        'success',
        `Impor data guru selesai: ${res.inserted} berhasil ditambahkan, ${res.skipped} dilewati.`
      );
      setUploadModalOpen(false);
      setUploadFileName('');
      setParsedTeacherRows([]);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengimpor data guru.');
    } finally {
      setImportingTeacher(false);
    }
  };

  const openTeacherUploadModal = () => {
    setUploadFileName('');
    setParsedTeacherRows([]);
    setUploadModalOpen(true);
  };

  const handleExport = (format: 'xlsx' | 'csv') => {
    const subjectLookup = new Map(subjects.map((s) => [s.id, s.name]));
    const rows = filteredUsers.map((u) => ({
      [mode === 'siswa' ? 'NIS' : 'NIP']: u.nip_nis,
      'Nama Lengkap': u.full_name,
      Username: u.username,
      Peran: u.role.toUpperCase(),
      [mode === 'siswa' ? 'Kelas' : 'Mata Pelajaran']:
        mode === 'siswa'
          ? u.class_name || '-'
          : u.subject_ids.map((id) => subjectLookup.get(id) || id).join(', ') || '-',
      Status: u.status,
    }));
    const fileName = mode === 'siswa' ? 'Data_Siswa_SMPN41' : 'Data_Guru_Staff_SMPN41';
    if (format === 'xlsx') exportToExcel(rows, mode === 'siswa' ? 'Data Siswa' : 'Data Guru', fileName);
    else exportToCsv(rows, fileName);
  };

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.nip_nis.toLowerCase().includes(q)
    );
  });

  const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={mode === 'siswa' ? 'Cari nama, NIS, username...' : 'Cari nama, NIP, username...'}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {mode === 'siswa' ? (
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700"
            >
              <option value="all">Semua Kelas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Kelas {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {[
                { key: 'guru', label: 'Guru' },
                { key: 'pengawas', label: 'Pengawas' },
                { key: 'admin', label: 'Admin' },
                { key: 'all', label: 'Semua Staff' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setRoleFilter(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    roleFilter === t.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'siswa' ? (
            <>
              <button
                type="button"
                onClick={downloadStudentTemplate}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                Template Excel
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Impor Excel/CSV
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={downloadTeacherTemplate}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                Template Excel
              </button>
              <button
                type="button"
                onClick={openTeacherUploadModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Excel Guru
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            {mode === 'siswa' ? 'Tambah Siswa' : 'Tambah Guru / Staff'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Memuat data...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Tidak ada data yang sesuai filter.</p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-lg"
            >
              Tambah Data Baru
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="py-3 px-4 font-medium">{mode === 'siswa' ? 'NIS' : 'NIP'}</th>
                  <th className="py-3 px-4 font-medium">Nama Lengkap</th>
                  <th className="py-3 px-4 font-medium">Username</th>
                  <th className="py-3 px-4 font-medium">{mode === 'siswa' ? 'Kelas' : 'Peran & Mapel'}</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">{u.nip_nis}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{u.full_name}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{u.username}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {u.role === 'siswa' ? (
                        <span>{u.class_name || 'Belum ditempatkan'}</span>
                      ) : (
                        <div className="text-xs">
                          <span className="font-semibold uppercase text-slate-800">{u.role}</span>
                          {u.subject_ids.length > 0 && (
                            <span className="text-slate-500">
                              {' · '}
                              {u.subject_ids.map((id) => subjectMap.get(id) || id).join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          u.status === 'aktif' ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                      >
                        {u.status === 'aktif' ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                        {u.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="p-1.5 text-slate-500 hover:text-blue-600 rounded-md hover:bg-blue-50"
                        title="Edit"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 text-slate-500 hover:text-red-600 rounded-md hover:bg-red-50 ml-1"
                        title="Hapus"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingUser ? 'Edit Data Pengguna' : mode === 'siswa' ? 'Tambah Siswa Baru' : 'Tambah Guru / Staff'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {role === 'siswa' ? 'Nomor Induk Siswa (NIS)' : 'NIP'}
                  </label>
                  <input
                    type="text"
                    required
                    value={nipNis}
                    onChange={(e) => setNipNis(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Peran / Hak Akses</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="siswa">Siswa</option>
                    <option value="guru">Guru</option>
                    <option value="pengawas">Pengawas Ujian</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {editingUser ? 'Password Baru (kosongkan jika tetap)' : 'Password'}
                  </label>
                  <input
                    type="text"
                    required={!editingUser}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              {role === 'siswa' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kelas</label>
                  <select
                    value={classId}
                    onChange={(e) => setClassId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">-- Pilih Kelas --</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Tingkat {c.grade_level})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {role === 'guru' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Mata Pelajaran Pengampu
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                    {subjects.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={subjectIds.includes(s.id)}
                          onChange={(e) =>
                            setSubjectIds((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                            )
                          }
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status Akun</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'aktif' | 'nonaktif')}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="aktif">Aktif</option>
                  <option value="nonaktif">Nonaktif</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  Simpan Data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Teacher Excel Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Upload Berkas Excel Data Guru</h3>
                  <p className="text-xs text-slate-500">
                    Tambahkan banyak akun guru sekaligus dari file Excel (.xlsx, .xls) atau CSV.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 mb-4 text-xs text-slate-600 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Format Kolom Excel yang Didukung:</span>
                <button
                  type="button"
                  onClick={downloadTeacherTemplate}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  Unduh Template Excel
                </button>
              </div>
              <p>
                Kolom: <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">nip</code>,{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">nama</code>,{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">username</code>,{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">password</code> (opsional, default{' '}
                <span className="font-mono">guru123</span>),{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">mapel</code> (kode/nama mapel, mis.{' '}
                <span className="font-mono">MTK, IPA</span>),{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">status</code> (<span className="font-mono">aktif</span>/<span className="font-mono">nonaktif</span>).
              </p>
            </div>

            <input
              ref={teacherFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleTeacherFileChange}
              className="hidden"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                const file = e.dataTransfer.files?.[0];
                if (file) await processTeacherSpreadsheet(file);
              }}
              onClick={() => teacherFileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                isDraggingFile
                  ? 'border-blue-500 bg-blue-50/70'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <Upload className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-800">
                {uploadFileName ? uploadFileName : 'Klik untuk memilih berkas Excel atau seret ke sini'}
              </p>
              <p className="text-xs text-slate-500 mt-1">Mendukung format .xlsx, .xls, dan .csv</p>
            </div>

            {parsedTeacherRows.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    Pratinjau Data ({parsedTeacherRows.length} baris siap diimpor)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadFileName('');
                      setParsedTeacherRows([]);
                    }}
                    className="text-slate-500 hover:text-red-600"
                  >
                    Reset Berkas
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 px-3 font-medium">NIP</th>
                        <th className="py-2 px-3 font-medium">Nama Lengkap</th>
                        <th className="py-2 px-3 font-medium">Username</th>
                        <th className="py-2 px-3 font-medium">Mapel</th>
                        <th className="py-2 px-3 font-medium">Peran</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedTeacherRows.map((row, idx) => (
                        <tr key={`${row.username}-${idx}`}>
                          <td className="py-2 px-3 font-mono text-slate-600">{row.nip || '-'}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{row.nama || '-'}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{row.username || '-'}</td>
                          <td className="py-2 px-3 text-slate-600">{row.mapel || '-'}</td>
                          <td className="py-2 px-3 uppercase font-semibold text-slate-700">{row.role}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`font-semibold ${
                                row.status === 'aktif' ? 'text-emerald-600' : 'text-slate-400'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={parsedTeacherRows.length === 0 || importingTeacher}
                onClick={handleConfirmTeacherImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {importingTeacher
                  ? 'Mengimpor...'
                  : `Impor ${parsedTeacherRows.length > 0 ? `${parsedTeacherRows.length} ` : ''}Data Guru`}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus Data Pengguna?"
        message={`Anda yakin ingin menghapus ${deleteTarget?.full_name} (${deleteTarget?.nip_nis})? Data riwayat ujian terkait juga akan terhapus.`}
        confirmLabel="Hapus Permanen"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
