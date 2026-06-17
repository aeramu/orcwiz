import { createSignal, Show, For } from 'solid-js';
import { renderMarkdown } from '../markdownUtils';

export function MessageItem(props: { message: any }) {
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
