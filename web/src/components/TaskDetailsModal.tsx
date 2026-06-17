import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task, Column, OrcwizConfig } from '../types';
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
  config: OrcwizConfig | null;
};

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
};


function renderMarkdown(text: string) {
  if (!text) return '';
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Code blocks: ```language ... ``` or ``` ... ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-xs text-gray-300 my-3 overflow-x-auto whitespace-pre select-all">${code.trim()}</pre>`;
  });
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
    return `<pre class="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-xs text-gray-300 my-3 overflow-x-auto whitespace-pre select-all">${code.trim()}</pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-gray-950 border border-gray-800 rounded px-1.5 py-0.5 font-mono text-xs text-indigo-300 font-medium">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-100">$1</strong>');

  return html;
}

function MessageItem(props: { message: any }) {
  const msg = props.message;

  return (
    <Show when={msg}>
      {/* User Message */}
      <Show when={msg.info?.role === 'user'}>
        <div class="flex justify-end w-full">
          <div class="max-w-[80%] bg-indigo-600 text-white rounded-2xl px-4 py-2.5 text-sm shadow-lg shadow-indigo-500/10 rounded-tr-none space-y-1">
            <For each={msg.parts}>
              {(part) => (
                <Show when={part.type === 'text'}>
                  <p class="whitespace-pre-wrap leading-relaxed select-text">{part.text}</p>
                </Show>
              )}
            </For>
            <div class="text-[9px] text-indigo-200 mt-1.5 text-right font-medium uppercase tracking-wider">User</div>
          </div>
        </div>
      </Show>

      {/* Assistant Message */}
      <Show when={msg.info?.role === 'assistant'}>
        <div class="flex justify-start w-full">
          <div class="max-w-[90%] bg-gray-800 text-gray-100 border border-gray-700/60 rounded-2xl px-4 py-3.5 text-sm shadow-md rounded-tl-none space-y-3 w-full animate-fade-in">
            <For each={msg.parts}>
              {(part) => {
                if (part.type === 'text') {
                  return <div class="whitespace-pre-wrap leading-relaxed select-text space-y-1.5" innerHTML={renderMarkdown(part.text || '')} />;
                }
                
                if (part.type === 'reasoning') {
                  const [isCollapsed, setIsCollapsed] = createSignal(false);
                  return (
                    <div class="border-l-2 border-amber-500/50 pl-3 py-1 my-2 bg-amber-500/5 rounded-r-lg text-xs text-amber-200/90 italic">
                      <div 
                        class="font-semibold text-amber-500 not-italic mb-1 text-[10px] uppercase tracking-wider flex items-center justify-between cursor-pointer select-none"
                        onClick={() => setIsCollapsed(!isCollapsed())}
                      >
                        <span>Thought Process</span>
                        <span class="text-[9px] text-gray-500">{isCollapsed() ? 'Show' : 'Hide'}</span>
                      </div>
                      <Show when={!isCollapsed()}>
                        <p class="whitespace-pre-wrap leading-normal select-text">{part.text}</p>
                      </Show>
                    </div>
                  );
                }

                if (part.type === 'tool') {
                  const status = part.state?.status || 'pending';
                  const statusColor = status === 'completed' ? 'text-green-400 bg-green-500/10 border-green-500/20' : 
                                      status === 'error' ? 'text-red-400 bg-red-500/10 border-red-500/20' : 
                                      'text-amber-400 bg-amber-500/10 border-amber-500/20';

                  const isBash = part.tool === 'bash' || part.tool === 'shell';
                  const isFileTool = ['write', 'write_to_file', 'read', 'view_file', 'replace_file_content', 'multi_replace_file_content'].includes(part.tool || '');
                  
                  // Extract input representation
                  let inputContent = '';
                  if (part.state?.input) {
                    if (typeof part.state.input === 'string') {
                      inputContent = part.state.input;
                    } else if (isBash && part.state.input.command) {
                      inputContent = part.state.input.command;
                    } else {
                      inputContent = JSON.stringify(part.state.input, null, 2);
                    }
                  }

                  // Extract output representation
                  let outputContent = '';
                  if (part.state?.output) {
                    if (typeof part.state.output === 'string') {
                      outputContent = part.state.output;
                    } else {
                      outputContent = JSON.stringify(part.state.output, null, 2);
                    }
                  } else if (part.state?.result) { // fallback
                    if (typeof part.state.result === 'string') {
                      outputContent = part.state.result;
                    } else {
                      outputContent = JSON.stringify(part.state.result, null, 2);
                    }
                  }

                  return (
                    <Show when={isBash || isFileTool} fallback={
                      <div class="border border-gray-700/80 rounded-xl p-3 bg-gray-950/40 text-xs font-mono space-y-2 w-full">
                        <div class="flex items-center justify-between border-b border-gray-800/80 pb-1.5 mb-1.5">
                          <span class="text-indigo-400 font-semibold font-sans">Tool: {part.tool}()</span>
                          <span class={`text-[9px] px-2 py-0.5 rounded font-sans font-bold uppercase border ${statusColor}`}>{status}</span>
                        </div>
                        {part.state?.input && (
                          <div class="text-[11px] text-gray-400">
                            <span class="text-gray-500 font-sans font-semibold">Input:</span>
                            <pre class="bg-gray-950/70 border border-gray-800 rounded p-2 mt-1 overflow-x-auto whitespace-pre select-all max-h-32 text-gray-300 font-mono">
                              {inputContent}
                            </pre>
                          </div>
                        )}
                        {outputContent && (
                          <div class="text-[11px] text-gray-300">
                            <span class="text-gray-500 font-sans font-semibold">Output:</span>
                            <pre class="bg-gray-950/70 border border-gray-800 rounded p-2 mt-1 overflow-x-auto whitespace-pre select-all max-h-48 text-gray-300 font-mono">
                              {outputContent}
                            </pre>
                          </div>
                        )}
                      </div>
                    }>
                      <Show when={isBash} fallback={
                        /* File operation card */
                        <div class="border border-gray-700/80 rounded-xl overflow-hidden bg-gray-950/20 text-xs font-mono w-full">
                          <div class="bg-gray-800/80 px-4 py-2 border-b border-gray-700 flex items-center justify-between font-sans">
                            <div class="flex items-center gap-2 text-gray-200">
                              <span class="text-indigo-400 font-semibold">
                                {['write', 'write_to_file'].includes(part.tool || '') ? '📝 Write File' : 
                                 ['read', 'view_file'].includes(part.tool || '') ? '📖 Read File' : '🔧 Edit File'}
                              </span>
                              <span class="text-gray-500 font-mono text-[10px] truncate max-w-[200px]" title={part.state?.input?.filePath || part.state?.input?.TargetFile || part.state?.input?.AbsolutePath || ''}>
                                {(() => {
                                  const path = part.state?.input?.filePath || part.state?.input?.TargetFile || part.state?.input?.AbsolutePath || '';
                                  return path.split('/').pop() || path;
                                })()}
                              </span>
                            </div>
                            <span class={`text-[9px] px-2 py-0.5 rounded font-bold uppercase border ${statusColor}`}>{status}</span>
                          </div>
                          <div class="p-3 space-y-3 font-mono text-xs">
                            {/* File Path */}
                            {(() => {
                              const path = part.state?.input?.filePath || part.state?.input?.TargetFile || part.state?.input?.AbsolutePath;
                              if (path) {
                                return (
                                  <div class="text-[10px] text-gray-500 truncate select-all">
                                    Path: <span class="text-gray-400">{path}</span>
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Input / Content */}
                            {(() => {
                              const content = part.state?.input?.content || part.state?.input?.CodeContent || part.state?.input?.ReplacementContent;
                              if (content) {
                                return (
                                  <div class="text-[11px]">
                                    <span class="text-gray-500 font-sans font-semibold">Content:</span>
                                    <pre class="bg-gray-950/70 border border-gray-800 rounded p-2 mt-1 overflow-x-auto whitespace-pre select-all max-h-48 text-gray-300 font-mono">
                                      {content}
                                    </pre>
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Output / Result */}
                            {outputContent && (
                              <div class="text-[11px] text-gray-300">
                                <span class="text-gray-500 font-sans font-semibold">Result:</span>
                                <pre class="bg-gray-950/70 border border-gray-800 rounded p-2 mt-1 overflow-x-auto whitespace-pre select-all max-h-48 text-gray-300 font-mono">
                                  {outputContent}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      }>
                        {/* Terminal window style for bash */}
                        <div class="w-full border border-gray-700/80 rounded-xl overflow-hidden shadow-lg font-mono text-xs">
                          <div class="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center justify-between shrink-0 font-sans">
                            <div class="flex items-center gap-1.5">
                              <span class="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                              <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                              <span class="w-2.5 h-2.5 rounded-full bg-green-500/80"></span>
                            </div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Terminal Shell ({part.tool})</span>
                            <span class={`text-[9px] px-2 py-0.5 rounded font-bold uppercase border ${statusColor}`}>{status}</span>
                          </div>
                          <div class="bg-black/90 p-4 space-y-2 max-h-[350px] overflow-y-auto">
                            {part.state?.input?.description && (
                              <div class="text-gray-500 italic text-[11px] mb-1 font-sans font-normal">
                                # {part.state.input.description}
                              </div>
                            )}
                            <div class="flex items-start">
                              <span class="text-indigo-400 mr-2 shrink-0 font-bold">$</span>
                              <span class="text-gray-100 select-all whitespace-pre-wrap">{inputContent}</span>
                            </div>
                            {outputContent && (
                              <pre class="text-gray-300 leading-relaxed overflow-x-auto whitespace-pre-wrap select-text border-t border-gray-900 pt-2.5 mt-2">{outputContent}</pre>
                            )}
                          </div>
                        </div>
                      </Show>
                    </Show>
                  );
                }

                return null;
              }}
            </For>
            <div class="text-[10px] text-gray-500 mt-2 flex items-center justify-between border-t border-gray-700/30 pt-2 shrink-0">
              <span class="font-medium">Assistant ({msg.info?.agent || 'Agent'})</span>
              {msg.info?.model?.modelID && <span class="text-gray-600 font-mono text-[9px]">{msg.info.model.modelID}</span>}
            </div>
          </div>
        </div>
      </Show>

      {/* System Message */}
      <Show when={msg.info?.role === 'system'}>
        <div class="flex justify-center my-1.5 shrink-0 w-full animate-fade-in">
          <div class="px-3 py-1 bg-gray-800/40 rounded-full border border-gray-700/40 text-[10px] text-gray-400 max-w-[80%] text-center uppercase tracking-wider font-semibold">
            <For each={msg.parts}>
              {(part) => (
                <Show when={part.type === 'text'}>
                  <span>System: {part.text}</span>
                </Show>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
}

export function TaskDetailsModal(props: TaskDetailsModalProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editPath, setEditPath] = createSignal('');
  const [editDesc, setEditDesc] = createSignal('');
  const [editParentId, setEditParentId] = createSignal('');
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


  // Chat signals
  const [messages, setMessages] = createSignal<any[]>([]);
  const [inputText, setInputText] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');
  let messagesContainerRef: HTMLDivElement | undefined;

  // File browser & Editor signals
  const [activeTab, setActiveTab] = createSignal<'chat' | 'files'>('chat');
  const [currentPath, setCurrentPath] = createSignal('');
  const [selectedFile, setSelectedFile] = createSignal<FileEntry | null>(null);
  const [fileContent, setFileContent] = createSignal('');
  const [isSavingFile, setIsSavingFile] = createSignal(false);
  const [isFileLoading, setIsFileLoading] = createSignal(false);
  const [fileList, setFileList] = createSignal<FileEntry[]>([]);
  const [fileError, setFileError] = createSignal('');
  const [saveSuccess, setSaveSuccess] = createSignal(false);

  let lineNumbersRef: HTMLDivElement | undefined;

  const relativePath = (fullPath: string) => {
    const root = props.task?.absolute_project_path || props.task?.project_path || '';
    if (!fullPath || !root) return '';
    if (fullPath === root) return './';
    if (fullPath.startsWith(root)) {
      let rel = fullPath.substring(root.length);
      if (rel.startsWith('/')) {
        rel = rel.substring(1);
      }
      return './' + rel;
    }
    return fullPath;
  };

  const fetchFiles = (path: string) => {
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setFileList(data);
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: file.path,
        content: fileContent(),
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
          
          // Refresh the file list of the current directory to show updated details
          fetchFiles(currentPath());
          
          // Local update to the active file's metadata (especially size)
          const activeFile = selectedFile();
          if (activeFile) {
            setSelectedFile({
              ...activeFile,
              size: new Blob([fileContent()]).size
            });
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

  const handleScroll = (e: Event) => {
    if (lineNumbersRef && e.currentTarget) {
      lineNumbersRef.scrollTop = (e.currentTarget as HTMLTextAreaElement).scrollTop;
    }
  };

  const lineCount = () => {
    const content = fileContent();
    if (!content) return 1;
    return content.split('\n').length;
  };




  const isOpencodeSession = () => props.task?.session_id?.startsWith('opencode|') ?? false;
  
  const rawSessionId = () => {
    const sid = props.task?.session_id;
    if (sid && sid.startsWith('opencode|')) {
      return sid.substring('opencode|'.length);
    }
    return null;
  };

  const getHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (props.config?.opencode_auth_header) {
      headers['Authorization'] = props.config.opencode_auth_header;
    }
    return headers;
  };

  const fetchMessages = async () => {
    const serverUrl = props.config?.opencode_server_url;
    const sessId = rawSessionId();
    if (!serverUrl || !sessId) return;

    try {
      const res = await fetch(`${serverUrl}/session/${sessId}/message`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data)) {
          setMessages(data);
        } else if (data && Array.isArray(data.data)) {
          setMessages(data.data);
        }
      }
    } catch (e) {
      console.error("Error fetching messages", e);
    }
  };

  const handleSendMessage = async (e: Event) => {
    e.preventDefault();
    const text = inputText().trim();
    const serverUrl = props.config?.opencode_server_url;
    const sessId = rawSessionId();
    if (!text || !serverUrl || !sessId || isSending()) return;

    setIsSending(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${serverUrl}/session/${sessId}/message`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          parts: [
            {
              type: 'text',
              text: text
            }
          ]
        })
      });
      if (res.ok) {
        setInputText('');
        fetchMessages();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.message || `Failed to send prompt (HTTP ${res.status})`);
      }
    } catch (err: any) {
      console.error("Error sending prompt", err);
      setErrorMsg(err.message || "Failed to communicate with OpenCode server.");
    } finally {
      setIsSending(false);
    }
  };

  // Synchronize internal state when the selected task changes or the modal is opened
  createEffect(() => {
    const t = props.task;
    const isOpen = props.isOpen;
    if (t && isOpen) {
      setEditTitle(t.title);
      setEditPath(t.project_path);
      setEditDesc(t.description || '');
      setEditParentId(t.parent_id?.toString() || '');
      setMessages([]);
      setErrorMsg('');
      setInputText('');
      
      // Reset files/tab state
      setActiveTab(isOpencodeSession() ? 'chat' : 'files');
      const root = t.absolute_project_path || t.project_path || '';
      setCurrentPath(root);
      setSelectedFile(null);
      setFileContent('');
      setFileList([]);
      setFileError('');
      setSaveSuccess(false);

      // Force fetch the directory files
      if (root) {
        fetchFiles(root);
      }
    }
    if (!isOpen) {
      setIsEditing(false);
    }
  });


  // Listen for real-time events when modal is open and has an opencode session
  createEffect(() => {
    const serverUrl = props.config?.opencode_server_url;
    const sessId = rawSessionId();
    const directory = props.task?.absolute_project_path || props.task?.project_path;

    if (props.isOpen && serverUrl && sessId && directory) {
      // 1. Initial fetch
      fetchMessages();

      // 2. Set up SSE connection
      const controller = new AbortController();
      let fetchTimer: number | undefined;

      const onEvent = () => {
        if (fetchTimer) return;
        fetchTimer = window.setTimeout(() => {
          fetchTimer = undefined;
          fetchMessages();
        }, 100);
      };

      const connectSSE = async () => {
        const url = `${serverUrl}/api/event?location[directory]=${encodeURIComponent(directory)}`;

        while (!controller.signal.aborted) {
          try {
            const response = await fetch(url, {
              headers: getHeaders(),
              signal: controller.signal
            });

            if (!response.ok) {
              throw new Error(`SSE failed with status: ${response.status}`);
            }
            if (!response.body) return;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

              const chunks = buffer.split("\n\n");
              buffer = chunks.pop() ?? "";

              if (chunks.length > 0) {
                onEvent();
              }
            }
          } catch (error) {
            if (controller.signal.aborted) break;
            console.error("OpenCode SSE stream error, retrying in 3s...", error);
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
      };

      void connectSSE();

      // Clean up connection and timer on close or task switch
      return () => {
        controller.abort();
        if (fetchTimer) window.clearTimeout(fetchTimer);
      };
    }
  });

  // Scroll to bottom on new messages
  createEffect(() => {
    const list = messages();
    if (list && messagesContainerRef) {
      messagesContainerRef.scrollTop = messagesContainerRef.scrollHeight;
    }
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
                  <span class="font-mono truncate select-all">{task.session_id || 'Not started'}</span>
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
              <div class="p-6 border-b border-gray-700 flex justify-between items-start shrink-0">
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
                  </div>

                  {/* Tab Contents */}
                  <div class="flex-1 min-h-0 relative">
                    
                    {/* Chat Tab */}
                    <Show when={activeTab() === 'chat' && isOpencodeSession()}>
                      <div class="absolute inset-0 flex flex-col min-h-0">
                        {/* Messages list */}
                        <div 
                          ref={messagesContainerRef}
                          class="flex-1 overflow-y-auto p-6 space-y-4 min-h-0"
                        >
                          <Show when={messages().length === 0}>
                            <div class="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              <span class="text-xs">No messages in this session yet.</span>
                            </div>
                          </Show>
                          <For each={messages()}>
                            {(msg) => <MessageItem message={msg} />}
                          </For>
                        </div>

                        {/* Error message if any */}
                        <Show when={errorMsg()}>
                          <div class="px-6 py-2 bg-red-900/30 border-t border-red-700/50 text-[11px] text-red-300 flex items-center justify-between shrink-0">
                            <span>{errorMsg()}</span>
                            <button type="button" onClick={() => setErrorMsg('')} class="text-red-400 hover:text-red-200 font-semibold">Dismiss</button>
                          </div>
                        </Show>

                        {/* Prompt Input */}
                        <form 
                          onSubmit={handleSendMessage}
                          class="p-4 border-t border-gray-700/60 bg-gray-800/40 flex gap-2 items-center shrink-0"
                        >
                          <input 
                            type="text" 
                            placeholder="Ask opencode..."
                            value={inputText()}
                            onInput={e => setInputText(e.currentTarget.value)}
                            disabled={isSending()}
                            class="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
                          />
                          <button 
                            type="submit"
                            disabled={isSending() || !inputText().trim()}
                            class="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-indigo-500/10 flex items-center gap-1.5 disabled:opacity-50 disabled:scale-100 shrink-0"
                          >
                            <Show when={isSending()}>
                              <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </Show>
                            Send
                          </button>
                        </form>
                      </div>
                    </Show>

                    {/* Files Tab */}
                    <Show when={activeTab() === 'files'}>
                      <div class="absolute inset-0 flex min-h-0 divide-x divide-gray-700/60">
                        
                        {/* File Browser Sidebar */}
                        <div class="w-56 shrink-0 flex flex-col h-full bg-gray-950/20 overflow-hidden">
                          <div class="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between bg-gray-900/10 shrink-0">
                            <span class="text-[10px] uppercase font-bold tracking-wider text-gray-400">Project Files</span>
                            <span class="text-[10px] text-gray-500 truncate max-w-[100px] font-mono" title={relativePath(currentPath())}>
                              {relativePath(currentPath())}
                            </span>
                          </div>
                          
                          <div class="flex-1 overflow-y-auto p-2 space-y-0.5">
                            {/* Parent directory navigation */}
                            <Show when={currentPath() !== (props.task?.absolute_project_path || props.task?.project_path || '')}>
                              <button 
                                type="button"
                                onClick={() => {
                                  const parts = currentPath().split('/');
                                  parts.pop();
                                  const parent = parts.join('/');
                                  const root = props.task?.absolute_project_path || props.task?.project_path || '';
                                  if (parent.startsWith(root)) {
                                    setCurrentPath(parent);
                                    fetchFiles(parent);
                                  }
                                }}
                                class="w-full text-left px-2.5 py-1.5 text-xs text-indigo-300 hover:bg-gray-800 rounded flex items-center gap-1.5 font-medium transition-colors"
                              >
                                <span class="text-xs">📁</span>
                                <span>..</span>
                              </button>
                            </Show>

                            {/* Empty list */}
                            <Show when={fileList().length === 0}>
                              <div class="p-3 text-xs text-gray-500 italic">No files found</div>
                            </Show>

                            {/* List of files/directories */}
                            <For each={fileList()}>
                              {(entry) => (
                                <Show 
                                  when={entry.is_dir}
                                  fallback={
                                    <button 
                                      type="button"
                                      onClick={() => selectFile(entry)}
                                      class={`w-full text-left px-2.5 py-1.5 text-xs rounded flex items-center gap-1.5 truncate transition-colors ${
                                        selectedFile()?.path === entry.path 
                                          ? 'bg-indigo-600/30 text-indigo-200 font-semibold' 
                                          : 'text-gray-300 hover:bg-gray-800'
                                      }`}
                                    >
                                      <span class="text-xs opacity-70">📄</span>
                                      <span class="truncate" title={entry.name}>{entry.name}</span>
                                    </button>
                                  }
                                >
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setCurrentPath(entry.path);
                                      fetchFiles(entry.path);
                                    }}
                                    class="w-full text-left px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 rounded flex items-center gap-1.5 truncate transition-colors font-medium"
                                  >
                                    <span class="text-xs opacity-70">📁</span>
                                    <span class="truncate" title={entry.name}>{entry.name}</span>
                                  </button>
                                </Show>
                              )}
                            </For>
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
                                <span class="text-[9px] text-gray-500 font-mono shrink-0">
                                  ({(selectedFile()?.size || 0).toLocaleString()} B)
                                </span>
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

                            {/* Editor Area with Line Numbers */}
                            <div class="flex-1 min-h-0 relative flex bg-gray-950/80 font-mono text-xs">
                              <Show 
                                when={isFileLoading()}
                                fallback={
                                  <>
                                    {/* Line Numbers */}
                                    <div 
                                      ref={lineNumbersRef}
                                      class="select-none text-right pr-3 pl-2 py-3 text-gray-600 bg-gray-950 border-r border-gray-800/80 w-12 shrink-0 overflow-hidden font-mono text-xs leading-5"
                                    >
                                      <For each={Array.from({ length: lineCount() }, (_, i) => i + 1)}>
                                        {(num) => <div class="h-5">{num}</div>}
                                      </For>
                                    </div>
                                    {/* Textarea */}
                                    <textarea
                                      value={fileContent()}
                                      onInput={(e) => setFileContent(e.currentTarget.value)}
                                      onScroll={handleScroll}
                                      class="flex-1 bg-transparent text-gray-300 px-3 py-3 focus:outline-none resize-none overflow-y-auto font-mono text-xs leading-5 whitespace-pre outline-none"
                                      spellcheck={false}
                                    />
                                  </>
                                }
                              >
                                <div class="flex-1 flex items-center justify-center text-gray-500">
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
                    </Show>
                  </div>
                </div>
              </div>

              
              <div class="p-6 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3 shrink-0">
                <Show when={isEditing()}>
                  <button 
                    onClick={() => setIsEditing(false)}
                    class="px-5 py-2 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-medium text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    class="px-5 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-colors font-medium text-sm"
                  >
                    Save Changes
                  </button>
                </Show>
                <Show when={!isEditing()}>
                  <button 
                    onClick={() => { props.onClose(); setIsEditing(false); }}
                    class="px-5 py-2 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors font-medium text-sm"
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
