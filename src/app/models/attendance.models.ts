export type ProfileStatus = 'active' | 'suspended' | 'archived';
export type AttendanceStatus = 'present' | 'late' | 'on_leave' | 'revoked';
export type VerificationMethod = 'facial_biometric' | 'manual_admin_override';

export interface FacialProfile {
  id: string;
  ownerId: string;
  fullName: string;
  employeeCode: string;
  branch: string;
  roleTitle: string;
  traitSignature: string; // 32 or 64 comma-separated floats in [-1, 1]
  interocularRatio: number;
  symmetryScore: number;
  descriptorHash: string;
  status: ProfileStatus;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface AttendanceLog {
  id: string;
  ownerId: string;
  profileId: string;
  fullName: string;
  employeeCode: string;
  branch: string;
  attendanceStatus: AttendanceStatus;
  verificationMethod: VerificationMethod;
  matchConfidence: number;
  latitude: number;
  longitude: number;
  locationName: string;
  monthKey: string;
  dateKey: string;
  timeLabel: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface GeoLocationState {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  locationName: string;
  source: 'gps_live' | 'campus_preset' | 'manual_override';
  capturedAt: string;
}

export interface BiometricExtractedTraits {
  vector: number[];
  traitSignature: string;
  interocularRatio: number;
  symmetryScore: number;
  descriptorHash: string;
  faceDetected: boolean;
  lightingQuality: number;
}

export interface BiometricMatchCandidate {
  profile: FacialProfile;
  similarityPercent: number;
  euclideanDistance: number;
  passedThreshold: boolean;
}

export interface MonthlyEmployeeSummary {
  profileId: string;
  fullName: string;
  employeeCode: string;
  branch: string;
  roleTitle: string;
  presentCount: number;
  lateCount: number;
  leaveCount: number;
  totalRecordedDays: number;
  attendanceRatePercent: number;
  avgMatchConfidence: number;
  primaryLocation: string;
  lastCheckInTime: string;
}

export interface CampusPreset {
  label: string;
  branch: string;
  latitude: number;
  longitude: number;
  address: string;
}

export const CAMPUS_PRESETS: CampusPreset[] = [
  {
    label: 'Mumbai Nariman Point HQ',
    branch: 'Mumbai Royal HQ',
    latitude: 18.9256,
    longitude: 72.8242,
    address: 'Nariman Point Financial District, Mumbai, MH 400021',
  },
  {
    label: 'Bangalore Indiranagar R&D',
    branch: 'Bangalore Tech Campus',
    latitude: 12.9784,
    longitude: 77.6408,
    address: '100 Feet Road, Indiranagar, Bengaluru, KA 560038',
  },
  {
    label: 'London Mayfair Executive Suite',
    branch: 'London Mayfair Branch',
    latitude: 51.5107,
    longitude: -0.1466,
    address: '24 Hanover Square, Mayfair, London W1S 1JD, UK',
  },
  {
    label: 'Singapore Marina Bay Hub',
    branch: 'Singapore Marina Hub',
    latitude: 1.2801,
    longitude: 103.8542,
    address: '8 Marina Boulevard, Tower 1, Singapore 018981',
  },
  {
    label: 'New York Bryant Park Tower',
    branch: 'New York Midtown',
    latitude: 40.7536,
    longitude: -73.9832,
    address: '1095 Avenue of the Americas, New York, NY 10036',
  },
];

export const BRANCH_OPTIONS: string[] = [
  'Mumbai Royal HQ',
  'Bangalore Tech Campus',
  'London Mayfair Branch',
  'Singapore Marina Hub',
  'New York Midtown',
];

export function generateDeterministicVector(seed: number): number[] {
  const vec: number[] = [];
  let s = seed;
  for (let i = 0; i < 32; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const raw = (s / 2147483648) - 1;
    vec.push(Number(raw.toFixed(4)));
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(4)));
}

export function vectorToSignature(vec: number[]): string {
  return vec.map((n) => n.toFixed(4)).join(',');
}

export function signatureToVector(sig: string): number[] {
  return sig
    .split(',')
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

export function computeHashFromSignature(sig: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `AV-${hex1}${hex2}`.toUpperCase();
}

export function buildSeedFacialProfiles(ownerId: string): FacialProfile[] {
  const rawSeeds = [
    {
      id: 'prof_aarav_101',
      fullName: 'Aarav Vardhan Rathore',
      employeeCode: 'EMP-1041',
      branch: 'Mumbai Royal HQ',
      roleTitle: 'Principal Biometric Architect',
      seed: 104199,
      interocularRatio: 0.384,
      symmetryScore: 98.2,
      status: 'active' as ProfileStatus,
    },
    {
      id: 'prof_meera_102',
      fullName: 'Meera Deshmukh',
      employeeCode: 'EMP-1042',
      branch: 'Bangalore Tech Campus',
      roleTitle: 'Director of Cloud Security',
      seed: 208411,
      interocularRatio: 0.371,
      symmetryScore: 97.6,
      status: 'active' as ProfileStatus,
    },
    {
      id: 'prof_julian_103',
      fullName: 'Julian Vance-Sterling',
      employeeCode: 'EMP-1043',
      branch: 'London Mayfair Branch',
      roleTitle: 'VP Regional Operations',
      seed: 319522,
      interocularRatio: 0.392,
      symmetryScore: 96.4,
      status: 'active' as ProfileStatus,
    },
    {
      id: 'prof_elena_104',
      fullName: 'Elena Rostova-Chen',
      employeeCode: 'EMP-1044',
      branch: 'Singapore Marina Hub',
      roleTitle: 'Lead Telemetry Systems Engineer',
      seed: 448103,
      interocularRatio: 0.368,
      symmetryScore: 98.8,
      status: 'active' as ProfileStatus,
    },
    {
      id: 'prof_kabir_105',
      fullName: 'Kabir Sen-Gupta',
      employeeCode: 'EMP-1045',
      branch: 'New York Midtown',
      roleTitle: 'Quantitative Compliance Officer',
      seed: 559214,
      interocularRatio: 0.379,
      symmetryScore: 95.9,
      status: 'active' as ProfileStatus,
    },
    {
      id: 'prof_ananya_106',
      fullName: 'Ananya Chatterjee',
      employeeCode: 'EMP-1046',
      branch: 'Mumbai Royal HQ',
      roleTitle: 'Senior Spatial UX Strategist',
      seed: 670325,
      interocularRatio: 0.375,
      symmetryScore: 97.9,
      status: 'active' as ProfileStatus,
    },
  ];

  const nowIso = new Date().toISOString();
  return rawSeeds.map((item) => {
    const vec = generateDeterministicVector(item.seed);
    const sig = vectorToSignature(vec);
    return {
      id: item.id,
      ownerId,
      fullName: item.fullName,
      employeeCode: item.employeeCode,
      branch: item.branch,
      roleTitle: item.roleTitle,
      traitSignature: sig,
      interocularRatio: item.interocularRatio,
      symmetryScore: item.symmetryScore,
      descriptorHash: computeHashFromSignature(sig),
      status: item.status,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  });
}

export function buildSeedAttendanceLogs(ownerId: string, profiles: FacialProfile[]): AttendanceLog[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const prevMonthNum = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevMonthYear = now.getMonth() === 0 ? currentYear - 1 : currentYear;
  const prevMonth = String(prevMonthNum).padStart(2, '0');
  const todayDay = String(now.getDate()).padStart(2, '0');
  const yesterdayDate = new Date(now.getTime() - 86400000);
  const yesterdayDay = String(yesterdayDate.getDate()).padStart(2, '0');
  const yesterdayMonth = String(yesterdayDate.getMonth() + 1).padStart(2, '0');
  const yesterdayYear = yesterdayDate.getFullYear();

  const entries: Omit<AttendanceLog, 'ownerId' | 'createdAtIso' | 'updatedAtIso'>[] = [
    {
      id: 'log_oct_1001',
      profileId: profiles[0]?.id || 'prof_aarav_101',
      fullName: 'Aarav Vardhan Rathore',
      employeeCode: 'EMP-1041',
      branch: 'Mumbai Royal HQ',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 99.1,
      latitude: 18.9256,
      longitude: 72.8242,
      locationName: 'Nariman Point Financial District, Mumbai (18.9256, 72.8242)',
      monthKey: `${currentYear}-${currentMonth}`,
      dateKey: `${currentYear}-${currentMonth}-${todayDay}`,
      timeLabel: '08:52:14 AM',
    },
    {
      id: 'log_oct_1002',
      profileId: profiles[1]?.id || 'prof_meera_102',
      fullName: 'Meera Deshmukh',
      employeeCode: 'EMP-1042',
      branch: 'Bangalore Tech Campus',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 98.4,
      latitude: 12.9784,
      longitude: 77.6408,
      locationName: '100 Feet Road, Indiranagar, Bengaluru (12.9784, 77.6408)',
      monthKey: `${currentYear}-${currentMonth}`,
      dateKey: `${currentYear}-${currentMonth}-${todayDay}`,
      timeLabel: '09:04:38 AM',
    },
    {
      id: 'log_oct_1003',
      profileId: profiles[2]?.id || 'prof_julian_103',
      fullName: 'Julian Vance-Sterling',
      employeeCode: 'EMP-1043',
      branch: 'London Mayfair Branch',
      attendanceStatus: 'late',
      verificationMethod: 'facial_biometric',
      matchConfidence: 97.2,
      latitude: 51.5107,
      longitude: -0.1466,
      locationName: '24 Hanover Square, Mayfair, London (51.5107, -0.1466)',
      monthKey: `${currentYear}-${currentMonth}`,
      dateKey: `${currentYear}-${currentMonth}-${todayDay}`,
      timeLabel: '09:41:19 AM',
    },
    {
      id: 'log_oct_1004',
      profileId: profiles[3]?.id || 'prof_elena_104',
      fullName: 'Elena Rostova-Chen',
      employeeCode: 'EMP-1044',
      branch: 'Singapore Marina Hub',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 99.4,
      latitude: 1.2801,
      longitude: 103.8542,
      locationName: '8 Marina Boulevard, Tower 1, Singapore (1.2801, 103.8542)',
      monthKey: `${currentYear}-${currentMonth}`,
      dateKey: `${currentYear}-${currentMonth}-${todayDay}`,
      timeLabel: '08:47:05 AM',
    },
    {
      id: 'log_oct_1005',
      profileId: profiles[4]?.id || 'prof_kabir_105',
      fullName: 'Kabir Sen-Gupta',
      employeeCode: 'EMP-1045',
      branch: 'New York Midtown',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 96.8,
      latitude: 40.7536,
      longitude: -73.9832,
      locationName: '1095 Avenue of the Americas, New York (40.7536, -73.9832)',
      monthKey: `${yesterdayYear}-${yesterdayMonth}`,
      dateKey: `${yesterdayYear}-${yesterdayMonth}-${yesterdayDay}`,
      timeLabel: '08:58:22 AM',
    },
    {
      id: 'log_oct_1006',
      profileId: profiles[5]?.id || 'prof_ananya_106',
      fullName: 'Ananya Chatterjee',
      employeeCode: 'EMP-1046',
      branch: 'Mumbai Royal HQ',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 98.7,
      latitude: 18.9259,
      longitude: 72.8245,
      locationName: 'Nariman Point Financial District, Mumbai (18.9259, 72.8245)',
      monthKey: `${yesterdayYear}-${yesterdayMonth}`,
      dateKey: `${yesterdayYear}-${yesterdayMonth}-${yesterdayDay}`,
      timeLabel: '09:01:11 AM',
    },
    {
      id: 'log_sep_1007',
      profileId: profiles[0]?.id || 'prof_aarav_101',
      fullName: 'Aarav Vardhan Rathore',
      employeeCode: 'EMP-1041',
      branch: 'Mumbai Royal HQ',
      attendanceStatus: 'present',
      verificationMethod: 'facial_biometric',
      matchConfidence: 98.9,
      latitude: 18.9256,
      longitude: 72.8242,
      locationName: 'Nariman Point Financial District, Mumbai (18.9256, 72.8242)',
      monthKey: `${prevMonthYear}-${prevMonth}`,
      dateKey: `${prevMonthYear}-${prevMonth}-24`,
      timeLabel: '08:50:09 AM',
    },
  ];

  const nowIso = new Date().toISOString();
  return entries.map((e) => ({
    ...e,
    ownerId,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  }));
}
