import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import type { Task } from '../types';
import { getRelativePath } from '../pathUtils';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, foldGutter } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { go } from '@codemirror/lang-go';
import { yaml } from '@codemirror/lang-yaml';

type FileExplorerProps = {
  task: Task;
  isOpen: boolean;
};

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
};

type FileTreeItemProps = {
  entry: FileEntry;
  depth: number;
  expandedPaths: () => Record<string, boolean>;
  directoryContents: () => Record<string, FileEntry[]>;
  selectedFile: () => FileEntry | null;
  onSelectFile: (entry: FileEntry) => void;
  onToggleExpand: (path: string) => void;
};

// Map file extensions to CodeMirror language extensions
function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true });
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true, jsx: true });
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'py':
    case 'pyw':
      return python();
    case 'rs':
      return rust();
    case 'json':
    case 'jsonc':
      return json();
    case 'md':
    case 'mdx':
      return markdown();
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'c':
    case 'h':
    case 'hpp':
      return cpp();
    case 'java':
      return java();
    case 'xml':
    case 'svg':
    case 'toml':
      return xml();
    case 'sql':
      return sql();
    case 'go':
      return go();
    case 'yaml':
    case 'yml':
      return yaml();
    default:
      return null;
  }
}

function FileTreeItem(props: FileTreeItemProps) {
  const isExpanded = () => !!props.expandedPaths()[props.entry.path];
  const children = () => props.directoryContents()[props.entry.path] || [];

  return (
    <div class="select-none">
      <Show
        when={props.entry.is_dir}
        fallback={
          <button
            type="button"
            onClick={() => props.onSelectFile(props.entry)}
            style={{ "padding-left": `${props.depth * 12 + 28}px` }}
            class={`w-full text-left py-1.5 pr-2 text-xs rounded flex items-center gap-1.5 truncate transition-all duration-150 ${
              props.selectedFile()?.path === props.entry.path
                ? 'bg-indigo-600/35 text-indigo-200 font-semibold'
                : 'text-gray-300 hover:bg-gray-800/60 hover:text-white'
            }`}
          >
            <span class="text-xs opacity-70 shrink-0">📄</span>
            <span class="truncate" title={props.entry.name}>{props.entry.name}</span>
          </button>
        }
      >
        <div class="flex flex-col">
          <button
            type="button"
            onClick={() => props.onToggleExpand(props.entry.path)}
            style={{ "padding-left": `${props.depth * 12 + 10}px` }}
            class="w-full text-left py-1.5 pr-2 text-xs text-gray-300 hover:bg-gray-800/60 hover:text-white rounded flex items-center gap-1.5 truncate transition-all duration-150 font-medium"
          >
            <span 
              class="text-[8px] text-gray-500 w-3 h-3 flex items-center justify-center transition-transform duration-200 shrink-0" 
              style={{ transform: isExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
            >
              ▶
            </span>
            <span class="text-xs opacity-80 shrink-0">
              {isExpanded() ? '📂' : '📁'}
            </span>
            <span class="truncate" title={props.entry.name}>{props.entry.name}</span>
          </button>
          
          <Show when={isExpanded()}>
            <div class="mt-0.5 flex flex-col">
              <Show 
                when={props.directoryContents()[props.entry.path]} 
                fallback={
                  <div 
                    style={{ "padding-left": `${(props.depth + 1) * 12 + 28}px` }}
                    class="py-1 text-[10px] text-gray-500 italic"
                  >
                    Loading...
                  </div>
                }
              >
                <Show 
                  when={children().length > 0}
                  fallback={
                    <div 
                      style={{ "padding-left": `${(props.depth + 1) * 12 + 28}px` }}
                      class="py-1 text-[10px] text-gray-500 italic"
                    >
                      No files
                    </div>
                  }
                >
                  <For each={children()}>
                    {(child) => (
                      <FileTreeItem
                        entry={child}
                        depth={props.depth + 1}
                        expandedPaths={props.expandedPaths}
                        directoryContents={props.directoryContents}
                        selectedFile={props.selectedFile}
                        onSelectFile={props.onSelectFile}
                        onToggleExpand={props.onToggleExpand}
                      />
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// CodeMirror editor component
function CodeEditor(props: { content: string; filename: string; onChange: (val: string) => void }) {
  let container: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const languageCompartment = new Compartment();
  const editableCompartment = new Compartment();

  onCleanup(() => view?.destroy());

  createEffect(() => {
    const filename = props.filename;
    const langExt = getLanguageExtension(filename);

    if (!view) {
      // Initial mount
      const state = EditorState.create({
        doc: props.content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          bracketMatching(),
          indentOnInput(),
          foldGutter(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          oneDark,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.of(langExt ?? []),
          editableCompartment.of(EditorView.editable.of(true)),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
            },
            '.cm-scroller': { overflow: 'auto', height: '100%' },
            '.cm-content': { paddingTop: '12px', paddingBottom: '12px' },
            '&.cm-focused': { outline: 'none' },
            '.cm-gutters': { background: 'transparent', borderRight: '1px solid rgba(255,255,255,0.06)' },
            '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', paddingRight: '12px' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) props.onChange(update.state.doc.toString());
          }),
        ],
      });

      view = new EditorView({ state, parent: container! });
      return;
    }

    // Reconfigure language when filename changes
    view.dispatch({ effects: languageCompartment.reconfigure(langExt ?? []) });
  });

  // Sync content when it changes externally (file switch)
  createEffect(() => {
    const content = props.content;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  });

  return <div ref={container} class="h-full w-full overflow-hidden" />;
}

export function FileExplorer(props: FileExplorerProps) {
  const [rootPath, setRootPath] = createSignal('');
  const [selectedFile, setSelectedFile] = createSignal<FileEntry | null>(null);
  const [fileContent, setFileContent] = createSignal('');
  const [isSavingFile, setIsSavingFile] = createSignal(false);
  const [isFileLoading, setIsFileLoading] = createSignal(false);
  const [directoryContents, setDirectoryContents] = createSignal<Record<string, FileEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = createSignal<Record<string, boolean>>({});
  const [fileError, setFileError] = createSignal('');
  const [saveSuccess, setSaveSuccess] = createSignal(false);

  const relativePath = (fullPath: string) => {
    const root = props.task.absolute_project_path || props.task.project_path || '';
    return getRelativePath(fullPath, root);
  };

  const fetchDirectory = (path: string) => {
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setDirectoryContents(prev => ({ ...prev, [path]: data }));
          setFileError('');
          return;
        }
        const err = await res.json().catch(() => ({}));
        setFileError(err.error || `Failed to load files (HTTP ${res.status})`);
      })
      .catch((e) => {
        setFileError(e.message || "Failed to fetch directory contents.");
      });
  };

  const toggleExpand = (path: string) => {
    const isExpanded = !expandedPaths()[path];
    setExpandedPaths(prev => ({ ...prev, [path]: isExpanded }));
    if (isExpanded && !directoryContents()[path]) {
      fetchDirectory(path);
    }
  };

  const selectFile = (entry: FileEntry) => {
    setSelectedFile(entry);
    setIsFileLoading(true);
    setFileError('');
    setSaveSuccess(false);
    fetch(`/api/files/read?path=${encodeURIComponent(entry.path)}`)
      .then(async (res) => {
        if (res.ok) {
          const text = await res.text();
          setFileContent(text);
          return;
        }
        const err = await res.json().catch(() => ({}));
        setFileError(err.error || `Failed to read file (HTTP ${res.status})`);
        setFileContent('');
      })
      .catch((e) => {
        setFileError(e.message || "Failed to read file.");
        setFileContent('');
      })
      .finally(() => {
        setIsFileLoading(false);
      });
  };

  const saveFile = () => {
    const file = selectedFile();
    if (!file) return;
    setIsSavingFile(true);
    setFileError('');
    setSaveSuccess(false);
    fetch('/api/files', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file.path, content: fileContent() }),
    })
      .then(async (res) => {
        if (res.ok) {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
          const activeFile = selectedFile();
          if (activeFile) {
            const lastSlash = activeFile.path.lastIndexOf('/');
            if (lastSlash !== -1) {
              fetchDirectory(activeFile.path.substring(0, lastSlash));
            } else {
              fetchDirectory(rootPath());
            }
            setSelectedFile({ ...activeFile, size: new Blob([fileContent()]).size });
          }
          return;
        }
        const err = await res.json().catch(() => ({}));
        setFileError(err.error || `Failed to save file (HTTP ${res.status})`);
      })
      .catch((e) => {
        setFileError(e.message || "Failed to save file.");
      })
      .finally(() => {
        setIsSavingFile(false);
      });
  };

  // Reset/sync state when the active task changes or modal opens
  createEffect(() => {
    const t = props.task;
    const isOpen = props.isOpen;
    if (t && isOpen) {
      const root = t.absolute_project_path || t.project_path || '';
      setRootPath(root);
      setSelectedFile(null);
      setFileContent('');
      setDirectoryContents({});
      setExpandedPaths({ [root]: true });
      setFileError('');
      setSaveSuccess(false);

      if (root) fetchDirectory(root);
    }
  });

  return (
    <div class="absolute inset-0 flex min-h-0 divide-x divide-gray-700/60 animate-fade-in">
      
      {/* File Browser Sidebar */}
      <div class="w-64 shrink-0 flex flex-col h-full bg-gray-950/20 overflow-hidden">
        <div class="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between bg-gray-900/10 shrink-0">
          <span class="text-[10px] uppercase font-bold tracking-wider text-gray-400">Project Files</span>
          <span class="text-[10px] text-gray-500 truncate max-w-[120px] font-mono" title={relativePath(rootPath())}>
            {relativePath(rootPath())}
          </span>
        </div>
        
        <div class="flex-1 overflow-y-auto p-2 space-y-0.5 column-scroll">
          <Show 
            when={directoryContents()[rootPath()]} 
            fallback={
              <div class="p-3 text-xs text-gray-500 italic flex items-center gap-2">
                <svg class="animate-spin h-3.5 w-3.5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading files...
              </div>
            }
          >
            <Show 
              when={(directoryContents()[rootPath()] || []).length > 0}
              fallback={
                <div class="p-3 text-xs text-gray-500 italic">No files found</div>
              }
            >
              <For each={directoryContents()[rootPath()]}>
                {(child) => (
                  <FileTreeItem
                    entry={child}
                    depth={0}
                    expandedPaths={expandedPaths}
                    directoryContents={directoryContents}
                    selectedFile={selectedFile}
                    onSelectFile={selectFile}
                    onToggleExpand={toggleExpand}
                  />
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>

      {/* Editor Area */}
      <div class="flex-1 flex flex-col h-full bg-gray-950/40 min-w-0 overflow-hidden">
        <Show 
          when={selectedFile()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center text-gray-500 space-y-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div class="text-xs text-center">
                <p class="font-medium text-gray-400">No file selected</p>
                <p class="text-[10px] text-gray-600 mt-1">Select a file from the sidebar to view or edit</p>
              </div>
            </div>
          }
        >
          {/* Editor Top Bar */}
          <div class="px-4 py-2.5 bg-gray-800/50 border-b border-gray-700/60 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xs font-semibold text-gray-200 truncate" title={selectedFile()?.path}>
                {relativePath(selectedFile()?.path || '')}
              </span>
              <span class="text-[9px] text-gray-500 font-mono shrink-0 bg-gray-800/60 px-1.5 py-0.5 rounded">
                {(selectedFile()?.size || 0).toLocaleString()} B
              </span>
              {/* Language badge */}
              <Show when={selectedFile()?.name.includes('.')}>
                <span class="text-[9px] text-indigo-400 font-mono shrink-0 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded uppercase">
                  {selectedFile()?.name.split('.').pop()}
                </span>
              </Show>
            </div>
            <button
              type="button"
              onClick={saveFile}
              disabled={isSavingFile()}
              class="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 shadow-md shadow-indigo-500/10 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Show when={isSavingFile()}>
                <svg class="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </Show>
              Save Changes
            </button>
          </div>

          {/* Error / Success Banners */}
          <Show when={fileError()}>
            <div class="px-4 py-2 bg-red-950/80 border-b border-red-700/50 text-xs text-red-300 flex items-center justify-between shrink-0">
              <span class="truncate">{fileError()}</span>
              <button type="button" onClick={() => setFileError('')} class="text-red-400 hover:text-red-200 font-semibold pl-2">Dismiss</button>
            </div>
          </Show>
          <Show when={saveSuccess()}>
            <div class="px-4 py-2 bg-green-950/80 border-b border-green-700/50 text-xs text-green-300 flex items-center justify-between shrink-0">
              <span>File saved successfully.</span>
              <button type="button" onClick={() => setSaveSuccess(false)} class="text-green-400 hover:text-green-200 font-semibold pl-2">Dismiss</button>
            </div>
          </Show>

          {/* Editor */}
          <div class="flex-1 min-h-0 relative overflow-hidden">
            <Show 
              when={isFileLoading()}
              fallback={
                <CodeEditor
                  content={fileContent()}
                  filename={selectedFile()?.name ?? ''}
                  onChange={setFileContent}
                />
              }
            >
              <div class="flex-1 h-full flex items-center justify-center text-gray-500">
                <svg class="animate-spin h-6 w-6 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
