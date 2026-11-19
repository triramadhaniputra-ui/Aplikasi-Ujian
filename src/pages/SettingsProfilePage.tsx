import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, Database, Download, History, KeyRound, RefreshCw, Save, Settings, Shield, Upload, UserCheck } from 'lucide-react';
import { useFirebase } from '../components/FirebaseProvider';
import { apiFetch } from '../lib/api';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  subscribeMyCbtSnapshots,
  syncCbtWorkspaceToFirestore,
  syncSchoolSettingsToFirestore,
  syncUserProfileToFirestore,
  type FirestoreCbtSnapshotData,
} from '../lib/firebase';
import type {
  ClassGroup,
  Exam,
  LoginHistoryEntry,
  Subject,
  SystemSettings,
  UserAccount,
} from '../types';

interface SettingsProfilePageProps {
  mode: 'pengaturan' | 'profil';
  currentUser: UserAccount;
  onUserUpdated: () => void;
  onSettingsUpdated: () => void;
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const SettingsProfilePage: React.FC<SettingsProfilePageProps> = ({
  mode,
  currentUser,
  onUserUpdated,
  onSettingsUpdated,
  onToast,
}) => {
  const {
    firebaseUser,
    authReady,
    connectionState,
    autoCloudSave,
    setAutoCloudSave,
    storeMeta,
    signInWithGoogle,
    signOutFirebase,
    saveFullToCloud,
    restoreFullFromCloud,
  } = useFirebase();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [cloudSnapshots, setCloudSnapshots] = useState<FirestoreCbtSnapshotData[]>([]);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [restoringCloud, setRestoringCloud] = useState(false);

  // Profile form
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFullName(currentUser.full_name);
    apiFetch<LoginHistoryEntry[]>('/api/auth/login-history')
      .then(setHistory)
      .catch(() => {});

    if (mode === 'pengaturan' && currentUser.role === 'admin') {
      apiFetch<SystemSettings>('/api/settings')
        .then(setSettings)
        .catch((err) => onToast('error', err instanceof Error ? err.message : 'Gagal memuat pengaturan.'));
    }
  }, [mode, currentUser.id]);

  // Attach Firestore onSnapshot listener only when Firebase Auth is ready and signed in
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setCloudSnapshots([]);
      return;
    }
    const unsubscribe = subscribeMyCbtSnapshots(
      firebaseUser.uid,
      (rows) => setCloudSnapshots(rows),
      (err) => onToast('error', err.message)
    );
    return () => unsubscribe();
  }, [authReady, firebaseUser?.uid]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ full_name: fullName, photo_url: currentUser.photo_url }),
      });
      onToast('success', 'Profil berhasil diperbarui.');
      onUserUpdated();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan profil.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      onToast('success', 'Password berhasil diganti.');
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengganti password.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      if (firebaseUser) {
        await syncSchoolSettingsToFirestore(settings, firebaseUser.uid);
      }
      onToast('success', 'Pengaturan sistem berhasil disimpan.');
      onSettingsUpdated();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan pengaturan sistem.');
    }
  };

  const handleConnectGoogleFirestore = async () => {
    try {
      const fbUser = await signInWithGoogle();
      await syncUserProfileToFirestore(currentUser, fbUser);
      onToast('success', `Terhubung ke Firebase sebagai ${fbUser.email || 'pengguna Google'}.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menghubungkan akun Google Firebase.');
    }
  };

  const handleSyncToFirestore = async () => {
    if (!firebaseUser || !settings) {
      onToast('error', 'Hubungkan akun Google terlebih dahulu untuk menyinkronkan ke Cloud Firestore.');
      return;
    }
    setSyncingCloud(true);
    try {
      const [summary, subjects, classes, exams] = await Promise.all([
        apiFetch<{ stats: { total_questions: number; total_students: number; total_teachers: number } }>(
          '/api/dashboard/summary'
        ),
        apiFetch<Subject[]>('/api/subjects'),
        apiFetch<ClassGroup[]>('/api/classes'),
        apiFetch<Exam[]>('/api/exams'),
      ]);

      await syncUserProfileToFirestore(currentUser, firebaseUser);
      const [fullResult] = await Promise.all([
        saveFullToCloud(currentUser.full_name),
        syncCbtWorkspaceToFirestore({
          uid: firebaseUser.uid,
          syncedByName: currentUser.full_name,
          settings,
          subjects,
          classes,
          exams,
          totalQuestions: summary.stats.total_questions,
          totalStudents: summary.stats.total_students,
          totalTeachers: summary.stats.total_teachers,
        }),
      ]);
      onToast(
        'success',
        `Model Full Penyimpanan berhasil: ${fullResult.totalRecords} baris data (${fullResult.totalChunks} paket) tersimpan di Cloud Firestore.`
      );
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyinkronkan data ke Cloud Firestore.');
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleRestoreFromFirestore = async () => {
    if (!firebaseUser) {
      onToast('error', 'Hubungkan akun Google terlebih dahulu untuk memulihkan data dari Cloud Firestore.');
      return;
    }
    setRestoringCloud(true);
    try {
      const res = await restoreFullFromCloud();
      onToast('success', `Seluruh data (${res.totalRecords} baris) berhasil dimuat ulang dari Cloud Firestore.`);
      onSettingsUpdated();
      const freshSettings = await apiFetch<SystemSettings>('/api/settings');
      setSettings(freshSettings);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat data dari Cloud Firestore.');
    } finally {
      setRestoringCloud(false);
    }
  };

  const handleBackup = async () => {
    try {
      const backup = await apiFetch<Record<string, unknown>>('/api/settings/backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Backup_SMART_CBT_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast('success', 'Backup database berhasil diunduh.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal membuat backup.');
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { data?: unknown };
      await apiFetch('/api/settings/restore', {
        method: 'POST',
        body: JSON.stringify({ data: parsed.data || parsed }),
      });
      onToast('success', 'Database berhasil dipulihkan dari file backup.');
      onSettingsUpdated();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'File backup tidak valid.');
    } finally {
      e.target.value = '';
    }
  };

  if (mode === 'pengaturan' && settings) {
    return (
      <div className="space-y-6">
        <form onSubmit={handleSaveSettings} className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Pengaturan Sistem SMART CBT</h2>
                <p className="text-xs text-slate-500">
                  Identitas sekolah, parameter akademik, keamanan anti-kecurangan, dan hak akses peran.
                </p>
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
            >
              <Save className="h-4 w-4" />
              Simpan Pengaturan
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Sekolah</label>
              <input
                type="text"
                value={settings.school_name}
                onChange={(e) => setSettings({ ...settings, school_name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">URL / Path Logo Sekolah</label>
              <input
                type="text"
                value={settings.school_logo}
                onChange={(e) => setSettings({ ...settings, school_logo: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tahun Pelajaran</label>
              <input
                type="text"
                value={settings.academic_year}
                onChange={(e) => setSettings({ ...settings, academic_year: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Semester</label>
              <select
                value={settings.semester}
                onChange={(e) => setSettings({ ...settings, semester: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="Ganjil">Ganjil</option>
                <option value="Genap">Genap</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">KKM Default</label>
              <input
                type="number"
                value={settings.default_kkm}
                onChange={(e) => setSettings({ ...settings, default_kkm: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Durasi Default (Mnt)</label>
              <input
                type="number"
                value={settings.default_duration}
                onChange={(e) => setSettings({ ...settings, default_duration: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Logout Otomatis (Mnt)</label>
              <input
                type="number"
                value={settings.auto_logout_minutes}
                onChange={(e) => setSettings({ ...settings, auto_logout_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Batas Tanda Pengawas</label>
              <input
                type="number"
                min={1}
                value={settings.max_violations}
                onChange={(e) => setSettings({ ...settings, max_violations: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.tab_switch_detection}
                onChange={(e) => setSettings({ ...settings, tab_switch_detection: e.target.checked })}
              />
              <span>Aktifkan deteksi pindah tab & kehilangan fokus jendela</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.require_webcam}
                onChange={(e) => setSettings({ ...settings, require_webcam: e.target.checked })}
              />
              <span>Aktifkan verifikasi webcam default (dengan izin peserta)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.notifications_enabled}
                onChange={(e) => setSettings({ ...settings, notifications_enabled: e.target.checked })}
              />
              <span>Aktifkan notifikasi peringatan pengawas real-time</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allow_token_auto_rotate}
                onChange={(e) => setSettings({ ...settings, allow_token_auto_rotate: e.target.checked })}
              />
              <span>Izinkan rotasi token otomatis oleh pengawas</span>
            </label>
          </div>
        </form>

        {/* Model Full Penyimpanan (Cloud Firestore) */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Model Full Penyimpanan (Cloud Firestore)</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      connectionState === 'connected'
                        ? 'bg-emerald-50 text-emerald-700'
                        : connectionState === 'offline'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {connectionState === 'connected'
                      ? 'Terhubung'
                      : connectionState === 'offline'
                      ? 'Offline'
                      : 'Memeriksa...'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Menyimpan seluruh 10 tabel CBT (Guru, Siswa, Kelas, Mapel, Bank Soal Bergambar, Jadwal, Jawaban, Nilai, Log Pengawas, Pengaturan) secara penuh ke Cloud Firestore.
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Project: <span className="font-mono">{FIREBASE_PROJECT_ID}</span> · Database:{' '}
                  <span className="font-mono">{FIRESTORE_DATABASE_ID.slice(0, 18)}…</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {firebaseUser ? (
                <>
                  <span className="text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
                    {firebaseUser.email}
                  </span>
                  <button
                    type="button"
                    disabled={syncingCloud || restoringCloud}
                    onClick={handleSyncToFirestore}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60"
                  >
                    {syncingCloud ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <CloudUpload className="h-4 w-4" />
                    )}
                    {syncingCloud ? 'Menyimpan Penuh...' : 'Simpan Semua ke Cloud'}
                  </button>
                  <button
                    type="button"
                    disabled={syncingCloud || restoringCloud}
                    onClick={handleRestoreFromFirestore}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg disabled:opacity-60"
                  >
                    <CloudDownload className="h-4 w-4" />
                    {restoringCloud ? 'Memuat...' : 'Muat dari Cloud'}
                  </button>
                  <button
                    type="button"
                    onClick={() => signOutFirebase()}
                    className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg"
                  >
                    Putuskan
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectGoogleFirestore}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  <Cloud className="h-4 w-4" />
                  Hubungkan Akun Google
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <label className="flex items-center gap-2.5 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={autoCloudSave}
                onChange={(e) => setAutoCloudSave(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>
                <strong className="text-slate-900">Auto-Simpan Penuh Otomatis:</strong> Setiap kali data guru, siswa, soal, jadwal, atau nilai diubah, aplikasi otomatis menyimpannya ke Cloud Firestore.
              </span>
            </label>
            {storeMeta && (
              <div className="text-[11px] text-slate-500 shrink-0">
                Terakhir disimpan:{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {storeMeta.updatedAtMs
                    ? new Date(storeMeta.updatedAtMs).toLocaleString('id-ID')
                    : 'Baru saja'}
                </span>
              </div>
            )}
          </div>

          {(storeMeta || cloudSnapshots.length > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 pt-1 text-xs">
              {storeMeta && (
                <>
                  <div className="rounded-lg bg-emerald-50/70 p-2.5 border border-emerald-200">
                    <span className="text-emerald-700 block">Total Data Cloud</span>
                    <span className="font-mono font-bold text-emerald-900">{storeMeta.totalRecords}</span>
                  </div>
                  <div className="rounded-lg bg-emerald-50/70 p-2.5 border border-emerald-200">
                    <span className="text-emerald-700 block">Paket Chunk</span>
                    <span className="font-mono font-bold text-emerald-900">{storeMeta.totalChunks}</span>
                  </div>
                </>
              )}
              {cloudSnapshots.length > 0 && (
                <>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Mapel</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalSubjects}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Kelas</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalClasses}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Bank Soal</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalQuestions}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Jadwal Ujian</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalExams}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Siswa</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalStudents}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200">
                    <span className="text-slate-400 block">Guru</span>
                    <span className="font-mono font-bold text-slate-900">{cloudSnapshots[0].totalTeachers}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Backup & Restore */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Backup & Restore Database</h3>
              <p className="text-xs text-slate-500">
                Ekspor cadangan seluruh data siswa, bank soal, ujian, dan hasil ke file JSON terstruktur.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
            >
              <Download className="h-4 w-4" />
              Unduh Backup
            </button>
            <input ref={restoreInputRef} type="file" accept=".json" onChange={handleRestore} className="hidden" />
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              <Upload className="h-4 w-4" />
              Pulihkan Backup
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Profile, Change Password & Login History
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveProfile} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <UserCheck className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">Profil Pengguna</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-400 block">Username</span>
              <span className="font-mono font-semibold text-slate-800">{currentUser.username}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{currentUser.role === 'siswa' ? 'NIS' : 'NIP'}</span>
              <span className="font-mono font-semibold text-slate-800">{currentUser.nip_nis}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Peran</span>
              <span className="font-semibold uppercase text-blue-700">{currentUser.role}</span>
            </div>
            {currentUser.class_name && (
              <div>
                <span className="text-slate-400 block">Kelas</span>
                <span className="font-semibold text-slate-800">{currentUser.class_name}</span>
              </div>
            )}
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
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
          >
            Perbarui Profil
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <KeyRound className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">Ganti Password</h3>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password Lama</label>
            <input
              type="password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password Baru (Min. 6 karakter)</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            Simpan Password Baru
          </button>
        </form>
      </div>

      {/* Login History */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <History className="h-5 w-5 text-slate-700" />
          <h3 className="text-base font-bold text-slate-900">Riwayat Login Pengguna</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Waktu</th>
                <th className="py-2.5 pr-4 font-medium">Username</th>
                <th className="py-2.5 pr-4 font-medium">Peran</th>
                <th className="py-2.5 pr-4 font-medium">IP Address</th>
                <th className="py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-500">
                    {new Date(h.timestamp).toLocaleString('id-ID')}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-slate-800">{h.username}</td>
                  <td className="py-2.5 pr-4 uppercase text-slate-600">{h.role}</td>
                  <td className="py-2.5 pr-4 font-mono text-slate-500">{h.ip_address}</td>
                  <td className="py-2.5">
                    <span className={h.status === 'success' ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                      {h.status === 'success' ? 'Berhasil' : 'Gagal'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
