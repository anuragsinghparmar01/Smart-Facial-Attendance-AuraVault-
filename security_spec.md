# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Authentication & Email Verification Invariant**: Every read and write operation requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
2. **Identity Ownership Invariant**: During creation of `FacialProfile` or `AttendanceLog`, `incoming().ownerId` must strictly equal `request.auth.uid`. `ownerId` and `createdAt` are immutable across all updates.
3. **Relational Consistency Invariant**: An `AttendanceLog` cannot be created unless its `profileId` points to an existing `/facialProfiles/{profileId}` document owned by `request.auth.uid` (or created by a verified administrator).
4. **Strict Schema & Volumetric Invariant**: Every document create and update must pass `isValidFacialProfile(incoming())` or `isValidAttendanceLog(incoming())` enforcing exact allowed keys (`hasAll` and `hasOnly`), string length bounds, regex format guards, numeric range constraints (e.g. `latitude` in `[-90, 90]`, `longitude` in `[-180, 180]`, `matchConfidence` in `[0, 100]`), and enum membership.
5. **Temporal Integrity Invariant**: `createdAt` and `updatedAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on update while `createdAt` remains equal to `existing().createdAt`.
6. **Terminal State Locking Invariant**: Once a `FacialProfile` reaches `status == 'archived'`, or an `AttendanceLog` reaches `attendanceStatus == 'revoked'`, non-admin users cannot perform further updates.
7. **Query Enforcer & Cost-Optimization Invariant**: `allow list` rules strictly verify `existing().ownerId == request.auth.uid || request.auth.token.email == 'beh246914@gmail.com'` with zero `get()` or `exists()` lookups.
8. **Privilege Escalation Prevention Invariant**: Only existing verified admins can write to `/admins/{adminUid}`; users cannot self-assign admin roles.

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on FacialProfile Create)**:
   `{ "ownerId": "spoofed_other_uid", "fullName": "Aarav Sharma", ... }` -> Must return `PERMISSION_DENIED`.
2. **Payload 2 (Unverified Email Spoof Attack)**:
   Authenticated as `beh246914@gmail.com` with `email_verified: false` attempting to read or write -> Must return `PERMISSION_DENIED`.
3. **Payload 3 (Shadow Field Injection on Create)**:
   `FacialProfile` payload containing all required keys plus `"isAdmin": true` -> Must return `PERMISSION_DENIED` via `hasOnly`.
4. **Payload 4 (Orphaned AttendanceLog Write)**:
   `AttendanceLog` creation referencing a non-existent `profileId: "missing_profile_999"` -> Must return `PERMISSION_DENIED` via `exists()` check.
5. **Payload 5 (Cross-Tenant AttendanceLog Creation)**:
   User B attempting to log attendance against User A's private `profileId` -> Must return `PERMISSION_DENIED`.
6. **Payload 6 (Immortal Field Mutation on Update)**:
   Updating `FacialProfile` while modifying `createdAt` or `ownerId` -> Must return `PERMISSION_DENIED`.
7. **Payload 7 (Client Timestamp Forgery)**:
   Creating `FacialProfile` with a forged past/future timestamp (`createdAt != request.time`) -> Must return `PERMISSION_DENIED`.
8. **Payload 8 (Terminal State Bypass)**:
   Non-admin attempting to update a `FacialProfile` whose existing `status` is `'archived'` -> Must return `PERMISSION_DENIED`.
9. **Payload 9 (Geolocation Out-of-Bounds Injection)**:
   Creating `AttendanceLog` with `latitude: 245.0` or `longitude: -500.0` -> Must return `PERMISSION_DENIED`.
10. **Payload 10 (Denial-of-Wallet Oversized String / ID Poisoning)**:
    Creating a profile with a 5,000-character `traitSignature` or invalid document ID containing spaces/symbols -> Must return `PERMISSION_DENIED`.
11. **Payload 11 (Unauthorized List Scraping)**:
    User B executing an unconstrained `list` query on `/attendanceLogs` without filtering `ownerId == request.auth.uid` -> Must return `PERMISSION_DENIED`.
12. **Payload 12 (Self-Assigned Admin Escalation)**:
    Standard user writing `{ "uid": "user_b", "role": "admin", "createdAt": request.time }` to `/admins/user_b` -> Must return `PERMISSION_DENIED`.
