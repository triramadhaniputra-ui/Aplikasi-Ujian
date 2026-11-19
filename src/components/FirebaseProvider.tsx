import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { apiFetch } from '../lib/api';
import {
  auth,
  loadFullDatabaseFromFirestore,
  saveFullDatabaseToFirestore,
  signInWithGooglePopup,
  signOutFirebaseAuth,
  subscribeFullStoreMeta,
  testConnection,
  type FirestoreConnectionState,
  type FirestoreStoreMeta,
  type FullBackupData,
} from '../lib/firebase';

const AUTO_CLOUD_SAVE_KEY = 'smart_cbt_auto_cloud_save';

export type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  connectionState: FirestoreConnectionState;
  autoCloudSave: boolean;
  setAutoCloudSave: (enabled: boolean) => void;
  cloudSaveStatus: CloudSaveStatus;
  storeMeta: FirestoreStoreMeta | null;
  signInWithGoogle: () => Promise<FirebaseUser>;
  signOutFirebase: () => Promise<void>;
  saveFullToCloud: (syncedByName: string) => Promise<{ totalRecords: number; totalChunks: number }>;
  restoreFullFromCloud: () => Promise<{ totalRecords: number }>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [connectionState, setConnectionState] = useState<FirestoreConnectionState>('checking');
  const [autoCloudSave, setAutoCloudSaveState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_CLOUD_SAVE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [cloudSaveStatus, setCloudSaveStatus] = useState<CloudSaveStatus>('idle');
  const [storeMeta, setStoreMeta] = useState<FirestoreStoreMeta | null>(null);

  const setAutoCloudSave = useCallback((enabled: boolean) => {
    setAutoCloudSaveState(enabled);
    try {
      localStorage.setItem(AUTO_CLOUD_SAVE_KEY, String(enabled));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    testConnection().then(setConnectionState);
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setStoreMeta(null);
      return;
    }
    const unsub = subscribeFullStoreMeta(
      (meta) => setStoreMeta(meta),
      () => {
        // Non-admin Firebase users will not have read access to admin full-store metadata
        setStoreMeta(null);
      }
    );
    return () => unsub();
  }, [authReady, firebaseUser?.uid]);

  const signInWithGoogle = useCallback(async () => {
    const cred = await signInWithGooglePopup();
    return cred.user;
  }, []);

  const signOutFirebase = useCallback(async () => {
    await signOutFirebaseAuth();
    setStoreMeta(null);
    setCloudSaveStatus('idle');
  }, []);

  const saveFullToCloud = useCallback(
    async (syncedByName: string) => {
      if (!firebaseUser) {
        throw new Error('Hubungkan akun Google terlebih dahulu untuk menyimpan ke Cloud Firestore.');
      }
      setCloudSaveStatus('saving');
      try {
        const backup = await apiFetch<{ data: Partial<FullBackupData> }>('/api/settings/backup');
        const result = await saveFullDatabaseToFirestore({
          uid: firebaseUser.uid,
          syncedByName,
          autoSync: autoCloudSave,
          data: backup.data || {},
        });
        setCloudSaveStatus('saved');
        return result;
      } catch (err) {
        setCloudSaveStatus('error');
        throw err;
      }
    },
    [firebaseUser, autoCloudSave]
  );

  const restoreFullFromCloud = useCallback(async () => {
    if (!firebaseUser) {
      throw new Error('Hubungkan akun Google terlebih dahulu untuk memulihkan data dari Cloud Firestore.');
    }
    const loaded = await loadFullDatabaseFromFirestore();
    if (!loaded || !loaded.data || loaded.data.users.length === 0) {
      throw new Error('Belum ada data penuh yang tersimpan di Cloud Firestore.');
    }
    await apiFetch('/api/settings/restore', {
      method: 'POST',
      body: JSON.stringify({ data: loaded.data }),
    });
    return { totalRecords: loaded.meta.totalRecords };
  }, [firebaseUser]);

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        authReady,
        connectionState,
        autoCloudSave,
        setAutoCloudSave,
        cloudSaveStatus,
        storeMeta,
        signInWithGoogle,
        signOutFirebase,
        saveFullToCloud,
        restoreFullFromCloud,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase harus digunakan di dalam FirebaseProvider.');
  }
  return ctx;
}
