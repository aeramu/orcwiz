import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task } from '../types';
import { getUniqueProjectPaths } from '../pathUtils';

type AddTaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onAddTask: (title: string, path: string, desc: string, parentId: string) => Promise<void>;
};

export function AddTaskModal(props: AddTaskModalProps) {
  const [newTitle, setNewTitle] = createSignal('');
  const [newPath, setNewPath] = createSignal('');
  const [newDesc, setNewDesc] = createSignal('');
  const [newParentId, setNewParentId] = createSignal('');
  const [showPathSuggestions, setShowPathSuggestions] = createSignal(false);
  const [dirRecommendations, setDirRecommendations] = createSignal<string[]>([]);
  let debounceTimer: number | undefined;

  createEffect(() => {
    const inputPath = newPath();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    if (!inputPath) {
      setDirRecommendations([]);
      return;
    }

    debounceTimer = window.setTimeout(() => {
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
            setDirRecommendations(matches);
          } else {
            setDirRecommendations([]);
          }
        })
        .catch(() => {
          setDirRecommendations([]);
        });
    }, 250);
  });


  const uniquePaths = () => getUniqueProjectPaths(props.tasks);

  const filteredPaths = () => {
    const current = newPath().toLowerCase();
    return uniquePaths().filter(p => p.toLowerCase().includes(current));
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!newTitle() || !newPath()) return;
    await props.onAddTask(newTitle(), newPath(), newDesc(), newParentId());
    setNewTitle('');
    setNewPath('');
    setNewDesc('');
    setNewParentId('');
  };

  return (
    <Show when={props.isOpen}>
      <div 
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
        onClick={props.onClose}
      >
        <div 
          class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden" 
          onClick={e => e.stopPropagation()}
        >
          <div class="p-6 border-b border-gray-700">
            <h2 class="text-xl font-bold text-gray-100">Add New Task</h2>
          </div>
          
          <form onSubmit={handleSubmit} class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-1">Title</label>
              <input 
                type="text" 
                required
                value={newTitle()}
                onInput={e => setNewTitle(e.currentTarget.value)}
                class="w-full bg-gray-900 border border-gray-700 rounded-md px-4 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
                placeholder="e.g. Implement login feature"
              />
            </div>
            
            <div class="relative">
              <label class="block text-sm font-medium text-gray-400 mb-1">Project Path</label>
              <input 
                type="text" 
                required
                value={newPath()}
                onInput={e => {
                  setNewPath(e.currentTarget.value);
                  setShowPathSuggestions(true);
                }}
                onFocus={() => setShowPathSuggestions(true)}
                onBlur={() => setTimeout(() => setShowPathSuggestions(false), 200)}
                class="w-full bg-gray-900 border border-gray-700 rounded-md px-4 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
                placeholder="e.g. ~/dev/my-project"
              />
              <Show when={showPathSuggestions() && (filteredPaths().length > 0 || dirRecommendations().length > 0)}>
                <div class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto divide-y divide-gray-700/50">
                  <Show when={filteredPaths().length > 0}>
                    <div class="p-1">
                      <div class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Existing Task Paths</div>
                      <For each={filteredPaths()}>
                        {(path) => (
                          <button
                            type="button"
                            class="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                            onClick={() => {
                              setNewPath(path);
                              setShowPathSuggestions(false);
                            }}
                          >
                            {path}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={dirRecommendations().length > 0}>
                    <div class="p-1">
                      <div class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
                        <span>📁</span> Directory Recommendations
                      </div>
                      <For each={dirRecommendations()}>
                        {(path) => (
                          <button
                            type="button"
                            class="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors truncate"
                            onClick={() => {
                              setNewPath(path);
                              setShowPathSuggestions(false);
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
            
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-1">Description (Optional)</label>
              <textarea 
                value={newDesc()}
                onInput={e => setNewDesc(e.currentTarget.value)}
                rows="3"
                class="w-full bg-gray-900 border border-gray-700 rounded-md px-4 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors resize-none"
                placeholder="Add any specific context or instructions..."
              ></textarea>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-1">Parent Task ID (Optional)</label>
              <input 
                type="number" 
                value={newParentId()}
                onInput={e => setNewParentId(e.currentTarget.value)}
                class="w-full bg-gray-900 border border-gray-700 rounded-md px-4 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
                placeholder="e.g. 1"
              />
            </div>
            
            <div class="pt-4 flex justify-end gap-3">
              <button 
                type="button" 
                onClick={props.onClose}
                class="px-4 py-2 rounded-md text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-md shadow-lg shadow-indigo-500/20 transition-all active:scale-95 font-medium"
              >
                Create Task
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
