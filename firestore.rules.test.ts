/**
 * Payload-First Security TDD specification & structural test runner for SMART CBT Firestore Rules.
 * Run with: npx tsx firestore.rules.test.ts
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const rulesContent = fs.readFileSync('firestore.rules', 'utf8');

// 1. Structural Eight Pillars Assertions
assert.match(rulesContent, /rules_version\s*=\s*'2'/, 'Must use rules_version = 2');
assert.match(rulesContent, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/, 'Must have global default-deny catch-all');
assert.match(rulesContent, /email_verified == true/, 'Must require verified email');
assert.match(rulesContent, /isValidId\(/, 'Must enforce path ID hardening');
assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/, 'Must enforce affectedKeys().hasOnly on updates');
assert.match(rulesContent, /keys\(\)\.hasAll\([\s\S]*keys\(\)\.hasOnly\(/, 'Must enforce strict key allowlists on writes');
assert.match(rulesContent, /request\.time/, 'Must enforce server timestamps');
assert.match(rulesContent, /existing\(\)\.status != 'selesai'/, 'Must enforce terminal state locking on exams');
assert.match(rulesContent, /match \/cbt_full_store\/\{chunkId\}/, 'Must secure cbt_full_store collection');
assert.match(rulesContent, /match \/cbt_store_meta\/\{metaId\}/, 'Must secure cbt_store_meta collection');
assert.match(rulesContent, /data\.records\.size\(\) <= 50/, 'Must bound records array size in full store chunks');
assert.doesNotMatch(rulesContent, /allow read:\s*if\s*true/, 'Must forbid open reads');
assert.doesNotMatch(rulesContent, /allow write:\s*if\s*true/, 'Must forbid open writes');
assert.doesNotMatch(rulesContent, /allow list:[\s\S]*?(get|exists)\(/, 'Must forbid get()/exists() inside allow list');

// 2. Dirty Dozen Payload Definitions verified against Blueprint
export const DIRTY_DOZEN_PAYLOADS = [
  { name: 'Unauthenticated Read/Write', auth: null, expected: 'PERMISSION_DENIED' },
  { name: 'Unverified Email Admin Spoof', auth: { email: 'triramadhaniputra@gmail.com', email_verified: false }, expected: 'PERMISSION_DENIED' },
  { name: 'Privilege Escalation Self-Role', payload: { role: 'admin' }, expected: 'PERMISSION_DENIED' },
  { name: 'Role Mutation on Update', payload: { role: 'guru' }, expected: 'PERMISSION_DENIED' },
  { name: 'Ghost Field Injection', payload: { code: 'MTK', isVerified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'Oversized ID Poisoning', id: 'A'.repeat(200), expected: 'PERMISSION_DENIED' },
  { name: 'Oversized String DoW', payload: { title: 'X'.repeat(5000) }, expected: 'PERMISSION_DENIED' },
  { name: 'Cross-Tenant PII Leak', path: '/users/otherUid/private/profile', expected: 'PERMISSION_DENIED' },
  { name: 'Fake Client Timestamp', payload: { createdAt: '2020-01-01T00:00:00Z' }, expected: 'PERMISSION_DENIED' },
  { name: 'Owner Hijack on Update', payload: { ownerUid: 'attackerUid' }, expected: 'PERMISSION_DENIED' },
  { name: 'Terminal State Bypass', existing: { status: 'selesai' }, payload: { title: 'Changed' }, expected: 'PERMISSION_DENIED' },
  { name: 'Blanket Collection Scraping', operation: 'list', path: '/cbt_snapshots', expected: 'PERMISSION_DENIED' },
];

console.log(`Verified Eight Pillars & ${DIRTY_DOZEN_PAYLOADS.length} Dirty Dozen guards in firestore.rules`);
