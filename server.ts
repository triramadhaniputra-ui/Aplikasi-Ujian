import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initDatabase,
  DEFAULT_ROLE_PERMISSIONS,
} from './src/server/db.ts';
import {
  hashPassword,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from './src/server/auth.ts';
import {
  evaluateAnswer,
  calculateFinalGrade,
  isStudentAnswerBlank,
} from './src/server/grading.ts';
import {
  computeItemAnalysis,
  computeMedian,
  type ExamQuestionMeta,
  type AttemptAnswerRecord,
} from './src/server/analytics.ts';
import { parseWordDocumentBuffer } from './src/server/wordParser.ts';
import type { QuestionType, UserRole } from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface WSClientMeta {
  ws: WebSocket;
  userId: number;
  role: UserRole;
  attemptId?: number;
}

const wsClients = new Set<WSClientMeta>();

function broadcastMonitorEvent(event: string, payload: unknown): void {
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of wsClients) {
    if (
      client.ws.readyState === WebSocket.OPEN &&
      (client.role === 'admin' || client.role === 'pengawas' || client.role === 'guru')
    ) {
      client.ws.send(message);
    }
  }
}

function sendToAttemptClient(attemptId: number, event: string, payload: unknown): void {
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.ws.readyState === WebSocket.OPEN && client.attemptId === attemptId) {
      client.ws.send(message);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const attemptParam = url.searchParams.get('attemptId');
  const auth = verifyAuthToken(token);

  if (!auth) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const meta: WSClientMeta = {
    ws,
    userId: auth.userId,
    role: auth.role,
    attemptId: attemptParam ? Number(attemptParam) : undefined,
  };
  wsClients.add(meta);

  ws.send(
    JSON.stringify({
      event: 'ws:connected',
      payload: { userId: auth.userId, role: auth.role },
      timestamp: new Date().toISOString(),
    })
  );

  ws.on('close', () => {
    wsClients.delete(meta);
  });
});

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getSystemSettingsRow() {
  const row = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<string, unknown>;
  return {
    school_name: String(row.school_name),
    school_logo: String(row.school_logo),
    academic_year: String(row.academic_year),
    semester: String(row.semester),
    default_kkm: Number(row.default_kkm),
    default_duration: Number(row.default_duration),
    auto_logout_minutes: Number(row.auto_logout_minutes),
    require_webcam: Boolean(row.require_webcam),
    max_violations: Number(row.max_violations),
    tab_switch_detection: Boolean(row.tab_switch_detection),
    allow_token_auto_rotate: Boolean(row.allow_token_auto_rotate),
    notifications_enabled: Boolean(row.notifications_enabled),
    role_permissions: parseJsonSafe(
      String(row.role_permissions_json),
      DEFAULT_ROLE_PERMISSIONS
    ),
  };
}

function recalculateAttemptGrade(attemptId: number): void {
  const attempt = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId) as
    | Record<string, unknown>
    | undefined;
  if (!attempt) return;

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id) as
    | Record<string, unknown>
    | undefined;
  if (!exam) return;

  const qOrder = parseJsonSafe<number[]>(String(attempt.question_order_json), []);
  const rows = db
    .prepare(
      `SELECT q.id, q.type, q.weight, eq.custom_weight, sa.answer_json, sa.is_correct, sa.earned_score
       FROM questions q
       LEFT JOIN exam_questions eq ON eq.question_id = q.id AND eq.exam_id = ?
       LEFT JOIN student_answers sa ON sa.question_id = q.id AND sa.attempt_id = ?
       WHERE q.id IN (${qOrder.length > 0 ? qOrder.map(() => '?').join(',') : '-1'})`
    )
    .all(attempt.exam_id, attemptId, ...qOrder) as Array<Record<string, unknown>>;

  let totalScore = 0;
  let maxScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  let allEssaysGraded = true;

  for (const r of rows) {
    const w = r.custom_weight !== null && r.custom_weight !== undefined ? Number(r.custom_weight) : Number(r.weight);
    maxScore += w;
    totalScore += Number(r.earned_score ?? 0);

    const parsedAns = r.answer_json ? parseJsonSafe<unknown>(String(r.answer_json), null) : null;
    if (isStudentAnswerBlank(parsedAns)) {
      blankCount += 1;
    } else if (r.type === 'esai' && r.is_correct === null) {
      allEssaysGraded = false;
    } else if (Number(r.is_correct) === 1) {
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  const finalGrade = calculateFinalGrade(totalScore, maxScore);
  const kkm = Number(exam.kkm ?? 75);
  const isPassed = finalGrade >= kkm ? 1 : 0;

  db.prepare(
    `UPDATE exam_attempts
     SET total_score = ?, max_score = ?, final_grade = ?,
         correct_count = ?, wrong_count = ?, blank_count = ?,
         is_passed = ?, essay_graded = ?
     WHERE id = ?`
  ).run(
    Math.round(totalScore * 100) / 100,
    Math.round(maxScore * 100) / 100,
    finalGrade,
    correctCount,
    wrongCount,
    blankCount,
    isPassed,
    allEssaysGraded ? 1 : 0,
    attemptId
  );
}

// =======================
// 1. AUTHENTICATION & PROFILE
// =======================
app.get('/api/public/school-info', (_req, res) => {
  const s = getSystemSettingsRow();
  res.json({
    school_name: s.school_name,
    school_logo: s.school_logo,
    academic_year: s.academic_year,
    semester: s.semester,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };
  if (!identifier || !password) {
    res.status(400).json({ error: 'Username/NIS/NIP dan password wajib diisi.' });
    return;
  }

  const cleanId = identifier.trim();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const ua = String(req.headers['user-agent'] || 'Browser');
  const now = new Date().toISOString();

  const user = db
    .prepare(
      `SELECT u.*, c.name AS class_name
       FROM users u
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE u.username = ? OR u.nip_nis = ?`
    )
    .get(cleanId, cleanId) as Record<string, unknown> | undefined;

  if (!user || !verifyPassword(password, String(user.password_hash))) {
    db.prepare(
      `INSERT INTO login_history (user_id, username, role, ip_address, user_agent, status, timestamp)
       VALUES (?, ?, ?, ?, ?, 'failed', ?)`
    ).run(user ? Number(user.id) : null, cleanId, user ? String(user.role) : 'unknown', ip, ua, now);
    res.status(401).json({ error: 'Username/NIS/NIP atau password salah.' });
    return;
  }

  if (user.status !== 'aktif') {
    db.prepare(
      `INSERT INTO login_history (user_id, username, role, ip_address, user_agent, status, timestamp)
       VALUES (?, ?, ?, ?, ?, 'failed', ?)`
    ).run(Number(user.id), String(user.username), String(user.role), ip, ua, now);
    res.status(403).json({ error: 'Akun Anda berstatus nonaktif. Hubungi administrator sekolah.' });
    return;
  }

  const settings = getSystemSettingsRow();
  const token = signAuthToken(
    {
      userId: Number(user.id),
      username: String(user.username),
      role: user.role as UserRole,
    },
    Math.max(30, settings.auto_logout_minutes)
  );

  db.prepare(
    `INSERT INTO login_history (user_id, username, role, ip_address, user_agent, status, timestamp)
     VALUES (?, ?, ?, ?, ?, 'success', ?)`
  ).run(Number(user.id), String(user.username), String(user.role), ip, ua, now);

  res.json({
    token,
    auto_logout_minutes: settings.auto_logout_minutes,
    permissions: settings.role_permissions[user.role as UserRole] || [],
    user: {
      id: Number(user.id),
      username: String(user.username),
      role: String(user.role),
      full_name: String(user.full_name),
      nip_nis: String(user.nip_nis),
      class_id: user.class_id ? Number(user.class_id) : null,
      class_name: user.class_name ? String(user.class_name) : undefined,
      subject_ids: parseJsonSafe<number[]>(String(user.subject_ids_json), []),
      status: String(user.status),
      photo_url: String(user.photo_url || ''),
      created_at: String(user.created_at),
    },
  });
});

app.post('/api/auth/firebase-google', async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ error: 'Token Firebase tidak ditemukan.' });
    return;
  }

  let apiKey = '';
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
    apiKey = cfg.apiKey || '';
  } catch {
    res.status(500).json({ error: 'Konfigurasi Firebase server belum tersedia.' });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: 'API Key Firebase tidak ditemukan.' });
    return;
  }

  try {
    const verifyResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    const verifyData = (await verifyResp.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean; displayName?: string }>;
    };
    const fbUser = verifyData.users?.[0];
    if (!verifyResp.ok || !fbUser?.email || !fbUser.emailVerified) {
      res.status(401).json({ error: 'Akun Google tidak valid atau email belum terverifikasi.' });
      return;
    }

    const emailLower = fbUser.email.toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ua = String(req.headers['user-agent'] || 'Browser');
    const now = new Date().toISOString();

    let user: Record<string, unknown> | undefined;
    if (emailLower === 'triramadhaniputra@gmail.com') {
      user = db
        .prepare(
          `SELECT u.*, c.name AS class_name
           FROM users u
           LEFT JOIN classes c ON c.id = u.class_id
           WHERE u.username = 'admin' AND u.role = 'admin'`
        )
        .get() as Record<string, unknown> | undefined;
    }

    if (!user) {
      res.status(403).json({
        error: `Email Google (${fbUser.email}) belum ditautkan ke akun administrator sekolah. Silakan masuk menggunakan Username / NIP / NIS.`,
      });
      return;
    }

    if (user.status !== 'aktif') {
      res.status(403).json({ error: 'Akun Anda berstatus nonaktif.' });
      return;
    }

    const settings = getSystemSettingsRow();
    const token = signAuthToken(
      {
        userId: Number(user.id),
        username: String(user.username),
        role: user.role as UserRole,
      },
      Math.max(30, settings.auto_logout_minutes)
    );

    db.prepare(
      `INSERT INTO login_history (user_id, username, role, ip_address, user_agent, status, timestamp)
       VALUES (?, ?, ?, ?, ?, 'success', ?)`
    ).run(Number(user.id), String(user.username), String(user.role), ip, ua, now);

    res.json({
      token,
      auto_logout_minutes: settings.auto_logout_minutes,
      permissions: settings.role_permissions[user.role as UserRole] || [],
      user: {
        id: Number(user.id),
        username: String(user.username),
        role: String(user.role),
        full_name: String(user.full_name),
        nip_nis: String(user.nip_nis),
        class_id: user.class_id ? Number(user.class_id) : null,
        class_name: user.class_name ? String(user.class_name) : undefined,
        subject_ids: parseJsonSafe<number[]>(String(user.subject_ids_json), []),
        status: String(user.status),
        photo_url: String(user.photo_url || ''),
        created_at: String(user.created_at),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Gagal memverifikasi sesi Google Firebase.' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = db
    .prepare(
      `SELECT u.*, c.name AS class_name
       FROM users u
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE u.id = ?`
    )
    .get(req.authUser!.userId) as Record<string, unknown> | undefined;

  if (!user) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  const settings = getSystemSettingsRow();
  res.json({
    permissions: settings.role_permissions[user.role as UserRole] || [],
    auto_logout_minutes: settings.auto_logout_minutes,
    user: {
      id: Number(user.id),
      username: String(user.username),
      role: String(user.role),
      full_name: String(user.full_name),
      nip_nis: String(user.nip_nis),
      class_id: user.class_id ? Number(user.class_id) : null,
      class_name: user.class_name ? String(user.class_name) : undefined,
      subject_ids: parseJsonSafe<number[]>(String(user.subject_ids_json), []),
      status: String(user.status),
      photo_url: String(user.photo_url || ''),
      created_at: String(user.created_at),
    },
  });
});

app.put('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const { full_name, photo_url } = req.body as { full_name?: string; photo_url?: string };
  if (!full_name || !full_name.trim()) {
    res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
    return;
  }
  db.prepare('UPDATE users SET full_name = ?, photo_url = ? WHERE id = ?').run(
    full_name.trim(),
    photo_url ?? '',
    req.authUser!.userId
  );
  res.json({ success: true });
});

app.put('/api/auth/password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };
  if (!old_password || !new_password || new_password.length < 6) {
    res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
    return;
  }
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUser!.userId) as
    | { password_hash: string }
    | undefined;
  if (!user || !verifyPassword(old_password, user.password_hash)) {
    res.status(400).json({ error: 'Password lama tidak sesuai.' });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(new_password),
    req.authUser!.userId
  );
  res.json({ success: true });
});

app.get('/api/auth/login-history', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.authUser!.role === 'admin') {
    const rows = db.prepare('SELECT * FROM login_history ORDER BY id DESC LIMIT 100').all();
    res.json(rows);
  } else {
    const rows = db
      .prepare('SELECT * FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT 50')
      .all(req.authUser!.userId);
    res.json(rows);
  }
});

// =======================
// 2. DASHBOARD SUMMARY
// =======================
app.get('/api/dashboard/summary', requireAuth, requireRole('admin', 'guru', 'pengawas'), (_req, res) => {
  const totalStudents = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'siswa' AND status = 'aktif'").get() as { c: number }).c;
  const totalTeachers = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'guru' AND status = 'aktif'").get() as { c: number }).c;
  const totalSubjects = (db.prepare('SELECT COUNT(*) AS c FROM subjects').get() as { c: number }).c;
  const totalQuestions = (db.prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number }).c;
  const activeExams = (db.prepare("SELECT COUNT(*) AS c FROM exams WHERE status = 'aktif'").get() as { c: number }).c;
  const finishedExams = (db.prepare("SELECT COUNT(*) AS c FROM exams WHERE status = 'selesai'").get() as { c: number }).c;

  const studentsInExam = (
    db.prepare("SELECT COUNT(DISTINCT student_id) AS c FROM exam_attempts WHERE status IN ('sedang_mengerjakan', 'terindikasi_pelanggaran')").get() as { c: number }
  ).c;

  // Eligible students in active exams who haven't started yet
  const activeExamRows = db.prepare("SELECT id, class_ids_json FROM exams WHERE status = 'aktif'").all() as Array<{
    id: number;
    class_ids_json: string;
  }>;
  let studentsNotStarted = 0;
  const notStartedSet = new Set<string>();
  for (const ex of activeExamRows) {
    const cids = parseJsonSafe<number[]>(ex.class_ids_json, []);
    if (cids.length === 0) continue;
    const eligible = db
      .prepare(`SELECT id FROM users WHERE role = 'siswa' AND status = 'aktif' AND class_id IN (${cids.map(() => '?').join(',')})`)
      .all(...cids) as Array<{ id: number }>;
    const attempted = new Set(
      (db.prepare('SELECT DISTINCT student_id FROM exam_attempts WHERE exam_id = ?').all(ex.id) as Array<{ student_id: number }>).map(
        (r) => r.student_id
      )
    );
    for (const s of eligible) {
      if (!attempted.has(s.id)) {
        notStartedSet.add(`${ex.id}:${s.id}`);
      }
    }
  }
  studentsNotStarted = notStartedSet.size;

  const avgRow = db
    .prepare("SELECT AVG(final_grade) AS avg_grade, COUNT(*) AS finished_attempts FROM exam_attempts WHERE status = 'selesai'")
    .get() as { avg_grade: number | null; finished_attempts: number };

  const recentViolations = db
    .prepare(
      `SELECT v.*, u.full_name AS student_name, u.nip_nis AS student_nis, c.name AS class_name, e.title AS exam_title
       FROM violation_logs v
       JOIN users u ON u.id = v.student_id
       LEFT JOIN classes c ON c.id = u.class_id
       JOIN exams e ON e.id = v.exam_id
       ORDER BY v.id DESC LIMIT 12`
    )
    .all();

  const suspiciousCount = (
    db.prepare("SELECT COUNT(*) AS c FROM exam_attempts WHERE flagged_for_review = 1 OR violation_count >= 3").get() as { c: number }
  ).c;

  // Real exam activity per exam
  const examStats = db
    .prepare(
      `SELECT e.id, e.title, s.code AS subject_code, s.name AS subject_name,
              COUNT(CASE WHEN ea.status = 'selesai' THEN 1 END) AS completed_count,
              COUNT(CASE WHEN ea.status IN ('sedang_mengerjakan', 'terindikasi_pelanggaran') THEN 1 END) AS ongoing_count,
              ROUND(AVG(CASE WHEN ea.status = 'selesai' THEN ea.final_grade END), 1) AS avg_grade
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       LEFT JOIN exam_attempts ea ON ea.exam_id = e.id
       GROUP BY e.id
       ORDER BY e.id DESC LIMIT 8`
    )
    .all();

  res.json({
    stats: {
      total_students: totalStudents,
      total_teachers: totalTeachers,
      total_subjects: totalSubjects,
      total_questions: totalQuestions,
      active_exams: activeExams,
      finished_exams: finishedExams,
      students_in_exam: studentsInExam,
      students_not_started: studentsNotStarted,
      average_grade: avgRow.avg_grade !== null ? Math.round(avgRow.avg_grade * 10) / 10 : null,
      finished_attempts: avgRow.finished_attempts,
      suspicious_count: suspiciousCount,
    },
    exam_stats: examStats,
    recent_violations: recentViolations,
  });
});

// =======================
// 3. CLASSES & SUBJECTS
// =======================
app.get('/api/classes', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.full_name AS homeroom_teacher_name,
              (SELECT COUNT(*) FROM users s WHERE s.class_id = c.id AND s.role = 'siswa') AS student_count
       FROM classes c
       LEFT JOIN users u ON u.id = c.homeroom_teacher_id
       ORDER BY c.grade_level ASC, c.name ASC`
    )
    .all();
  res.json(rows);
});

app.post('/api/classes', requireAuth, requireRole('admin'), (req, res) => {
  const { name, grade_level, homeroom_teacher_id } = req.body as {
    name?: string;
    grade_level?: number;
    homeroom_teacher_id?: number | null;
  };
  if (!name || !grade_level) {
    res.status(400).json({ error: 'Nama kelas dan tingkat wajib diisi.' });
    return;
  }
  try {
    const info = db
      .prepare('INSERT INTO classes (name, grade_level, homeroom_teacher_id) VALUES (?, ?, ?)')
      .run(name.trim(), Number(grade_level), homeroom_teacher_id || null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Nama kelas sudah terdaftar.' });
  }
});

app.put('/api/classes/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { name, grade_level, homeroom_teacher_id } = req.body as {
    name?: string;
    grade_level?: number;
    homeroom_teacher_id?: number | null;
  };
  db.prepare('UPDATE classes SET name = ?, grade_level = ?, homeroom_teacher_id = ? WHERE id = ?').run(
    String(name || '').trim(),
    Number(grade_level || 7),
    homeroom_teacher_id || null,
    Number(req.params.id)
  );
  res.json({ success: true });
});

app.delete('/api/classes/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM classes WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

app.get('/api/subjects', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM subjects ORDER BY name ASC').all();
  res.json(rows);
});

app.post('/api/subjects', requireAuth, requireRole('admin'), (req, res) => {
  const { code, name, kkm } = req.body as { code?: string; name?: string; kkm?: number };
  if (!code || !name) {
    res.status(400).json({ error: 'Kode dan nama mata pelajaran wajib diisi.' });
    return;
  }
  try {
    const info = db
      .prepare('INSERT INTO subjects (code, name, kkm) VALUES (?, ?, ?)')
      .run(code.trim().toUpperCase(), name.trim(), Number(kkm || 75));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Kode mata pelajaran sudah digunakan.' });
  }
});

app.put('/api/subjects/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { code, name, kkm } = req.body as { code?: string; name?: string; kkm?: number };
  db.prepare('UPDATE subjects SET code = ?, name = ?, kkm = ? WHERE id = ?').run(
    String(code || '').trim().toUpperCase(),
    String(name || '').trim(),
    Number(kkm || 75),
    Number(req.params.id)
  );
  res.json({ success: true });
});

app.delete('/api/subjects/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// =======================
// 4. USERS (SISWA, GURU, PENGAWAS, ADMIN)
// =======================
app.get('/api/users', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const { role, class_id, search } = req.query as {
    role?: string;
    class_id?: string;
    search?: string;
  };
  let sql = `
    SELECT u.id, u.username, u.role, u.full_name, u.nip_nis, u.class_id, c.name AS class_name,
           u.subject_ids_json, u.status, u.photo_url, u.created_at
    FROM users u
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (role && role !== 'all') {
    sql += ' AND u.role = ?';
    params.push(role);
  }
  if (class_id && class_id !== 'all') {
    sql += ' AND u.class_id = ?';
    params.push(Number(class_id));
  }
  if (search && search.trim()) {
    sql += ' AND (u.full_name LIKE ? OR u.username LIKE ? OR u.nip_nis LIKE ?)';
    const like = `%${search.trim()}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY u.role ASC, u.full_name ASC';

  const rows = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    subject_ids: parseJsonSafe<number[]>(String(r.subject_ids_json), []),
  }));
  res.json(rows);
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, role, full_name, nip_nis, class_id, subject_ids, status } = req.body as {
    username?: string;
    password?: string;
    role?: UserRole;
    full_name?: string;
    nip_nis?: string;
    class_id?: number | null;
    subject_ids?: number[];
    status?: 'aktif' | 'nonaktif';
  };
  if (!username || !password || !role || !full_name || !nip_nis) {
    res.status(400).json({ error: 'Lengkapi seluruh data wajib pengguna.' });
    return;
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, role, full_name, nip_nis, class_id, subject_ids_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        username.trim(),
        hashPassword(password),
        role,
        full_name.trim(),
        nip_nis.trim(),
        class_id || null,
        JSON.stringify(subject_ids || []),
        status || 'aktif',
        new Date().toISOString()
      );
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Username sudah terdaftar.' });
  }
});

app.post('/api/users/import', requireAuth, requireRole('admin'), (req, res) => {
  const { rows } = req.body as {
    rows?: Array<{
      nis?: string;
      nip?: string;
      nama?: string;
      kelas?: string;
      mapel?: string;
      username?: string;
      password?: string;
      status?: string;
      role?: UserRole;
    }>;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'Data impor kosong.' });
    return;
  }

  const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: number; name: string }>;
  const classMap = new Map(classes.map((c) => [c.name.trim().toUpperCase(), c.id]));

  const subjects = db.prepare('SELECT id, code, name FROM subjects').all() as Array<{
    id: number;
    code: string;
    name: string;
  }>;
  const subjectLookup = new Map<string, number>();
  for (const s of subjects) {
    subjectLookup.set(s.code.trim().toUpperCase(), s.id);
    subjectLookup.set(s.name.trim().toUpperCase(), s.id);
  }

  const allowedRoles: UserRole[] = ['admin', 'guru', 'pengawas', 'siswa'];

  const insertStmt = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, nip_nis, class_id, subject_ids_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const item of rows) {
      const rawIdentifier = String(item.nip ?? item.nis ?? '').trim();
      const uname = String(item.username || rawIdentifier || '').trim();
      const fname = String(item.nama || '').trim();
      const nipNis = rawIdentifier || uname;
      if (!uname || !fname) {
        skipped += 1;
        continue;
      }

      const requestedRole = String(item.role || 'siswa').trim().toLowerCase() as UserRole;
      const resolvedRole: UserRole = allowedRoles.includes(requestedRole) ? requestedRole : 'siswa';

      const clsId =
        resolvedRole === 'siswa' && item.kelas
          ? classMap.get(String(item.kelas).trim().toUpperCase()) ?? null
          : null;

      const resolvedSubjectIds: number[] = [];
      if (resolvedRole === 'guru' && item.mapel) {
        const tokens = String(item.mapel)
          .split(/[,;|]+/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
        for (const tok of tokens) {
          const sid = subjectLookup.get(tok);
          if (sid && !resolvedSubjectIds.includes(sid)) {
            resolvedSubjectIds.push(sid);
          }
        }
      }

      const defaultPass =
        resolvedRole === 'guru'
          ? 'guru123'
          : resolvedRole === 'pengawas'
          ? 'pengawas123'
          : resolvedRole === 'admin'
          ? 'admin123'
          : 'siswa123';
      const rawPassword = String(item.password ?? '').trim() || defaultPass;

      try {
        insertStmt.run(
          uname,
          hashPassword(rawPassword),
          resolvedRole,
          fname,
          nipNis,
          clsId,
          JSON.stringify(resolvedSubjectIds),
          String(item.status || 'aktif').trim().toLowerCase() === 'nonaktif' ? 'nonaktif' : 'aktif',
          now
        );
        inserted += 1;
      } catch {
        skipped += 1;
      }
    }
  });
  tx();

  res.json({ inserted, skipped });
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const { username, password, role, full_name, nip_nis, class_id, subject_ids, status } = req.body as {
    username?: string;
    password?: string;
    role?: UserRole;
    full_name?: string;
    nip_nis?: string;
    class_id?: number | null;
    subject_ids?: number[];
    status?: 'aktif' | 'nonaktif';
  };
  try {
    db.prepare(
      `UPDATE users SET username = ?, role = ?, full_name = ?, nip_nis = ?, class_id = ?, subject_ids_json = ?, status = ?
       WHERE id = ?`
    ).run(
      String(username || '').trim(),
      role || 'siswa',
      String(full_name || '').trim(),
      String(nip_nis || '').trim(),
      class_id || null,
      JSON.stringify(subject_ids || []),
      status || 'aktif',
      id
    );
    if (password && password.trim().length >= 6) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password.trim()), id);
    }
    res.json({ success: true });
  } catch {
    res.status(409).json({ error: 'Username bertabrakan dengan pengguna lain.' });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.authUser!.userId) {
    res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang login.' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ success: true });
});

// =======================
// 5. BANK SOAL DIGITAL
// =======================
app.get('/api/questions', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const { subject_id, grade_level, difficulty, type, topic, search } = req.query as Record<string, string>;
  let sql = `
    SELECT q.*, s.name AS subject_name, s.code AS subject_code
    FROM questions q
    JOIN subjects s ON s.id = q.subject_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (subject_id && subject_id !== 'all') {
    sql += ' AND q.subject_id = ?';
    params.push(Number(subject_id));
  }
  if (grade_level && grade_level !== 'all') {
    sql += ' AND q.grade_level = ?';
    params.push(Number(grade_level));
  }
  if (difficulty && difficulty !== 'all') {
    sql += ' AND q.difficulty = ?';
    params.push(difficulty);
  }
  if (type && type !== 'all') {
    sql += ' AND q.type = ?';
    params.push(type);
  }
  if (topic && topic.trim()) {
    sql += ' AND q.topic LIKE ?';
    params.push(`%${topic.trim()}%`);
  }
  if (search && search.trim()) {
    sql += ' AND (q.prompt LIKE ? OR q.topic LIKE ?)';
    const like = `%${search.trim()}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY q.id DESC';

  const rows = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    subject_id: Number(r.subject_id),
    subject_name: String(r.subject_name),
    subject_code: String(r.subject_code),
    grade_level: Number(r.grade_level),
    topic: String(r.topic),
    type: String(r.type),
    difficulty: String(r.difficulty),
    weight: Number(r.weight),
    prompt: String(r.prompt),
    media_type: String(r.media_type),
    media_url: String(r.media_url),
    options: parseJsonSafe(String(r.options_json), []),
    correct_answer: parseJsonSafe(String(r.correct_answer_json), ''),
    scoring_rule: parseJsonSafe(String(r.scoring_rule_json), {}),
    explanation: String(r.explanation),
    created_by: Number(r.created_by),
    created_at: String(r.created_at),
  }));
  res.json(rows);
});

app.post('/api/questions', requireAuth, requireRole('admin', 'guru'), (req: AuthenticatedRequest, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.subject_id || !body.prompt || !body.type) {
    res.status(400).json({ error: 'Mata pelajaran, jenis soal, dan isi pertanyaan wajib diisi.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO questions (
        subject_id, grade_level, topic, type, difficulty, weight, prompt,
        media_type, media_url, options_json, correct_answer_json, scoring_rule_json,
        explanation, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(body.subject_id),
      Number(body.grade_level || 9),
      String(body.topic || 'Umum').trim(),
      String(body.type),
      String(body.difficulty || 'sedang'),
      Number(body.weight || 1),
      String(body.prompt),
      String(body.media_type || 'none'),
      String(body.media_url || ''),
      JSON.stringify(body.options || []),
      JSON.stringify(body.correct_answer ?? ''),
      JSON.stringify(body.scoring_rule || {}),
      String(body.explanation || ''),
      req.authUser!.userId,
      new Date().toISOString()
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.post('/api/questions/:id/duplicate', requireAuth, requireRole('admin', 'guru'), (req: AuthenticatedRequest, res) => {
  const orig = db.prepare('SELECT * FROM questions WHERE id = ?').get(Number(req.params.id)) as
    | Record<string, unknown>
    | undefined;
  if (!orig) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO questions (
        subject_id, grade_level, topic, type, difficulty, weight, prompt,
        media_type, media_url, options_json, correct_answer_json, scoring_rule_json,
        explanation, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orig.subject_id,
      orig.grade_level,
      orig.topic,
      orig.type,
      orig.difficulty,
      orig.weight,
      `${orig.prompt} (Salinan)`,
      orig.media_type,
      orig.media_url,
      orig.options_json,
      orig.correct_answer_json,
      orig.scoring_rule_json,
      orig.explanation,
      req.authUser!.userId,
      new Date().toISOString()
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.post('/api/questions/parse-word', requireAuth, requireRole('admin', 'guru'), async (req, res) => {
  const { fileName, fileBase64 } = req.body as { fileName?: string; fileBase64?: string };
  if (!fileBase64) {
    res.status(400).json({ error: 'Berkas Word tidak ditemukan.' });
    return;
  }
  try {
    const cleanBase64 = fileBase64.includes(',') ? fileBase64.split(',').pop() || '' : fileBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    // Detect legacy binary Word 97-2003 (.doc OLE2 magic bytes D0 CF 11 E0)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0
    ) {
      res.status(400).json({
        error:
          'Format .doc lama (Word 97-2003) belum didukung langsung. Silakan simpan ulang dokumen di Microsoft Word sebagai .docx.',
      });
      return;
    }

    const questions = await parseWordDocumentBuffer(buffer, fileName || 'soal.docx');
    if (questions.length === 0) {
      res.status(400).json({
        error:
          'Tidak ada soal yang terdeteksi dalam berkas Word. Pastikan setiap soal diawali nomor (contoh: 1. Pertanyaan...) atau format tabel soal.',
      });
      return;
    }

    res.json({ count: questions.length, questions });
  } catch (err) {
    console.error('Parse Word error:', err);
    res.status(400).json({
      error: 'Gagal membaca berkas Word. Pastikan berkas berformat .docx yang valid.',
    });
  }
});

app.post('/api/questions/import', requireAuth, requireRole('admin', 'guru'), (req: AuthenticatedRequest, res) => {
  const { items } = req.body as { items?: Array<Record<string, unknown>> };
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Tidak ada data soal untuk diimpor.' });
    return;
  }
  const subjects = db.prepare('SELECT id, code, name FROM subjects').all() as Array<{
    id: number;
    code: string;
    name: string;
  }>;
  const subByCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s.id]));
  const subByName = new Map(subjects.map((s) => [s.name.toLowerCase(), s.id]));

  const stmt = db.prepare(`
    INSERT INTO questions (
      subject_id, grade_level, topic, type, difficulty, weight, prompt,
      media_type, media_url, options_json, correct_answer_json, scoring_rule_json,
      explanation, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const item of items) {
      let subjectId = Number(item.subject_id || 0);
      if (!subjectId && item.subject_code) {
        subjectId = subByCode.get(String(item.subject_code).trim().toUpperCase()) || 0;
      }
      if (!subjectId && item.subject_name) {
        subjectId = subByName.get(String(item.subject_name).trim().toLowerCase()) || 0;
      }
      if (!subjectId && subjects.length > 0) subjectId = subjects[0].id;
      if (!item.prompt || !subjectId) continue;

      const mediaType =
        item.media_type === 'image' || item.media_type === 'audio' || item.media_type === 'video'
          ? item.media_type
          : 'none';
      const mediaUrl = mediaType !== 'none' ? String(item.media_url || '') : '';

      stmt.run(
        subjectId,
        Number(item.grade_level || 9),
        String(item.topic || 'Umum'),
        String(item.type || 'pg'),
        String(item.difficulty || 'sedang'),
        Number(item.weight || 1),
        String(item.prompt),
        mediaType,
        mediaUrl,
        JSON.stringify(item.options || []),
        JSON.stringify(item.correct_answer ?? ''),
        JSON.stringify(item.scoring_rule || {}),
        String(item.explanation || ''),
        req.authUser!.userId,
        now
      );
      inserted += 1;
    }
  });
  tx();

  res.json({ inserted });
});

app.put('/api/questions/:id', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const body = req.body as Record<string, unknown>;
  db.prepare(
    `UPDATE questions
     SET subject_id = ?, grade_level = ?, topic = ?, type = ?, difficulty = ?, weight = ?,
         prompt = ?, media_type = ?, media_url = ?, options_json = ?, correct_answer_json = ?,
         scoring_rule_json = ?, explanation = ?
     WHERE id = ?`
  ).run(
    Number(body.subject_id),
    Number(body.grade_level || 9),
    String(body.topic || 'Umum').trim(),
    String(body.type),
    String(body.difficulty || 'sedang'),
    Number(body.weight || 1),
    String(body.prompt),
    String(body.media_type || 'none'),
    String(body.media_url || ''),
    JSON.stringify(body.options || []),
    JSON.stringify(body.correct_answer ?? ''),
    JSON.stringify(body.scoring_rule || {}),
    String(body.explanation || ''),
    Number(req.params.id)
  );
  res.json({ success: true });
});

app.delete('/api/questions/:id', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// =======================
// 6. EXAMS & SCHEDULING
// =======================
app.get('/api/exams', requireAuth, requireRole('admin', 'guru', 'pengawas'), (_req, res) => {
  const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: number; name: string }>;
  const classNameMap = new Map(classes.map((c) => [c.id, c.name]));

  const rows = db
    .prepare(
      `SELECT e.*, s.name AS subject_name, s.code AS subject_code, u.full_name AS teacher_name,
              (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS assigned_question_count
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN users u ON u.id = e.teacher_id
       ORDER BY e.id DESC`
    )
    .all() as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => {
      const classIds = parseJsonSafe<number[]>(String(r.class_ids_json), []);
      return {
        id: Number(r.id),
        title: String(r.title),
        subject_id: Number(r.subject_id),
        subject_name: String(r.subject_name),
        subject_code: String(r.subject_code),
        teacher_id: Number(r.teacher_id),
        teacher_name: String(r.teacher_name),
        class_ids: classIds,
        class_names: classIds.map((id) => classNameMap.get(id) || `Kelas ${id}`),
        exam_date: String(r.exam_date),
        start_time: String(r.start_time),
        end_time: String(r.end_time),
        duration_minutes: Number(r.duration_minutes),
        question_count: Number(r.question_count),
        kkm: Number(r.kkm),
        token: String(r.token),
        exam_password: String(r.exam_password),
        max_attempts: Number(r.max_attempts),
        shuffle_questions: Boolean(r.shuffle_questions),
        shuffle_options: Boolean(r.shuffle_options),
        allow_navigation: Boolean(r.allow_navigation),
        allow_back: Boolean(r.allow_back),
        show_result_after: Boolean(r.show_result_after),
        require_webcam: Boolean(r.require_webcam),
        status: String(r.status),
        created_at: String(r.created_at),
        assigned_question_count: Number(r.assigned_question_count),
      };
    })
  );
});

app.post('/api/exams', requireAuth, requireRole('admin', 'guru'), (req: AuthenticatedRequest, res) => {
  const b = req.body as Record<string, unknown>;
  if (!b.title || !b.subject_id || !b.exam_date || !b.start_time || !b.end_time) {
    res.status(400).json({ error: 'Judul, mata pelajaran, tanggal, dan jam ujian wajib diisi.' });
    return;
  }
  const token =
    String(b.token || '')
      .trim()
      .toUpperCase() || crypto.randomBytes(3).toString('hex').toUpperCase();

  const teacherId = Number(b.teacher_id || req.authUser!.userId);
  const info = db
    .prepare(
      `INSERT INTO exams (
        title, subject_id, teacher_id, class_ids_json, exam_date, start_time, end_time,
        duration_minutes, question_count, kkm, token, exam_password, max_attempts,
        shuffle_questions, shuffle_options, allow_navigation, allow_back, show_result_after,
        require_webcam, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.title).trim(),
      Number(b.subject_id),
      teacherId,
      JSON.stringify(b.class_ids || []),
      String(b.exam_date),
      String(b.start_time),
      String(b.end_time),
      Number(b.duration_minutes || 60),
      Number(b.question_count || 10),
      Number(b.kkm || 75),
      token,
      String(b.exam_password || ''),
      Number(b.max_attempts || 1),
      b.shuffle_questions ? 1 : 0,
      b.shuffle_options ? 1 : 0,
      b.allow_navigation !== false ? 1 : 0,
      b.allow_back !== false ? 1 : 0,
      b.show_result_after !== false ? 1 : 0,
      b.require_webcam ? 1 : 0,
      String(b.status || 'aktif'),
      new Date().toISOString()
    );

  const examId = Number(info.lastInsertRowid);

  // If explicit question_ids or auto_pick config provided
  if (Array.isArray(b.question_ids) && b.question_ids.length > 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO exam_questions (exam_id, question_id, order_index) VALUES (?, ?, ?)');
    (b.question_ids as number[]).forEach((qid, idx) => ins.run(examId, Number(qid), idx + 1));
  } else if (b.auto_pick) {
    const cfg = b.auto_pick as { difficulty?: string; count?: number };
    const diff = cfg.difficulty && cfg.difficulty !== 'all' ? cfg.difficulty : null;
    const count = Number(cfg.count || b.question_count || 10);
    const pool = (
      diff
        ? db.prepare('SELECT id FROM questions WHERE subject_id = ? AND difficulty = ?').all(Number(b.subject_id), diff)
        : db.prepare('SELECT id FROM questions WHERE subject_id = ?').all(Number(b.subject_id))
    ) as Array<{ id: number }>;
    const picked = shuffleArray(pool).slice(0, count);
    const ins = db.prepare('INSERT OR IGNORE INTO exam_questions (exam_id, question_id, order_index) VALUES (?, ?, ?)');
    picked.forEach((p, idx) => ins.run(examId, p.id, idx + 1));
  }

  res.status(201).json({ id: examId, token });
});

app.put('/api/exams/:id', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  db.prepare(
    `UPDATE exams
     SET title = ?, subject_id = ?, teacher_id = ?, class_ids_json = ?, exam_date = ?,
         start_time = ?, end_time = ?, duration_minutes = ?, question_count = ?, kkm = ?,
         token = ?, exam_password = ?, max_attempts = ?, shuffle_questions = ?, shuffle_options = ?,
         allow_navigation = ?, allow_back = ?, show_result_after = ?, require_webcam = ?, status = ?
     WHERE id = ?`
  ).run(
    String(b.title).trim(),
    Number(b.subject_id),
    Number(b.teacher_id),
    JSON.stringify(b.class_ids || []),
    String(b.exam_date),
    String(b.start_time),
    String(b.end_time),
    Number(b.duration_minutes || 60),
    Number(b.question_count || 10),
    Number(b.kkm || 75),
    String(b.token || '').trim().toUpperCase(),
    String(b.exam_password || ''),
    Number(b.max_attempts || 1),
    b.shuffle_questions ? 1 : 0,
    b.shuffle_options ? 1 : 0,
    b.allow_navigation ? 1 : 0,
    b.allow_back ? 1 : 0,
    b.show_result_after ? 1 : 0,
    b.require_webcam ? 1 : 0,
    String(b.status || 'aktif'),
    id
  );
  res.json({ success: true });
});

app.post('/api/exams/:id/rotate-token', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const token = crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('UPDATE exams SET token = ? WHERE id = ?').run(token, Number(req.params.id));
  res.json({ token });
});

app.get('/api/exams/:id/questions', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT eq.order_index, eq.custom_weight, q.*, s.name AS subject_name
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       JOIN subjects s ON s.id = q.subject_id
       WHERE eq.exam_id = ?
       ORDER BY eq.order_index ASC`
    )
    .all(Number(req.params.id)) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      order_index: Number(r.order_index),
      custom_weight: r.custom_weight !== null ? Number(r.custom_weight) : null,
      weight: Number(r.weight),
      subject_id: Number(r.subject_id),
      subject_name: String(r.subject_name),
      topic: String(r.topic),
      type: String(r.type),
      difficulty: String(r.difficulty),
      prompt: String(r.prompt),
      options: parseJsonSafe(String(r.options_json), []),
    }))
  );
});

app.put('/api/exams/:id/questions', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const examId = Number(req.params.id);
  const { items, auto_pick } = req.body as {
    items?: Array<{ question_id: number; custom_weight?: number | null }>;
    auto_pick?: { subject_id: number; difficulty?: string; count: number };
  };

  let finalItems = items || [];
  if (auto_pick) {
    const pool = (
      auto_pick.difficulty && auto_pick.difficulty !== 'all'
        ? db
            .prepare('SELECT id FROM questions WHERE subject_id = ? AND difficulty = ?')
            .all(auto_pick.subject_id, auto_pick.difficulty)
        : db.prepare('SELECT id FROM questions WHERE subject_id = ?').all(auto_pick.subject_id)
    ) as Array<{ id: number }>;
    finalItems = shuffleArray(pool)
      .slice(0, Number(auto_pick.count || 10))
      .map((p) => ({ question_id: p.id, custom_weight: null }));
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(examId);
    const ins = db.prepare(
      'INSERT INTO exam_questions (exam_id, question_id, order_index, custom_weight) VALUES (?, ?, ?, ?)'
    );
    finalItems.forEach((it, idx) => {
      ins.run(examId, Number(it.question_id), idx + 1, it.custom_weight ?? null);
    });
    db.prepare('UPDATE exams SET question_count = ? WHERE id = ?').run(finalItems.length, examId);
  });
  tx();

  res.json({ assigned_count: finalItems.length });
});

app.delete('/api/exams/:id', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  db.prepare('DELETE FROM exams WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// =======================
// 7. STUDENT EXAM PORTAL (PROTECTED KEYS & ANTI-CHEAT)
// =======================
app.get('/api/student/exams', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const student = db.prepare('SELECT id, class_id FROM users WHERE id = ?').get(req.authUser!.userId) as {
    id: number;
    class_id: number | null;
  };
  const exams = db
    .prepare(
      `SELECT e.*, s.name AS subject_name, s.code AS subject_code, u.full_name AS teacher_name,
              (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS actual_question_count
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN users u ON u.id = e.teacher_id
       WHERE e.status != 'draft'
       ORDER BY e.exam_date DESC, e.start_time ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const now = new Date();
  const available = exams
    .filter((ex) => {
      const classIds = parseJsonSafe<number[]>(String(ex.class_ids_json), []);
      return student.class_id !== null && classIds.includes(student.class_id);
    })
    .map((ex) => {
      const attempts = db
        .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY attempt_number DESC')
        .all(Number(ex.id), student.id) as Array<Record<string, unknown>>;
      const activeAttempt = attempts.find(
        (a) => a.status === 'sedang_mengerjakan' || a.status === 'terindikasi_pelanggaran'
      );
      const startDt = new Date(`${ex.exam_date}T${ex.start_time}:00`);
      const endDt = new Date(`${ex.exam_date}T${ex.end_time}:59`);
      let scheduleState: 'open' | 'upcoming' | 'closed' = 'open';
      if (ex.status === 'selesai' || now > endDt) scheduleState = 'closed';
      else if (now < startDt) scheduleState = 'upcoming';

      return {
        id: Number(ex.id),
        title: String(ex.title),
        subject_name: String(ex.subject_name),
        subject_code: String(ex.subject_code),
        teacher_name: String(ex.teacher_name),
        exam_date: String(ex.exam_date),
        start_time: String(ex.start_time),
        end_time: String(ex.end_time),
        duration_minutes: Number(ex.duration_minutes),
        question_count: Number(ex.actual_question_count || ex.question_count),
        kkm: Number(ex.kkm),
        has_password: Boolean(ex.exam_password),
        max_attempts: Number(ex.max_attempts),
        attempts_used: attempts.length,
        active_attempt_id: activeAttempt ? Number(activeAttempt.id) : null,
        last_attempt: attempts[0]
          ? {
              id: Number(attempts[0].id),
              status: String(attempts[0].status),
              final_grade: ex.show_result_after ? Number(attempts[0].final_grade) : null,
              is_passed: ex.show_result_after ? Boolean(attempts[0].is_passed) : null,
            }
          : null,
        require_webcam: Boolean(ex.require_webcam),
        show_result_after: Boolean(ex.show_result_after),
        schedule_state: scheduleState,
      };
    });

  res.json(available);
});

app.post('/api/student/exams/:id/start', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const examId = Number(req.params.id);
  const studentId = req.authUser!.userId;
  const { token, exam_password, webcam_snapshot, browser_session_key } = req.body as {
    token?: string;
    exam_password?: string;
    webcam_snapshot?: string;
    browser_session_key?: string;
  };

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as Record<string, unknown> | undefined;
  if (!exam || exam.status === 'draft') {
    res.status(404).json({ error: 'Ujian tidak ditemukan atau belum dipublikasikan.' });
    return;
  }

  const student = db.prepare('SELECT id, class_id, full_name, nip_nis FROM users WHERE id = ?').get(studentId) as {
    id: number;
    class_id: number | null;
    full_name: string;
    nip_nis: string;
  };
  const classIds = parseJsonSafe<number[]>(String(exam.class_ids_json), []);
  if (!student.class_id || !classIds.includes(student.class_id)) {
    res.status(403).json({ error: 'Anda tidak terdaftar pada kelas peserta ujian ini.' });
    return;
  }

  // Schedule window enforcement
  const now = new Date();
  const startDt = new Date(`${exam.exam_date}T${exam.start_time}:00`);
  const endDt = new Date(`${exam.exam_date}T${exam.end_time}:59`);
  if (now < startDt) {
    res.status(403).json({ error: `Ujian belum dimulai. Jadwal dibuka pada ${exam.exam_date} pukul ${exam.start_time}.` });
    return;
  }
  if (exam.status === 'selesai' || now > endDt) {
    res.status(403).json({ error: 'Waktu pelaksanaan ujian telah berakhir.' });
    return;
  }

  // Check if already has active attempt
  const existingActive = db
    .prepare(
      `SELECT * FROM exam_attempts
       WHERE exam_id = ? AND student_id = ? AND status IN ('sedang_mengerjakan', 'terindikasi_pelanggaran')
       ORDER BY id DESC LIMIT 1`
    )
    .get(examId, studentId) as Record<string, unknown> | undefined;

  if (existingActive) {
    if (existingActive.proctor_action === 'diskualifikasi' || existingActive.proctor_action === 'hentikan_sementara') {
      res.status(403).json({
        error: 'Sesi ujian Anda sedang dihentikan sementara oleh pengawas. Hubungi pengawas ruangan.',
      });
      return;
    }
    // Single active session enforcement
    const incomingKey = browser_session_key || '';
    if (existingActive.session_token && incomingKey && existingActive.session_token !== incomingKey) {
      db.prepare(
        `INSERT INTO violation_logs (attempt_id, exam_id, student_id, event_type, severity, description, created_at)
         VALUES (?, ?, ?, 'session_conflict', 'warning_2', ?, ?)`
      ).run(
        Number(existingActive.id),
        examId,
        studentId,
        'Terdeteksi upaya membuka sesi ujian dari perangkat/tab lain secara bersamaan.',
        now.toISOString()
      );
    }
    // Validate token still matches for resumption if entered
    if (token && token.trim().toUpperCase() !== String(exam.token).toUpperCase()) {
      res.status(400).json({ error: 'Token ujian tidak valid.' });
      return;
    }
    res.json({
      attempt_id: Number(existingActive.id),
      session_token: String(existingActive.session_token),
      resumed: true,
    });
    return;
  }

  // Verify token & password for fresh attempt
  if (!token || token.trim().toUpperCase() !== String(exam.token).toUpperCase()) {
    res.status(400).json({ error: 'Token ujian salah. Periksa kembali token dari pengawas.' });
    return;
  }
  if (exam.exam_password && String(exam.exam_password) !== String(exam_password || '')) {
    res.status(400).json({ error: 'Password ujian salah.' });
    return;
  }

  const pastAttempts = (
    db.prepare('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ? AND student_id = ?').get(examId, studentId) as {
      c: number;
    }
  ).c;
  if (pastAttempts >= Number(exam.max_attempts)) {
    res.status(403).json({ error: `Anda telah mencapai batas maksimal percobaan (${exam.max_attempts}x).` });
    return;
  }

  // Gather exam questions
  const assignedRows = db
    .prepare(
      `SELECT q.id, q.type, q.options_json
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = ?
       ORDER BY eq.order_index ASC`
    )
    .all(examId) as Array<{ id: number; type: QuestionType; options_json: string }>;

  if (assignedRows.length === 0) {
    res.status(400).json({ error: 'Ujian ini belum memiliki daftar soal.' });
    return;
  }

  const orderedQuestions = exam.shuffle_questions ? shuffleArray(assignedRows) : assignedRows;
  const qIds = orderedQuestions.map((q) => q.id);

  // Per-student option shuffle map (preserves original keys so grading remains exact!)
  const optionOrders: Record<string, string[]> = {};
  if (exam.shuffle_options) {
    for (const q of orderedQuestions) {
      if (q.type === 'pg' || q.type === 'pg_kompleks') {
        const opts = parseJsonSafe<Array<{ key: string }>>(q.options_json, []);
        optionOrders[String(q.id)] = shuffleArray(opts.map((o) => o.key));
      }
    }
  }

  const sessionToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + Number(exam.duration_minutes) * 60 * 1000);
  const clampedExpires = expiresAt > endDt ? endDt : expiresAt;

  const info = db
    .prepare(
      `INSERT INTO exam_attempts (
        exam_id, student_id, session_token, attempt_number, status,
        started_at, expires_at, question_order_json, option_orders_json,
        webcam_verified, webcam_snapshot_url
      ) VALUES (?, ?, ?, ?, 'sedang_mengerjakan', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      examId,
      studentId,
      sessionToken,
      pastAttempts + 1,
      now.toISOString(),
      clampedExpires.toISOString(),
      JSON.stringify(qIds),
      JSON.stringify(optionOrders),
      webcam_snapshot ? 1 : 0,
      webcam_snapshot || ''
    );

  const attemptId = Number(info.lastInsertRowid);
  broadcastMonitorEvent('attempt:started', {
    attempt_id: attemptId,
    exam_id: examId,
    student_id: studentId,
    student_name: student.full_name,
  });

  res.status(201).json({
    attempt_id: attemptId,
    session_token: sessionToken,
    resumed: false,
  });
});

app.get('/api/student/attempts/:attemptId', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const attemptId = Number(req.params.attemptId);
  const sessionToken = String(req.headers['x-exam-session'] || req.query.session_token || '');

  const attempt = db
    .prepare(
      `SELECT ea.*, e.title AS exam_title, e.duration_minutes, e.allow_navigation, e.allow_back,
              e.show_result_after, e.require_webcam, e.kkm, s.name AS subject_name,
              u.full_name AS student_name, u.nip_nis AS student_nis, c.name AS class_name
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
       JOIN subjects s ON s.id = e.subject_id
       JOIN users u ON u.id = ea.student_id
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE ea.id = ? AND ea.student_id = ?`
    )
    .get(attemptId, req.authUser!.userId) as Record<string, unknown> | undefined;

  if (!attempt) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }

  if (attempt.status === 'selesai') {
    res.status(409).json({ error: 'Ujian ini telah selesai dikumpulkan.', finished: true });
    return;
  }

  if (sessionToken && attempt.session_token && sessionToken !== attempt.session_token) {
    res.status(409).json({
      error: 'Sesi ujian aktif berada di tab/perangkat lain. Satu peserta hanya diizinkan 1 sesi aktif.',
      session_conflict: true,
    });
    return;
  }

  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(String(attempt.expires_at)).getTime() - Date.now()) / 1000)
  );

  const qOrder = parseJsonSafe<number[]>(String(attempt.question_order_json), []);
  const optionOrders = parseJsonSafe<Record<string, string[]>>(String(attempt.option_orders_json), {});

  const qRows = db
    .prepare(
      `SELECT q.id, q.type, q.topic, q.difficulty, q.weight, q.prompt, q.media_type, q.media_url, q.options_json,
              eq.custom_weight
       FROM questions q
       LEFT JOIN exam_questions eq ON eq.question_id = q.id AND eq.exam_id = ?
       WHERE q.id IN (${qOrder.length > 0 ? qOrder.map(() => '?').join(',') : '-1'})`
    )
    .all(attempt.exam_id, ...qOrder) as Array<Record<string, unknown>>;

  const qMap = new Map(qRows.map((r) => [Number(r.id), r]));

  // IMPORTANT: Never expose correct_answer, scoring_rule, or explanation!
  const questions = qOrder
    .map((qid) => qMap.get(qid))
    .filter((q): q is Record<string, unknown> => Boolean(q))
    .map((q, index) => {
      const qid = Number(q.id);
      let options = parseJsonSafe<Array<Record<string, unknown>>>(String(q.options_json), []);
      const customOrder = optionOrders[String(qid)];
      if (Array.isArray(customOrder) && customOrder.length > 0) {
        const byKey = new Map(options.map((o) => [String(o.key), o]));
        options = customOrder.map((k) => byKey.get(k)).filter((o): o is Record<string, unknown> => Boolean(o));
      }
      // For menjodohkan, also provide shuffled right choices separately so student matches left -> right!
      let rightChoices: string[] | undefined;
      if (q.type === 'menjodohkan') {
        rightChoices = shuffleArray(options.map((o) => String(o.right)));
        options = options.map((o) => ({ id: o.id, left: o.left }));
      }
      return {
        index: index + 1,
        id: qid,
        type: String(q.type),
        topic: String(q.topic),
        weight: q.custom_weight !== null && q.custom_weight !== undefined ? Number(q.custom_weight) : Number(q.weight),
        prompt: String(q.prompt),
        media_type: String(q.media_type),
        media_url: String(q.media_url),
        options,
        right_choices: rightChoices,
      };
    });

  const savedRows = db
    .prepare('SELECT question_id, answer_json, is_marked FROM student_answers WHERE attempt_id = ?')
    .all(attemptId) as Array<{ question_id: number; answer_json: string | null; is_marked: number }>;
  const savedAnswers: Record<number, { answer: unknown; is_marked: boolean }> = {};
  for (const s of savedRows) {
    savedAnswers[s.question_id] = {
      answer: s.answer_json ? parseJsonSafe(s.answer_json, null) : null,
      is_marked: Boolean(s.is_marked),
    };
  }

  const settings = getSystemSettingsRow();
  res.json({
    attempt: {
      id: Number(attempt.id),
      exam_id: Number(attempt.exam_id),
      exam_title: String(attempt.exam_title),
      subject_name: String(attempt.subject_name),
      student_name: String(attempt.student_name),
      student_nis: String(attempt.student_nis),
      class_name: String(attempt.class_name || '-'),
      allow_navigation: Boolean(attempt.allow_navigation),
      allow_back: Boolean(attempt.allow_back),
      require_webcam: Boolean(attempt.require_webcam),
      violation_count: Number(attempt.violation_count),
      proctor_action: String(attempt.proctor_action),
      proctor_notes: String(attempt.proctor_notes),
      remaining_seconds: remainingSeconds,
      max_violations: settings.max_violations,
      tab_switch_detection: settings.tab_switch_detection,
    },
    questions,
    saved_answers: savedAnswers,
  });
});

app.put('/api/student/attempts/:attemptId/answer', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const attemptId = Number(req.params.attemptId);
  const { question_id, answer, is_marked, session_token } = req.body as {
    question_id?: number;
    answer?: unknown;
    is_marked?: boolean;
    session_token?: string;
  };

  const attempt = db
    .prepare('SELECT * FROM exam_attempts WHERE id = ? AND student_id = ?')
    .get(attemptId, req.authUser!.userId) as Record<string, unknown> | undefined;

  if (!attempt || attempt.status === 'selesai') {
    res.status(409).json({ error: 'Sesi ujian sudah berakhir.' });
    return;
  }
  if (session_token && attempt.session_token !== session_token) {
    res.status(409).json({ error: 'Konflik sesi aktif.' });
    return;
  }
  if (attempt.proctor_action === 'hentikan_sementara' || attempt.proctor_action === 'diskualifikasi') {
    res.status(403).json({ error: 'Sesi ujian dihentikan oleh pengawas.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO student_answers (attempt_id, question_id, answer_json, is_marked, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET answer_json = excluded.answer_json, is_marked = excluded.is_marked, updated_at = excluded.updated_at`
  ).run(attemptId, Number(question_id), JSON.stringify(answer ?? null), is_marked ? 1 : 0, now);

  const answeredCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM student_answers
         WHERE attempt_id = ? AND answer_json IS NOT NULL AND answer_json != 'null' AND answer_json != '""' AND answer_json != '[]' AND answer_json != '{}'`
      )
      .get(attemptId) as { c: number }
  ).c;

  broadcastMonitorEvent('attempt:updated', {
    attempt_id: attemptId,
    exam_id: Number(attempt.exam_id),
    answered_count: answeredCount,
  });

  res.json({ success: true, saved_at: now, answered_count: answeredCount });
});

app.post('/api/student/attempts/:attemptId/violation', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const attemptId = Number(req.params.attemptId);
  const { event_type, description, evidence_image } = req.body as {
    event_type?: string;
    description?: string;
    evidence_image?: string;
  };

  const attempt = db
    .prepare('SELECT * FROM exam_attempts WHERE id = ? AND student_id = ?')
    .get(attemptId, req.authUser!.userId) as Record<string, unknown> | undefined;

  if (!attempt || attempt.status === 'selesai') {
    res.json({ ignored: true });
    return;
  }

  const newCount = Number(attempt.violation_count) + 1;
  const settings = getSystemSettingsRow();
  const severity =
    newCount === 1 ? 'warning_1' : newCount === 2 ? 'warning_2' : 'warning_3';
  const flagged = newCount >= settings.max_violations ? 1 : Number(attempt.flagged_for_review);
  const newStatus = flagged ? 'terindikasi_pelanggaran' : String(attempt.status);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO violation_logs (attempt_id, exam_id, student_id, event_type, severity, description, evidence_image, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    attemptId,
    Number(attempt.exam_id),
    req.authUser!.userId,
    String(event_type || 'tab_switch'),
    severity,
    String(description || 'Peserta meninggalkan fokus jendela ujian.'),
    String(evidence_image || ''),
    now
  );

  db.prepare(
    'UPDATE exam_attempts SET violation_count = ?, flagged_for_review = ?, status = ? WHERE id = ?'
  ).run(newCount, flagged, newStatus, attemptId);

  broadcastMonitorEvent('violation:logged', {
    attempt_id: attemptId,
    exam_id: Number(attempt.exam_id),
    student_id: req.authUser!.userId,
    violation_count: newCount,
    severity,
    flagged: Boolean(flagged),
    description,
    created_at: now,
  });

  res.json({
    violation_count: newCount,
    severity,
    flagged_for_review: Boolean(flagged),
  });
});

app.post('/api/student/attempts/:attemptId/finish', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const attemptId = Number(req.params.attemptId);
  const studentId = req.authUser!.userId;

  const attempt = db
    .prepare('SELECT * FROM exam_attempts WHERE id = ? AND student_id = ?')
    .get(attemptId, studentId) as Record<string, unknown> | undefined;

  if (!attempt) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id) as Record<string, unknown>;
  const qOrder = parseJsonSafe<number[]>(String(attempt.question_order_json), []);
  const questions = db
    .prepare(
      `SELECT q.*, eq.custom_weight
       FROM questions q
       LEFT JOIN exam_questions eq ON eq.question_id = q.id AND eq.exam_id = ?
       WHERE q.id IN (${qOrder.length > 0 ? qOrder.map(() => '?').join(',') : '-1'})`
    )
    .all(attempt.exam_id, ...qOrder) as Array<Record<string, unknown>>;

  const answers = db
    .prepare('SELECT * FROM student_answers WHERE attempt_id = ?')
    .all(attemptId) as Array<Record<string, unknown>>;
  const ansMap = new Map(answers.map((a) => [Number(a.question_id), a]));

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const q of questions) {
      const qid = Number(q.id);
      const weight = q.custom_weight !== null && q.custom_weight !== undefined ? Number(q.custom_weight) : Number(q.weight);
      const saved = ansMap.get(qid);
      const studentAnswer = saved?.answer_json ? parseJsonSafe(String(saved.answer_json), null) : null;
      const correctAnswer = parseJsonSafe(String(q.correct_answer_json), '');
      const scoringRule = parseJsonSafe(String(q.scoring_rule_json), {});

      const evalRes = evaluateAnswer({
        type: String(q.type) as QuestionType,
        weight,
        correctAnswer,
        scoringRule,
        studentAnswer,
      });

      db.prepare(
        `INSERT INTO student_answers (attempt_id, question_id, answer_json, is_marked, is_correct, earned_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET is_correct = excluded.is_correct, earned_score = excluded.earned_score`
      ).run(
        attemptId,
        qid,
        saved?.answer_json ? String(saved.answer_json) : null,
        saved?.is_marked ? Number(saved.is_marked) : 0,
        evalRes.is_correct,
        evalRes.earned_score,
        now
      );
    }

    db.prepare("UPDATE exam_attempts SET status = 'selesai', finished_at = ? WHERE id = ?").run(now, attemptId);
    recalculateAttemptGrade(attemptId);
  });
  tx();

  const updated = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId) as Record<string, unknown>;
  broadcastMonitorEvent('attempt:finished', {
    attempt_id: attemptId,
    exam_id: Number(attempt.exam_id),
    student_id: studentId,
    final_grade: Number(updated.final_grade),
  });

  res.json({
    attempt_id: attemptId,
    show_result_after: Boolean(exam.show_result_after),
    result: exam.show_result_after
      ? {
          final_grade: Number(updated.final_grade),
          total_score: Number(updated.total_score),
          max_score: Number(updated.max_score),
          correct_count: Number(updated.correct_count),
          wrong_count: Number(updated.wrong_count),
          blank_count: Number(updated.blank_count),
          is_passed: Boolean(updated.is_passed),
          essay_graded: Boolean(updated.essay_graded),
          kkm: Number(exam.kkm),
        }
      : null,
  });
});

app.get('/api/student/results', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT ea.*, e.title AS exam_title, e.kkm, e.show_result_after, s.name AS subject_name
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE ea.student_id = ? AND ea.status = 'selesai'
       ORDER BY ea.finished_at DESC`
    )
    .all(req.authUser!.userId) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      exam_id: Number(r.exam_id),
      exam_title: String(r.exam_title),
      subject_name: String(r.subject_name),
      started_at: String(r.started_at),
      finished_at: String(r.finished_at),
      show_result_after: Boolean(r.show_result_after),
      kkm: Number(r.kkm),
      final_grade: r.show_result_after ? Number(r.final_grade) : null,
      total_score: r.show_result_after ? Number(r.total_score) : null,
      max_score: r.show_result_after ? Number(r.max_score) : null,
      correct_count: r.show_result_after ? Number(r.correct_count) : null,
      wrong_count: r.show_result_after ? Number(r.wrong_count) : null,
      blank_count: r.show_result_after ? Number(r.blank_count) : null,
      is_passed: r.show_result_after ? Boolean(r.is_passed) : null,
      essay_graded: Boolean(r.essay_graded),
    }))
  );
});

// =======================
// 8. MONITORING UJIAN REAL-TIME & PENGAWAS
// =======================
app.get('/api/monitoring', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const { exam_id, class_id, search } = req.query as {
    exam_id?: string;
    class_id?: string;
    search?: string;
  };

  let examSql = `
    SELECT e.*, s.name AS subject_name
    FROM exams e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.status IN ('aktif', 'selesai')
  `;
  const examParams: unknown[] = [];
  if (exam_id && exam_id !== 'all') {
    examSql += ' AND e.id = ?';
    examParams.push(Number(exam_id));
  }
  examSql += ' ORDER BY e.id DESC';

  const exams = db.prepare(examSql).all(...examParams) as Array<Record<string, unknown>>;
  const rows: Array<Record<string, unknown>> = [];

  for (const ex of exams) {
    const cids = parseJsonSafe<number[]>(String(ex.class_ids_json), []);
    if (cids.length === 0) continue;

    let studentSql = `
      SELECT u.id AS student_id, u.full_name AS student_name, u.nip_nis AS student_nis,
             u.class_id, c.name AS class_name
      FROM users u
      LEFT JOIN classes c ON c.id = u.class_id
      WHERE u.role = 'siswa' AND u.status = 'aktif'
        AND u.class_id IN (${cids.map(() => '?').join(',')})
    `;
    const stParams: unknown[] = [...cids];
    if (class_id && class_id !== 'all') {
      studentSql += ' AND u.class_id = ?';
      stParams.push(Number(class_id));
    }
    if (search && search.trim()) {
      studentSql += ' AND (u.full_name LIKE ? OR u.nip_nis LIKE ?)';
      stParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const students = db.prepare(studentSql).all(...stParams) as Array<Record<string, unknown>>;
    const totalQuestions = (
      db.prepare('SELECT COUNT(*) AS c FROM exam_questions WHERE exam_id = ?').get(Number(ex.id)) as { c: number }
    ).c || Number(ex.question_count);

    for (const st of students) {
      const attempt = db
        .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1')
        .get(Number(ex.id), Number(st.student_id)) as Record<string, unknown> | undefined;

      if (!attempt) {
        rows.push({
          id: 0,
          exam_id: Number(ex.id),
          exam_title: String(ex.title),
          subject_name: String(ex.subject_name),
          student_id: Number(st.student_id),
          student_name: String(st.student_name),
          student_nis: String(st.student_nis),
          class_id: Number(st.class_id),
          class_name: String(st.class_name || '-'),
          attempt_number: 0,
          status: 'belum_mulai',
          started_at: null,
          expires_at: null,
          finished_at: null,
          answered_count: 0,
          total_questions: totalQuestions,
          violation_count: 0,
          flagged_for_review: false,
          proctor_notes: '',
          proctor_action: 'none',
          webcam_verified: false,
          webcam_snapshot_url: '',
          final_grade: 0,
        });
      } else {
        const answeredCount = (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM student_answers
               WHERE attempt_id = ? AND answer_json IS NOT NULL AND answer_json != 'null' AND answer_json != '""' AND answer_json != '[]' AND answer_json != '{}'`
            )
            .get(Number(attempt.id)) as { c: number }
        ).c;

        const qCount = parseJsonSafe<number[]>(String(attempt.question_order_json), []).length || totalQuestions;
        rows.push({
          id: Number(attempt.id),
          exam_id: Number(ex.id),
          exam_title: String(ex.title),
          subject_name: String(ex.subject_name),
          student_id: Number(st.student_id),
          student_name: String(st.student_name),
          student_nis: String(st.student_nis),
          class_id: Number(st.class_id),
          class_name: String(st.class_name || '-'),
          attempt_number: Number(attempt.attempt_number),
          status: String(attempt.status),
          started_at: attempt.started_at ? String(attempt.started_at) : null,
          expires_at: attempt.expires_at ? String(attempt.expires_at) : null,
          finished_at: attempt.finished_at ? String(attempt.finished_at) : null,
          answered_count: answeredCount,
          total_questions: qCount,
          violation_count: Number(attempt.violation_count),
          flagged_for_review: Boolean(attempt.flagged_for_review),
          proctor_notes: String(attempt.proctor_notes || ''),
          proctor_action: String(attempt.proctor_action || 'none'),
          webcam_verified: Boolean(attempt.webcam_verified),
          webcam_snapshot_url: String(attempt.webcam_snapshot_url || ''),
          final_grade: Number(attempt.final_grade || 0),
        });
      }
    }
  }

  res.json(rows);
});

app.get('/api/monitoring/violations', requireAuth, requireRole('admin', 'guru', 'pengawas'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT v.*, u.full_name AS student_name, u.nip_nis AS student_nis, c.name AS class_name, e.title AS exam_title
       FROM violation_logs v
       JOIN users u ON u.id = v.student_id
       LEFT JOIN classes c ON c.id = u.class_id
       JOIN exams e ON e.id = v.exam_id
       ORDER BY v.id DESC LIMIT 200`
    )
    .all();
  res.json(rows);
});

app.get('/api/monitoring/attempts/:attemptId/logs', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const logs = db
    .prepare('SELECT * FROM violation_logs WHERE attempt_id = ? ORDER BY id DESC')
    .all(Number(req.params.attemptId));
  res.json(logs);
});

app.post('/api/monitoring/attempts/:attemptId/proctor', requireAuth, requireRole('admin', 'pengawas', 'guru'), (req, res) => {
  const attemptId = Number(req.params.attemptId);
  const { proctor_notes, proctor_action, clear_flag } = req.body as {
    proctor_notes?: string;
    proctor_action?: string;
    clear_flag?: boolean;
  };

  const attempt = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId) as
    | Record<string, unknown>
    | undefined;
  if (!attempt) {
    res.status(404).json({ error: 'Sesi ujian peserta tidak ditemukan.' });
    return;
  }

  const nextFlag = clear_flag ? 0 : Number(attempt.flagged_for_review);
  const nextStatus =
    clear_flag && attempt.status === 'terindikasi_pelanggaran'
      ? 'sedang_mengerjakan'
      : String(attempt.status);

  db.prepare(
    `UPDATE exam_attempts
     SET proctor_notes = ?, proctor_action = ?, flagged_for_review = ?, status = ?
     WHERE id = ?`
  ).run(
    String(proctor_notes ?? attempt.proctor_notes),
    String(proctor_action ?? attempt.proctor_action),
    nextFlag,
    nextStatus,
    attemptId
  );

  if (proctor_notes || (proctor_action && proctor_action !== 'none')) {
    db.prepare(
      `INSERT INTO violation_logs (attempt_id, exam_id, student_id, event_type, severity, description, created_at)
       VALUES (?, ?, ?, 'proctor_note', 'info', ?, ?)`
    ).run(
      attemptId,
      Number(attempt.exam_id),
      Number(attempt.student_id),
      `Catatan Pengawas (${proctor_action || 'info'}): ${proctor_notes || '-'}`,
      new Date().toISOString()
    );
  }

  sendToAttemptClient(attemptId, 'proctor:action', {
    proctor_action: proctor_action || 'none',
    proctor_notes: proctor_notes || '',
  });
  broadcastMonitorEvent('attempt:updated', { attempt_id: attemptId });

  res.json({ success: true });
});

// =======================
// 9. HASIL UJIAN & PENILAIAN ESAI
// =======================
app.get('/api/results', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const { exam_id, class_id, subject_id } = req.query as Record<string, string>;
  let sql = `
    SELECT ea.*, e.title AS exam_title, e.kkm, e.subject_id, s.name AS subject_name, s.code AS subject_code,
           u.full_name AS student_name, u.nip_nis AS student_nis, u.class_id, c.name AS class_name
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    JOIN subjects s ON s.id = e.subject_id
    JOIN users u ON u.id = ea.student_id
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE ea.status = 'selesai'
  `;
  const params: unknown[] = [];
  if (exam_id && exam_id !== 'all') {
    sql += ' AND ea.exam_id = ?';
    params.push(Number(exam_id));
  }
  if (class_id && class_id !== 'all') {
    sql += ' AND u.class_id = ?';
    params.push(Number(class_id));
  }
  if (subject_id && subject_id !== 'all') {
    sql += ' AND e.subject_id = ?';
    params.push(Number(subject_id));
  }
  sql += ' ORDER BY ea.finished_at DESC';

  const attempts = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    exam_id: Number(r.exam_id),
    exam_title: String(r.exam_title),
    subject_id: Number(r.subject_id),
    subject_name: String(r.subject_name),
    subject_code: String(r.subject_code),
    student_id: Number(r.student_id),
    student_name: String(r.student_name),
    student_nis: String(r.student_nis),
    class_id: r.class_id ? Number(r.class_id) : null,
    class_name: String(r.class_name || '-'),
    started_at: String(r.started_at),
    finished_at: String(r.finished_at),
    duration_minutes_taken: r.finished_at && r.started_at
      ? Math.max(1, Math.round((new Date(String(r.finished_at)).getTime() - new Date(String(r.started_at)).getTime()) / 60000))
      : 0,
    total_score: Number(r.total_score),
    max_score: Number(r.max_score),
    final_grade: Number(r.final_grade),
    correct_count: Number(r.correct_count),
    wrong_count: Number(r.wrong_count),
    blank_count: Number(r.blank_count),
    is_passed: Boolean(r.is_passed),
    essay_graded: Boolean(r.essay_graded),
    kkm: Number(r.kkm),
    violation_count: Number(r.violation_count),
  }));

  const grades = attempts.map((a) => a.final_grade);
  const passedCount = attempts.filter((a) => a.is_passed).length;
  const failedCount = attempts.length - passedCount;
  const highest = grades.length ? Math.max(...grades) : 0;
  const lowest = grades.length ? Math.min(...grades) : 0;
  const mean = grades.length ? Math.round((grades.reduce((s, g) => s + g, 0) / grades.length) * 100) / 100 : 0;
  const median = computeMedian(grades);

  // Score distribution buckets: 0-25, 26-50, 51-74, 75-89, 90-100
  const buckets = [
    { label: '0–25', count: grades.filter((g) => g <= 25).length },
    { label: '26–50', count: grades.filter((g) => g > 25 && g <= 50).length },
    { label: '51–74', count: grades.filter((g) => g > 50 && g < 75).length },
    { label: '75–89', count: grades.filter((g) => g >= 75 && g < 90).length },
    { label: '90–100', count: grades.filter((g) => g >= 90).length },
  ];

  res.json({
    attempts,
    summary: {
      total_participants: attempts.length,
      highest,
      lowest,
      mean,
      median,
      passed_count: passedCount,
      failed_count: failedCount,
      pass_rate: attempts.length > 0 ? Math.round((passedCount / attempts.length) * 1000) / 10 : 0,
      distribution: buckets,
    },
  });
});

app.get('/api/results/:attemptId/detail', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const attemptId = Number(req.params.attemptId);
  const attempt = db
    .prepare(
      `SELECT ea.*, e.title AS exam_title, e.kkm, s.name AS subject_name,
              u.full_name AS student_name, u.nip_nis AS student_nis, c.name AS class_name
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
       JOIN subjects s ON s.id = e.subject_id
       JOIN users u ON u.id = ea.student_id
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE ea.id = ?`
    )
    .get(attemptId) as Record<string, unknown> | undefined;

  if (!attempt) {
    res.status(404).json({ error: 'Data hasil ujian tidak ditemukan.' });
    return;
  }

  const qOrder = parseJsonSafe<number[]>(String(attempt.question_order_json), []);
  const rows = db
    .prepare(
      `SELECT q.*, eq.custom_weight, sa.answer_json, sa.is_correct, sa.earned_score, sa.teacher_feedback
       FROM questions q
       LEFT JOIN exam_questions eq ON eq.question_id = q.id AND eq.exam_id = ?
       LEFT JOIN student_answers sa ON sa.question_id = q.id AND sa.attempt_id = ?
       WHERE q.id IN (${qOrder.length > 0 ? qOrder.map(() => '?').join(',') : '-1'})`
    )
    .all(attempt.exam_id, attemptId, ...qOrder) as Array<Record<string, unknown>>;

  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const items = qOrder
    .map((qid) => byId.get(qid))
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r, idx) => ({
      order: idx + 1,
      question_id: Number(r.id),
      type: String(r.type),
      topic: String(r.topic),
      prompt: String(r.prompt),
      weight: r.custom_weight !== null && r.custom_weight !== undefined ? Number(r.custom_weight) : Number(r.weight),
      options: parseJsonSafe(String(r.options_json), []),
      correct_answer: parseJsonSafe(String(r.correct_answer_json), ''),
      scoring_rule: parseJsonSafe(String(r.scoring_rule_json), {}),
      explanation: String(r.explanation || ''),
      student_answer: r.answer_json ? parseJsonSafe(String(r.answer_json), null) : null,
      is_correct: r.is_correct !== null ? Number(r.is_correct) : null,
      earned_score: Number(r.earned_score ?? 0),
      teacher_feedback: String(r.teacher_feedback || ''),
    }));

  res.json({ attempt, items });
});

app.put('/api/results/:attemptId/grade-essay', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const attemptId = Number(req.params.attemptId);
  const { grades } = req.body as {
    grades?: Array<{ question_id: number; earned_score: number; teacher_feedback?: string }>;
  };
  if (!Array.isArray(grades)) {
    res.status(400).json({ error: 'Format nilai esai tidak valid.' });
    return;
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const g of grades) {
      db.prepare(
        `UPDATE student_answers
         SET earned_score = ?, is_correct = ?, teacher_feedback = ?, updated_at = ?
         WHERE attempt_id = ? AND question_id = ?`
      ).run(
        Number(g.earned_score || 0),
        Number(g.earned_score || 0) > 0 ? 1 : 0,
        String(g.teacher_feedback || ''),
        now,
        attemptId,
        Number(g.question_id)
      );
    }
    recalculateAttemptGrade(attemptId);
  });
  tx();

  const updated = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId);
  res.json({ success: true, attempt: updated });
});

// =======================
// 10. ANALISIS BUTIR SOAL
// =======================
app.get('/api/analytics/item-analysis/:examId', requireAuth, requireRole('admin', 'guru'), (req, res) => {
  const examId = Number(req.params.examId);
  const exam = db
    .prepare(
      `SELECT e.*, s.name AS subject_name
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.id = ?`
    )
    .get(examId) as Record<string, unknown> | undefined;

  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const qRows = db
    .prepare(
      `SELECT eq.order_index, eq.custom_weight, q.*
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = ?
       ORDER BY eq.order_index ASC`
    )
    .all(examId) as Array<Record<string, unknown>>;

  const questionsMeta: ExamQuestionMeta[] = qRows.map((r) => ({
    question_id: Number(r.id),
    order_index: Number(r.order_index),
    prompt: String(r.prompt),
    type: String(r.type) as QuestionType,
    topic: String(r.topic),
    weight: r.custom_weight !== null && r.custom_weight !== undefined ? Number(r.custom_weight) : Number(r.weight),
    options: parseJsonSafe(String(r.options_json), []),
    correct_answer: parseJsonSafe(String(r.correct_answer_json), ''),
  }));

  const attemptGrades = db
    .prepare("SELECT id AS attempt_id, final_grade FROM exam_attempts WHERE exam_id = ? AND status = 'selesai'")
    .all(examId) as Array<{ attempt_id: number; final_grade: number }>;

  const attemptIds = attemptGrades.map((a) => a.attempt_id);
  const answers = (
    attemptIds.length > 0
      ? db
          .prepare(
            `SELECT sa.attempt_id, ea.final_grade, sa.question_id, sa.answer_json, sa.is_correct, sa.earned_score
             FROM student_answers sa
             JOIN exam_attempts ea ON ea.id = sa.attempt_id
             WHERE sa.attempt_id IN (${attemptIds.map(() => '?').join(',')})`
          )
          .all(...attemptIds)
      : []
  ) as AttemptAnswerRecord[];

  const items = computeItemAnalysis(questionsMeta, attemptGrades, answers);
  res.json({
    exam: {
      id: Number(exam.id),
      title: String(exam.title),
      subject_name: String(exam.subject_name),
      participant_count: attemptGrades.length,
    },
    items,
  });
});

// =======================
// 11. LAPORAN & EXPORT DATA
// =======================
app.get('/api/reports/export-data', requireAuth, requireRole('admin', 'guru', 'pengawas'), (req, res) => {
  const { type, exam_id, class_id, subject_id, date_from, date_to } = req.query as Record<string, string>;

  if (type === 'pelanggaran') {
    let sql = `
      SELECT v.created_at, u.nip_nis, u.full_name, c.name AS class_name, e.title AS exam_title,
             v.event_type, v.severity, v.description
      FROM violation_logs v
      JOIN users u ON u.id = v.student_id
      LEFT JOIN classes c ON c.id = u.class_id
      JOIN exams e ON e.id = v.exam_id
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (exam_id && exam_id !== 'all') {
      sql += ' AND v.exam_id = ?';
      params.push(Number(exam_id));
    }
    if (class_id && class_id !== 'all') {
      sql += ' AND u.class_id = ?';
      params.push(Number(class_id));
    }
    sql += ' ORDER BY v.id DESC';
    res.json({ rows: db.prepare(sql).all(...params) });
    return;
  }

  if (type === 'belum_ujian') {
    const exams = (
      exam_id && exam_id !== 'all'
        ? db.prepare('SELECT e.*, s.name AS subject_name FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.id = ?').all(Number(exam_id))
        : db.prepare('SELECT e.*, s.name AS subject_name FROM exams e JOIN subjects s ON s.id = e.subject_id').all()
    ) as Array<Record<string, unknown>>;

    const missing: Array<Record<string, unknown>> = [];
    for (const ex of exams) {
      const cids = parseJsonSafe<number[]>(String(ex.class_ids_json), []);
      if (cids.length === 0) continue;
      let stSql = `
        SELECT u.id, u.nip_nis, u.full_name, c.name AS class_name
        FROM users u
        LEFT JOIN classes c ON c.id = u.class_id
        WHERE u.role = 'siswa' AND u.status = 'aktif' AND u.class_id IN (${cids.map(() => '?').join(',')})
      `;
      const params: unknown[] = [...cids];
      if (class_id && class_id !== 'all') {
        stSql += ' AND u.class_id = ?';
        params.push(Number(class_id));
      }
      const students = db.prepare(stSql).all(...params) as Array<Record<string, unknown>>;
      const doneSet = new Set(
        (db.prepare('SELECT DISTINCT student_id FROM exam_attempts WHERE exam_id = ?').all(Number(ex.id)) as Array<{ student_id: number }>).map(
          (r) => r.student_id
        )
      );
      for (const st of students) {
        if (!doneSet.has(Number(st.id))) {
          missing.push({
            nis: st.nip_nis,
            nama_siswa: st.full_name,
            kelas: st.class_name,
            ujian: ex.title,
            mata_pelajaran: ex.subject_name,
            tanggal: ex.exam_date,
          });
        }
      }
    }
    res.json({ rows: missing });
    return;
  }

  // Default: nilai / rekap kelas / mapel / belum_tuntas
  let sql = `
    SELECT u.nip_nis AS nis, u.full_name AS nama_siswa, c.name AS kelas, s.name AS mata_pelajaran,
           e.title AS ujian, e.exam_date AS tanggal, e.kkm, ea.correct_count AS benar,
           ea.wrong_count AS salah, ea.blank_count AS kosong, ea.total_score AS skor,
           ea.max_score AS skor_maks, ea.final_grade AS nilai_akhir,
           CASE WHEN ea.is_passed = 1 THEN 'Tuntas' ELSE 'Belum Tuntas' END AS status_ketuntasan,
           ea.violation_count AS pelanggaran
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    JOIN subjects s ON s.id = e.subject_id
    JOIN users u ON u.id = ea.student_id
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE ea.status = 'selesai'
  `;
  const params: unknown[] = [];
  if (exam_id && exam_id !== 'all') {
    sql += ' AND ea.exam_id = ?';
    params.push(Number(exam_id));
  }
  if (class_id && class_id !== 'all') {
    sql += ' AND u.class_id = ?';
    params.push(Number(class_id));
  }
  if (subject_id && subject_id !== 'all') {
    sql += ' AND e.subject_id = ?';
    params.push(Number(subject_id));
  }
  if (date_from) {
    sql += ' AND e.exam_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND e.exam_date <= ?';
    params.push(date_to);
  }
  if (type === 'belum_tuntas') {
    sql += ' AND ea.is_passed = 0';
  }
  sql += ' ORDER BY c.name ASC, u.full_name ASC';

  res.json({ rows: db.prepare(sql).all(...params) });
});

// =======================
// 12. PENGATURAN SISTEM & BACKUP/RESTORE
// =======================
app.get('/api/settings', requireAuth, requireRole('admin', 'guru', 'pengawas'), (_req, res) => {
  res.json(getSystemSettingsRow());
});

app.put('/api/settings', requireAuth, requireRole('admin'), (req, res) => {
  const b = req.body as Record<string, unknown>;
  db.prepare(
    `UPDATE system_settings
     SET school_name = ?, school_logo = ?, academic_year = ?, semester = ?,
         default_kkm = ?, default_duration = ?, auto_logout_minutes = ?,
         require_webcam = ?, max_violations = ?, tab_switch_detection = ?,
         allow_token_auto_rotate = ?, notifications_enabled = ?, role_permissions_json = ?
     WHERE id = 1`
  ).run(
    String(b.school_name || 'SMP Negeri 41 Muaro Jambi'),
    String(b.school_logo || '/logo-smpn41-muaro-jambi.svg'),
    String(b.academic_year || '2026/2027'),
    String(b.semester || 'Ganjil'),
    Number(b.default_kkm || 75),
    Number(b.default_duration || 60),
    Number(b.auto_logout_minutes || 90),
    b.require_webcam ? 1 : 0,
    Number(b.max_violations || 3),
    b.tab_switch_detection ? 1 : 0,
    b.allow_token_auto_rotate ? 1 : 0,
    b.notifications_enabled ? 1 : 0,
    JSON.stringify(b.role_permissions || DEFAULT_ROLE_PERMISSIONS)
  );
  res.json({ success: true });
});

app.get('/api/settings/backup', requireAuth, requireRole('admin'), (_req, res) => {
  const tables = [
    'system_settings',
    'classes',
    'subjects',
    'users',
    'questions',
    'exams',
    'exam_questions',
    'exam_attempts',
    'student_answers',
    'violation_logs',
  ];
  const backup: Record<string, unknown[]> = {};
  for (const t of tables) {
    backup[t] = db.prepare(`SELECT * FROM ${t}`).all() as unknown[];
  }
  res.json({
    exported_at: new Date().toISOString(),
    version: '1.0',
    data: backup,
  });
});

app.post('/api/settings/restore', requireAuth, requireRole('admin'), (req, res) => {
  const { data } = req.body as { data?: Record<string, Array<Record<string, unknown>>> };
  if (!data || !data.users || !data.subjects) {
    res.status(400).json({ error: 'Format file backup tidak valid.' });
    return;
  }

  const orderedTables = [
    'violation_logs',
    'student_answers',
    'exam_attempts',
    'exam_questions',
    'exams',
    'questions',
    'users',
    'subjects',
    'classes',
    'system_settings',
  ];

  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const t of orderedTables) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    const insertOrder = [...orderedTables].reverse();
    for (const t of insertOrder) {
      const rows = data[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`);
      for (const r of rows) {
        stmt.run(...cols.map((c) => r[c]));
      }
    }
    db.pragma('foreign_keys = ON');
  });
  tx();
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // ignore checkpoint errors if busy
  }

  res.json({ success: true });
});

// =======================
// VITE / STATIC SERVING
// =======================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SMART CBT server running on http://localhost:${PORT}`);
  });
}

startServer();
