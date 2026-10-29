/**
 * 작업 폴더 내용 찾기 worker 스레드 (workspaceSearch.ts 의 runSearchWorker 가 띄운다).
 * 파일마다 결과를 보내고 끝나면 done. 정규식 한 번이 끝나지 않으면 여기서는 멈추지 못하고 서버가 terminate() 한다
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { decodeText, isBinaryBuffer, MAX_TEXT_BYTES } from './workspaceFiles.js'
import { buildSearchPattern, searchText, type SearchJob, type SearchWorkerMessage } from './workspaceSearch.js'

/** 훑은 수를 알리는 간격 (terminate 될 때 서버가 아는 수) */
const PROGRESS_INTERVAL_MS = 100

const job = workerData as SearchJob
const post = (message: SearchWorkerMessage) => parentPort?.postMessage(message)
const startedAt = Date.now()
const isOverTime = () => Date.now() - startedAt > job.timeLimitMs
const pattern = buildSearchPattern(job.options)

let matchCount = 0
let searchedFileCount = 0
let isTruncated = false
let lastPostAt = startedAt
for (const path of job.paths) {
  if (matchCount >= job.maxMatches || isOverTime()) {
    isTruncated = true
    break
  }
  /** 1MB 넘는 파일·바이너리(NUL)·못 읽는 파일은 건너뛴다. 글은 UTF-8 → 안 되면 EUC-KR (readWorkspaceFile 과 같다) */
  let data: Buffer
  try {
    const file = join(job.root, path)
    if (statSync(file).size > MAX_TEXT_BYTES) continue
    data = readFileSync(file)
  } catch {
    continue
  }
  if (data.length > MAX_TEXT_BYTES || isBinaryBuffer(data)) continue
  const { lines, matchCount: fileMatchCount, isStopped } = searchText(decodeText(data).text, pattern, job.maxMatches - matchCount, isOverTime)
  searchedFileCount++
  matchCount += fileMatchCount
  if (lines.length > 0) {
    post({ type: 'file', file: { path, matchCount: fileMatchCount, matches: lines }, searchedFileCount })
    lastPostAt = Date.now()
  } else if (Date.now() - lastPostAt >= PROGRESS_INTERVAL_MS) {
    post({ type: 'progress', searchedFileCount })
    lastPostAt = Date.now()
  }
  if (isStopped) {
    isTruncated = true
    break
  }
}
if (matchCount >= job.maxMatches) isTruncated = true
post({ type: 'done', searchedFileCount, isTruncated })
