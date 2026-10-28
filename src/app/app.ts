import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  AttendanceLog,
  AttendanceStatus,
  BiometricExtractedTraits,
  BiometricMatchCandidate,
  BRANCH_OPTIONS,
  CAMPUS_PRESETS,
  FacialProfile,
  GeoLocationState,
  ProfileStatus,
  signatureToVector,
} from './models/attendance.models';
import { BiometricEngineService } from './services/biometric-engine.service';
import { AttendanceStoreService } from './services/attendance-store.service';

export type WorkspaceTab = 'scanner' | 'enroll' | 'reports' | 'admin';

export interface CustomThemeConfig {
  name: string;
  bgCanvas: string;
  bgSurface: string;
  bgElevated: string;
  textPrimary: string;
  textSecondary: string;
  accentBurgundy: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  readonly store = inject(AttendanceStoreService);
  private readonly bioEngine = inject(BiometricEngineService);

  @ViewChild('cameraVideo') cameraVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('meshCanvas') meshCanvasRef?: ElementRef<HTMLCanvasElement>;

  // Navigation & Theme
  readonly activeTab = signal<WorkspaceTab>('scanner');
  readonly isRoyalDark = signal<boolean>(false);

  // Admin Custom Theme Creator State
  readonly customBgColor = signal<string>('#F6F2EA');
  readonly customCardColor = signal<string>('#FAF7F2');
  readonly customButtonColor = signal<string>('#5E1928');
  readonly customTextColor = signal<string>('#1E191B');

  // Constants for Templates
  readonly branchOptions = BRANCH_OPTIONS;
  readonly campusPresets = CAMPUS_PRESETS;

  // Scanner State
  readonly cameraActive = signal<boolean>(false);
  readonly uploadedPortraitDataUrl = signal<string | null>(null);
  private uploadedImageElement: HTMLImageElement | null = null;

  readonly cameraStatusText = signal<string>('Camera Ready');
  readonly selectedSubjectId = signal<string>('prof_aarav_101');
  readonly verifyAttendanceStatus = signal<AttendanceStatus>('present');
  readonly isScanningNow = signal<boolean>(false);

  readonly liveTraits = signal<BiometricExtractedTraits | null>(null);
  readonly latestMatchCandidate = signal<BiometricMatchCandidate | null>(null);
  readonly latestRecordedLog = signal<AttendanceLog | null>(null);

  // Add New Person State
  readonly enrollName = signal<string>('');
  readonly enrollCode = signal<string>('EMP-1050');
  readonly enrollBranch = signal<string>('Mumbai Royal HQ');
  readonly enrollRole = signal<string>('Team Member');

  // Quick Add Attendance Data State (In Admin)
  readonly quickAddName = signal<string>('');
  readonly quickAddCode = signal<string>('EMP-1065');
  readonly quickAddBranch = signal<string>('Mumbai Royal HQ');
  readonly quickAddStatus = signal<AttendanceStatus>('present');

  // Geolocation State
  readonly geoState = signal<GeoLocationState>(
    this.bioEngine.getPresetLocationForBranch('Mumbai Royal HQ')
  );
  readonly geoBusy = signal<boolean>(false);
  readonly customLocationNote = signal<string>('');

  // Admin Password Gate State (Password: 123456)
  readonly passwordInput = signal<string>('');
  readonly showPasswordPlain = signal<boolean>(false);

  // Admin Filter State
  readonly realtimeSearch = signal<string>('');
  readonly realtimeBranchFilter = signal<string>('ALL');
  readonly realtimeStatusFilter = signal<string>('ALL');
  readonly inspectedLocationLog = signal<AttendanceLog | null>(null);

  // Monthly Reports Filter State
  readonly reportMonthKey = signal<string>(new Date().toISOString().slice(0, 7));
  readonly reportBranchFilter = signal<string>('ALL');

  // Admin Sub-Tab State
  readonly adminSection = signal<'live' | 'users' | 'themes'>('live');
  readonly editingProfile = signal<{
    id: string;
    fullName: string;
    employeeCode: string;
    branch: string;
    roleTitle: string;
    status: ProfileStatus;
  } | null>(null);

  readonly editingLog = signal<{
    id: string;
    fullName: string;
    employeeCode: string;
    branch: string;
    attendanceStatus: AttendanceStatus;
    locationName: string;
    timeLabel: string;
    dateKey: string;
  } | null>(null);

  private mediaStream: MediaStream | null = null;
  private animFrameId: number | null = null;
  private scanPhase = 0;

  // Computed properties
  readonly selectedSubjectProfile = computed(() => {
    const id = this.selectedSubjectId();
    const list = this.store.facialProfiles();
    return list.find((p) => p.id === id) || list[0] || null;
  });

  readonly filteredRealtimeLogs = computed(() => {
    const q = this.realtimeSearch().trim().toLowerCase();
    const branch = this.realtimeBranchFilter();
    const status = this.realtimeStatusFilter();

    return this.store.attendanceLogs().filter((log) => {
      const matchQuery =
        !q ||
        log.fullName.toLowerCase().includes(q) ||
        log.employeeCode.toLowerCase().includes(q) ||
        log.locationName.toLowerCase().includes(q) ||
        log.branch.toLowerCase().includes(q);
      const matchBranch = branch === 'ALL' || log.branch === branch;
      const matchStatus = status === 'ALL' || log.attendanceStatus === status;
      return matchQuery && matchBranch && matchStatus;
    });
  });

  readonly availableMonths = computed(() => {
    const set = new Set<string>();
    const currentMonth = new Date().toISOString().slice(0, 7);
    set.add(currentMonth);
    for (const log of this.store.attendanceLogs()) {
      if (log.monthKey) set.add(log.monthKey);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  });

  readonly monthlyEmployeeSummaries = computed(() =>
    this.store.computeMonthlyReportSummaries(this.reportMonthKey(), this.reportBranchFilter())
  );

  readonly filteredReportLogs = computed(() => {
    const month = this.reportMonthKey();
    const branch = this.reportBranchFilter();
    return this.store.attendanceLogs().filter((l) => {
      const mOk = month === 'ALL' || l.monthKey === month;
      const bOk = branch === 'ALL' || l.branch === branch;
      return mOk && bOk;
    });
  });

  readonly reportKpis = computed(() => {
    const logs = this.filteredReportLogs();
    const total = logs.length;
    const present = logs.filter((l) => l.attendanceStatus === 'present').length;
    const late = logs.filter((l) => l.attendanceStatus === 'late').length;
    const onTimeRate = total > 0 ? Math.round((present / total) * 100) : 0;
    const avgConf =
      total > 0
        ? Number((logs.reduce((acc, x) => acc + x.matchConfidence, 0) / total).toFixed(1))
        : 98.5;
    return {
      total,
      present,
      late,
      onTimeRate,
      avgConf,
    };
  });

  constructor() {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('auravault_royal_dark');
      if (savedTheme === 'true') {
        this.setTheme(true);
      }
    }
  }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.startMeshRenderLoop();
    this.refreshDeviceLocation();
  }

  ngOnDestroy(): void {
    this.stopCameraStream();
    if (this.animFrameId !== null && typeof window !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  toggleRoyalDark(): void {
    this.clearInlineCustomTheme();
    this.setTheme(!this.isRoyalDark());
  }

  private setTheme(dark: boolean): void {
    this.isRoyalDark.set(dark);
    if (typeof document !== 'undefined') {
      if (dark) {
        document.documentElement.classList.add('royal-dark');
        document.body.classList.add('royal-dark');
      } else {
        document.documentElement.classList.remove('royal-dark');
        document.body.classList.remove('royal-dark');
      }
      try {
        localStorage.setItem('auravault_royal_dark', String(dark));
      } catch {
        // Ignore storage error
      }
    }
  }

  /**
   * Admin Theme Creator: Applies preset or custom colors to CSS variables.
   */
  applyThemePreset(preset: 'cream_burgundy' | 'royal_dark' | 'sage_forest' | 'midnight_gold'): void {
    this.clearInlineCustomTheme();
    if (preset === 'cream_burgundy') {
      this.setTheme(false);
      this.store.notify('success', 'Theme changed to Warm Cream & Deep Burgundy.');
      return;
    }
    if (preset === 'royal_dark') {
      this.setTheme(true);
      this.store.notify('success', 'Theme changed to Royal Dark Mode.');
      return;
    }
    if (preset === 'sage_forest') {
      this.setTheme(false);
      this.setRootVars({
        bgCanvas: '#E7EFEA',
        bgSurface: '#DAE5DF',
        bgElevated: '#F2F7F4',
        textPrimary: '#16241D',
        accentBurgundy: '#2B5B46',
      });
      this.store.notify('success', 'Theme changed to Muted Sage Forest.');
      return;
    }
    if (preset === 'midnight_gold') {
      this.setTheme(true);
      this.setRootVars({
        bgCanvas: '#0D1117',
        bgSurface: '#161B22',
        bgElevated: '#1F2630',
        textPrimary: '#F7F3E8',
        accentBurgundy: '#9A6F1A',
      });
      this.store.notify('success', 'Theme changed to Royal Midnight Gold.');
    }
  }

  applyAdminCustomColors(): void {
    this.setRootVars({
      bgCanvas: this.customBgColor(),
      bgSurface: this.customCardColor(),
      bgElevated: this.customCardColor(),
      textPrimary: this.customTextColor(),
      accentBurgundy: this.customButtonColor(),
    });
    this.store.notify('success', 'Your custom Admin theme colors are now live!');
  }

  private setRootVars(vars: {
    bgCanvas: string;
    bgSurface: string;
    bgElevated: string;
    textPrimary: string;
    accentBurgundy: string;
  }): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--bg-canvas', vars.bgCanvas);
    root.style.setProperty('--bg-surface', vars.bgSurface);
    root.style.setProperty('--bg-elevated', vars.bgElevated);
    root.style.setProperty('--text-primary', vars.textPrimary);
    root.style.setProperty('--accent-burgundy', vars.accentBurgundy);
    root.style.setProperty('--accent-burgundy-hover', vars.accentBurgundy);
  }

  private clearInlineCustomTheme(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.removeProperty('--bg-canvas');
    root.style.removeProperty('--bg-surface');
    root.style.removeProperty('--bg-elevated');
    root.style.removeProperty('--text-primary');
    root.style.removeProperty('--accent-burgundy');
    root.style.removeProperty('--accent-burgundy-hover');
  }

  switchTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    if ((tab === 'scanner' || tab === 'enroll') && typeof window !== 'undefined') {
      setTimeout(() => this.renderSingleMeshTick(), 40);
    }
  }

  private startMeshRenderLoop(): void {
    const loop = () => {
      this.scanPhase += 1;
      if (this.activeTab() === 'scanner' || this.activeTab() === 'enroll') {
        this.renderSingleMeshTick();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private renderSingleMeshTick(): void {
    const videoEl = this.cameraVideoRef?.nativeElement || null;
    const canvasEl = this.meshCanvasRef?.nativeElement || null;
    if (!canvasEl) return;

    const traits = this.bioEngine.extractTraitsAndDrawMesh(
      videoEl,
      this.uploadedImageElement,
      canvasEl,
      this.cameraActive(),
      this.selectedSubjectProfile(),
      this.isRoyalDark(),
      this.scanPhase
    );
    if (this.scanPhase % 12 === 0 || !this.liveTraits()) {
      this.liveTraits.set(traits);
    }
  }

  async toggleLiveCamera(): Promise<void> {
    if (this.cameraActive()) {
      this.stopCameraStream();
      this.cameraStatusText.set('Camera Paused — Smart Face Scanner Ready');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.cameraStatusText.set('Using Smart Face Scanner');
      this.store.notify('warning', 'Camera not found on this device. Using smart face scanner.');
      return;
    }

    try {
      this.cameraStatusText.set('Starting Camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 400 },
          facingMode: 'user',
        },
        audio: false,
      });
      this.mediaStream = stream;
      const videoEl = this.cameraVideoRef?.nativeElement;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      this.cameraActive.set(true);
      this.cameraStatusText.set('Live Camera On');
    } catch {
      this.cameraActive.set(false);
      this.cameraStatusText.set('Using Smart Face Scanner');
      this.store.notify('warning', 'Camera access was blocked. Using smart face scanner instead.');
    }
  }

  private stopCameraStream(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    this.cameraActive.set(false);
  }

  onFacialPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    this.stopCameraStream();
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        this.uploadedImageElement = img;
        this.uploadedPortraitDataUrl.set(dataUrl);
        this.cameraStatusText.set(`Photo Loaded: ${file.name.slice(0, 24)}`);
        this.renderSingleMeshTick();
        this.store.notify('success', 'Face photo loaded and scanned!');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  clearUploadedPortrait(): void {
    this.uploadedImageElement = null;
    this.uploadedPortraitDataUrl.set(null);
    this.cameraStatusText.set('Camera Ready');
    this.renderSingleMeshTick();
  }

  async refreshDeviceLocation(): Promise<void> {
    this.geoBusy.set(true);
    const subj = this.selectedSubjectProfile();
    const detected = await this.bioEngine.detectDeviceLocation(subj?.branch);
    this.geoState.set(detected);
    this.geoBusy.set(false);
  }

  selectCampusLocationPreset(branchName: string): void {
    const preset = this.bioEngine.getPresetLocationForBranch(branchName);
    this.geoState.set(preset);
    this.store.notify('success', `Location set to ${preset.locationName}`);
  }

  applyCustomLocationOverride(): void {
    const note = this.customLocationNote().trim();
    if (!note) return;
    const current = this.geoState();
    this.geoState.set({
      ...current,
      locationName: `${note} (${current.latitude}, ${current.longitude})`.slice(0, 155),
      source: 'manual_override',
      capturedAt: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });
    this.customLocationNote.set('');
  }

  async executeBiometricVerifyAndRecord(): Promise<void> {
    this.isScanningNow.set(true);
    this.renderSingleMeshTick();

    const traits = this.liveTraits();
    if (!traits) {
      this.isScanningNow.set(false);
      return;
    }

    const candidate = this.bioEngine.matchAgainstCloudStore(
      traits,
      this.store.facialProfiles(),
      this.selectedSubjectId()
    );

    this.latestMatchCandidate.set(candidate);

    if (!candidate || !candidate.passedThreshold) {
      this.isScanningNow.set(false);
      this.store.notify('error', 'Face did not match. Please try again or add your face first.');
      return;
    }

    const loc = this.geoState();
    const recorded = await this.store.recordAttendance({
      profile: candidate.profile,
      attendanceStatus: this.verifyAttendanceStatus(),
      verificationMethod: 'facial_biometric',
      matchConfidence: candidate.similarityPercent,
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationName: loc.locationName,
    });

    this.latestRecordedLog.set(recorded);
    this.isScanningNow.set(false);
  }

  async executeEnrollCloudProfile(): Promise<void> {
    const name = this.enrollName().trim();
    const code = this.enrollCode().trim();
    const branch = this.enrollBranch().trim();
    const role = this.enrollRole().trim();

    if (name.length < 2) {
      this.store.notify('error', 'Please type a name (at least 2 letters).');
      return;
    }

    this.isScanningNow.set(true);
    this.renderSingleMeshTick();
    const traits = this.liveTraits();
    const fallbackSig =
      traits?.traitSignature ||
      '0.1420,0.2210,-0.1180,0.3120,0.1940,-0.0840,0.2510,0.1730';

    const created = await this.store.enrollFacialProfile({
      fullName: name,
      employeeCode: code,
      branch,
      roleTitle: role || 'Member',
      traitSignature: fallbackSig,
      interocularRatio: traits?.interocularRatio || 0.38,
      symmetryScore: traits?.symmetryScore || 97.5,
      descriptorHash: traits?.descriptorHash || 'AV-8841F09A',
    });

    this.selectedSubjectId.set(created.id);
    this.enrollName.set('');
    this.enrollCode.set(`EMP-${Math.floor(1051 + Math.random() * 890)}`);
    this.isScanningNow.set(false);
    if (this.activeTab() === 'enroll') {
      this.switchTab('scanner');
    }
  }

  async executeQuickAddAttendanceData(): Promise<void> {
    const name = this.quickAddName().trim();
    if (name.length < 2) {
      this.store.notify('error', 'Please type a person’s name first.');
      return;
    }
    const loc = this.geoState();
    const log = await this.store.quickAddCustomAttendanceData({
      fullName: name,
      employeeCode: this.quickAddCode().trim() || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      branch: this.quickAddBranch(),
      attendanceStatus: this.quickAddStatus(),
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationName: loc.locationName,
    });
    this.latestRecordedLog.set(log);
    this.quickAddName.set('');
    this.quickAddCode.set(`EMP-${Math.floor(1070 + Math.random() * 890)}`);
  }

  submitVaultPassword(): void {
    if (this.store.verifyAccessPassword(this.passwordInput())) {
      this.passwordInput.set('');
    }
  }

  quickUnlockWithDefaultPassword(): void {
    this.passwordInput.set('123456');
    this.store.verifyAccessPassword('123456');
  }

  getProfileVectorBars(sig: string): number[] {
    const vec = signatureToVector(sig).slice(0, 12);
    return vec.map((v) => Math.max(15, Math.min(96, Math.round(Math.abs(v) * 250 + 20))));
  }

  openEditProfileModal(profile: FacialProfile): void {
    this.editingProfile.set({
      id: profile.id,
      fullName: profile.fullName,
      employeeCode: profile.employeeCode,
      branch: profile.branch,
      roleTitle: profile.roleTitle,
      status: profile.status,
    });
  }

  updateEditingProfileField(
    field: 'fullName' | 'employeeCode' | 'branch' | 'roleTitle' | 'status',
    value: string
  ): void {
    const current = this.editingProfile();
    if (!current) return;
    this.editingProfile.set({
      ...current,
      [field]: value,
    });
  }

  async saveEditedProfile(): Promise<void> {
    const edit = this.editingProfile();
    if (!edit) return;
    if (edit.fullName.trim().length < 2) {
      this.store.notify('error', 'Name must be at least 2 letters.');
      return;
    }
    await this.store.updateFacialProfileDetails(edit.id, {
      fullName: edit.fullName,
      employeeCode: edit.employeeCode,
      branch: edit.branch,
      roleTitle: edit.roleTitle,
      status: edit.status,
    });
    this.editingProfile.set(null);
  }

  async recalibrateProfileFromLiveRig(profile: FacialProfile): Promise<void> {
    this.renderSingleMeshTick();
    const traits = this.liveTraits();
    if (!traits) return;
    await this.store.recalibrateProfileTraits(profile.id, {
      traitSignature: traits.traitSignature,
      interocularRatio: traits.interocularRatio,
      symmetryScore: traits.symmetryScore,
      descriptorHash: traits.descriptorHash,
    });
  }

  openEditLogModal(log: AttendanceLog): void {
    this.editingLog.set({
      id: log.id,
      fullName: log.fullName,
      employeeCode: log.employeeCode,
      branch: log.branch,
      attendanceStatus: log.attendanceStatus,
      locationName: log.locationName,
      timeLabel: log.timeLabel,
      dateKey: log.dateKey,
    });
  }

  updateEditingLogField(
    field:
      | 'fullName'
      | 'employeeCode'
      | 'branch'
      | 'attendanceStatus'
      | 'locationName'
      | 'timeLabel'
      | 'dateKey',
    value: string
  ): void {
    const current = this.editingLog();
    if (!current) return;
    this.editingLog.set({
      ...current,
      [field]: value,
    });
  }

  async saveEditedLog(): Promise<void> {
    const edit = this.editingLog();
    if (!edit) return;
    await this.store.updateAttendanceLogRecord(edit.id, {
      fullName: edit.fullName,
      employeeCode: edit.employeeCode,
      branch: edit.branch,
      attendanceStatus: edit.attendanceStatus,
      locationName: edit.locationName,
      timeLabel: edit.timeLabel,
      dateKey: edit.dateKey,
    });
    this.editingLog.set(null);
  }

  downloadMonthlyCsvReport(): void {
    const logs = this.filteredReportLogs();
    const summaries = this.monthlyEmployeeSummaries();
    const period = this.reportMonthKey();

    const csvRows: string[] = [];
    csvRows.push(
      [
        'Section',
        'Name',
        'ID Code',
        'Branch',
        'Date',
        'Time',
        'Status',
        'Match (%)',
        'Latitude',
        'Longitude',
        'Location',
      ].join(',')
    );

    for (const log of logs) {
      csvRows.push(
        [
          '"Attendance"',
          `"${log.fullName.replace(/"/g, '""')}"`,
          `"${log.employeeCode}"`,
          `"${log.branch}"`,
          `"${log.dateKey}"`,
          `"${log.timeLabel}"`,
          `"${log.attendanceStatus.toUpperCase()}"`,
          log.matchConfidence.toFixed(1),
          log.latitude.toFixed(5),
          log.longitude.toFixed(5),
          `"${log.locationName.replace(/"/g, '""')}"`,
        ].join(',')
      );
    }

    csvRows.push('');
    csvRows.push(
      [
        'Summary',
        'Name',
        'ID Code',
        'Branch',
        'Job Role',
        'Days Present',
        'Days Late',
        'Days Leave',
        'Total Days',
        'Location',
      ].join(',')
    );

    for (const s of summaries) {
      csvRows.push(
        [
          '"Summary"',
          `"${s.fullName.replace(/"/g, '""')}"`,
          `"${s.employeeCode}"`,
          `"${s.branch}"`,
          `"${s.roleTitle.replace(/"/g, '""')}"`,
          String(s.presentCount),
          String(s.lateCount),
          String(s.leaveCount),
          String(s.totalRecordedDays),
          `"${s.primaryLocation.replace(/"/g, '""')}"`,
        ].join(',')
      );
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    this.triggerFileDownload(blob, `Attendance_Report_${period}.csv`);
    this.store.notify('success', `Downloaded Monthly Report (${period}).`);
  }

  printExecutiveReport(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  private triggerFileDownload(blob: Blob, filename: string): void {
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}
