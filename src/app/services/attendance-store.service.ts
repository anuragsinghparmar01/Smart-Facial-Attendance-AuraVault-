import { Injectable, signal, computed } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase.client';
import {
  AttendanceLog,
  AttendanceStatus,
  buildSeedAttendanceLogs,
  buildSeedFacialProfiles,
  computeHashFromSignature,
  FacialProfile,
  generateDeterministicVector,
  MonthlyEmployeeSummary,
  ProfileStatus,
  vectorToSignature,
  VerificationMethod,
} from '../models/attendance.models';

const LOCAL_PROFILES_KEY = 'auravault_facial_profiles_v2';
const LOCAL_LOGS_KEY = 'auravault_attendance_logs_v2';
const WORKSPACE_OWNER_ID = 'shared_workspace';

@Injectable({
  providedIn: 'root',
})
export class AttendanceStoreService {
  readonly cloudSynced = signal<boolean>(false);
  readonly syncBusy = signal<boolean>(false);
  readonly statusBanner = signal<{ type: 'success' | 'warning' | 'error'; message: string } | null>(
    null
  );

  // Password 123456 gate for Confidential Admin Vault
  readonly isAdminUnlocked = signal<boolean>(false);

  readonly facialProfiles = signal<FacialProfile[]>([]);
  readonly attendanceLogs = signal<AttendanceLog[]>([]);

  private profilesUnsub: Unsubscribe | null = null;
  private logsUnsub: Unsubscribe | null = null;
  private hasAttemptedSeed = false;

  readonly activeProfilesCount = computed(
    () => this.facialProfiles().filter((p) => p.status === 'active').length
  );

  readonly todayLogsCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.attendanceLogs().filter((l) => l.dateKey === today).length;
  });

  constructor() {
    this.loadInitialLocalCache();
    this.connectAutomaticFirebaseStream();
  }

  private loadInitialLocalCache(): void {
    if (typeof window === 'undefined') {
      const seededProfiles = buildSeedFacialProfiles(WORKSPACE_OWNER_ID);
      this.facialProfiles.set(seededProfiles);
      this.attendanceLogs.set(buildSeedAttendanceLogs(WORKSPACE_OWNER_ID, seededProfiles));
      return;
    }

    try {
      const savedProfiles = localStorage.getItem(LOCAL_PROFILES_KEY);
      const savedLogs = localStorage.getItem(LOCAL_LOGS_KEY);

      if (savedProfiles && savedLogs) {
        const parsedProfiles = JSON.parse(savedProfiles) as FacialProfile[];
        const parsedLogs = JSON.parse(savedLogs) as AttendanceLog[];
        if (Array.isArray(parsedProfiles) && Array.isArray(parsedLogs) && parsedProfiles.length > 0) {
          this.facialProfiles.set(parsedProfiles);
          this.attendanceLogs.set(parsedLogs);
          return;
        }
      }
    } catch {
      // Fallback to seed data
    }

    const seededProfiles = buildSeedFacialProfiles(WORKSPACE_OWNER_ID);
    const seededLogs = buildSeedAttendanceLogs(WORKSPACE_OWNER_ID, seededProfiles);
    this.facialProfiles.set(seededProfiles);
    this.attendanceLogs.set(seededLogs);
    this.saveToLocalCache(seededProfiles, seededLogs);
  }

  private saveToLocalCache(profiles: FacialProfile[], logs: AttendanceLog[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
      localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(logs));
    } catch {
      // Ignore storage quota errors
    }
  }

  /**
   * Automatically connects to the owner's Cloud Firestore database on app startup
   * without requiring users to click any "Connect Database" button.
   */
  private connectAutomaticFirebaseStream(): void {
    if (typeof window === 'undefined') return;

    const profilesPath = 'facialProfiles';
    const profilesQuery = query(
      collection(db, profilesPath),
      where('ownerId', '==', WORKSPACE_OWNER_ID)
    );

    this.profilesUnsub = onSnapshot(
      profilesQuery,
      async (snapshot) => {
        if (snapshot.empty && !this.hasAttemptedSeed) {
          this.hasAttemptedSeed = true;
          await this.seedCloudDatabase();
          return;
        }

        const loaded: FacialProfile[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d['ownerId'] || WORKSPACE_OWNER_ID),
            fullName: String(d['fullName'] || ''),
            employeeCode: String(d['employeeCode'] || ''),
            branch: String(d['branch'] || ''),
            roleTitle: String(d['roleTitle'] || ''),
            traitSignature: String(d['traitSignature'] || ''),
            interocularRatio: Number(d['interocularRatio'] || 0.38),
            symmetryScore: Number(d['symmetryScore'] || 96),
            descriptorHash: String(d['descriptorHash'] || ''),
            status: (d['status'] as ProfileStatus) || 'active',
            createdAtIso:
              d['createdAt'] instanceof Timestamp
                ? d['createdAt'].toDate().toISOString()
                : new Date().toISOString(),
            updatedAtIso:
              d['updatedAt'] instanceof Timestamp
                ? d['updatedAt'].toDate().toISOString()
                : new Date().toISOString(),
          };
        });

        if (loaded.length > 0) {
          this.facialProfiles.set(loaded);
          this.cloudSynced.set(true);
          this.saveToLocalCache(loaded, this.attendanceLogs());
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, profilesPath);
      }
    );

    const logsPath = 'attendanceLogs';
    const logsQuery = query(
      collection(db, logsPath),
      where('ownerId', '==', WORKSPACE_OWNER_ID)
    );

    this.logsUnsub = onSnapshot(
      logsQuery,
      (snapshot) => {
        const loadedLogs: AttendanceLog[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d['ownerId'] || WORKSPACE_OWNER_ID),
            profileId: String(d['profileId'] || ''),
            fullName: String(d['fullName'] || ''),
            employeeCode: String(d['employeeCode'] || ''),
            branch: String(d['branch'] || ''),
            attendanceStatus: (d['attendanceStatus'] as AttendanceStatus) || 'present',
            verificationMethod:
              (d['verificationMethod'] as VerificationMethod) || 'facial_biometric',
            matchConfidence: Number(d['matchConfidence'] || 98),
            latitude: Number(d['latitude'] || 0),
            longitude: Number(d['longitude'] || 0),
            locationName: String(d['locationName'] || ''),
            monthKey: String(d['monthKey'] || ''),
            dateKey: String(d['dateKey'] || ''),
            timeLabel: String(d['timeLabel'] || ''),
            createdAtIso:
              d['createdAt'] instanceof Timestamp
                ? d['createdAt'].toDate().toISOString()
                : new Date().toISOString(),
            updatedAtIso:
              d['updatedAt'] instanceof Timestamp
                ? d['updatedAt'].toDate().toISOString()
                : new Date().toISOString(),
          };
        });

        loadedLogs.sort((a, b) => {
          const keyA = `${a.dateKey}_${a.timeLabel}_${a.createdAtIso}`;
          const keyB = `${b.dateKey}_${b.timeLabel}_${b.createdAtIso}`;
          return keyB.localeCompare(keyA);
        });

        if (loadedLogs.length > 0 || this.cloudSynced()) {
          this.attendanceLogs.set(loadedLogs);
          this.cloudSynced.set(true);
          this.saveToLocalCache(this.facialProfiles(), loadedLogs);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, logsPath);
      }
    );
  }

  private async seedCloudDatabase(): Promise<void> {
    this.syncBusy.set(true);
    const profiles = buildSeedFacialProfiles(WORKSPACE_OWNER_ID);
    const logs = buildSeedAttendanceLogs(WORKSPACE_OWNER_ID, profiles);

    try {
      for (const p of profiles) {
        const safeId = this.sanitizeDocId(p.id);
        await setDoc(doc(db, 'facialProfiles', safeId), {
          ownerId: WORKSPACE_OWNER_ID,
          fullName: p.fullName.slice(0, 80),
          employeeCode: this.sanitizeCode(p.employeeCode),
          branch: p.branch.slice(0, 60),
          roleTitle: p.roleTitle.slice(0, 60),
          traitSignature: p.traitSignature.slice(0, 2048),
          interocularRatio: Number(Math.max(0.05, Math.min(1.0, p.interocularRatio)).toFixed(4)),
          symmetryScore: Number(Math.max(0, Math.min(100, p.symmetryScore)).toFixed(1)),
          descriptorHash: this.sanitizeCode(p.descriptorHash),
          status: p.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const l of logs) {
        const safeLogId = this.sanitizeDocId(l.id);
        await setDoc(doc(db, 'attendanceLogs', safeLogId), {
          ownerId: WORKSPACE_OWNER_ID,
          profileId: this.sanitizeDocId(l.profileId),
          fullName: l.fullName.slice(0, 80),
          employeeCode: this.sanitizeCode(l.employeeCode),
          branch: l.branch.slice(0, 60),
          attendanceStatus: l.attendanceStatus,
          verificationMethod: l.verificationMethod,
          matchConfidence: Number(Math.max(0, Math.min(100, l.matchConfidence)).toFixed(1)),
          latitude: Number(Math.max(-90, Math.min(90, l.latitude)).toFixed(5)),
          longitude: Number(Math.max(-180, Math.min(180, l.longitude)).toFixed(5)),
          locationName: l.locationName.slice(0, 160),
          monthKey: l.monthKey,
          dateKey: l.dateKey,
          timeLabel: l.timeLabel.slice(0, 20),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      this.cloudSynced.set(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'facialProfiles');
    } finally {
      this.syncBusy.set(false);
    }
  }

  async restoreDefaultSampleData(): Promise<void> {
    await this.seedCloudDatabase();
    this.notify('success', 'Restored sample people and attendance records in Firebase.');
  }

  verifyAccessPassword(passwordInput: string): boolean {
    if (passwordInput.trim() === '123456') {
      this.isAdminUnlocked.set(true);
      this.notify('success', 'Admin area unlocked! You can now see and edit everything.');
      return true;
    }
    this.notify('error', 'Wrong password. Please type 123456 to open Admin.');
    return false;
  }

  lockVault(): void {
    this.isAdminUnlocked.set(false);
    this.notify('warning', 'Admin area locked to keep everyone’s data private.');
  }

  async enrollFacialProfile(input: {
    fullName: string;
    employeeCode: string;
    branch: string;
    roleTitle: string;
    traitSignature: string;
    interocularRatio: number;
    symmetryScore: number;
    descriptorHash: string;
  }): Promise<FacialProfile> {
    const docId = this.sanitizeDocId(`prof_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    const nowIso = new Date().toISOString();

    const newProfile: FacialProfile = {
      id: docId,
      ownerId: WORKSPACE_OWNER_ID,
      fullName: input.fullName.trim().slice(0, 80),
      employeeCode: this.sanitizeCode(input.employeeCode),
      branch: input.branch.trim().slice(0, 60),
      roleTitle: (input.roleTitle.trim() || 'Member').slice(0, 60),
      traitSignature: input.traitSignature.slice(0, 2048),
      interocularRatio: Number(Math.max(0.05, Math.min(1.0, input.interocularRatio)).toFixed(4)),
      symmetryScore: Number(Math.max(0, Math.min(100, input.symmetryScore)).toFixed(1)),
      descriptorHash: this.sanitizeCode(input.descriptorHash),
      status: 'active',
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };

    const updatedList = [newProfile, ...this.facialProfiles()];
    this.facialProfiles.set(updatedList);
    this.saveToLocalCache(updatedList, this.attendanceLogs());

    try {
      await setDoc(doc(db, 'facialProfiles', docId), {
        ownerId: WORKSPACE_OWNER_ID,
        fullName: newProfile.fullName,
        employeeCode: newProfile.employeeCode,
        branch: newProfile.branch,
        roleTitle: newProfile.roleTitle,
        traitSignature: newProfile.traitSignature,
        interocularRatio: newProfile.interocularRatio,
        symmetryScore: newProfile.symmetryScore,
        descriptorHash: newProfile.descriptorHash,
        status: newProfile.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `facialProfiles/${docId}`);
    }

    this.notify('success', `Saved ${newProfile.fullName}'s face to Firebase!`);
    return newProfile;
  }

  async quickAddCustomAttendanceData(input: {
    fullName: string;
    employeeCode: string;
    branch: string;
    attendanceStatus: AttendanceStatus;
    latitude: number;
    longitude: number;
    locationName: string;
  }): Promise<AttendanceLog> {
    const cleanName = input.fullName.trim();
    let targetProfile = this.facialProfiles().find(
      (p) =>
        p.fullName.toLowerCase() === cleanName.toLowerCase() ||
        p.employeeCode.toLowerCase() === input.employeeCode.trim().toLowerCase()
    );

    if (!targetProfile) {
      const vec = generateDeterministicVector(Date.now() % 100000);
      const sig = vectorToSignature(vec);
      targetProfile = await this.enrollFacialProfile({
        fullName: cleanName,
        employeeCode: input.employeeCode,
        branch: input.branch,
        roleTitle: 'Member',
        traitSignature: sig,
        interocularRatio: 0.378,
        symmetryScore: 97.5,
        descriptorHash: computeHashFromSignature(sig),
      });
    }

    return this.recordAttendance({
      profile: targetProfile,
      attendanceStatus: input.attendanceStatus,
      verificationMethod: 'facial_biometric',
      matchConfidence: 98.6,
      latitude: input.latitude,
      longitude: input.longitude,
      locationName: input.locationName,
    });
  }

  async recordAttendance(input: {
    profile: FacialProfile;
    attendanceStatus: AttendanceStatus;
    verificationMethod: VerificationMethod;
    matchConfidence: number;
    latitude: number;
    longitude: number;
    locationName: string;
  }): Promise<AttendanceLog> {
    const logId = this.sanitizeDocId(`log_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const monthKey = `${year}-${month}`;
    const dateKey = `${year}-${month}-${day}`;
    const timeLabel = now
      .toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
      .slice(0, 20);

    const newLog: AttendanceLog = {
      id: logId,
      ownerId: WORKSPACE_OWNER_ID,
      profileId: this.sanitizeDocId(input.profile.id),
      fullName: input.profile.fullName.slice(0, 80),
      employeeCode: this.sanitizeCode(input.profile.employeeCode),
      branch: input.profile.branch.slice(0, 60),
      attendanceStatus: input.attendanceStatus,
      verificationMethod: input.verificationMethod,
      matchConfidence: Number(Math.max(0, Math.min(100, input.matchConfidence)).toFixed(1)),
      latitude: Number(Math.max(-90, Math.min(90, input.latitude)).toFixed(5)),
      longitude: Number(Math.max(-180, Math.min(180, lOrDefault(input.longitude))).toFixed(5)),
      locationName: (input.locationName || 'Office Camera').slice(0, 160),
      monthKey,
      dateKey,
      timeLabel,
      createdAtIso: now.toISOString(),
      updatedAtIso: now.toISOString(),
    };

    const updatedLogs = [newLog, ...this.attendanceLogs()];
    this.attendanceLogs.set(updatedLogs);
    this.saveToLocalCache(this.facialProfiles(), updatedLogs);

    try {
      await setDoc(doc(db, 'attendanceLogs', logId), {
        ownerId: WORKSPACE_OWNER_ID,
        profileId: newLog.profileId,
        fullName: newLog.fullName,
        employeeCode: newLog.employeeCode,
        branch: newLog.branch,
        attendanceStatus: newLog.attendanceStatus,
        verificationMethod: newLog.verificationMethod,
        matchConfidence: newLog.matchConfidence,
        latitude: newLog.latitude,
        longitude: newLog.longitude,
        locationName: newLog.locationName,
        monthKey: newLog.monthKey,
        dateKey: newLog.dateKey,
        timeLabel: newLog.timeLabel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `attendanceLogs/${logId}`);
    }

    this.notify(
      'success',
      `Attendance marked for ${newLog.fullName} (${newLog.branch}) at ${newLog.timeLabel}!`
    );
    return newLog;
  }

  async updateFacialProfileDetails(
    profileId: string,
    changes: {
      fullName: string;
      employeeCode: string;
      branch: string;
      roleTitle: string;
      status: ProfileStatus;
    }
  ): Promise<void> {
    const safeFullName = changes.fullName.trim().slice(0, 80);
    const safeCode = this.sanitizeCode(changes.employeeCode);
    const safeBranch = changes.branch.trim().slice(0, 60);
    const safeRole = changes.roleTitle.trim().slice(0, 60);

    const updated = this.facialProfiles().map((p) =>
      p.id === profileId
        ? {
            ...p,
            fullName: safeFullName,
            employeeCode: safeCode,
            branch: safeBranch,
            roleTitle: safeRole,
            status: changes.status,
            updatedAtIso: new Date().toISOString(),
          }
        : p
    );
    this.facialProfiles.set(updated);
    this.saveToLocalCache(updated, this.attendanceLogs());

    try {
      await updateDoc(doc(db, 'facialProfiles', profileId), {
        fullName: safeFullName,
        employeeCode: safeCode,
        branch: safeBranch,
        roleTitle: safeRole,
        status: changes.status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `facialProfiles/${profileId}`);
    }

    this.notify('success', `Saved changes for ${safeFullName}.`);
  }

  async recalibrateProfileTraits(
    profileId: string,
    traits: {
      traitSignature: string;
      interocularRatio: number;
      symmetryScore: number;
      descriptorHash: string;
    }
  ): Promise<void> {
    const updated = this.facialProfiles().map((p) =>
      p.id === profileId
        ? {
            ...p,
            traitSignature: traits.traitSignature.slice(0, 2048),
            interocularRatio: Number(traits.interocularRatio.toFixed(4)),
            symmetryScore: Number(traits.symmetryScore.toFixed(1)),
            descriptorHash: this.sanitizeCode(traits.descriptorHash),
            updatedAtIso: new Date().toISOString(),
          }
        : p
    );
    this.facialProfiles.set(updated);
    this.saveToLocalCache(updated, this.attendanceLogs());

    try {
      await updateDoc(doc(db, 'facialProfiles', profileId), {
        traitSignature: traits.traitSignature.slice(0, 2048),
        interocularRatio: Number(traits.interocularRatio.toFixed(4)),
        symmetryScore: Number(traits.symmetryScore.toFixed(1)),
        descriptorHash: this.sanitizeCode(traits.descriptorHash),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `facialProfiles/${profileId}`);
    }

    this.notify('success', 'Updated face data in Firebase!');
  }

  async deleteFacialProfile(profileId: string): Promise<void> {
    const target = this.facialProfiles().find((p) => p.id === profileId);
    const updated = this.facialProfiles().filter((p) => p.id !== profileId);
    this.facialProfiles.set(updated);
    this.saveToLocalCache(updated, this.attendanceLogs());

    try {
      await deleteDoc(doc(db, 'facialProfiles', profileId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `facialProfiles/${profileId}`);
    }

    this.notify('warning', `Removed person: ${target?.fullName || profileId}.`);
  }

  async updateAttendanceLogRecord(
    logId: string,
    changes: {
      fullName: string;
      employeeCode: string;
      branch: string;
      attendanceStatus: AttendanceStatus;
      locationName: string;
      timeLabel: string;
      dateKey: string;
    }
  ): Promise<void> {
    const safeName = changes.fullName.trim().slice(0, 80);
    const safeCode = this.sanitizeCode(changes.employeeCode);
    const safeBranch = changes.branch.trim().slice(0, 60);
    const safeLoc = changes.locationName.trim().slice(0, 160);
    const safeTime = changes.timeLabel.trim().slice(0, 20);
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(changes.dateKey)
      ? changes.dateKey
      : new Date().toISOString().slice(0, 10);
    const safeMonth = safeDate.slice(0, 7);

    const updated = this.attendanceLogs().map((l) =>
      l.id === logId
        ? {
            ...l,
            fullName: safeName,
            employeeCode: safeCode,
            branch: safeBranch,
            attendanceStatus: changes.attendanceStatus,
            locationName: safeLoc,
            timeLabel: safeTime,
            dateKey: safeDate,
            monthKey: safeMonth,
            updatedAtIso: new Date().toISOString(),
          }
        : l
    );
    this.attendanceLogs.set(updated);
    this.saveToLocalCache(this.facialProfiles(), updated);

    try {
      await updateDoc(doc(db, 'attendanceLogs', logId), {
        fullName: safeName,
        employeeCode: safeCode,
        branch: safeBranch,
        attendanceStatus: changes.attendanceStatus,
        locationName: safeLoc,
        timeLabel: safeTime,
        dateKey: safeDate,
        monthKey: safeMonth,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `attendanceLogs/${logId}`);
    }

    this.notify('success', `Saved attendance record for ${safeName}.`);
  }

  async deleteAttendanceLog(logId: string): Promise<void> {
    const target = this.attendanceLogs().find((l) => l.id === logId);
    const updated = this.attendanceLogs().filter((l) => l.id !== logId);
    this.attendanceLogs.set(updated);
    this.saveToLocalCache(this.facialProfiles(), updated);

    try {
      await deleteDoc(doc(db, 'attendanceLogs', logId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attendanceLogs/${logId}`);
    }

    this.notify('warning', `Removed attendance record for ${target?.fullName || logId}.`);
  }

  computeMonthlyReportSummaries(monthKey: string, branchFilter: string): MonthlyEmployeeSummary[] {
    const logs = this.attendanceLogs().filter((l) => {
      const matchMonth = monthKey === 'ALL' || l.monthKey === monthKey;
      const matchBranch = branchFilter === 'ALL' || l.branch === branchFilter;
      return matchMonth && matchBranch && l.attendanceStatus !== 'revoked';
    });

    const profiles = this.facialProfiles().filter(
      (p) => branchFilter === 'ALL' || p.branch === branchFilter
    );

    return profiles.map((prof) => {
      const empLogs = logs.filter(
        (l) => l.profileId === prof.id || l.employeeCode === prof.employeeCode
      );
      const presentCount = empLogs.filter((l) => l.attendanceStatus === 'present').length;
      const lateCount = empLogs.filter((l) => l.attendanceStatus === 'late').length;
      const leaveCount = empLogs.filter((l) => l.attendanceStatus === 'on_leave').length;
      const totalRecordedDays = empLogs.length;

      const avgConfidence =
        empLogs.length > 0
          ? Number(
              (
                empLogs.reduce((acc, item) => acc + item.matchConfidence, 0) / empLogs.length
              ).toFixed(1)
            )
          : 98.0;

      const attendanceRatePercent =
        totalRecordedDays > 0
          ? Math.round(((presentCount + lateCount * 0.85) / totalRecordedDays) * 100)
          : 0;

      return {
        profileId: prof.id,
        fullName: prof.fullName,
        employeeCode: prof.employeeCode,
        branch: prof.branch,
        roleTitle: prof.roleTitle,
        presentCount,
        lateCount,
        leaveCount,
        totalRecordedDays,
        attendanceRatePercent,
        avgMatchConfidence: avgConfidence,
        primaryLocation: empLogs[0]?.locationName || `${prof.branch} Office`,
        lastCheckInTime: empLogs[0]
          ? `${empLogs[0].dateKey} · ${empLogs[0].timeLabel}`
          : 'No check-in yet',
      };
    });
  }

  notify(type: 'success' | 'warning' | 'error', message: string): void {
    this.statusBanner.set({ type, message });
  }

  clearBanner(): void {
    this.statusBanner.set(null);
  }

  private sanitizeDocId(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'doc_1';
  }

  private sanitizeCode(raw: string): string {
    const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
    return cleaned.length >= 2 ? cleaned : `ID-${Date.now().toString().slice(-4)}`;
  }
}

function lOrDefault(val: number): number {
  return Number.isNaN(val) ? 0 : val;
}
