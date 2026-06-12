import { createSignal, onMount, For, Show } from 'solid-js';

type Task = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  project_path: string;
  session_id: string | null;
  created_at: string;
};

const COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' }
];

function App() {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  
  // Modal state
  const [showModal, setShowModal] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal('');
  const [newPath, setNewPath] = createSignal('');
  const [newDesc, setNewDesc] = createSignal('');

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        setTasks(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    }
  };

  onMount(() => {
    fetchTasks();
    // Poll every 5 seconds for updates
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  });

  const updateStatus = async (id: number, status: string) => {
    // Optimistic update
    setTasks(tasks().map(t => t.id === id ? { ...t, status } : t));
    try {
      await fetch(`/api/tasks/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
    } catch (e) {
      console.error(e);
      fetchTasks(); // Revert on error
    }
  };

  const runTask = async (id: number) => {
    setTasks(tasks().map(t => t.id === id ? { ...t, status: 'todo' } : t));
    try {
      await fetch(`/api/tasks/${id}/run`, { method: 'POST' });
    } catch (e) {
      console.error(e);
      fetchTasks();
    }
  };

  const handleAddTask = async (e: Event) => {
    e.preventDefault();
    if (!newTitle() || !newPath()) return;
    
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle(),
          project_path: newPath(),
          description: newDesc() || null
        })
      });
      setShowModal(false);
      setNewTitle('');
      setNewPath('');
      setNewDesc('');
      fetchTasks();
    } catch (e) {
      console.error(e);
    }
  };

  // Drag and Drop handlers
  let draggedTaskId: number | null = null;

  const onDragStart = (e: DragEvent, id: number) => {
    draggedTaskId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: DragEvent, status: string) => {
    e.preventDefault();
    if (draggedTaskId !== null) {
      updateStatus(draggedTaskId, status);
      draggedTaskId = null;
    }
  };

  return (
    <div class="min-h-screen flex flex-col bg-gray-900 text-gray-100 font-sans">
      <header class="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Orcwiz Kanban</h1>
          <p class="text-sm text-gray-400 mt-1">Agent Orchestration Dashboard</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md shadow-lg shadow-indigo-500/20 transition-all active:scale-95 font-medium flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
          </svg>
          New Task
        </button>
      </header>

      <main class="flex-1 overflow-x-auto p-6">
        <div class="flex gap-6 h-full items-start min-w-max">
          <For each={COLUMNS}>
            {(col) => (
              <div 
                class="w-80 flex flex-col bg-gray-800/50 border border-gray-700/50 rounded-xl h-[calc(100vh-140px)] overflow-hidden"
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, col.id)}
              >
                <div class="p-4 border-b border-gray-700/50 flex justify-between items-center bg-gray-800/80 backdrop-blur-sm">
                  <h2 class="font-semibold text-gray-200">{col.title}</h2>
                  <span class="bg-gray-700 text-gray-300 text-xs py-1 px-2 rounded-full">
                    {tasks().filter(t => t.status === col.id).length}
                  </span>
                </div>
                
                <div class="flex-1 p-3 overflow-y-auto column-scroll space-y-3">
                  <For each={tasks().filter(t => t.status === col.id)}>
                    {(task) => (
                      <div 
                        draggable="true"
                        onDragStart={(e) => onDragStart(e, task.id)}
                        class="bg-gray-800 border border-gray-700 p-4 rounded-lg shadow-md cursor-grab active:cursor-grabbing hover:border-indigo-500/50 transition-colors group relative"
                      >
                        <div class="flex justify-between items-start mb-2">
                          <h3 class="font-medium text-gray-100 leading-tight pr-6">{task.title}</h3>
                          <Show when={col.id === 'backlog'}>
                            <button 
                              onClick={() => runTask(task.id)}
                              class="absolute top-3 right-3 text-gray-400 hover:text-green-400 transition-colors"
                              title="Run Task"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                              </svg>
                            </button>
                          </Show>
                        </div>
                        
                        <Show when={task.description}>
                          <p class="text-sm text-gray-400 mb-3 line-clamp-2">{task.description}</p>
                        </Show>
                        
                        <div class="mt-3 space-y-2">
                          <div class="flex items-center text-xs text-gray-500 gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H8a3 3 0 00-3 3v5H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                            </svg>
                            <span class="truncate" title={task.project_path}>{task.project_path.split('/').pop()}</span>
                          </div>
                          
                          <Show when={task.session_id}>
                            <div class="flex items-center text-xs text-indigo-400/80 gap-1.5">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                              </svg>
                              <span class="font-mono">{task.session_id}</span>
                            </div>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                  
                  {/* Empty state placeholder for drop target */}
                  <Show when={tasks().filter(t => t.status === col.id).length === 0}>
                    <div class="h-24 border-2 border-dashed border-gray-700/50 rounded-lg flex items-center justify-center text-gray-500 text-sm">
                      Drop tasks here
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </main>

      {/* Add Task Modal */}
      <Show when={showModal()}>
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div class="p-6 border-b border-gray-700">
              <h2 class="text-xl font-bold text-gray-100">Add New Task</h2>
            </div>
            
            <form onSubmit={handleAddTask} class="p-6 space-y-4">
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
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Project Path</label>
                <input 
                  type="text" 
                  required
                  value={newPath()}
                  onInput={e => setNewPath(e.currentTarget.value)}
                  class="w-full bg-gray-900 border border-gray-700 rounded-md px-4 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
                  placeholder="e.g. ~/dev/my-project"
                />
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
              
              <div class="pt-4 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
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
    </div>
  );
}

export default App;
