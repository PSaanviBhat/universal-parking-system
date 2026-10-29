export interface FacilityStats {
  facility: { id: string; name: string; feeRatePerHour: number | string };
  totalSlots: number;
  occupiedSlots: number;
  availableSlots: number;
  occupancyPercentage: number;
  activeSessions: number;
  staleSessions: number;
  todayEntries: number;
  todayExits: number;
  todayRevenue: number;
}

export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'DISPUTED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'DEBT' | 'AUTOPAY_PENDING' | 'FINED';

/** Shape returned by the /api/operator/sessions* endpoints. */
export interface OperatorSession {
  sessionId: string;
  licensePlate: string;
  userName: string;
  userPhone: string;
  slotNumber: string;
  levelName: string;
  levelCode: string;
  entryGate: string;
  exitGate: string | null;
  entryTime: string;
  exitTime: string | null;
  durationMinutes: number;
  hourlyRate: number;
  totalFee: number;
  status: SessionStatus;
  paymentStatus: PaymentStatus;
  resolutionNote: string | null;
  isStale: boolean;
}

export interface SlotItem {
  id: string;
  slotNumber: string;
  status: 'AVAILABLE' | 'RESERVED_OCCUPIED';
  isActive: boolean;
  currentSession?: { id: string; vehicle: { licensePlate: string } } | null;
}

export interface LevelSlots {
  id: string;
  levelCode: string;
  displayName: string;
  slots: SlotItem[];
}

export interface Facility {
  id: string;
  name: string;
  address: string;
  type?: string;
  feeRatePerHour: number | string;
}
