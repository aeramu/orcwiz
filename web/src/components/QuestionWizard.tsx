import { createSignal, createEffect, Show, For } from 'solid-js';
import type { Task, OrcwizConfig } from '../types';

type QuestionWizardProps = {
  task: Task;
  config: OrcwizConfig | null;
  activeQuestion: any;
  setActiveQuestion: (q: any) => void;
  setErrorMsg: (msg: string) => void;
  fetchMessages: () => Promise<void>;
  getHeaders: () => Record<string, string>;
};

export function QuestionWizard(props: QuestionWizardProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = createSignal(0);
  const [selectedAnswers, setSelectedAnswers] = createSignal<Record<number, string[]>>({});
  const [customAnswer, setCustomAnswer] = createSignal<Record<number, string>>({});
  const [isCustomSelected, setIsCustomSelected] = createSignal<Record<number, boolean>>({});

  createEffect(() => {
    // Reset state whenever the active question changes
    props.activeQuestion;
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setCustomAnswer({});
    setIsCustomSelected({});
  });

  const req = () => props.activeQuestion;
  const qIndex = () => currentQuestionIndex();
  const q = () => req()?.questions[qIndex()];

  const isMulti = () => q()?.multiple === true;
  const isCustomAllowed = () => q()?.custom !== false; // default true

  // Get current picked options
  const picked = () => selectedAnswers()[qIndex()] || [];
  
  // Toggle an option
  const handleToggleOption = (label: string) => {
    setSelectedAnswers(prev => {
      const current = prev[qIndex()] || [];
      let next;
      if (isMulti()) {
        if (current.includes(label)) {
          next = current.filter(x => x !== label);
        } else {
          next = [...current, label];
        }
      } else {
        next = [label];
        // deselect custom if single selection
        setIsCustomSelected(cPrev => ({ ...cPrev, [qIndex()]: false }));
      }
      return { ...prev, [qIndex()]: next };
    });
  };

  // Toggle custom answer
  const handleToggleCustom = () => {
    setIsCustomSelected(prev => {
      const next = !prev[qIndex()];
      if (next && !isMulti()) {
        // deselect other options if single selection
        setSelectedAnswers(aPrev => ({ ...aPrev, [qIndex()]: [] }));
      }
      return { ...prev, [qIndex()]: next };
    });
  };

  const isCustomActive = () => isCustomSelected()[qIndex()] === true;
  const customVal = () => customAnswer()[qIndex()] || "";

  const handleCustomValChange = (val: string) => {
    setCustomAnswer(prev => ({ ...prev, [qIndex()]: val }));
    if (!isCustomActive()) {
      handleToggleCustom();
    }
  };

  const hasAnswered = () => {
    if (picked().length > 0) return true;
    if (isCustomActive() && customVal().trim().length > 0) return true;
    return false;
  };

  const isLast = () => qIndex() === (req()?.questions.length - 1);

  const handleNext = () => {
    if (isLast()) {
      handleSubmitAnswers();
    } else {
      setCurrentQuestionIndex(qIndex() + 1);
    }
  };

  const handleBack = () => {
    if (qIndex() > 0) {
      setCurrentQuestionIndex(qIndex() - 1);
    }
  };

  const handleSubmitAnswers = async () => {
    const serverUrl = props.config?.opencode_server_url;
    const directory = props.task.absolute_project_path || props.task.project_path;
    if (!serverUrl || !directory) return;

    const answers = req().questions.map((_: any, i: number) => {
      const opts = selectedAnswers()[i] || [];
      const customOn = isCustomSelected()[i] === true;
      const customText = (customAnswer()[i] || "").trim();
      
      let finalAns = [...opts];
      if (customOn && customText) {
        finalAns.push(customText);
      }
      return finalAns;
    });

    try {
      const res = await fetch(`${serverUrl}/question/${req().id}/reply?directory=${encodeURIComponent(directory)}`, {
        method: 'POST',
        headers: props.getHeaders(),
        body: JSON.stringify({ answers }),
      });
      if (res.ok) {
        props.setActiveQuestion(null);
        props.fetchMessages();
      } else {
        const err = await res.json().catch(() => ({}));
        props.setErrorMsg(err.message || `Failed to submit answer (HTTP ${res.status})`);
      }
    } catch (err: any) {
      props.setErrorMsg(err.message || "Failed to submit answers.");
    }
  };

  const handleDismiss = async () => {
    const serverUrl = props.config?.opencode_server_url;
    const directory = props.task.absolute_project_path || props.task.project_path;
    if (!serverUrl || !directory) return;

    try {
      const res = await fetch(`${serverUrl}/question/${req().id}/reject?directory=${encodeURIComponent(directory)}`, {
        method: 'POST',
        headers: props.getHeaders(),
      });
      if (res.ok) {
        props.setActiveQuestion(null);
        props.fetchMessages();
      } else {
        const err = await res.json().catch(() => ({}));
        props.setErrorMsg(err.message || `Failed to reject question (HTTP ${res.status})`);
      }
    } catch (err: any) {
      props.setErrorMsg(err.message || "Failed to reject question.");
    }
  };

  return (
    <Show when={req() && q()}>
      <div class="m-4 p-4 bg-gray-950 border border-amber-500/35 rounded-xl shadow-lg flex flex-col gap-3 shrink-0 animate-fade-in">
        {/* Header */}
        <div class="flex items-center justify-between border-b border-gray-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-amber-500 font-bold text-xs flex items-center gap-1.5 font-sans">
              <span class="text-xs">❓</span> OpenCode Question
            </span>
            <span class="text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-full font-sans font-semibold">
              {qIndex() + 1} of {req().questions.length}
            </span>
          </div>
          <button 
            type="button" 
            onClick={handleDismiss}
            class="text-[10px] text-gray-500 hover:text-gray-300 font-semibold transition-colors font-sans"
          >
            Dismiss
          </button>
        </div>

        {/* Question Text */}
        <div class="text-xs font-semibold text-gray-200 leading-normal select-text">
          {q().question}
        </div>

        {/* Options List */}
        <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          <For each={q().options}>
            {(opt) => {
              const isPicked = () => picked().includes(opt.label);
              return (
                <button
                  type="button"
                  onClick={() => handleToggleOption(opt.label)}
                  class={`w-full text-left p-2.5 rounded-lg border text-[11px] transition-all flex items-start gap-2.5 ${
                    isPicked() 
                      ? 'bg-indigo-600/15 border-indigo-500/80 text-indigo-200' 
                      : 'bg-gray-900/40 border-gray-800/80 text-gray-300 hover:bg-gray-800/60 hover:border-gray-700/60'
                  }`}
                >
                  {/* Mark Indicator */}
                  <div class="mt-0.5 shrink-0 flex items-center justify-center">
                    <div class={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                      isPicked() 
                        ? 'bg-indigo-600 border-indigo-500' 
                        : 'border-gray-700'
                    }`}>
                      <Show when={isPicked()}>
                        <span class="text-[8px] text-white">✓</span>
                      </Show>
                    </div>
                  </div>
                  <div>
                    <div class="font-bold">{opt.label}</div>
                    {opt.description && <div class="text-[9px] text-gray-500 mt-0.5 font-normal leading-normal">{opt.description}</div>}
                  </div>
                </button>
              );
            }}
          </For>

          {/* Custom option */}
          <Show when={isCustomAllowed()}>
            <div class={`p-2.5 rounded-lg border text-[11px] transition-all space-y-2 ${
              isCustomActive() 
                ? 'bg-indigo-600/15 border-indigo-500/80' 
                : 'bg-gray-900/40 border-gray-800/80'
            }`}>
              <button
                type="button"
                onClick={handleToggleCustom}
                class="w-full text-left flex items-start gap-2.5 text-gray-300 hover:text-white"
              >
                <div class="mt-0.5 shrink-0 flex items-center justify-center">
                  <div class={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                    isCustomActive() 
                      ? 'bg-indigo-600 border-indigo-500' 
                      : 'border-gray-700'
                  }`}>
                    {isCustomActive() && <span class="text-[8px] text-white">✓</span>}
                  </div>
                </div>
                <span class="font-bold">Type your own answer</span>
              </button>
              
              <Show when={isCustomActive()}>
                <textarea
                  placeholder="Enter custom response..."
                  value={customVal()}
                  onInput={(e) => handleCustomValChange(e.currentTarget.value)}
                  rows="1.5"
                  class="w-full bg-gray-950 border border-gray-800 rounded p-2 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none font-sans"
                />
              </Show>
            </div>
          </Show>
        </div>

        {/* Footer navigation */}
        <div class="flex items-center justify-between pt-1.5 border-t border-gray-800/60">
          <button
            type="button"
            onClick={handleBack}
            disabled={qIndex() === 0}
            class="px-3 py-1 text-[10px] font-bold rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-40 disabled:hover:bg-gray-800 font-sans"
          >
            Back
          </button>
          
          <button
            type="button"
            onClick={handleNext}
            disabled={!hasAnswered()}
            class={`px-3 py-1 text-[10px] font-bold rounded transition-all shadow ${
              hasAnswered() 
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/10 font-sans' 
                : 'bg-gray-800 text-gray-500 cursor-not-allowed font-sans'
            }`}
          >
            {isLast() ? 'Submit Answers' : 'Next'}
          </button>
        </div>
      </div>
    </Show>
  );
}
