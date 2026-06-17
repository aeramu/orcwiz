import { For, Show } from 'solid-js';
import type { Column, Task } from '../types';
import { TaskCard } from './TaskCard';

type KanbanColumnProps = {
  column: Column;
  tasks: Task[];
  allTasks: Task[];
  columnsMap: Record<string, Column>;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent, status: string) => void;
  onDragStart: (e: DragEvent, id: number) => void;
  onSelectTask: (task: Task) => void;
  onRunTask: (id: number) => void;
};

export function KanbanColumn(props: KanbanColumnProps) {
  const columnTasks = () => props.tasks.filter(t => t.status === props.column.id);
  const topLevelTasks = () => columnTasks().filter(t => t.parent_id === null);

  return (
    <div 
      class={`w-80 flex flex-col bg-gray-800/50 border border-gray-700/50 border-t-2 ${props.column.color} rounded-xl h-[calc(100vh-140px)] overflow-hidden`}
      onDragOver={props.onDragOver}
      onDrop={(e) => props.onDrop(e, props.column.id)}
    >
      <div class="p-4 border-b border-gray-700/50 flex justify-between items-center bg-gray-800/80 backdrop-blur-sm">
        <h2 class="font-semibold text-gray-200">{props.column.title}</h2>
        <span class={`text-xs py-1 px-2 rounded-full border ${props.column.bg}`}>
          {columnTasks().length}
        </span>
      </div>
      
      <div class="flex-1 p-3 overflow-y-auto column-scroll space-y-3">
        <For each={topLevelTasks()}>
          {(task) => (
            <TaskCard 
              task={task}
              subtasks={props.allTasks.filter(sub => sub.parent_id === task.id)}
              columnsMap={props.columnsMap}
              onSelect={props.onSelectTask}
              onDragStart={props.onDragStart}
              onRunTask={props.onRunTask}
            />
          )}
        </For>
        
        {/* Empty state placeholder for drop target */}
        <Show when={columnTasks().length === 0}>
          <div class="h-24 border-2 border-dashed border-gray-700/50 rounded-lg flex items-center justify-center text-gray-500 text-sm">
            Drop tasks here
          </div>
        </Show>
      </div>
    </div>
  );
}
