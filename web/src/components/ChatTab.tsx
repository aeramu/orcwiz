import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task, OrcwizConfig } from '../types';
import { MessageItem } from './MessageItem';
import { QuestionWizard } from './QuestionWizard';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';

type ChatTabProps = {
  task: Task;
  config: OrcwizConfig | null;
  isOpen: boolean;
};

export function ChatTab(props: ChatTabProps) {
  // Chat signals
  const [messages, setMessages] = createSignal<any[]>([]);
  const [inputText, setInputText] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');
  const [activeQuestion, setActiveQuestion] = createSignal<any | null>(null);
  const [sessionStatus, setSessionStatus] = createSignal<string>('idle');
  
  let messagesContainerRef: HTMLDivElement | undefined;

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

  const client = () => {
    const serverUrl = props.config?.opencode_server_url;
    if (!serverUrl) return null;
    return createOpencodeClient({
      baseUrl: serverUrl,
      directory: props.task?.absolute_project_path || props.task?.project_path || undefined,
      headers: props.config?.opencode_auth_header ? {
        Authorization: props.config.opencode_auth_header
      } : undefined
    });
  };

  const fetchQuestions = async () => {
    const c = client();
    const directory = props.task?.absolute_project_path || props.task?.project_path;
    if (!c || !directory) return;

    try {
      const res = await c.question.list({
        directory
      });
      if (res.data) {
        const list = res.data;
        if (list.length > 0) {
          const currentQue = activeQuestion();
          if (!currentQue || currentQue.id !== list[0].id) {
            setActiveQuestion(list[0]);
          }
        } else {
          setActiveQuestion(null);
        }
      }
    } catch (e) {
      console.error("Error fetching questions", e);
    }
  };

  const fetchMessages = async () => {
    const c = client();
    const sessId = rawSessionId();
    if (!c || !sessId) return;

    try {
      const res = await c.session.messages({
        sessionID: sessId,
      });
      if (res.data) {
        setMessages(res.data);
      }
    } catch (e) {
      console.error("Error fetching messages", e);
    }
  };

  const fetchSessionStatus = async () => {
    const c = client();
    const sessId = rawSessionId();
    const directory = props.task?.absolute_project_path || props.task?.project_path;
    if (!c || !sessId || !directory) return;

    try {
      const res = await c.session.status({
        directory
      });
      if (res.data) {
        const statusMap = res.data as Record<string, { type: string }>;
        const status = statusMap[sessId];
        if (status) {
          setSessionStatus(status.type || 'idle');
        } else {
          setSessionStatus('idle');
        }
      }
    } catch (e) {
      console.error("Error fetching session status", e);
    }
  };

  const handleStopSession = async (e: Event) => {
    e.preventDefault();
    const c = client();
    const sessId = rawSessionId();
    const directory = props.task?.absolute_project_path || props.task?.project_path || undefined;
    if (!c || !sessId) return;

    try {
      await c.session.abort({
        sessionID: sessId,
        directory
      }, { throwOnError: true });
    } catch (err: any) {
      console.error("Error stopping session", err);
      setErrorMsg(err.message || "Failed to stop/interrupt session.");
    }
  };

  const handleSendMessage = async (e: Event) => {
    e.preventDefault();
    const text = inputText().trim();
    const c = client();
    const sessId = rawSessionId();
    if (!text || !c || !sessId || isSending()) return;

    setIsSending(true);
    setErrorMsg('');
    try {
      await c.session.prompt({
        sessionID: sessId,
        agent: props.task.assigned_agent || undefined,
        parts: [
          {
            type: 'text',
            text: text
          }
        ]
      }, { throwOnError: true });
      setInputText('');
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
      setMessages([]);
      setErrorMsg('');
      setInputText('');
      setActiveQuestion(null);
      setSessionStatus('idle');
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
      fetchQuestions();
      fetchSessionStatus();

      const applyEventToMessages = (event: any) => {
        const type = event.type;
        const properties = event.properties || event.data;

        setMessages(prev => {
          if (type === "message.updated") {
            const info = properties?.info;
            if (!info) return prev;
            
            const idx = prev.findIndex(m => m.info?.id === info.id);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = { ...next[idx], info };
              return next;
            } else {
              return [...prev, { info, parts: [] }];
            }
          }

          if (type === "message.removed") {
            const messageID = properties?.messageID;
            if (!messageID) return prev;
            return prev.filter(m => m.info?.id !== messageID);
          }

          if (type === "message.part.updated") {
            const part = properties?.part;
            if (!part || !part.messageID) return prev;

            const idx = prev.findIndex(m => m.info?.id === part.messageID);
            if (idx !== -1) {
              const msg = prev[idx];
              const nextParts = [...(msg.parts || [])];
              const pIdx = nextParts.findIndex(p => p.id === part.id);
              if (pIdx !== -1) {
                nextParts[pIdx] = { ...nextParts[pIdx], ...part };
              } else {
                nextParts.push(part);
              }

              const next = [...prev];
              next[idx] = { ...msg, parts: nextParts };
              return next;
            } else {
              return [...prev, {
                info: {
                  id: part.messageID,
                  role: "assistant",
                  sessionID: part.sessionID,
                },
                parts: [part]
              }];
            }
          }

          if (type === "message.part.removed") {
            const messageID = properties?.messageID;
            const partID = properties?.partID;
            if (!messageID || !partID) return prev;

            const idx = prev.findIndex(m => m.info?.id === messageID);
            if (idx === -1) return prev;

            const msg = prev[idx];
            const nextParts = (msg.parts || []).filter((p: any) => p.id !== partID);

            const next = [...prev];
            next[idx] = { ...msg, parts: nextParts };
            return next;
          }

          if (type === "message.part.delta") {
            const messageID = properties?.messageID;
            const partID = properties?.partID;
            const field = properties?.field;
            const delta = properties?.delta;
            if (!messageID || !partID || !field || delta === undefined) return prev;

            const idx = prev.findIndex(m => m.info?.id === messageID);
            if (idx !== -1) {
              const msg = prev[idx];
              const nextParts = [...(msg.parts || [])];
              const pIdx = nextParts.findIndex(p => p.id === partID);
              if (pIdx !== -1) {
                const part = nextParts[pIdx];
                const existingVal = part[field] || "";
                nextParts[pIdx] = { ...part, [field]: existingVal + delta };
              } else {
                nextParts.push({
                  id: partID,
                  messageID: messageID,
                  [field]: delta
                } as any);
              }

              const next = [...prev];
              next[idx] = { ...msg, parts: nextParts };
              return next;
            } else {
              return [...prev, {
                info: {
                  id: messageID,
                  role: "assistant",
                  sessionID: sessId,
                },
                parts: [{
                  id: partID,
                  messageID: messageID,
                  [field]: delta
                } as any]
              }];
            }
          }

          return prev;
        });
      };

      // 2. Set up SSE connection
      const controller = new AbortController();

      const onEvent = (event: any) => {
        const type = event?.type;
        const properties = event?.properties || event?.data;
        if (!type) return;

        if (type === "session.status") {
          if (properties && properties.sessionID === sessId) {
            setSessionStatus(properties.status?.type || 'idle');
          }
        }

        if (type === "question.asked") {
          if (properties && properties.sessionID === sessId) {
            setActiveQuestion(properties);
          }
        }

        if (type === "question.replied" || type === "question.rejected") {
          if (properties && properties.sessionID === sessId) {
            const currentQue = activeQuestion();
            if (currentQue && currentQue.id === properties.requestID) {
              setActiveQuestion(null);
            }
          }
        }

        if (type.startsWith("message.")) {
          applyEventToMessages(event);
        }
      };

      const c = client();
      if (c) {
        c.event.subscribe({
          directory
        }, {
          signal: controller.signal,
          onSseError: (err) => {
            if (!controller.signal.aborted) {
              console.error("OpenCode SSE stream error:", err);
            }
          }
        }).then(async (result) => {
          for await (const event of result.stream) {
            onEvent(event);
          }
        }).catch(err => {
          if (!controller.signal.aborted) {
            console.error("OpenCode SSE subscription failed:", err);
          }
        });
      }

      // Clean up connection on close or task switch
      return () => {
        controller.abort();
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

  return (
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

      {/* Question Area */}
      <Show when={activeQuestion()}>
        <QuestionWizard
          task={props.task}
          config={props.config}
          activeQuestion={activeQuestion()}
          setActiveQuestion={setActiveQuestion}
          setErrorMsg={setErrorMsg}
          fetchMessages={fetchMessages}
          getHeaders={getHeaders}
          client={client}
        />
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
        <Show when={sessionStatus() !== 'idle'}>
          <button 
            type="button"
            onClick={handleStopSession}
            class="bg-rose-600 hover:bg-rose-500 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-rose-500/10 flex items-center gap-1.5 shrink-0"
          >
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
            </svg>
            Stop
          </button>
        </Show>
      </form>
    </div>
  );
}
