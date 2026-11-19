import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { ClassGroup, Exam, Subject, SystemSettings, UserAccount } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type FirestoreConnectionState = 'checking' | 'connected' | 'offline';

export async function testConnection(): Promise<FirestoreConnectionState> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return 'offline';
    }
    // Permission error or missing doc still confirms server reachability
    return 'connected';
  }
}

void testConnection();

export async function signInWithGooglePopup() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebaseAuth() {
  await signOut(auth);
}

function clampString(val: string, maxLength: number, fallback = ''): string {
  const trimmed = (val || fallback).trim();
  return trimmed.slice(0, maxLength);
}

function clampSafeId(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || fallback;
}

function normalizeAcademicYear(raw: string): string {
  return /^[0-9]{4}\/[0-9]{4}$/.test(raw) ? raw : '2026/2027';
}

function clampNumber(val: number, min: number, max: number): number {
  const n = Number.isFinite(val) ? val : min;
  return Math.min(max, Math.max(min, n));
}

export interface FirestoreCbtSnapshotData {
  id: string;
  ownerUid: string;
  schoolName: string;
  academicYear: string;
  semester: 'Ganjil' | 'Genap';
  totalSubjects: number;
  totalClasses: number;
  totalQuestions: number;
  totalExams: number;
  totalStudents: number;
  totalTeachers: number;
  syncedByName: string;
  updatedAt?: unknown;
}

export async function syncUserProfileToFirestore(
  appUser: UserAccount,
  firebaseUser: FirebaseUser
): Promise<void> {
  if (!firebaseUser.uid || !firebaseUser.emailVerified) return;

  const userPath = `users/${firebaseUser.uid}`;
  const privatePath = `users/${firebaseUser.uid}/private/profile`;

  try {
    const existingPublic = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (!existingPublic.exists()) {
      const isBootstrapAdmin = firebaseUser.email?.toLowerCase() === 'triramadhaniputra@gmail.com';
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        displayName: clampString(appUser.full_name || firebaseUser.displayName || 'Pengguna CBT', 120, 'Pengguna CBT'),
        role: isBootstrapAdmin ? 'admin' : 'siswa',
        status: 'aktif',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prev = existingPublic.data();
      await setDoc(
        doc(db, 'users', firebaseUser.uid),
        {
          uid: prev.uid,
          displayName: clampString(appUser.full_name || prev.displayName, 120, 'Pengguna CBT'),
          role: prev.role,
          status: prev.status,
          createdAt: prev.createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const existingPrivate = await getDoc(doc(db, 'users', firebaseUser.uid, 'private', 'profile'));
    if (!existingPrivate.exists()) {
      await setDoc(doc(db, 'users', firebaseUser.uid, 'private', 'profile'), {
        uid: firebaseUser.uid,
        email: clampString(firebaseUser.email || '', 160, 'user@example.com'),
        nipNis: clampString(appUser.nip_nis || '', 40, ''),
        className: clampString(appUser.class_name || '', 40, ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prev = existingPrivate.data();
      await setDoc(
        doc(db, 'users', firebaseUser.uid, 'private', 'profile'),
        {
          uid: prev.uid,
          email: prev.email,
          nipNis: clampString(appUser.nip_nis || '', 40, ''),
          className: clampString(appUser.class_name || '', 40, ''),
          createdAt: prev.createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function syncSchoolSettingsToFirestore(
  settings: SystemSettings,
  uid: string
): Promise<void> {
  const path = 'school_settings/main';
  try {
    const ref = doc(db, 'school_settings', 'main');
    const existingSnap = await getDoc(ref);
    const payload = {
      schoolName: clampString(settings.school_name, 150, 'SMP Negeri 41 Muaro Jambi'),
      schoolLogo: clampString(settings.school_logo, 500, '/logo-smpn41-muaro-jambi.svg'),
      academicYear: normalizeAcademicYear(settings.academic_year),
      semester: settings.semester === 'Genap' ? 'Genap' : 'Ganjil',
      defaultKkm: clampNumber(settings.default_kkm, 0, 100),
      defaultDuration: clampNumber(settings.default_duration, 5, 300),
      autoLogoutMinutes: clampNumber(settings.auto_logout_minutes, 5, 480),
      requireWebcam: Boolean(settings.require_webcam),
      maxViolations: clampNumber(settings.max_violations, 1, 20),
      tabSwitchDetection: Boolean(settings.tab_switch_detection),
      allowTokenAutoRotate: Boolean(settings.allow_token_auto_rotate),
      notificationsEnabled: Boolean(settings.notifications_enabled),
      updatedByUid: uid,
      createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncCbtWorkspaceToFirestore(params: {
  uid: string;
  syncedByName: string;
  settings: SystemSettings;
  subjects: Subject[];
  classes: ClassGroup[];
  exams: Exam[];
  totalQuestions: number;
  totalStudents: number;
  totalTeachers: number;
}): Promise<void> {
  const { uid, syncedByName, settings, subjects, classes, exams, totalQuestions, totalStudents, totalTeachers } = params;

  await syncSchoolSettingsToFirestore(settings, uid);

  const snapshotPath = 'cbt_snapshots/latest';
  try {
    const snapRef = doc(db, 'cbt_snapshots', 'latest');
    const existingSnap = await getDoc(snapRef);
    await setDoc(snapRef, {
      ownerUid: existingSnap.exists() ? existingSnap.data().ownerUid : uid,
      schoolName: clampString(settings.school_name, 150, 'SMP Negeri 41 Muaro Jambi'),
      academicYear: normalizeAcademicYear(settings.academic_year),
      semester: settings.semester === 'Genap' ? 'Genap' : 'Ganjil',
      totalSubjects: Math.max(0, subjects.length),
      totalClasses: Math.max(0, classes.length),
      totalQuestions: Math.max(0, totalQuestions),
      totalExams: Math.max(0, exams.length),
      totalStudents: Math.max(0, totalStudents),
      totalTeachers: Math.max(0, totalTeachers),
      syncedByName: clampString(syncedByName, 120, 'Administrator'),
      createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, snapshotPath);
  }

  // Batch sync subjects & classes & recent exams (chunked <= 400 writes per batch)
  const batch = writeBatch(db);
  let opCount = 0;

  try {
    for (const subj of subjects.slice(0, 100)) {
      const code = clampString(subj.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '_'), 20, `MAPEL_${subj.id}`);
      const id = clampSafeId(`sub_${subj.id}`, `sub_${subj.id}`);
      const ref = doc(db, 'subjects', id);
      const prev = await getDoc(ref);
      batch.set(ref, {
        ownerUid: prev.exists() ? prev.data().ownerUid : uid,
        code,
        name: clampString(subj.name, 100, code),
        kkm: clampNumber(subj.kkm, 0, 100),
        createdAt: prev.exists() ? prev.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      opCount += 1;
    }

    for (const cls of classes.slice(0, 100)) {
      const id = clampSafeId(`cls_${cls.id}`, `cls_${cls.id}`);
      const ref = doc(db, 'classes', id);
      const prev = await getDoc(ref);
      batch.set(ref, {
        ownerUid: prev.exists() ? prev.data().ownerUid : uid,
        name: clampString(cls.name, 40, `Kelas ${cls.id}`),
        gradeLevel: clampNumber(cls.grade_level, 1, 12),
        studentCount: clampNumber(cls.student_count || 0, 0, 500),
        createdAt: prev.exists() ? prev.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      opCount += 1;
    }

    for (const ex of exams.slice(0, 100)) {
      const id = clampSafeId(`exam_${ex.id}`, `exam_${ex.id}`);
      const ref = doc(db, 'exams', id);
      const prev = await getDoc(ref);
      const safeCode = clampString((ex.subject_code || 'CBT').toUpperCase().replace(/[^A-Z0-9_-]/g, '_'), 20, 'CBT');
      const safeDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ex.exam_date) ? ex.exam_date : new Date().toISOString().slice(0, 10);
      batch.set(ref, {
        ownerUid: prev.exists() ? prev.data().ownerUid : uid,
        title: clampString(ex.title, 160, 'Ujian CBT'),
        subjectCode: safeCode,
        subjectName: clampString(ex.subject_name || safeCode, 100, safeCode),
        examDate: safeDate,
        durationMinutes: clampNumber(ex.duration_minutes, 5, 300),
        questionCount: clampNumber(ex.question_count, 1, 500),
        kkm: clampNumber(ex.kkm, 0, 100),
        status: ex.status === 'aktif' || ex.status === 'selesai' ? ex.status : 'draft',
        createdAt: prev.exists() ? prev.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      opCount += 1;
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'subjects_classes_exams_batch');
  }
}

export function subscribeMyCbtSnapshots(
  uid: string,
  onData: (snapshots: FirestoreCbtSnapshotData[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'cbt_snapshots';
  const q = query(collection(db, path), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows: FirestoreCbtSnapshotData[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerUid: String(data.ownerUid || ''),
          schoolName: String(data.schoolName || ''),
          academicYear: String(data.academicYear || ''),
          semester: data.semester === 'Genap' ? 'Genap' : 'Ganjil',
          totalSubjects: Number(data.totalSubjects || 0),
          totalClasses: Number(data.totalClasses || 0),
          totalQuestions: Number(data.totalQuestions || 0),
          totalExams: Number(data.totalExams || 0),
          totalStudents: Number(data.totalStudents || 0),
          totalTeachers: Number(data.totalTeachers || 0),
          syncedByName: String(data.syncedByName || ''),
          updatedAt: data.updatedAt,
        };
      });
      onData(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        } else {
          throw wrapped;
        }
      }
    }
  );
}

// ===========================================
// FULL STORAGE MODE (ALL 10 CBT TABLES)
// ===========================================
export const FULL_STORE_TABLES = [
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
] as const;

export type FullStoreTableName = (typeof FULL_STORE_TABLES)[number];
export type FullBackupData = Record<FullStoreTableName, Array<Record<string, unknown>>>;

export interface FirestoreStoreMeta {
  ownerUid: string;
  storageMode: 'full_cloud' | 'hybrid';
  autoSync: boolean;
  totalRecords: number;
  totalChunks: number;
  chunkIds: string[];
  syncedByName: string;
  updatedAtMs: number | null;
}

function sanitizeRecordForFirestore(record: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) {
      clean[k] = null;
    } else if (typeof v === 'string' && v.length > 650_000) {
      // Safeguard against single-field >650KB breaching Firestore 1MB document limit
      clean[k] = v.slice(0, 650_000);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function chunkTableRecords(
  records: Array<Record<string, unknown>>,
  maxRecordsPerChunk = 40,
  maxBytesPerChunk = 420_000
): Array<Array<Record<string, unknown>>> {
  if (!Array.isArray(records) || records.length === 0) return [];
  const chunks: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  let currentBytes = 0;

  for (const raw of records) {
    const rec = sanitizeRecordForFirestore(raw);
    const estBytes = JSON.stringify(rec).length;
    if (
      current.length > 0 &&
      (current.length >= maxRecordsPerChunk || currentBytes + estBytes > maxBytesPerChunk)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(rec);
    currentBytes += estBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function saveFullDatabaseToFirestore(params: {
  uid: string;
  syncedByName: string;
  autoSync: boolean;
  data: Partial<FullBackupData>;
}): Promise<{ totalRecords: number; totalChunks: number }> {
  const { uid, syncedByName, autoSync, data } = params;
  const metaPath = 'cbt_store_meta/main';

  let previousChunkIds: string[] = [];
  let existingMetaCreatedAt: unknown = null;
  let existingMetaOwnerUid: string | null = null;
  try {
    const prevMetaSnap = await getDoc(doc(db, 'cbt_store_meta', 'main'));
    if (prevMetaSnap.exists()) {
      const prevData = prevMetaSnap.data();
      previousChunkIds = Array.isArray(prevData.chunkIds)
        ? prevData.chunkIds.map((x: unknown) => String(x))
        : [];
      existingMetaCreatedAt = prevData.createdAt || null;
      existingMetaOwnerUid = typeof prevData.ownerUid === 'string' ? prevData.ownerUid : null;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, metaPath);
  }

  const chunkEntries: Array<{
    chunkId: string;
    tableName: FullStoreTableName;
    chunkIndex: number;
    totalChunks: number;
    records: Array<Record<string, unknown>>;
  }> = [];

  let totalRecords = 0;
  for (const tableName of FULL_STORE_TABLES) {
    const rows = Array.isArray(data[tableName]) ? data[tableName]! : [];
    totalRecords += rows.length;
    const chunks = chunkTableRecords(rows, 40, 420_000);
    chunks.forEach((records, idx) => {
      chunkEntries.push({
        chunkId: `${tableName}_${idx}`,
        tableName,
        chunkIndex: idx,
        totalChunks: chunks.length,
        records,
      });
    });
  }

  const activeChunkIds = chunkEntries.map((c) => c.chunkId).slice(0, 200);
  const activeSet = new Set(activeChunkIds);
  const obsoleteChunkIds = previousChunkIds.filter((id) => !activeSet.has(id));

  // Write chunks in safe Firestore batches (<= 200 writes per batch)
  const BATCH_SIZE = 150;
  try {
    for (let i = 0; i < chunkEntries.length; i += BATCH_SIZE) {
      const slice = chunkEntries.slice(i, i + BATCH_SIZE);
      const existingDocs = await Promise.all(
        slice.map((entry) => getDoc(doc(db, 'cbt_full_store', entry.chunkId)))
      );
      const batch = writeBatch(db);
      slice.forEach((entry, idx) => {
        const ref = doc(db, 'cbt_full_store', entry.chunkId);
        const prev = existingDocs[idx];
        batch.set(ref, {
          ownerUid: prev.exists() ? prev.data().ownerUid : uid,
          tableName: entry.tableName,
          chunkIndex: entry.chunkIndex,
          totalChunks: entry.totalChunks,
          recordCount: entry.records.length,
          records: entry.records,
          createdAt: prev.exists() ? prev.data().createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    // Delete obsolete chunks if dataset shrank
    if (obsoleteChunkIds.length > 0) {
      const delBatch = writeBatch(db);
      for (const oldId of obsoleteChunkIds.slice(0, 200)) {
        delBatch.delete(doc(db, 'cbt_full_store', oldId));
      }
      await delBatch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'cbt_full_store');
  }

  // Update metadata index document
  try {
    await setDoc(doc(db, 'cbt_store_meta', 'main'), {
      ownerUid: existingMetaOwnerUid || uid,
      storageMode: 'full_cloud',
      autoSync: Boolean(autoSync),
      totalRecords,
      totalChunks: activeChunkIds.length,
      chunkIds: activeChunkIds,
      syncedByName: clampString(syncedByName, 120, 'Administrator'),
      createdAt: existingMetaCreatedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, metaPath);
  }

  // Also keep cbt_snapshots/latest synchronized for dashboard summary consistency
  try {
    const sysRow = (data.system_settings?.[0] || {}) as Record<string, unknown>;
    const users = data.users || [];
    const totalStudents = users.filter((u) => u.role === 'siswa' && u.status === 'aktif').length;
    const totalTeachers = users.filter((u) => u.role === 'guru' && u.status === 'aktif').length;
    const snapRef = doc(db, 'cbt_snapshots', 'latest');
    const prevSnap = await getDoc(snapRef);
    await setDoc(snapRef, {
      ownerUid: prevSnap.exists() ? prevSnap.data().ownerUid : uid,
      schoolName: clampString(String(sysRow.school_name || 'SMP Negeri 41 Muaro Jambi'), 150, 'SMP Negeri 41 Muaro Jambi'),
      academicYear: normalizeAcademicYear(String(sysRow.academic_year || '2026/2027')),
      semester: sysRow.semester === 'Genap' ? 'Genap' : 'Ganjil',
      totalSubjects: (data.subjects || []).length,
      totalClasses: (data.classes || []).length,
      totalQuestions: (data.questions || []).length,
      totalExams: (data.exams || []).length,
      totalStudents,
      totalTeachers,
      syncedByName: clampString(syncedByName, 120, 'Administrator'),
      createdAt: prevSnap.exists() ? prevSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'cbt_snapshots/latest');
  }

  return { totalRecords, totalChunks: activeChunkIds.length };
}

export async function loadFullDatabaseFromFirestore(): Promise<{
  meta: FirestoreStoreMeta;
  data: FullBackupData;
} | null> {
  const metaPath = 'cbt_store_meta/main';
  let metaSnap;
  try {
    metaSnap = await getDocFromServer(doc(db, 'cbt_store_meta', 'main'));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, metaPath);
  }

  if (!metaSnap.exists()) return null;
  const rawMeta = metaSnap.data();
  const chunkIds: string[] = Array.isArray(rawMeta.chunkIds)
    ? rawMeta.chunkIds.map((x: unknown) => String(x))
    : [];

  const assembled: FullBackupData = {
    system_settings: [],
    classes: [],
    subjects: [],
    users: [],
    questions: [],
    exams: [],
    exam_questions: [],
    exam_attempts: [],
    student_answers: [],
    violation_logs: [],
  };

  try {
    const chunkSnaps = await Promise.all(
      chunkIds.map((id) => getDocFromServer(doc(db, 'cbt_full_store', id)))
    );

    const grouped: Record<string, Array<{ idx: number; records: Array<Record<string, unknown>> }>> = {};
    for (const snap of chunkSnaps) {
      if (!snap.exists()) continue;
      const d = snap.data();
      const table = String(d.tableName || '') as FullStoreTableName;
      if (!FULL_STORE_TABLES.includes(table)) continue;
      if (!grouped[table]) grouped[table] = [];
      grouped[table].push({
        idx: Number(d.chunkIndex || 0),
        records: Array.isArray(d.records) ? (d.records as Array<Record<string, unknown>>) : [],
      });
    }

    for (const table of FULL_STORE_TABLES) {
      const parts = (grouped[table] || []).sort((a, b) => a.idx - b.idx);
      assembled[table] = parts.flatMap((p) => p.records);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'cbt_full_store');
  }

  const updatedAtObj = rawMeta.updatedAt as { toMillis?: () => number } | undefined;
  const meta: FirestoreStoreMeta = {
    ownerUid: String(rawMeta.ownerUid || ''),
    storageMode: rawMeta.storageMode === 'hybrid' ? 'hybrid' : 'full_cloud',
    autoSync: Boolean(rawMeta.autoSync),
    totalRecords: Number(rawMeta.totalRecords || 0),
    totalChunks: Number(rawMeta.totalChunks || chunkIds.length),
    chunkIds,
    syncedByName: String(rawMeta.syncedByName || ''),
    updatedAtMs: typeof updatedAtObj?.toMillis === 'function' ? updatedAtObj.toMillis() : null,
  };

  return { meta, data: assembled };
}

export function subscribeFullStoreMeta(
  onData: (meta: FirestoreStoreMeta | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'cbt_store_meta/main';
  return onSnapshot(
    doc(db, 'cbt_store_meta', 'main'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      const updatedAtObj = d.updatedAt as { toMillis?: () => number } | undefined;
      onData({
        ownerUid: String(d.ownerUid || ''),
        storageMode: d.storageMode === 'hybrid' ? 'hybrid' : 'full_cloud',
        autoSync: Boolean(d.autoSync),
        totalRecords: Number(d.totalRecords || 0),
        totalChunks: Number(d.totalChunks || 0),
        chunkIds: Array.isArray(d.chunkIds) ? d.chunkIds.map((x: unknown) => String(x)) : [],
        syncedByName: String(d.syncedByName || ''),
        updatedAtMs: typeof updatedAtObj?.toMillis === 'function' ? updatedAtObj.toMillis() : null,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        } else {
          throw wrapped;
        }
      }
    }
  );
}

