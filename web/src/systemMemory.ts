import type { SystemMemory } from './types'

const BYTES_PER_GB = 1024 ** 3

/** 사용률(%) 정수. 전체가 0 이하면 null */
export function memoryPercent(memory: SystemMemory): number | null {
  if (!(memory.totalBytes > 0)) return null
  const usedBytes = Math.min(Math.max(memory.totalBytes - memory.freeBytes, 0), memory.totalBytes)
  return Math.round((usedBytes / memory.totalBytes) * 100)
}

/** 툴팁·aria-label "Memory 19.8 / 32.0 GB" (사용량 / 전체) */
export function memoryLabel(memory: SystemMemory): string {
  const usedBytes = Math.min(Math.max(memory.totalBytes - memory.freeBytes, 0), memory.totalBytes)
  return `Memory ${(usedBytes / BYTES_PER_GB).toFixed(1)} / ${(memory.totalBytes / BYTES_PER_GB).toFixed(1)} GB`
}

/** 응답이 꼴에 맞을 때만 값으로 (아니면 칸을 숨긴다) */
export function parseSystemMemory(value: unknown): SystemMemory | null {
  if (typeof value !== 'object' || value === null) return null
  const { totalBytes, freeBytes } = value as Record<string, unknown>
  if (typeof totalBytes !== 'number' || typeof freeBytes !== 'number') return null
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) return null
  return { totalBytes, freeBytes }
}
