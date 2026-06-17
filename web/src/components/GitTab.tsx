import { createSignal, createEffect, Show, For, createMemo } from 'solid-js';
import type { Task } from '../types';

type GitTabProps = {
  task: Task;
  isOpen: boolean;
};

type GitFileStatus = {
  name: string;
  path: string;
  status: string;
  staged: boolean;
};

export function GitTab(props: GitTabProps) {
  const [fileStatuses, setFileStatuses] = createSignal<GitFileStatus[]>([]);
  const [selectedFile, setSelectedFile] = createSignal<GitFileStatus | null>(null);
  const [diffContent, setDiffContent] = createSignal('');
  const [isNotARepo, setIsNotARepo] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isDiffLoading, setIsDiffLoading] = createSignal(false);
  const [gitError, setGitError] = createSignal('');
  const [commitMessage, setCommitMessage] = createSignal('');
  const [isCommitting, setIsCommitting] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(false);
  const [actionInProgress, setActionInProgress] = createSignal<string | null>(null);

  const projectPath = () => props.task.absolute_project_path || props.task.project_path || '';

  const fetchStatus = () => {
    const path = projectPath();
    if (!path) return;
    setIsLoading(true);
    setGitError('');
    setIsNotARepo(false);

    fetch(`/api/git/status?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          console.log("Git status raw data:", data);
          setFileStatuses(data);
          return;
        }
        const err = await res.json().catch(() => ({}));
        if (err.error === 'not_a_repo' || res.status === 400) {
          setIsNotARepo(true);
        } else {
          setGitError(err.error || `Failed to fetch Git status (HTTP ${res.status})`);
        }
      })
      .catch((e) => {
        setGitError(e.message || 'Failed to fetch Git status.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const fetchDiff = (file: GitFileStatus) => {
    const path = projectPath();
    setIsDiffLoading(true);
    setGitError('');
    setDiffContent('');

    const isUntracked = file.status === 'untracked';
    fetch(
      `/api/git/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(
        file.path
      )}&staged=${file.staged}&untracked=${isUntracked}`
    )
      .then(async (res) => {
        if (res.ok) {
          const text = await res.text();
          console.log("Git diff raw text:", text);
          setDiffContent(text);
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || `Failed to fetch diff (HTTP ${res.status})`);
      })
      .catch((e) => {
        setGitError(e.message || 'Failed to fetch diff.');
      })
      .finally(() => {
        setIsDiffLoading(false);
      });
  };

  const handleStage = (file: GitFileStatus, e?: Event) => {
    if (e) e.stopPropagation();
    const path = projectPath();
    setActionInProgress(file.path + '-stage');
    setGitError('');

    fetch('/api/git/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, file: file.path }),
    })
      .then(async (res) => {
        if (res.ok) {
          fetchStatus();
          // If the selected file was the one staged, refresh diff
          const selected = selectedFile();
          if (selected && selected.path === file.path && !selected.staged) {
            setSelectedFile({ ...selected, staged: true });
            fetchDiff({ ...selected, staged: true });
          }
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || 'Failed to stage file');
      })
      .catch((err) => setGitError(err.message || 'Failed to stage file'))
      .finally(() => setActionInProgress(null));
  };

  const handleUnstage = (file: GitFileStatus, e?: Event) => {
    if (e) e.stopPropagation();
    const path = projectPath();
    setActionInProgress(file.path + '-unstage');
    setGitError('');

    fetch('/api/git/unstage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, file: file.path }),
    })
      .then(async (res) => {
        if (res.ok) {
          fetchStatus();
          // If the selected file was the one unstaged, refresh diff
          const selected = selectedFile();
          if (selected && selected.path === file.path && selected.staged) {
            setSelectedFile({ ...selected, staged: false });
            fetchDiff({ ...selected, staged: false });
          }
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || 'Failed to unstage file');
      })
      .catch((err) => setGitError(err.message || 'Failed to unstage file'))
      .finally(() => setActionInProgress(null));
  };

  const handleDiscard = (file: GitFileStatus, e?: Event) => {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to discard all unstaged changes in ${file.name}? This cannot be undone.`)) {
      return;
    }

    const path = projectPath();
    setActionInProgress(file.path + '-discard');
    setGitError('');

    fetch('/api/git/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, file: file.path }),
    })
      .then(async (res) => {
        if (res.ok) {
          fetchStatus();
          const selected = selectedFile();
          if (selected && selected.path === file.path) {
            setSelectedFile(null);
            setDiffContent('');
          }
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || 'Failed to discard changes');
      })
      .catch((err) => setGitError(err.message || 'Failed to discard changes'))
      .finally(() => setActionInProgress(null));
  };

  const handleCommit = () => {
    const msg = commitMessage().trim();
    if (!msg) return;

    const path = projectPath();
    setIsCommitting(true);
    setGitError('');

    fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, message: msg }),
    })
      .then(async (res) => {
        if (res.ok) {
          setCommitMessage('');
          setSelectedFile(null);
          setDiffContent('');
          fetchStatus();
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || 'Failed to commit changes');
      })
      .catch((err) => setGitError(err.message || 'Failed to commit changes'))
      .finally(() => setIsCommitting(false));
  };

  const handleInitRepo = () => {
    const path = projectPath();
    setIsInitializing(true);
    setGitError('');

    fetch('/api/git/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then(async (res) => {
        if (res.ok) {
          setIsNotARepo(false);
          fetchStatus();
          return;
        }
        const err = await res.json().catch(() => ({}));
        setGitError(err.error || 'Failed to initialize Git repository');
      })
      .catch((err) => setGitError(err.message || 'Failed to initialize Git repository'))
      .finally(() => setIsInitializing(false));
  };

  const selectFile = (file: GitFileStatus) => {
    setSelectedFile(file);
    fetchDiff(file);
  };

  // Reset/sync state when the active task changes or modal opens
  createEffect(() => {
    const t = props.task;
    const isOpen = props.isOpen;
    if (t && isOpen) {
      setSelectedFile(null);
      setDiffContent('');
      setFileStatuses([]);
      setGitError('');
      setCommitMessage('');
      setIsNotARepo(false);
      fetchStatus();
    }
  });

  const stagedChanges = createMemo(() => fileStatuses().filter((f) => f.staged));
  const unstagedChanges = createMemo(() => fileStatuses().filter((f) => !f.staged));

  // We will render status badges inline inside the lists

  const getDiffLineClass = (line: string) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return 'bg-green-950/20 text-green-300 font-mono px-3 block h-5 leading-5 whitespace-pre';
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return 'bg-red-950/20 text-red-300 font-mono px-3 block h-5 leading-5 whitespace-pre';
    }
    if (line.startsWith('@@')) {
      return 'bg-indigo-950/25 text-indigo-400/80 font-mono px-3 block h-5 leading-5 font-semibold';
    }
    return 'text-gray-300 font-mono px-3 block h-5 leading-5 whitespace-pre';
  };

  return (
    <div class="absolute inset-0 flex min-h-0 divide-x divide-gray-700/60 animate-fade-in">
      
      {/* Sidebar: Changed files + Commit form */}
      <div class="w-64 shrink-0 flex flex-col h-full bg-gray-950/20 overflow-hidden">
        <div class="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between bg-gray-900/10 shrink-0">
          <span class="text-[10px] uppercase font-bold tracking-wider text-gray-400">Git Dashboard</span>
          <button
            type="button"
            onClick={fetchStatus}
            disabled={isLoading() || isInitializing()}
            class="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
          >
            Refresh
          </button>
        </div>

        <Show
          when={!isNotARepo()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div class="space-y-1">
                <h4 class="text-xs font-semibold text-gray-400">Not a Git Repository</h4>
                <p class="text-[10px] text-gray-500">There is no Git repository initialized in this project path.</p>
              </div>
              <button
                type="button"
                onClick={handleInitRepo}
                disabled={isInitializing()}
                class="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-4 py-2 text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50"
              >
                <Show when={isInitializing()} fallback="Initialize Repository">
                  Initializing...
                </Show>
              </button>
            </div>
          }
        >
          <>
            {/* File Lists */}
            <div class="flex-1 overflow-y-auto p-2 space-y-4">
              
              {/* Staged Changes */}
              <div>
                <div class="px-2 py-1 text-[9px] uppercase font-bold tracking-wider text-gray-500 flex items-center justify-between">
                  <span>Staged Changes</span>
                  <span class="bg-gray-800 text-gray-400 px-1 rounded">{stagedChanges().length}</span>
                </div>
                <Show when={stagedChanges().length === 0}>
                  <div class="px-2 py-1.5 text-[10px] text-gray-600 italic">No staged changes</div>
                </Show>
                <div class="space-y-0.5">
                  <For each={stagedChanges()}>
                    {(file) => (
                      <div
                        onClick={() => selectFile(file)}
                        class={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between group transition-colors text-xs cursor-pointer ${
                          selectedFile()?.path === file.path && selectedFile()?.staged
                            ? 'bg-indigo-600/20 text-indigo-200 font-semibold'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class={`w-5 h-5 flex items-center justify-center rounded text-[10px] border font-bold shrink-0 ${
                            file.status === 'added' ? 'bg-green-950/40 text-green-400 border-green-800/30' :
                            file.status === 'deleted' ? 'bg-red-950/40 text-red-400 border-red-800/30' :
                            file.status === 'untracked' ? 'bg-indigo-950/40 text-indigo-400 border-indigo-800/30' :
                            file.status === 'renamed' || file.status === 'copied' ? 'bg-teal-950/40 text-teal-400 border-teal-800/30' :
                            file.status === 'unmerged' ? 'bg-amber-950/40 text-amber-400 border-amber-800/30' :
                            'bg-amber-950/40 text-amber-400 border-amber-800/30'
                          }`}>
                            {file.status === 'added' ? 'A' :
                             file.status === 'deleted' ? 'D' :
                             file.status === 'untracked' ? 'U' :
                             file.status === 'renamed' ? 'R' :
                             file.status === 'copied' ? 'C' :
                             file.status === 'unmerged' ? '!' : 'M'}
                          </span>
                          <div class="flex flex-col min-w-0 text-left">
                            <span class="truncate" title={file.name}>{file.name}</span>
                            <span class="text-[9px] text-gray-500 truncate" title={file.path}>{file.path}</span>
                          </div>
                        </div>
                        
                        {/* Unstage Button */}
                        <button
                          type="button"
                          onClick={(e) => handleUnstage(file, e)}
                          disabled={actionInProgress() === file.path + '-unstage'}
                          class="hidden group-hover:flex items-center justify-center w-5 h-5 bg-red-950/60 hover:bg-red-900/60 border border-red-800/40 rounded text-red-400 text-xs font-bold leading-none shrink-0"
                          title="Unstage changes"
                        >
                          -
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Unstaged Changes */}
              <div>
                <div class="px-2 py-1 text-[9px] uppercase font-bold tracking-wider text-gray-500 flex items-center justify-between">
                  <span>Changes</span>
                  <span class="bg-gray-800 text-gray-400 px-1 rounded">{unstagedChanges().length}</span>
                </div>
                <Show when={unstagedChanges().length === 0}>
                  <div class="px-2 py-1.5 text-[10px] text-gray-600 italic">No unstaged changes</div>
                </Show>
                <div class="space-y-0.5">
                  <For each={unstagedChanges()}>
                    {(file) => (
                      <div
                        onClick={() => selectFile(file)}
                        class={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between group transition-colors text-xs cursor-pointer ${
                          selectedFile()?.path === file.path && !selectedFile()?.staged
                            ? 'bg-indigo-600/20 text-indigo-200 font-semibold'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class={`w-5 h-5 flex items-center justify-center rounded text-[10px] border font-bold shrink-0 ${
                            file.status === 'added' ? 'bg-green-950/40 text-green-400 border-green-800/30' :
                            file.status === 'deleted' ? 'bg-red-950/40 text-red-400 border-red-800/30' :
                            file.status === 'untracked' ? 'bg-indigo-950/40 text-indigo-400 border-indigo-800/30' :
                            file.status === 'renamed' || file.status === 'copied' ? 'bg-teal-950/40 text-teal-400 border-teal-800/30' :
                            file.status === 'unmerged' ? 'bg-amber-950/40 text-amber-400 border-amber-800/30' :
                            'bg-amber-950/40 text-amber-400 border-amber-800/30'
                          }`}>
                            {file.status === 'added' ? 'A' :
                             file.status === 'deleted' ? 'D' :
                             file.status === 'untracked' ? 'U' :
                             file.status === 'renamed' ? 'R' :
                             file.status === 'copied' ? 'C' :
                             file.status === 'unmerged' ? '!' : 'M'}
                          </span>
                          <div class="flex flex-col min-w-0 text-left">
                            <span class="truncate" title={file.name}>{file.name}</span>
                            <span class="text-[9px] text-gray-500 truncate" title={file.path}>{file.path}</span>
                          </div>
                        </div>
                        
                        {/* Action buttons (Stage, Discard) */}
                        <div class="hidden group-hover:flex items-center gap-1 shrink-0">
                          <Show when={file.status !== 'untracked'}>
                            <button
                              type="button"
                              onClick={(e) => handleDiscard(file, e)}
                              disabled={actionInProgress() === file.path + '-discard'}
                              class="flex items-center justify-center w-5 h-5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 text-[10px]"
                              title="Discard changes"
                            >
                              ↺
                            </button>
                          </Show>
                          <button
                            type="button"
                            onClick={(e) => handleStage(file, e)}
                            disabled={actionInProgress() === file.path + '-stage'}
                            class="flex items-center justify-center w-5 h-5 bg-green-950/60 hover:bg-green-900/60 border border-green-800/40 rounded text-green-400 text-xs font-bold leading-none"
                            title="Stage changes"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

            </div>

            {/* Commit Form */}
            <div class="p-3 border-t border-gray-700/60 bg-gray-950/40 space-y-2">
              <textarea
                value={commitMessage()}
                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                placeholder="Commit message..."
                class="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 resize-none h-14"
              />
              <button
                type="button"
                onClick={handleCommit}
                disabled={isCommitting() || stagedChanges().length === 0 || !commitMessage().trim()}
                class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none text-white rounded py-1.5 text-xs font-semibold transition-all active:scale-95 shadow-md shadow-indigo-500/10 flex items-center justify-center gap-1.5"
              >
                <Show when={isCommitting()}>
                  <svg class="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </Show>
                Commit ({stagedChanges().length})
              </button>
            </div>
          </>
        </Show>

      </div>

      {/* Main Panel: Diff viewer */}
      <div class="flex-1 flex flex-col h-full bg-gray-950/40 min-w-0 overflow-hidden">
        
        {/* Error banner */}
        <Show when={gitError()}>
          <div class="px-4 py-2 bg-red-950/80 border-b border-red-700/50 text-xs text-red-300 flex items-center justify-between shrink-0">
            <span class="truncate">{gitError()}</span>
            <button type="button" onClick={() => setGitError('')} class="text-red-400 hover:text-red-200 font-semibold pl-2">Dismiss</button>
          </div>
        </Show>

        <Show
          when={selectedFile()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center text-gray-500 space-y-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              <div class="text-xs text-center">
                <p class="font-medium text-gray-400">No file selected</p>
                <p class="text-[10px] text-gray-600 mt-1">Select a file from the sidebar to view its changes</p>
              </div>
            </div>
          }
        >
          <>
            {/* Diff Header */}
            <div class="px-4 py-2.5 bg-gray-800/50 border-b border-gray-700/60 flex items-center justify-between shrink-0">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs font-semibold text-gray-200 truncate" title={selectedFile()?.path}>
                  {selectedFile()?.path}
                </span>
                <span class={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                  selectedFile()?.staged 
                    ? 'bg-green-950/50 text-green-400 border border-green-800/30' 
                    : 'bg-amber-950/50 text-amber-400 border border-amber-800/30'
                }`}>
                  {selectedFile()?.staged ? 'Staged' : 'Unstaged'}
                </span>
              </div>

              {/* Context Actions */}
              <div class="flex gap-2">
                <Show when={!selectedFile()?.staged && selectedFile()?.status !== 'untracked'}>
                  <button
                    type="button"
                    onClick={() => handleDiscard(selectedFile()!)}
                    disabled={actionInProgress() === selectedFile()?.path + '-discard'}
                    class="bg-gray-800 hover:bg-gray-700 text-gray-200 rounded px-2.5 py-1 text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Discard
                  </button>
                </Show>
                <Show
                  when={selectedFile()?.staged}
                  fallback={
                    <button
                      type="button"
                      onClick={() => handleStage(selectedFile()!)}
                      disabled={actionInProgress() === selectedFile()?.path + '-stage'}
                      class="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 shadow-md shadow-indigo-500/10 disabled:opacity-50"
                    >
                      Stage File
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleUnstage(selectedFile()!)}
                    disabled={actionInProgress() === selectedFile()?.path + '-unstage'}
                    class="bg-red-900/60 hover:bg-red-800/60 text-red-200 rounded px-2.5 py-1 text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Unstage File
                  </button>
                </Show>
              </div>
            </div>

            {/* Diff Viewer Area */}
            <div class="flex-1 min-h-0 relative flex bg-gray-950/80 font-mono text-xs overflow-y-auto py-3">
              <Show
                when={isDiffLoading()}
                fallback={
                  <div class="w-full h-fit flex flex-col font-mono text-xs">
                    <Show when={!diffContent() || diffContent().trim() === ''}>
                      <div class="text-gray-500 italic p-4 text-xs font-sans">No changes found (or binary file)</div>
                    </Show>
                    <For each={diffContent().split('\n')}>
                      {(line) => <span class={getDiffLineClass(line)}>{line}</span>}
                    </For>
                  </div>
                }
              >
                <div class="absolute inset-0 flex items-center justify-center text-gray-500">
                  <svg class="animate-spin h-6 w-6 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              </Show>
            </div>
          </>
        </Show>

      </div>

    </div>
  );
}
