import { SEED_CYCLE_RECORDS } from '@/data/seed'
import type { ManholeCycleRecord } from '@/data/types'

// 井盖养护周期记录独立存放：确认更换时冻结一条，重复确认不会新增。
const CYCLE_STORAGE_KEY = 'underground-pipeline-inspection:manhole-cycles'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cycleCache: ManholeCycleRecord[] | null = null

function readCycleStorage(): ManholeCycleRecord[] {
  const fallback = clone(SEED_CYCLE_RECORDS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(CYCLE_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(CYCLE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as ManholeCycleRecord[]
    if (!Array.isArray(parsed)) {
      throw new Error('bad payload')
    }
    return parsed
  } catch {
    window.localStorage.setItem(CYCLE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function listCycleRecords(): ManholeCycleRecord[] {
  if (cycleCache === null) {
    cycleCache = readCycleStorage()
  }
  return cycleCache
}

export function saveCycleRecords(records: ManholeCycleRecord[]): void {
  cycleCache = records
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CYCLE_STORAGE_KEY, JSON.stringify(records))
  }
}

export function appendCycleRecord(record: ManholeCycleRecord): void {
  saveCycleRecords([...listCycleRecords(), record])
}

export function replaceCycleRecordsForManhole(manholeId: number, records: ManholeCycleRecord[]): void {
  const others = listCycleRecords().filter((item) => item.manholeId !== manholeId)
  saveCycleRecords([...others, ...records])
}

export function resetCycleRecords(): ManholeCycleRecord[] {
  const records = clone(SEED_CYCLE_RECORDS)
  saveCycleRecords(records)
  return records
}

export function cycleStorageKey(): string {
  return CYCLE_STORAGE_KEY
}
