import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from './auth.ts';
import type { SystemSettings } from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'smart_cbt.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DEFAULT_ROLE_PERMISSIONS: SystemSettings['role_permissions'] = {
  admin: [
    'dashboard',
    'guru',
    'siswa',
    'kelas',
    'mapel',
    'bank_soal',
    'jadwal_ujian',
    'monitoring',
    'hasil_ujian',
    'analisis_butir',
    'laporan',
    'pengaturan',
    'profil',
  ],
  guru: [
    'dashboard',
    'bank_soal',
    'jadwal_ujian',
    'monitoring',
    'hasil_ujian',
    'analisis_butir',
    'laporan',
    'profil',
  ],
  pengawas: ['dashboard', 'monitoring', 'profil'],
  siswa: ['ujian_siswa', 'hasil_siswa', 'profil'],
};

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      school_name TEXT NOT NULL,
      school_logo TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      semester TEXT NOT NULL,
      default_kkm INTEGER NOT NULL DEFAULT 75,
      default_duration INTEGER NOT NULL DEFAULT 60,
      auto_logout_minutes INTEGER NOT NULL DEFAULT 90,
      require_webcam INTEGER NOT NULL DEFAULT 0,
      max_violations INTEGER NOT NULL DEFAULT 3,
      tab_switch_detection INTEGER NOT NULL DEFAULT 1,
      allow_token_auto_rotate INTEGER NOT NULL DEFAULT 0,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      role_permissions_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      grade_level INTEGER NOT NULL,
      homeroom_teacher_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kkm INTEGER NOT NULL DEFAULT 75
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'guru', 'pengawas', 'siswa')),
      full_name TEXT NOT NULL,
      nip_nis TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
      subject_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
      photo_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      grade_level INTEGER NOT NULL DEFAULT 9,
      topic TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pg', 'pg_kompleks', 'benar_salah', 'menjodohkan', 'isian_singkat', 'esai')),
      difficulty TEXT NOT NULL CHECK (difficulty IN ('mudah', 'sedang', 'sukar')),
      weight REAL NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'image', 'audio', 'video')),
      media_url TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_answer_json TEXT NOT NULL DEFAULT '""',
      scoring_rule_json TEXT NOT NULL DEFAULT '{}',
      explanation TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_ids_json TEXT NOT NULL DEFAULT '[]',
      exam_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      question_count INTEGER NOT NULL,
      kkm INTEGER NOT NULL DEFAULT 75,
      token TEXT NOT NULL,
      exam_password TEXT NOT NULL DEFAULT '',
      max_attempts INTEGER NOT NULL DEFAULT 1,
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      shuffle_options INTEGER NOT NULL DEFAULT 1,
      allow_navigation INTEGER NOT NULL DEFAULT 1,
      allow_back INTEGER NOT NULL DEFAULT 1,
      show_result_after INTEGER NOT NULL DEFAULT 1,
      require_webcam INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('draft', 'aktif', 'selesai')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      custom_weight REAL,
      UNIQUE (exam_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'sedang_mengerjakan' CHECK (status IN ('sedang_mengerjakan', 'selesai', 'terindikasi_pelanggaran')),
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      finished_at TEXT,
      question_order_json TEXT NOT NULL DEFAULT '[]',
      option_orders_json TEXT NOT NULL DEFAULT '{}',
      violation_count INTEGER NOT NULL DEFAULT 0,
      flagged_for_review INTEGER NOT NULL DEFAULT 0,
      proctor_notes TEXT NOT NULL DEFAULT '',
      proctor_action TEXT NOT NULL DEFAULT 'none',
      webcam_verified INTEGER NOT NULL DEFAULT 0,
      webcam_snapshot_url TEXT NOT NULL DEFAULT '',
      total_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 0,
      final_grade REAL NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      blank_count INTEGER NOT NULL DEFAULT 0,
      is_passed INTEGER NOT NULL DEFAULT 0,
      essay_graded INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS student_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      answer_json TEXT,
      is_marked INTEGER NOT NULL DEFAULT 0,
      is_correct INTEGER,
      earned_score REAL NOT NULL DEFAULT 0,
      teacher_feedback TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE (attempt_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS violation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_image TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  seedInitialData();
}

function seedInitialData(): void {
  const existingSettings = db.prepare('SELECT id FROM system_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO system_settings (
        id, school_name, school_logo, academic_year, semester,
        default_kkm, default_duration, auto_logout_minutes, require_webcam,
        max_violations, tab_switch_detection, allow_token_auto_rotate,
        notifications_enabled, role_permissions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      'SMP Negeri 41 Muaro Jambi',
      '/logo-smpn41-muaro-jambi.svg',
      '2026/2027',
      'Ganjil',
      75,
      60,
      90,
      0,
      3,
      1,
      0,
      1,
      JSON.stringify(DEFAULT_ROLE_PERMISSIONS)
    );
  } else {
    db.prepare(`
      UPDATE system_settings
      SET school_logo = ?
      WHERE id = 1 AND school_logo = '/src/assets/images/school_crest_logo_1794761880758.jpg'
    `).run('/logo-smpn41-muaro-jambi.svg');
  }

  const userCount = (db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount > 0) {
    db.prepare(`
      UPDATE users
      SET full_name = ?, nip_nis = ?
      WHERE username = 'admin'
        AND role = 'admin'
        AND (full_name = 'Drs. Hendra Wijaya, M.Pd.' OR nip_nis = '197504122000031002')
    `).run('Tri Ramadhani Putra, S.Pd.', '199004102019031002');
    return;
  }

  const now = new Date().toISOString();
  const todayDate = new Date().toISOString().slice(0, 10);

  // 1. Seed Classes
  const classNames = [
    { name: 'VII-A', grade: 7 },
    { name: 'VII-B', grade: 7 },
    { name: 'VIII-A', grade: 8 },
    { name: 'VIII-B', grade: 8 },
    { name: 'IX-A', grade: 9 },
    { name: 'IX-B', grade: 9 },
  ];
  const insertClass = db.prepare('INSERT INTO classes (name, grade_level) VALUES (?, ?)');
  const classIdMap: Record<string, number> = {};
  for (const c of classNames) {
    const info = insertClass.run(c.name, c.grade);
    classIdMap[c.name] = Number(info.lastInsertRowid);
  }

  // 2. Seed Subjects
  const subjectsData = [
    { code: 'MTK', name: 'Matematika', kkm: 75 },
    { code: 'BIN', name: 'Bahasa Indonesia', kkm: 75 },
    { code: 'IPA', name: 'Ilmu Pengetahuan Alam', kkm: 75 },
    { code: 'BIG', name: 'Bahasa Inggris', kkm: 75 },
    { code: 'PKN', name: 'Pendidikan Pancasila', kkm: 78 },
    { code: 'IPS', name: 'Ilmu Pengetahuan Sosial', kkm: 75 },
  ];
  const insertSubject = db.prepare('INSERT INTO subjects (code, name, kkm) VALUES (?, ?, ?)');
  const subjectIdMap: Record<string, number> = {};
  for (const s of subjectsData) {
    const info = insertSubject.run(s.code, s.name, s.kkm);
    subjectIdMap[s.code] = Number(info.lastInsertRowid);
  }

  // 3. Seed Users (Admin, Guru, Pengawas, Siswa)
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, nip_nis, class_id, subject_ids_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'aktif', ?)
  `);

  const adminId = Number(
    insertUser.run('admin', hashPassword('admin123'), 'admin', 'Tri Ramadhani Putra, S.Pd.', '199004102019031002', null, '[]', now).lastInsertRowid
  );
  const guruMtkId = Number(
    insertUser.run(
      'guru.mtk',
      hashPassword('guru123'),
      'guru',
      'Siti Rahmawati, S.Pd.',
      '198408192009022005',
      null,
      JSON.stringify([subjectIdMap.MTK]),
      now
    ).lastInsertRowid
  );
  const guruIpaId = Number(
    insertUser.run(
      'guru.ipa',
      hashPassword('guru123'),
      'guru',
      'Budi Santoso, S.Si.',
      '198711032011011004',
      null,
      JSON.stringify([subjectIdMap.IPA]),
      now
    ).lastInsertRowid
  );
  const guruBinId = Number(
    insertUser.run(
      'guru.bin',
      hashPassword('guru123'),
      'guru',
      'Nurul Hidayah, S.Pd.',
      '199002142015022001',
      null,
      JSON.stringify([subjectIdMap.BIN, subjectIdMap.PKN]),
      now
    ).lastInsertRowid
  );

  // Assign homeroom teachers
  db.prepare('UPDATE classes SET homeroom_teacher_id = ? WHERE id = ?').run(guruMtkId, classIdMap['IX-A']);
  db.prepare('UPDATE classes SET homeroom_teacher_id = ? WHERE id = ?').run(guruIpaId, classIdMap['IX-B']);
  db.prepare('UPDATE classes SET homeroom_teacher_id = ? WHERE id = ?').run(guruBinId, classIdMap['VIII-A']);

  // Pengawas
  insertUser.run('pengawas1', hashPassword('pengawas123'), 'pengawas', 'Ahmad Fauzi, S.Pd.', '198206102008011008', null, '[]', now);
  insertUser.run('pengawas2', hashPassword('pengawas123'), 'pengawas', 'Rina Marlina, S.Kom.', '199103212019032006', null, '[]', now);

  // Siswa across classes
  const studentsSeed = [
    { username: 'siswa1', nis: '2409001', name: 'Adelia Putri Ramadhani', cls: 'IX-A' },
    { username: 'siswa2', nis: '2409002', name: 'Bagas Pratama Putra', cls: 'IX-A' },
    { username: 'siswa3', nis: '2409003', name: 'Citra Ayu Lestari', cls: 'IX-A' },
    { username: 'siswa4', nis: '2409004', name: 'Dimas Saputra', cls: 'IX-A' },
    { username: 'siswa5', nis: '2409005', name: 'Eka Nurul Azizah', cls: 'IX-B' },
    { username: 'siswa6', nis: '2409006', name: 'Farhan Alfarizi', cls: 'IX-B' },
    { username: 'siswa7', nis: '2409007', name: 'Gita Puspita Sari', cls: 'IX-B' },
    { username: 'siswa8', nis: '2409008', name: 'Hafiz Akbar Maulana', cls: 'VIII-A' },
    { username: 'siswa9', nis: '2409009', name: 'Intan Permata Sari', cls: 'VIII-A' },
    { username: 'siswa10', nis: '2409010', name: 'Joko Prasetyo', cls: 'VIII-B' },
    { username: 'siswa11', nis: '2409011', name: 'Kurnia Sari Dewi', cls: 'VII-A' },
    { username: 'siswa12', nis: '2409012', name: 'Luthfi Hakim', cls: 'VII-B' },
  ];
  for (const st of studentsSeed) {
    insertUser.run(st.username, hashPassword('siswa123'), 'siswa', st.name, st.nis, classIdMap[st.cls], '[]', now);
  }

  // 4. Seed Rich Question Bank (All 6 Types across Subjects)
  const insertQ = db.prepare(`
    INSERT INTO questions (
      subject_id, grade_level, topic, type, difficulty, weight, prompt,
      media_type, media_url, options_json, correct_answer_json, scoring_rule_json,
      explanation, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const mtkQuestions: number[] = [];
  const mtkSeed = [
    {
      topic: 'Persamaan Kuadrat',
      type: 'pg',
      difficulty: 'sedang',
      weight: 2,
      prompt: 'Akar-akar dari persamaan kuadrat $x^2 - 5x + 6 = 0$ adalah ...',
      options: [
        { key: 'A', text: '$x_1 = 2$ dan $x_2 = 3$' },
        { key: 'B', text: '$x_1 = -2$ dan $x_2 = -3$' },
        { key: 'C', text: '$x_1 = 1$ dan $x_2 = 6$' },
        { key: 'D', text: '$x_1 = -1$ dan $x_2 = 6$' },
      ],
      correct: 'A',
      rule: {},
      explanation: 'Faktorkan $x^2 - 5x + 6 = (x - 2)(x - 3) = 0$, sehingga diperoleh $x_1 = 2$ dan $x_2 = 3$.',
    },
    {
      topic: 'Teorema Pythagoras',
      type: 'pg',
      difficulty: 'mudah',
      weight: 2,
      prompt: 'Sebuah segitiga siku-siku memiliki panjang sisi siku-siku $6\\text{ cm}$ dan $8\\text{ cm}$. Panjang sisi miring (hipotenusa) segitiga tersebut adalah ...',
      options: [
        { key: 'A', text: '$10\\text{ cm}$' },
        { key: 'B', text: '$12\\text{ cm}$' },
        { key: 'C', text: '$14\\text{ cm}$' },
        { key: 'D', text: '$48\\text{ cm}$' },
      ],
      correct: 'A',
      rule: {},
      explanation: 'Berdasarkan Teorema Pythagoras: $c = \\sqrt{6^2 + 8^2} = \\sqrt{36 + 64} = \\sqrt{100} = 10\\text{ cm}$.',
    },
    {
      topic: 'Bilangan Berpangkat & Akar',
      type: 'pg_kompleks',
      difficulty: 'sedang',
      weight: 3,
      prompt: 'Pilihlah **dua** pernyataan operasi bilangan berpangkat yang bernilai benar di bawah ini:',
      options: [
        { key: 'A', text: '$2^3 \\times 2^4 = 2^7$' },
        { key: 'B', text: '$(3^2)^3 = 3^5$' },
        { key: 'C', text: '$5^0 = 1$' },
        { key: 'D', text: '$4^{-1} = -4$' },
      ],
      correct: ['A', 'C'],
      rule: { mode: 'partial' },
      explanation: '$2^3 \\times 2^4 = 2^{3+4} = 2^7$ (Benar) dan setiap bilangan bukan nol berpangkat $0$ bernilai $1$ (Benar).',
    },
    {
      topic: 'Fungsi Kuadrat',
      type: 'benar_salah',
      difficulty: 'mudah',
      weight: 1,
      prompt: 'Grafik fungsi kuadrat $f(x) = -2x^2 + 4x + 6$ memiliki kurva yang terbuka ke atas karena nilai konstanta $c = 6$ positif.',
      options: [
        { key: 'BENAR', text: 'Benar' },
        { key: 'SALAH', text: 'Salah' },
      ],
      correct: 'SALAH',
      rule: {},
      explanation: 'Arah terbuka parabola ditentukan oleh koefisien $a$. Karena $a = -2 < 0$, kurva terbuka ke bawah.',
    },
    {
      topic: 'Bangun Ruang Sisi Lengkung',
      type: 'menjodohkan',
      difficulty: 'sedang',
      weight: 4,
      prompt: 'Pasangkan bangun ruang sisi lengkung di sebelah kiri dengan rumus volumenya yang tepat di sebelah kanan:',
      options: [
        { id: 'p1', left: 'Tabung', right: 'πr²t' },
        { id: 'p2', left: 'Kerucut', right: '⅓πr²t' },
        { id: 'p3', left: 'Bola', right: '⁴⁄₃πr³' },
      ],
      correct: { p1: 'πr²t', p2: '⅓πr²t', p3: '⁴⁄₃πr³' },
      rule: {},
      explanation: 'Volume tabung $= \\pi r^2 t$, kerucut $= \\frac{1}{3}\\pi r^2 t$, dan bola $= \\frac{4}{3}\\pi r^3$.',
    },
    {
      topic: 'Transformasi Geometri',
      type: 'isian_singkat',
      difficulty: 'sedang',
      weight: 2,
      prompt: 'Titik $P(3, -4)$ dicerminkan terhadap sumbu-$X$. Koordinat bayangan titik $P\'$ adalah ... (tulis dalam format `(x,y)` atau `(x, y)`).',
      options: [],
      correct: '(3,4)',
      rule: { variations: ['(3, 4)', '3,4', '3, 4'], case_sensitive: false },
      explanation: 'Pencerminan titik $(x, y)$ terhadap sumbu-$X$ menghasilkan $(x, -y)$, sehingga $P(3, -4) \\rightarrow P\'(3, 4)$.',
    },
    {
      topic: 'Statistika & Peluang',
      type: 'esai',
      difficulty: 'sukar',
      weight: 6,
      prompt: 'Nilai ulangan harian 5 siswa kelas IX-A adalah 70, 80, 85, 75, dan 90. Hitunglah nilai rata-rata (mean) dan jelaskan langkah penyelesaiannya!',
      options: [],
      correct: '',
      rule: {
        rubric: 'Skor penuh (6): Menuliskan rumus rata-rata dengan benar (2 poin), menjumlahkan seluruh data = 400 (2 poin), membagi 400/5 = 80 dengan kesimpulan tepat (2 poin).',
      },
      explanation: 'Mean $= \\frac{70 + 80 + 85 + 75 + 90}{5} = \\frac{400}{5} = 80$.',
    },
  ];

  for (const q of mtkSeed) {
    const info = insertQ.run(
      subjectIdMap.MTK,
      9,
      q.topic,
      q.type,
      q.difficulty,
      q.weight,
      q.prompt,
      'none',
      '',
      JSON.stringify(q.options),
      JSON.stringify(q.correct),
      JSON.stringify(q.rule),
      q.explanation,
      guruMtkId,
      now
    );
    mtkQuestions.push(Number(info.lastInsertRowid));
  }

  // IPA Questions
  const ipaQuestions: number[] = [];
  const ipaSeed = [
    {
      topic: 'Sistem Reproduksi & Sel',
      type: 'pg',
      difficulty: 'mudah',
      weight: 2,
      prompt: 'Organel sel yang berfungsi sebagai pusat penghasil energi melalui respirasi seluler adalah ...',
      options: [
        { key: 'A', text: 'Ribosom' },
        { key: 'B', text: 'Mitokondria' },
        { key: 'C', text: 'Lisosom' },
        { key: 'D', text: 'Badan Golgi' },
      ],
      correct: 'B',
      rule: {},
      explanation: 'Mitokondria dikenal sebagai powerhouse of the cell karena menghasilkan ATP melalui respirasi seluler.',
    },
    {
      topic: 'Listrik Dinamis',
      type: 'pg',
      difficulty: 'sedang',
      weight: 2,
      prompt: 'Sebuah hambatan $12\\,\\Omega$ dihubungkan dengan sumber tegangan $24\\text{ V}$. Besar kuat arus listrik yang mengalir berdasarkan Hukum Ohm ($I = \\frac{V}{R}$) adalah ...',
      options: [
        { key: 'A', text: '$0,5\\text{ A}$' },
        { key: 'B', text: '$2\\text{ A}$' },
        { key: 'C', text: '$12\\text{ A}$' },
        { key: 'D', text: '$288\\text{ A}$' },
      ],
      correct: 'B',
      rule: {},
      explanation: '$I = \\frac{V}{R} = \\frac{24}{12} = 2\\text{ A}$.',
    },
    {
      topic: 'Pewarisan Sifat',
      type: 'pg_kompleks',
      difficulty: 'sukar',
      weight: 3,
      prompt: 'Manakah pernyataan yang benar mengenai persilangan monohibrid dominan penuh antara bunga merah ($MM$) dan bunga putih ($mm$)? Pilih semua yang benar:',
      options: [
        { key: 'A', text: 'Seluruh keturunan $F_1$ bergenotipe $Mm$' },
        { key: 'B', text: 'Seluruh keturunan $F_1$ berfenotipe merah' },
        { key: 'C', text: 'Perbandingan fenotipe $F_2$ adalah $1 : 2 : 1$' },
        { key: 'D', text: 'Alel $M$ menutupi ekspresi alel $m$ pada heterozigot' },
      ],
      correct: ['A', 'B', 'D'],
      rule: { mode: 'partial' },
      explanation: 'Pada $F_1$, semua keturunan $Mm$ (merah) karena $M$ dominan penuh. Pada $F_2$, rasio fenotipe adalah $3 : 1$, sedangkan $1 : 2 : 1$ adalah rasio genotipe.',
    },
    {
      topic: 'Kemagnetan',
      type: 'benar_salah',
      difficulty: 'mudah',
      weight: 1,
      prompt: 'Jika dua kutub magnet yang sejenis (Utara dengan Utara) didekatkan, keduanya akan saling tarik-menarik.',
      options: [
        { key: 'BENAR', text: 'Benar' },
        { key: 'SALAH', text: 'Salah' },
      ],
      correct: 'SALAH',
      rule: {},
      explanation: 'Kutub magnet yang sejenis akan saling tolak-menolak, sedangkan kutub berlawanan akan tarik-menarik.',
    },
    {
      topic: 'Tekanan Zat',
      type: 'isian_singkat',
      difficulty: 'sedang',
      weight: 2,
      prompt: 'Satuan Internasional (SI) untuk besaran tekanan adalah Pascal atau disingkat ...',
      options: [],
      correct: 'Pa',
      rule: { variations: ['pascal', 'N/m2', 'N/m^2'], case_sensitive: false },
      explanation: 'Tekanan memiliki satuan SI Pascal ($\\text{Pa}$) yang setara dengan $\\text{N/m}^2$.',
    },
  ];

  for (const q of ipaSeed) {
    const info = insertQ.run(
      subjectIdMap.IPA,
      9,
      q.topic,
      q.type,
      q.difficulty,
      q.weight,
      q.prompt,
      'none',
      '',
      JSON.stringify(q.options),
      JSON.stringify(q.correct),
      JSON.stringify(q.rule),
      q.explanation,
      guruIpaId,
      now
    );
    ipaQuestions.push(Number(info.lastInsertRowid));
  }

  // Bahasa Indonesia & Bahasa Inggris sample questions
  const extraQuestions = [
    {
      subject_id: subjectIdMap.BIN,
      grade: 9,
      topic: 'Teks Laporan Percobaan',
      type: 'pg',
      difficulty: 'mudah',
      weight: 2,
      prompt: 'Bagian struktur teks laporan percobaan yang memaparkan langkah-langkah kerja secara berurutan disebut ...',
      options: [
        { key: 'A', text: 'Tujuan' },
        { key: 'B', text: 'Alat dan Bahan' },
        { key: 'C', text: 'Prosedur / Langkah Kerja' },
        { key: 'D', text: 'Simpulan' },
      ],
      correct: 'C',
      rule: {},
      explanation: 'Prosedur atau langkah kerja berisi urutan tindakan sistematis selama percobaan berlangsung.',
      created_by: guruBinId,
    },
    {
      subject_id: subjectIdMap.BIN,
      grade: 9,
      topic: 'Teks Pidato Persuasif',
      type: 'pg',
      difficulty: 'sedang',
      weight: 2,
      prompt: 'Kalimat berikut yang mengandung majas ajakan persuasif yang paling tepat dalam penutup pidato adalah ...',
      options: [
        { key: 'A', text: 'Kemarin sekolah kita mengadakan kerja bakti di lapangan.' },
        { key: 'B', text: 'Marilah kita jaga kebersihan lingkungan sekolah demi kenyamanan belajar bersama!' },
        { key: 'C', text: 'Banyak siswa membawa botol minum pribadi dari rumah.' },
        { key: 'D', text: 'Acara dimulai pukul delapan pagi waktu setempat.' },
      ],
      correct: 'B',
      rule: {},
      explanation: 'Kata "Marilah" merupakan penanda kalimat ajakan persuasif.',
      created_by: guruBinId,
    },
    {
      subject_id: subjectIdMap.BIG,
      grade: 9,
      topic: 'Procedure Text',
      type: 'pg',
      difficulty: 'mudah',
      weight: 2,
      prompt: 'Which imperative verb is commonly used in a cooking procedure text to combine ingredients?',
      options: [
        { key: 'A', text: 'Mix' },
        { key: 'B', text: 'Sleep' },
        { key: 'C', text: 'Drive' },
        { key: 'D', text: 'Read' },
      ],
      correct: 'A',
      rule: {},
      explanation: '"Mix" berarti mencampur, yang umum dipakai dalam teks prosedur memasak.',
      created_by: adminId,
    },
    {
      subject_id: subjectIdMap.PKN,
      grade: 8,
      topic: 'Kedudukan Pancasila',
      type: 'pg',
      difficulty: 'mudah',
      weight: 2,
      prompt: 'Pancasila sebagai sumber dari segala sumber hukum di Indonesia menegaskan kedudukan Pancasila sebagai ...',
      options: [
        { key: 'A', text: 'Pandangan hidup bangsa' },
        { key: 'B', text: 'Dasar negara' },
        { key: 'C', text: 'Perjanjian luhur' },
        { key: 'D', text: 'Kepribadian bangsa' },
      ],
      correct: 'B',
      rule: {},
      explanation: 'Sebagai dasar negara, Pancasila menjadi landasan penyelenggaraan pemerintahan dan sumber hukum nasional.',
      created_by: guruBinId,
    },
  ];

  for (const q of extraQuestions) {
    insertQ.run(
      q.subject_id,
      q.grade,
      q.topic,
      q.type,
      q.difficulty,
      q.weight,
      q.prompt,
      'none',
      '',
      JSON.stringify(q.options),
      JSON.stringify(q.correct),
      JSON.stringify(q.rule),
      q.explanation,
      q.created_by,
      now
    );
  }

  // 5. Seed Active Exams (with wide today window so testers can immediately enter & take an exam!)
  const insertExam = db.prepare(`
    INSERT INTO exams (
      title, subject_id, teacher_id, class_ids_json, exam_date, start_time, end_time,
      duration_minutes, question_count, kkm, token, exam_password, max_attempts,
      shuffle_questions, shuffle_options, allow_navigation, allow_back, show_result_after,
      require_webcam, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const mtkExamId = Number(
    insertExam.run(
      'Penilaian Tengah Semester Ganjil – Matematika Kelas IX',
      subjectIdMap.MTK,
      guruMtkId,
      JSON.stringify([classIdMap['IX-A'], classIdMap['IX-B']]),
      todayDate,
      '00:00',
      '23:59',
      60,
      mtkQuestions.length,
      75,
      'MTK41A',
      '',
      2,
      1,
      1,
      1,
      1,
      1,
      0,
      'aktif',
      now
    ).lastInsertRowid
  );

  const insertExamQ = db.prepare('INSERT INTO exam_questions (exam_id, question_id, order_index) VALUES (?, ?, ?)');
  mtkQuestions.forEach((qid, idx) => {
    insertExamQ.run(mtkExamId, qid, idx + 1);
  });

  const ipaExamId = Number(
    insertExam.run(
      'Asesmen Sumatif Bab 1–3 – IPA Terpadu Kelas IX',
      subjectIdMap.IPA,
      guruIpaId,
      JSON.stringify([classIdMap['IX-A'], classIdMap['IX-B']]),
      todayDate,
      '00:00',
      '23:59',
      45,
      ipaQuestions.length,
      75,
      'IPA41B',
      '',
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      'aktif',
      now
    ).lastInsertRowid
  );

  ipaQuestions.forEach((qid, idx) => {
    insertExamQ.run(ipaExamId, qid, idx + 1);
  });
}
