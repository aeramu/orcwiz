import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task, Column, OrcwizConfig } from '../types';
import { getUniqueProjectPaths } from '../pathUtils';
import { ChatTab } from './ChatTab';
import { FileExplorer } from './FileExplorer';
import { GitTab } from './GitTab';

type TaskDetailsModalProps = {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  columnsMap: Record<string, Column>;
  columns: Column[];
  agents: any[];
  onDelete: () => Promise<void>;
  onUpdate: (title: string, path: string, desc: string, parentId: string, assignedAgent: string) => Promise<void>;
  config: OrcwizConfig | null;
};

export function TaskDetailsModal(props: TaskDetailsModalProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editPath, setEditPath] = createSignal('');
  const [editDesc, setEditDesc] = createSignal('');
  const [editParentId, setEditParentId] = createSignal('');
  const [editAssignedAgent, setEditAssignedAgent] = createSignal('');
  const [showEditPathSuggestions, setShowEditPathSuggestions] = createSignal(false);
  const [editDirRecommendations, setEditDirRecommendations] = createSignal<string[]>([]);
  let editDebounceTimer: number | undefined;

  createEffect(() => {
    const inputPath = editPath();
    if (editDebounceTimer) {
      clearTimeout(editDebounceTimer);
    }
    
    if (!inputPath) {
      setEditDirRecommendations([]);
      return;
    }

    editDebounceTimer = window.setTimeout(() => {
      const lastSlashIndex = inputPath.lastIndexOf('/');
      let parent = '';
      let prefix = '';
      
      if (lastSlashIndex !== -1) {
        parent = inputPath.substring(0, lastSlashIndex);
        prefix = inputPath.substring(lastSlashIndex + 1);
        if (parent === '') {
          parent = '/';
        }
      } else {
        parent = '.';
        prefix = inputPath;
      }

      fetch(`/api/files?path=${encodeURIComponent(parent)}`)
        .then(async (res) => {
          if (res.ok) {
            const entries = await res.json();
            const matches = entries
              .filter((e: any) => e.is_dir && e.name.toLowerCase().includes(prefix.toLowerCase()))
              .map((e: any) => e.path);
            setEditDirRecommendations(matches);
          } else {
            setEditDirRecommendations([]);
          }
        })
        .catch(() => {
          setEditDirRecommendations([]);
        });
    }, 250);
  });

  const [activeTab, setActiveTab] = createSignal<'chat' | 'files' | 'git'>('files');

  const isOpencodeSession = () => props.task?.session_id?.startsWith('opencode|') ?? false;

  // Synchronize internal state when the selected task changes or the modal is opened
  createEffect(() => {
    const t = props.task;
    const isOpen = props.isOpen;
    if (t && isOpen) {
      setEditTitle(t.title);
      setEditPath(t.project_path);
      setEditDesc(t.description || '');
      setEditParentId(t.parent_id?.toString() || '');
      setEditAssignedAgent(t.assigned_agent || '');
      
      // Reset files/tab state
      setActiveTab(isOpencodeSession() ? 'chat' : 'files');
    }
    if (!isOpen) {
      setIsEditing(false);
    }
  });

  const uniquePaths = () => getUniqueProjectPaths(props.tasks);

  const editFilteredPaths = () => {
    const current = editPath().toLowerCase();
    return uniquePaths().filter(p => p.toLowerCase().includes(current));
  };

  const handleSave = async () => {
    await props.onUpdate(editTitle(), editPath(), editDesc(), editParentId(), editAssignedAgent());
    setIsEditing(false);
  };

  return (
    <Show when={props.isOpen && props.task}>
      {(() => {
        const task = props.task!;
        const colMap = props.columnsMap;
        const cols = props.columns;

        const detailsContent = (
          <div class="space-y-6">
            <div class="flex justify-between items-center">
              <div class="flex flex-wrap gap-4">
                <span class={`border text-xs font-medium px-2.5 py-1 rounded ${
                  colMap[task.status]?.badgeClass || 'bg-indigo-900/50 text-indigo-300 border-indigo-700/50'
                }`}>
                  {cols.find(c => c.id === task.status)?.title}
                </span>
                <span class="text-xs text-gray-400 flex items-center">
                  ID: {task.id}
                </span>
                <Show when={task.parent_id}>
                  <span class="text-xs text-indigo-400 border border-indigo-700/50 bg-indigo-900/30 px-2 py-0.5 rounded flex items-center">
                    Subtask of #{task.parent_id}
                  </span>
                </Show>
                <span class="text-xs text-gray-400 flex items-center">
                  Created: {new Date(task.created_at).toLocaleString()}
                </span>
              </div>
              <Show when={(task.status === 'backlog' || task.status === 'failed') && !isEditing()}>
                <div class="flex space-x-2">
                  <button
                    onClick={props.onDelete}
                    class="text-xs bg-red-900/60 hover:bg-red-800/60 text-red-200 border border-red-800/60 px-3 py-1.5 rounded transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setIsEditing(true)}
                    class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded transition-colors"
                  >
                    Edit Task
                  </button>
                </div>
              </Show>
              <Show when={isEditing()}>
                <div class="flex space-x-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors shadow-md shadow-indigo-500/20"
                  >
                    Save Changes
                  </button>
                </div>
              </Show>
            </div>

            <div>
              <h3 class="text-sm font-medium text-gray-400 mb-2">Description</h3>
              <Show when={!isEditing()}>
                <div class="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 text-sm text-gray-300 whitespace-pre-wrap min-h-[4rem]">
                  {task.description || <span class="italic text-gray-500">No description provided.</span>}
                </div>
              </Show>
              <Show when={isEditing()}>
                <textarea 
                  value={editDesc()}
                  onInput={e => setEditDesc(e.currentTarget.value)}
                  rows="4"
                  class="w-full bg-gray-900/50 rounded-lg p-3 border border-indigo-500 text-sm text-gray-300 focus:outline-none resize-none"
                ></textarea>
              </Show>
            </div>

            <div class="grid grid-cols-1 gap-6">
              <div>
                <h3 class="text-sm font-medium text-gray-400 mb-2">Project Path</h3>
                <Show when={!isEditing()}>
                  <div class="flex items-center text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-700/50">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H8a3 3 0 00-3 3v5H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                    </svg>
                    <span class="truncate" title={task.project_path}>{task.project_path}</span>
                  </div>
                </Show>
                <Show when={isEditing()}>
                  <div class="relative">
                    <input 
                      type="text" 
                      value={editPath()}
                      onInput={e => {
                        setEditPath(e.currentTarget.value);
                        setShowEditPathSuggestions(true);
                      }}
                      onFocus={() => setShowEditPathSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowEditPathSuggestions(false), 200)}
                      class="w-full text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-indigo-500 focus:outline-none mb-3"
                    />
                    <Show when={showEditPathSuggestions() && (editFilteredPaths().length > 0 || editDirRecommendations().length > 0)}>
                      <div class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto divide-y divide-gray-700/50">
                        <Show when={editFilteredPaths().length > 0}>
                          <div class="p-1">
                            <div class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Existing Task Paths</div>
                            <For each={editFilteredPaths()}>
                              {(path) => (
                                <button
                                  type="button"
                                  class="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                                  onClick={() => {
                                    setEditPath(path);
                                    setShowEditPathSuggestions(false);
                                  }}
                                >
                                  {path}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={editDirRecommendations().length > 0}>
                          <div class="p-1">
                            <div class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
                              <span>📁</span> Directory Recommendations
                            </div>
                            <For each={editDirRecommendations()}>
                              {(path) => (
                                <button
                                  type="button"
                                  class="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors truncate"
                                  onClick={() => {
                                    setEditPath(path);
                                    setShowEditPathSuggestions(false);
                                  }}
                                >
                                  {path}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <h3 class="text-sm font-medium text-gray-400 mb-2 mt-4">Parent Task ID</h3>
                  <input 
                    type="number" 
                    value={editParentId()}
                    onInput={e => setEditParentId(e.currentTarget.value)}
                    class="w-full text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-indigo-500 focus:outline-none mb-3"
                  />
                  <h3 class="text-sm font-medium text-gray-400 mb-2 mt-4">Assigned Agent</h3>
                  <select 
                    value={editAssignedAgent()}
                    onChange={e => setEditAssignedAgent(e.currentTarget.value)}
                    class="w-full text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-indigo-500 focus:outline-none"
                  >
                    <option value="">No Agent Assigned</option>
                    <For each={props.agents}>
                      {(agent) => (
                        <option value={agent.name}>{agent.name}</option>
                      )}
                    </For>
                  </select>
                </Show>
              </div>

              <div>
                <h3 class="text-sm font-medium text-gray-400 mb-2">Session ID</h3>
                <div class="flex items-center text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-700/50 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-indigo-400/80" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                  </svg>
                  <span class="font-mono truncate select-all">{task.session_id || 'Not started'}</span>
                </div>

                <h3 class="text-sm font-medium text-gray-400 mb-2">Assigned Agent</h3>
                <div class="flex items-center text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-700/50">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-indigo-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>{task.assigned_agent || 'Unassigned'}</span>
                </div>
              </div>
            </div>
          </div>
        );

        return (
          <div 
            class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" 
            onClick={() => { props.onClose(); setIsEditing(false); }}
          >
            <div 
              class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full h-[85vh] max-w-6xl overflow-hidden transition-all duration-300 flex flex-col" 
              onClick={e => e.stopPropagation()}
            >
              <div class="p-6 border-b border-gray-700 shrink-0 flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <Show when={!isEditing()}>
                    <h2 class="text-2xl font-bold text-gray-100">{task.title}</h2>
                  </Show>
                  <Show when={isEditing()}>
                    <input
                      type="text"
                      value={editTitle()}
                      onInput={e => setEditTitle(e.currentTarget.value)}
                      class="text-2xl font-bold text-gray-100 bg-gray-900 border border-indigo-500 rounded px-2 py-1 w-full focus:outline-none"
                    />
                  </Show>
                </div>
                <button
                  onClick={() => { props.onClose(); setIsEditing(false); }}
                  class="text-gray-400 hover:text-gray-200 transition-colors mt-1 shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              
              <div class="flex-1 min-h-0 flex md:flex-row flex-col">
                <div class="md:w-[42%] w-full border-r border-gray-700/60 p-6 space-y-6 overflow-y-auto h-full min-h-0">
                  {detailsContent}
                </div>
                <div class="md:w-[58%] w-full flex flex-col h-full bg-gray-900/40 min-h-0">
                  
                  {/* Tabs Header */}
                  <div class="flex border-b border-gray-700/60 bg-gray-800/30 shrink-0">
                    <Show when={isOpencodeSession()}>
                      <button 
                        type="button"
                        onClick={() => setActiveTab('chat')}
                        class={`flex-1 md:flex-none px-6 py-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${
                          activeTab() === 'chat' 
                            ? 'border-indigo-500 text-indigo-400 bg-gray-900/10' 
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/10'
                        }`}
                      >
                        <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        Chat
                      </button>
                    </Show>
                    <button 
                      type="button"
                      onClick={() => setActiveTab('files')}
                      class={`flex-1 md:flex-none px-6 py-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${
                        activeTab() === 'files' 
                          ? 'border-indigo-500 text-indigo-400 bg-gray-900/10' 
                          : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/10'
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      Files
                    </button>
                    <button 
                      type="button"
                      onClick={() => setActiveTab('git')}
                      class={`flex-1 md:flex-none px-6 py-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${
                        activeTab() === 'git' 
                          ? 'border-indigo-500 text-indigo-400 bg-gray-900/10' 
                          : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/10'
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="6" y1="3" x2="6" y2="15"></line>
                        <circle cx="18" cy="6" r="3"></circle>
                        <circle cx="6" cy="18" r="3"></circle>
                        <path d="M18 9a9 9 0 0 1-9 9"></path>
                      </svg>
                      Git
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div class="flex-1 min-h-0 relative">
                    
                    {/* Chat Tab */}
                    <Show when={activeTab() === 'chat' && isOpencodeSession()}>
                      <ChatTab
                        task={task}
                        config={props.config}
                        isOpen={props.isOpen}
                      />
                    </Show>

                    {/* Files Tab */}
                    <Show when={activeTab() === 'files'}>
                      <FileExplorer
                        task={task}
                        isOpen={props.isOpen}
                      />
                    </Show>

                    {/* Git Tab */}
                    <Show when={activeTab() === 'git'}>
                      <GitTab
                        task={task}
                        isOpen={props.isOpen}
                      />
                    </Show>
                  </div>
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </Show>
  );
}
