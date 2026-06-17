import { createSignal, onMount, For } from 'solid-js';
import type { Task, Column, OrcwizConfig } from './types';
import { KanbanColumn } from './components/KanbanColumn';
import { AddTaskModal } from './components/AddTaskModal';
import { TaskDetailsModal } from './components/TaskDetailsModal';

const COLUMNS: Column[] = [
  { id: 'backlog', title: 'Backlog', color: 'border-t-gray-500', bg: 'bg-gray-700/50 text-gray-300 border-gray-700/50', border: 'border-l-gray-500', badgeClass: 'bg-gray-800 text-gray-300 border-gray-700' },
  { id: 'todo', title: 'To Do', color: 'border-t-blue-500', bg: 'bg-blue-900/50 text-blue-300 border-blue-700/50', border: 'border-l-blue-500', badgeClass: 'bg-blue-900/40 text-blue-300 border-blue-700/50' },
  { id: 'in_progress', title: 'In Progress', color: 'border-t-amber-500', bg: 'bg-amber-900/50 text-amber-300 border-amber-700/50', border: 'border-l-amber-500', badgeClass: 'bg-amber-900/40 text-amber-300 border-amber-700/50' },
  { id: 'review', title: 'Review', color: 'border-t-purple-500', bg: 'bg-purple-900/50 text-purple-300 border-purple-700/50', border: 'border-l-purple-500', badgeClass: 'bg-purple-900/40 text-purple-300 border-purple-700/50' },
  { id: 'done', title: 'Done', color: 'border-t-green-500', bg: 'bg-green-900/50 text-green-300 border-green-700/50', border: 'border-l-green-500', badgeClass: 'bg-green-900/40 text-green-300 border-green-700/50' },
  { id: 'failed', title: 'Failed', color: 'border-t-red-500', bg: 'bg-red-900/50 text-red-300 border-red-700/50', border: 'border-l-red-500', badgeClass: 'bg-red-900/40 text-red-300 border-red-700/50' }
];

const COLUMNS_MAP: Record<string, Column> = COLUMNS.reduce((acc, col) => {
  acc[col.id] = col;
  return acc;
}, {} as Record<string, Column>);

function App() {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [config, setConfig] = createSignal<OrcwizConfig | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = createSignal(false);
  const [selectedTask, setSelectedTask] = createSignal<Task | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        setConfig(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch config", e);
    }
  };

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
    fetchConfig();
    // Poll every 5 seconds for updates
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  });

  const updateStatus = async (id: number, status: string) => {
    // Optimistic update
    setTasks(tasks().map(t => t.id === id ? { ...t, status } : t));
    try {
      const res = await fetch(`/api/tasks/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("Failed to update status on server:", err);
        fetchTasks(); // Revert on error
      }
    } catch (e) {
      console.error(e);
      fetchTasks(); // Revert on error
    }
  };

  const runTask = async (id: number) => {
    setTasks(tasks().map(t => t.id === id ? { ...t, status: 'todo' } : t));
    try {
      const res = await fetch(`/api/tasks/${id}/run`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        console.error("Failed to run task on server:", err);
        fetchTasks();
      }
    } catch (e) {
      console.error(e);
      fetchTasks();
    }
  };

  const handleAddTask = async (title: string, path: string, desc: string, parentId: string) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          project_path: path,
          description: desc || null,
          parent_id: parentId ? parseInt(parentId, 10) : null
        })
      });
      if (res.ok) {
        setShowModal(false);
        fetchTasks();
      } else {
        const err = await res.json();
        alert("Failed to add task: " + (err.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteTask = async () => {
    const t = selectedTask();
    if (!t) return;
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedTask(null);
        fetchTasks();
      } else {
        const err = await res.json();
        alert("Failed to delete task: " + (err.error || "Unknown error"));
      }
    } catch (e) {
      console.error("Failed to delete task", e);
    }
  };

  const handleUpdateTask = async (title: string, path: string, desc: string, parentId: string) => {
    const t = selectedTask();
    if (!t) return;
    
    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || undefined,
          project_path: path || undefined,
          description: desc || undefined,
          parent_id: parentId ? parseInt(parentId, 10) : null
        })
      });
      
      if (res.ok) {
        fetchTasks();
        // Update selected task view
        setSelectedTask({
          ...t,
          title: title || t.title,
          project_path: path || t.project_path,
          description: desc || t.description,
          parent_id: parentId ? parseInt(parentId, 10) : null
        });
      } else {
        const err = await res.json();
        alert("Failed to update: " + (err.error || "Unknown error"));
      }
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
              <KanbanColumn 
                column={col}
                tasks={tasks()}
                allTasks={tasks()}
                columnsMap={COLUMNS_MAP}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragStart={onDragStart}
                onSelectTask={setSelectedTask}
                onRunTask={runTask}
              />
            )}
          </For>
        </div>
      </main>

      <AddTaskModal 
        isOpen={showModal()}
        onClose={() => setShowModal(false)}
        tasks={tasks()}
        onAddTask={handleAddTask}
      />

      <TaskDetailsModal 
        task={selectedTask()}
        isOpen={selectedTask() !== null}
        onClose={() => setSelectedTask(null)}
        tasks={tasks()}
        columnsMap={COLUMNS_MAP}
        columns={COLUMNS}
        onDelete={handleDeleteTask}
        onUpdate={handleUpdateTask}
        config={config()}
      />
    </div>
  );
}

export default App;
