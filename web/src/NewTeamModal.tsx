import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderPicker } from './FolderPicker'
import { folderNameOf, gitInitBlockReason, isSameFolder, type FolderListing, type FolderVcs, type GitInitCheck } from './folderChoice'
import { Modal } from './Modal'

interface Props {
  groupName: string
  /** 이 PC 에서 연 화면. Browse…·git init 칸은 이 PC 에서만 (서버 API 도 loopback 전용) */
  isLocal: boolean
  onClose: () => void
  /** 팀을 만든다. 성공하면 true (창을 닫는다) */
  onCreate: (team: { name: string; cwd: string; gitInit?: boolean }) => Promise<boolean>
}

/** 적힌 경로의 git init 가능 여부를 묻는다 (목록 없이 판정만) */
async function checkFolder(path: string, signal: AbortSignal): Promise<GitInitCheck> {
  const response = await fetch(`/api/fs/dirs?path=${encodeURIComponent(path)}&skipEntries=1`, { signal })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) return { kind: 'error', path, message: response.status === 400 ? 'Enter an absolute path like D:\\work' : (body.message ?? `HTTP ${response.status}`) }
  const listing = body as FolderListing
  return { kind: 'folder', path, vcs: listing.vcsAbove, teamName: listing.teamName }
}

/** 그룹 라벨 "+" 의 팀 만들기 창: 이름 · 작업 폴더(이 PC 면 Browse… 와 git init 칸) */
export function NewTeamModal({ groupName, isLocal, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  /** 사용자가 이름 칸을 직접 고쳤는지 — 고쳤으면 고른 폴더 이름으로 덮지 않는다 (비우면 다시 채운다) */
  const [isNameEdited, setIsNameEdited] = useState(false)
  const [cwd, setCwd] = useState('')
  const [isPicking, setIsPicking] = useState(false)
  const [isGitInit, setIsGitInit] = useState(false)
  const [check, setCheck] = useState<GitInitCheck>({ kind: 'empty' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** 고르기 창이 준 판정. 경로 칸이 그 값 그대로면 서버에 다시 묻지 않는다 */
  const pickedRef = useRef<{ path: string; vcs: FolderVcs | null; teamName: string | null } | null>(null)

  useEffect(() => {
    if (!isLocal) return
    const path = cwd.trim()
    if (!path) {
      setCheck({ kind: 'empty' })
      return
    }
    const picked = pickedRef.current
    if (picked && isSameFolder(picked.path, path)) {
      setCheck({ kind: 'folder', ...picked })
      return
    }
    setCheck({ kind: 'checking', path })
    // 칠 때마다 묻지 않게 잠깐 기다린다
    const controller = new AbortController()
    const timer = setTimeout(() => {
      checkFolder(path, controller.signal).then(setCheck, (error: Error) => {
        if (error.name !== 'AbortError') setCheck({ kind: 'error', path, message: 'Network error' })
      })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [cwd, isLocal])

  const blockReason = gitInitBlockReason(check)
  const isGitInitAllowed = blockReason === null
  const existingTeam = check.kind === 'folder' ? check.teamName : null

  function selectFolder(folder: { path: string; vcs: FolderVcs | null; teamName: string | null }) {
    pickedRef.current = folder
    setCwd(folder.path)
    if (!isNameEdited || !name.trim()) {
      setName(folderNameOf(folder.path))
      setIsNameEdited(false)
    }
    setIsPicking(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const isDone = await onCreate({ name, cwd, ...(isLocal && isGitInit && isGitInitAllowed ? { gitInit: true } : {}) })
      if (isDone) onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isPicking) {
    return (
      // 고르는 중의 Esc·바깥 클릭은 팀 만들기 칸으로 돌아간다
      <Modal title="Choose work folder" className="folder-picker-modal" onClose={() => setIsPicking(false)}>
        <FolderPicker initialPath={cwd} onSelect={selectFolder} onCancel={() => setIsPicking(false)} />
      </Modal>
    )
  }

  return (
    <Modal title={`New team — Group "${groupName}"`} onClose={onClose}>
      <form className="create" onSubmit={submit}>
        <input
          name="name"
          placeholder="Team name"
          required
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setIsNameEdited(true)
          }}
        />
        <div className="path-row">
          <input
            name="cwd"
            placeholder="Work folder (e.g. D:\workspace\foo). Sessions in this folder join the team"
            required
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            spellCheck={false}
          />
          {isLocal && (
            <button type="button" onClick={() => setIsPicking(true)} title="Choose a folder on this PC">
              Browse…
            </button>
          )}
        </div>
        {existingTeam && <div className="folder-error">Team "{existingTeam}" already uses this folder</div>}
        {isLocal && (
          <label className="check" title={blockReason ?? 'Runs git init -b main in the folder before creating the team'}>
            <input type="checkbox" checked={isGitInit && isGitInitAllowed} disabled={!isGitInitAllowed} onChange={(event) => setIsGitInit(event.target.checked)} />
            Initialize git repository (git init -b main)
          </label>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
