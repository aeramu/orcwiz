import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task, Column } from '../types';
import { getUniqueProjectPaths } from '../pathUtils';

type TaskDetailsModalProps = {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  columnsMap: Record<string, Column>;
  columns: Column[];
  onDelete: () => Promise<void>;
  onUpdate: (title: string, path: string, desc: string, parentId: string) => Promise<void>;
};

export function TaskDetailsModal(props: TaskDetailsModalProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editPath, setEditPath] = createSignal('');
  const [editDesc, setEditDesc] = createSignal('');
  const [editParentId, setEditParentId] = createSignal('');
  const [showEditPathSuggestions, setShowEditPathSuggestions] = createSignal(false);

  // Synchronize internal state when the selected task changes
  createEffect(() => {
    const t = props.task;
    if (t) {
      setEditTitle(t.title);
      setEditPath(t.project_path);
      setEditDesc(t.description || '');
      setEditParentId(t.parent_id?.toString() || '');
    }
    setIsEditing(false);
  });

  const uniquePaths = () => getUniqueProjectPaths(props.tasks);

  const editFilteredPaths = () => {
    const current = editPath().toLowerCase();
    return uniquePaths().filter(p => p.toLowerCase().includes(current));
  };

  const handleSave = async () => {
    await props.onUpdate(editTitle(), editPath(), editDesc(), editParentId());
    setIsEditing(false);
  };

  return (
    <Show when={props.isOpen && props.task}>
      {/* Explicitly bind to props.task since TypeScript flow doesn't infer nested reactivity under Show */}
      {(() => {
        const task = props.task!;
        const colMap = props.columnsMap;
        const cols = props.columns;

        return (
          <div 
            class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" 
            onClick={() => { props.onClose(); setIsEditing(false); }}
          >
            <div 
              class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden" 
              onClick={e => e.stopPropagation()}
            >
              <div class="p-6 border-b border-gray-700 flex justify-between items-start">
                <Show when={!isEditing()}>
                  <h2 class="text-2xl font-bold text-gray-100 pr-8">{task.title}</h2>
                </Show>
                <Show when={isEditing()}>
                  <input 
                    type="text" 
                    value={editTitle()}
                    onInput={e => setEditTitle(e.currentTarget.value)}
                    class="text-2xl font-bold text-gray-100 bg-gray-900 border border-indigo-500 rounded px-2 py-1 w-full mr-4 focus:outline-none"
                  />
                </Show>
                <button 
                  onClick={() => { props.onClose(); setIsEditing(false); }}
                  class="text-gray-400 hover:text-gray-200 transition-colors mt-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div class="p-6 space-y-6">
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

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        <Show when={showEditPathSuggestions() && editFilteredPaths().length > 0}>
                          <div class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                            <For each={editFilteredPaths()}>
                              {(path) => (
                                <button
                                  type="button"
                                  class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
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
                      <h3 class="text-sm font-medium text-gray-400 mb-2 mt-4">Parent Task ID</h3>
                      <input 
                        type="number" 
                        value={editParentId()}
                        onInput={e => setEditParentId(e.currentTarget.value)}
                        class="w-full text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-indigo-500 focus:outline-none"
                      />
                    </Show>
                  </div>

                  <div>
                    <h3 class="text-sm font-medium text-gray-400 mb-2">Session ID</h3>
                    <div class="flex items-center text-sm text-gray-300 bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-700/50">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-indigo-400/80" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                      </svg>
                      <span class="font-mono truncate">{task.session_id || 'Not started'}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div class="p-6 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3">
                <Show when={isEditing()}>
                  <button 
                    onClick={() => setIsEditing(false)}
                    class="px-5 py-2 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    class="px-5 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-colors font-medium"
                  >
                    Save Changes
                  </button>
                </Show>
                <Show when={!isEditing()}>
                  <button 
                    onClick={() => { props.onClose(); setIsEditing(false); }}
                    class="px-5 py-2 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors font-medium"
                  >
                    Close
                  </button>
                </Show>
              </div>
            </div>
          </div>
        );
      })()}
    </Show>
  );
}
