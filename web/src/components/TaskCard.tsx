import { Show, For } from 'solid-js';
import type { Task, Column } from '../types';

type TaskCardProps = {
  task: Task;
  subtasks: Task[];
  columnsMap: Record<string, Column>;
  onSelect: (task: Task) => void;
  onDragStart: (e: DragEvent, id: number) => void;
  onRunTask: (id: number) => void;
};

export function TaskCard(props: TaskCardProps) {
  return (
    <div 
      draggable="true"
      onClick={() => props.onSelect(props.task)}
      onDragStart={(e) => props.onDragStart(e, props.task.id)}
      class={`bg-gray-800 border-y border-r border-l-4 border-gray-700 ${props.columnsMap[props.task.status]?.border || 'border-l-gray-700'} p-4 rounded-lg shadow-md cursor-pointer hover:border-indigo-500/50 transition-colors group relative`}
    >
      <div class="flex justify-between items-start mb-2">
        <h3 class="font-medium text-gray-100 leading-tight pr-6">{props.task.title}</h3>
        <Show when={props.task.status === 'backlog' || props.task.status === 'failed'}>
          <button 
            onClick={(e) => { e.stopPropagation(); props.onRunTask(props.task.id); }}
            class="absolute top-3 right-3 text-gray-400 hover:text-green-400 transition-colors"
            title="Run Task"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
            </svg>
          </button>
        </Show>
      </div>
      
      <Show when={props.task.description}>
        <p class="text-sm text-gray-400 mb-3 line-clamp-2">{props.task.description}</p>
      </Show>
      
      <div class="mt-3 space-y-2">
        <div class="flex items-center text-xs text-gray-500 gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H8a3 3 0 00-3 3v5H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
          </svg>
          <span class="truncate" title={props.task.project_path}>{props.task.project_path.split('/').pop()}</span>
        </div>
        
        <Show when={props.task.session_id}>
          <div class="flex items-center text-xs text-indigo-400/80 gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
            </svg>
            <span class="font-mono">{props.task.session_id}</span>
          </div>
        </Show>
      </div>
      
      {/* Nested Subtasks */}
      <Show when={props.subtasks.length > 0}>
        <div class="mt-3 space-y-1.5">
          <For each={props.subtasks}>
            {(subtask) => (
              <div 
                onClick={(e) => { e.stopPropagation(); props.onSelect(subtask); }}
                class="bg-gray-900/60 border border-gray-700/60 rounded px-2.5 py-1.5 flex items-center justify-between group/subtask hover:bg-gray-700/60 transition-colors"
              >
                <div class="flex items-center gap-2 overflow-hidden">
                  <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    subtask.status === 'failed' ? 'bg-red-500' :
                    subtask.status === 'done' ? 'bg-green-500' :
                    subtask.status === 'review' ? 'bg-purple-500' :
                    subtask.status === 'in_progress' ? 'bg-amber-500' :
                    subtask.status === 'todo' ? 'bg-blue-500' :
                    'bg-gray-500'
                  }`}></span>
                  <span class="text-xs text-gray-300 truncate">{subtask.title}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${
                    subtask.status === 'failed' ? 'bg-red-950/40 text-red-400 border-red-900/50' :
                    subtask.status === 'done' ? 'bg-green-950/40 text-green-400 border-green-900/50' :
                    subtask.status === 'review' ? 'bg-purple-950/40 text-purple-400 border-purple-900/50' :
                    subtask.status === 'in_progress' ? 'bg-amber-950/40 text-amber-400 border-amber-900/50' :
                    subtask.status === 'todo' ? 'bg-blue-950/40 text-blue-400 border-blue-900/50' :
                    'bg-gray-800 text-gray-400 border-gray-700'
                  }`}>
                    {subtask.status.replace('_', ' ')}
                  </span>
                  <Show when={subtask.status === 'backlog' || subtask.status === 'failed'}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); props.onRunTask(subtask.id); }}
                      class="text-gray-500 hover:text-green-400 transition-colors opacity-0 group-hover/subtask:opacity-100"
                      title="Run Subtask"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
