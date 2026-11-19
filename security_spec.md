# SMART CBT Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Verified Identity First**: Every read/write operation requires `request.auth != null` and `request.auth.token.email_verified == true`. Unverified tokens and anonymous sessions are rejected.
2. **Bootstrapped Admin + Trusted Admin Collection**: Admin access is granted ONLY if `exists(/databases/$(database)/documents/admins/$(request.auth.uid))` OR (`request.auth.token.email == 'triramadhaniputra@gmail.com' && request.auth.token.email_verified == true`). Client custom claims are never trusted.
3. **Self-Assigned Role Prevention**: Self-created `/users/{userId}` documents must strictly set `role == 'siswa'` and `status == 'aktif'` unless written by a verified admin. Self-updates cannot alter `uid`, `role`, `status`, or `createdAt`.
4. **PII Isolation**: Sensitive user fields (`email`, `nipNis`, `className`) are isolated in `/users/{userId}/private/{docId}` and readable/writable only by `isOwner(userId)` or `isAdmin()`.
5. **Immutable Ownership & Server Timestamps**: `ownerUid` / `uid` / `createdAt` cannot change after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
6. **Terminal State Locking**: `/exams/{examId}` documents with `status == 'selesai'` are locked against further non-admin updates.
7. **Strict Key & Size Allowlisting**: Every entity validates `keys().hasAll(...)` + `keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, path `isValidId()` regex (`^[a-zA-Z0-9_\\-]+$`), and `.size()` bounds on all strings.
8. **Secure List Queries**: Every `allow list` rule evaluates `resource.data` directly (e.g., `resource.data.ownerUid == request.auth.uid`) without blanket `isSignedIn()` reads or `get()`/`exists()` loops.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: Read `/school_settings/main` or `/cbt_snapshots/latest` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Admin Spoof**: Sign in with `email: 'triramadhaniputra@gmail.com'`, `email_verified: false` -> `PERMISSION_DENIED` on `/admins/*`, `/school_settings/main`.
3. **Privilege Escalation (Self-Role)**: Create `/users/{uid}` with `role: 'admin'` by non-admin user -> `PERMISSION_DENIED`.
4. **Role Mutation on Update**: Update `/users/{uid}` changing `role` from `'siswa'` to `'guru'` -> `PERMISSION_DENIED`.
5. **Ghost / Shadow Field Injection**: Create `/subjects/MTK` with extra field `isVerified: true` -> `PERMISSION_DENIED` (`keys().hasOnly(...)`).
6. **Oversized ID Poisoning**: Write to `/subjects/` + `'A'.repeat(200)` or `'bad/id'` -> `PERMISSION_DENIED` (`isValidId`).
7. **Oversized String DoW**: Create `/exams/exam1` with `title` of 5,000 characters -> `PERMISSION_DENIED` (`size() <= 160`).
8. **Cross-Tenant PII Leak**: Read `/users/otherUid/private/profile` as non-owner non-admin -> `PERMISSION_DENIED`.
9. **Fake Client Timestamp**: Create `/cbt_snapshots/latest` with `createdAt: new Date('2020-01-01')` instead of `serverTimestamp()` -> `PERMISSION_DENIED`.
10. **Owner Hijack on Update**: Update `/exams/exam1` attempting to modify `ownerUid` -> `PERMISSION_DENIED`.
11. **Terminal State Bypass**: Non-admin attempts to update `/exams/exam1` after `existing().status == 'selesai'` -> `PERMISSION_DENIED`.
12. **Blanket Collection Scraping**: Non-owner executes `list` on `/cbt_snapshots` or `/users/{other}/private` without `where('ownerUid', '==', uid)` -> `PERMISSION_DENIED`.
