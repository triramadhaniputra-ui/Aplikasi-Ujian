import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarClock,
  Check,
  ClipboardList,
  Cloud,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Radio,
  School,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from './components/FirebaseProvider';
import { apiFetch, getAuthToken, setAuthToken, subscribeApiMutations } from './lib/api';
import { ToastContainer, type ToastMessage } from './components/ConfirmModal';
import { LoginPage, type LoginSuccessPayload } from './pages/LoginPage';
import { DashboardOverview } from './pages/DashboardOverview';
import { UsersManager } from './pages/UsersManager';
import { MasterDataPage } from './pages/MasterDataPage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { ExamSchedulerPage } from './pages/ExamSchedulerPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { ResultsAnalyticsPage } from './pages/ResultsAnalyticsPage';
import { ItemAnalysisPage } from './pages/ItemAnalysisPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsProfilePage } from './pages/SettingsProfilePage';
import { StudentExamPortal } from './pages/StudentExamPortal';
import type { UserAccount, UserRole } from './types';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'guru', 'pengawas'] },
  { id: 'guru', label: 'Data Guru', icon: Users, roles: ['admin'] },
  { id: 'siswa', label: 'Data Siswa', icon: GraduationCap, roles: ['admin'] },
  { id: 'kelas', label: 'Data Kelas', icon: School, roles: ['admin'] },
  { id: 'mapel', label: 'Mata Pelajaran', icon: BookOpen, roles: ['admin'] },
  { id: 'bank_soal', label: 'Bank Soal', icon: FileText, roles: ['admin', 'guru'] },
  { id: 'jadwal_ujian', label: 'Jadwal Ujian', icon: CalendarClock, roles: ['admin', 'guru'] },
  { id: 'monitoring', label: 'Monitoring Ujian', icon: Radio, roles: ['admin', 'guru', 'pengawas'] },
  { id: 'hasil_ujian', label: 'Hasil Ujian', icon: Award, roles: ['admin', 'guru'] },
  { id: 'analisis_butir', label: 'Analisis Butir Soal', icon: BarChart3, roles: ['admin', 'guru'] },
  { id: 'laporan', label: 'Laporan', icon: FileSpreadsheet, roles: ['admin', 'guru'] },
  { id: 'pengaturan', label: 'Pengaturan Sistem', icon: Settings, roles: ['admin'] },
  { id: 'ujian_siswa', label: 'Daftar Ujian', icon: ClipboardList, roles: ['siswa'] },
  { id: 'hasil_siswa', label: 'Hasil Ujian Saya', icon: Award, roles: ['siswa'] },
  { id: 'profil', label: 'Profil & Akun', icon: UserCircle, roles: ['admin', 'guru', 'pengawas', 'siswa'] },
];

export default function App() {
  const {
    firebaseUser,
    autoCloudSave,
    cloudSaveStatus,
    saveFullToCloud,
  } = useFirebase();

  const [schoolInfo, setSchoolInfo] = useState({
    school_name: 'SMP Negeri 41 Muaro Jambi',
    school_logo: '/logo-smpn41-muaro-jambi.svg',
    academic_year: '2026/2027',
    semester: 'Ganjil',
  });
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState<number>(90);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [examRunnerActive, setExamRunnerActive] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const idleTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  const pushToast = (type: 'success' | 'error', text: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const loadSchoolInfo = async () => {
    try {
      const info = await apiFetch<typeof schoolInfo>('/api/public/school-info');
      setSchoolInfo(info);
    } catch {
      // keep defaults
    }
  };

  const logout = (reason?: string) => {
    setAuthToken(null);
    setCurrentUser(null);
    setExamRunnerActive(false);
    if (reason) pushToast('error', reason);
  };

  const restoreSession = async () => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    try {
      const res = await apiFetch<{ user: UserAccount; auto_logout_minutes: number }>('/api/auth/me');
      setCurrentUser(res.user);
      setAutoLogoutMinutes(res.auto_logout_minutes || 90);
      setActiveTab(res.user.role === 'siswa' ? 'ujian_siswa' : 'dashboard');
    } catch {
      setAuthToken(null);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    loadSchoolInfo();
    restoreSession();
  }, []);

  // Auto-logout when session idle exceeds configured minutes
  useEffect(() => {
    if (!currentUser) return;
    const resetIdleTimer = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        logout('Sesi Anda berakhir otomatis karena tidak ada aktivitas.');
      }, Math.max(5, autoLogoutMinutes) * 60 * 1000);
    };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
    };
  }, [currentUser?.id, autoLogoutMinutes]);

  // Auto-save full database to Cloud Firestore whenever an admin mutates data
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin' || !firebaseUser || !autoCloudSave) return;
    const unsub = subscribeApiMutations(() => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        saveFullToCloud(currentUser.full_name).catch(() => {
          // Error is already logged & reflected in cloudSaveStatus
        });
      }, 2500);
    });
    return () => {
      unsub();
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.full_name, firebaseUser?.uid, autoCloudSave, saveFullToCloud]);

  const handleQuickCloudSave = async () => {
    if (!currentUser) return;
    if (!firebaseUser) {
      setActiveTab('pengaturan');
      pushToast('error', 'Hubungkan akun Google di Pengaturan Sistem untuk mengaktifkan simpan penuh ke Cloud.');
      return;
    }
    try {
      const res = await saveFullToCloud(currentUser.full_name);
      pushToast('success', `Seluruh data (${res.totalRecords} baris) berhasil disimpan ke Cloud Firestore.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Gagal menyimpan data ke Cloud Firestore.');
    }
  };

  const handleLoginSuccess = (payload: LoginSuccessPayload) => {
    setAuthToken(payload.token);
    setCurrentUser(payload.user);
    setAutoLogoutMinutes(payload.auto_logout_minutes || 90);
    setActiveTab(payload.user.role === 'siswa' ? 'ujian_siswa' : 'dashboard');
    pushToast('success', `Selamat datang, ${payload.user.full_name}.`);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        Memuat sesi SMART CBT...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginPage schoolInfo={schoolInfo} onLoginSuccess={handleLoginSuccess} />
        <ToastContainer
          toasts={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
      </>
    );
  }

  // Distraction-free exam mode hides sidebar and header completely
  if (examRunnerActive && currentUser.role === 'siswa') {
    return (
      <>
        <StudentExamPortal
          activeSection="ujian_siswa"
          onExamActiveChange={setExamRunnerActive}
          onToast={pushToast}
        />
        <ToastContainer
          toasts={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
      </>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(currentUser.role));
  const currentNavLabel = visibleNav.find((n) => n.id === activeTab)?.label || 'Dashboard';

  const roleBadgeLabel: Record<UserRole, string> = {
    admin: 'Administrator',
    guru: 'Guru Mapel',
    pengawas: 'Pengawas Ujian',
    siswa: 'Peserta Didik',
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardOverview role={currentUser.role} onNavigate={setActiveTab} />;
      case 'guru':
        return <UsersManager mode="guru" onToast={pushToast} />;
      case 'siswa':
        return <UsersManager mode="siswa" onToast={pushToast} />;
      case 'kelas':
        return <MasterDataPage mode="kelas" onToast={pushToast} />;
      case 'mapel':
        return <MasterDataPage mode="mapel" onToast={pushToast} />;
      case 'bank_soal':
        return <QuestionBankPage onToast={pushToast} />;
      case 'jadwal_ujian':
        return <ExamSchedulerPage onToast={pushToast} />;
      case 'monitoring':
        return <MonitoringPage onToast={pushToast} />;
      case 'hasil_ujian':
        return <ResultsAnalyticsPage onToast={pushToast} />;
      case 'analisis_butir':
        return <ItemAnalysisPage onToast={pushToast} />;
      case 'laporan':
        return <ReportsPage schoolName={schoolInfo.school_name} onToast={pushToast} />;
      case 'pengaturan':
        return (
          <SettingsProfilePage
            mode="pengaturan"
            currentUser={currentUser}
            onUserUpdated={restoreSession}
            onSettingsUpdated={loadSchoolInfo}
            onToast={pushToast}
          />
        );
      case 'profil':
        return (
          <SettingsProfilePage
            mode="profil"
            currentUser={currentUser}
            onUserUpdated={restoreSession}
            onSettingsUpdated={loadSchoolInfo}
            onToast={pushToast}
          />
        );
      case 'ujian_siswa':
      case 'hasil_siswa':
        return (
          <StudentExamPortal
            activeSection={activeTab}
            onExamActiveChange={setExamRunnerActive}
            onToast={pushToast}
          />
        );
      default:
        return <DashboardOverview role={currentUser.role} onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Navy Sidebar */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col bg-[#0A192F] text-white shrink-0 no-print">
        <div className="p-5 border-b border-white/10 flex items-center gap-3">
          <img
            src={schoolInfo.school_logo}
            alt={`Logo ${schoolInfo.school_name}`}
            referrerPolicy="no-referrer"
            className="h-11 w-11 rounded-xl bg-white object-contain p-1 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-white truncate">SMART CBT</div>
            <div className="text-[11px] text-slate-300 truncate">{schoolInfo.school_name}</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-white truncate">{currentUser.full_name}</div>
            <div className="text-slate-400">
              {roleBadgeLabel[currentUser.role]} · {currentUser.nip_nis}
            </div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 bg-white/5 hover:bg-red-600 hover:text-white transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Keluar Sistem
          </button>
          <div className="pt-2 border-t border-white/10 text-[11px] leading-relaxed text-slate-400">
            <div>© {new Date().getFullYear()} Tri Ramadhani Putra</div>
            <div className="text-[10px] text-slate-500">Hak Cipta Dilindungi</div>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-[#0A192F] text-white flex flex-col h-full z-10">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src={schoolInfo.school_logo}
                  alt={`Logo ${schoolInfo.school_name}`}
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded-lg bg-white p-1 object-contain"
                />
                <span className="text-sm font-bold">SMART CBT</span>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                      active ? 'bg-[#2563EB] text-white' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/10 space-y-3">
              <button
                type="button"
                onClick={() => logout()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white"
              >
                <LogOut className="h-4 w-4" />
                Keluar Sistem
              </button>
              <div className="pt-2 border-t border-white/10 text-[11px] leading-relaxed text-slate-400">
                <div>© {new Date().getFullYear()} Tri Ramadhani Putra</div>
                <div className="text-[10px] text-slate-500">Hak Cipta Dilindungi</div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Buka menu navigasi"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src={schoolInfo.school_logo}
              alt={`Logo ${schoolInfo.school_name}`}
              referrerPolicy="no-referrer"
              className="lg:hidden h-9 w-9 rounded-lg bg-white border border-slate-200 p-0.5 object-contain shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs text-slate-400 truncate">
                {schoolInfo.school_name} / {currentNavLabel}
              </div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 truncate">
                {currentNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {currentUser.role === 'admin' && (
              <button
                type="button"
                onClick={handleQuickCloudSave}
                disabled={cloudSaveStatus === 'saving'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  cloudSaveStatus === 'saving'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : firebaseUser
                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                }`}
                title="Simpan seluruh data aplikasi ke Cloud Firestore"
              >
                {cloudSaveStatus === 'saving' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : cloudSaveStatus === 'saved' && firebaseUser ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Cloud className="h-3.5 w-3.5" />
                )}
                <span className="hidden md:inline">
                  {cloudSaveStatus === 'saving'
                    ? 'Menyimpan...'
                    : cloudSaveStatus === 'saved' && firebaseUser
                    ? 'Tersimpan Cloud'
                    : 'Simpan Data'}
                </span>
              </button>
            )}
            <div className="hidden sm:block text-right">
              <div className="text-xs font-semibold text-slate-900">{currentUser.full_name}</div>
              <div className="text-[11px] text-slate-500">
                {roleBadgeLabel[currentUser.role]} · TA {schoolInfo.academic_year} ({schoolInfo.semester})
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('profil')}
              className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 flex items-center justify-center transition-colors"
              title="Profil & Pengaturan Akun"
            >
              <UserCircle className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {renderContent()}
        </main>
      </div>

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
