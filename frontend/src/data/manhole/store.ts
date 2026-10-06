import { buildSeedDataset } from './seed'
import type { ManholeDataset } from './types'

// 井盖养护数据独立存储：周期记录、维护履历、规则版本都要持久保留。
const STORAGE_KEY = 'underground-pipeline-inspection:manhole'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seed(): ManholeDataset {
  return buildSeedDataset()
}

function readStorage(): ManholeDataset {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const fallback = seed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ManholeDataset
  } catch {
    const fallback = seed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ManholeDataset | null = null

export function manholeDataset(): ManholeDataset {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveManholeDataset(dataset: ManholeDataset): void {
  cache = clone(dataset)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function resetManholeDataset(): ManholeDataset {
  const fresh = seed()
  saveManholeDataset(fresh)
  return fresh
}

export function manholeStorageKey(): string {
  return STORAGE_KEY
}
