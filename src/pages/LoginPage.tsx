import React, { useState } from 'react';
import { Eye, EyeOff, Lock, LogIn, ShieldCheck, User } from 'lucide-react';
import { useFirebase } from '../components/FirebaseProvider';
import { apiFetch } from '../lib/api';
import { syncUserProfileToFirestore } from '../lib/firebase';
import type { UserAccount, UserRole } from '../types';

export interface LoginSuccessPayload {
  token: string;
  auto_logout_minutes: number;
  permissions: string[];
  user: UserAccount;
}

interface LoginPageProps {
  schoolInfo: {
    school_name: string;
    school_logo: string;
    academic_year: string;
    semester: string;
  };
  onLoginSuccess: (payload: LoginSuccessPayload) => void;
}

const DEMO_ACCOUNTS: Array<{
  roleLabel: string;
  role: UserRole;
  identifier: string;
  password: string;
  note: string;
}> = [
  { roleLabel: 'Administrator', role: 'admin', identifier: 'admin', password: 'admin123', note: 'Akses penuh sistem' },
  { roleLabel: 'Guru Mapel', role: 'guru', identifier: 'guru.mtk', password: 'guru123', note: 'Bank soal & nilai' },
  { roleLabel: 'Pengawas', role: 'pengawas', identifier: 'pengawas1', password: 'pengawas123', note: 'Monitoring real-time' },
  { roleLabel: 'Siswa (IX-A)', role: 'siswa', identifier: '2409001', password: 'siswa123', note: 'Ujian CBT aktif' },
];

export const LoginPage: React.FC<LoginPageProps> = ({ schoolInfo, onLoginSuccess }) => {
  const { signInWithGoogle } = useFirebase();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [imgError, setImgError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<LoginSuccessPayload>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      onLoginSuccess(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      const idToken = await fbUser.getIdToken();
      const res = await apiFetch<LoginSuccessPayload>('/api/auth/firebase-google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      await syncUserProfileToFirestore(res.user, fbUser).catch(() => {});
      onLoginSuccess(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk dengan akun Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-stretch">
      {/* Left Visual Split Panel */}
      <div className="hidden lg:flex lg:w-[46%] relative bg-[#0A192F] text-white overflow-hidden flex-col justify-between p-10">
        {!imgError ? (
          <img
            src="/src/assets/images/login_campus_panel_1794761880939.jpg"
            alt="Ruang Ujian Digital SMP Negeri 41 Muaro Jambi"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F]/90 via-[#0A192F]/75 to-[#061021]/95" />

        <div className="relative z-10 flex items-center gap-3.5">
          {!logoError ? (
            <img
              src={schoolInfo.school_logo || '/logo-smpn41-muaro-jambi.svg'}
              alt={`Logo ${schoolInfo.school_name}`}
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="h-14 w-14 rounded-xl object-contain bg-white p-1 border border-white/20 shrink-0"
            />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-lg">
              41
            </div>
          )}
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">{schoolInfo.school_name}</p>
            <p className="text-xs text-slate-300">
              Tahun Pelajaran {schoolInfo.academic_year} · Semester {schoolInfo.semester}
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-5">
          <h1 className="text-3xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
            SMART CBT – Digital Examination System
          </h1>
          <p className="text-sm text-slate-200 leading-relaxed">
            Platform evaluasi akademik terpadu berbasis komputer dengan pengacakan soal otomatis,
            pencatatan log aktivitas peserta, penilaian objektif real-time, dan analisis kualitas butir soal.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/15">
            <div>
              <p className="text-xs text-slate-300">Keamanan Sesi</p>
              <p className="text-sm font-semibold text-white mt-0.5">Token & Fokus Browser</p>
            </div>
            <div>
              <p className="text-xs text-slate-300">Tipe Evaluasi</p>
              <p className="text-sm font-semibold text-white mt-0.5">6 Jenis Soal & Rubrik</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-400 space-y-1">
          <div>Kabupaten Muaro Jambi · Provinsi Jambi</div>
          <div className="text-slate-300 font-medium">
            © {new Date().getFullYear()} Tri Ramadhani Putra · Hak Cipta Dilindungi
          </div>
        </div>
      </div>

      {/* Right Login Form Panel */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16 bg-white">
        <div className="w-full max-w-md mx-auto">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img
              src={schoolInfo.school_logo || '/logo-smpn41-muaro-jambi.svg'}
              alt={`Logo ${schoolInfo.school_name}`}
              referrerPolicy="no-referrer"
              className="h-12 w-12 rounded-xl object-contain bg-white p-1 border border-slate-200 shrink-0"
            />
            <div>
              <p className="text-sm font-bold text-slate-900">SMART CBT</p>
              <p className="text-xs text-slate-500">{schoolInfo.school_name}</p>
            </div>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Masuk ke Portal Ujian</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Gunakan Username, NIS (Siswa), atau NIP (Guru/Pengawas/Admin) beserta kata sandi Anda.
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-identifier" className="block text-sm font-medium text-slate-700 mb-1.5">
                Username / NIS / NIP
              </label>
              <div className="relative">
                <User className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Contoh: 2409001 atau guru.mtk"
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Tampilkan atau sembunyikan kata sandi"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {loading ? 'Memverifikasi Akun...' : 'Masuk Sistem'}
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase">
                <span className="bg-white px-2 text-slate-400">atau</span>
              </div>
            </div>

            <button
              type="button"
              disabled={loading || googleLoading}
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              {googleLoading ? 'Menghubungkan Google...' : 'Masuk dengan Google (Admin Firebase)'}
            </button>
          </form>

          {/* Quick Account Switcher for Evaluation */}
          <div className="mt-8 pt-6 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-3">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <span>Akses Cepat Uji Peran (Klik untuk isi otomatis)</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => {
                    setIdentifier(acc.identifier);
                    setPassword(acc.password);
                    setError('');
                  }}
                  className="text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900">{acc.roleLabel}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {acc.identifier} · {acc.note}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:hidden mt-8 pt-4 border-t border-slate-100 text-xs text-slate-500">
            © {new Date().getFullYear()} Tri Ramadhani Putra · Hak Cipta Dilindungi
          </div>
        </div>
      </div>
    </div>
  );
};
