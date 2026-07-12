import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Sparkles, Loader2, Trash, Lightbulb } from "lucide-react";
import { Agent, ChatMessage, PluginParameter } from "../types";

interface AIAgentChatProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  chatHistory: ChatMessage[];
  onSendMessage: (prompt: string) => Promise<void>;
  isLoading: boolean;
  onClearChatHistory: () => void;
  activeCode: string;
  activeParams: PluginParameter[];
}

export default function AIAgentChat({
  agents,
  selectedAgentId,
  onSelectAgent,
  chatHistory,
  onSendMessage,
  isLoading,
  onClearChatHistory,
  activeCode,
  activeParams,
}: AIAgentChatProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const useSamplePrompt = (promptText: string) => {
    setInput(promptText);
  };

  // Define custom suggestions based on the chosen agent role
  const getSuggestions = () => {
    switch (selectedAgentId) {
      case "aero":
        return [
          { text: "Equations for Biquad lowpass", p: "Provide the standard difference equations and transfer function for a 2-pole Biquad low-pass filter." },
          { text: "Tape soft-clipper curve", p: "Suggest a smooth waveshaping transfer function to simulate retro analog tape compression." },
          { text: "Stereo delay feedback math", p: "Explain how to calculate fractional delay line taps with comb filtering for luxurious stereo widening." }
        ];
      case "syntax":
        return [
          { text: "Port this code to standard C++ JUCE", p: "Translate my current JavaScript DSP processing code into a production-safe JUCE C++ processBlock loop." },
          { text: "Strict Faust script", p: "Compile this plugin's mathematical behavior into high-efficiency Faust language script." },
          { text: "Lock-free DSP guidelines", p: "What are the rules of memory allocation and thread safety inside a C++ processBlock?" }
        ];
      case "haptic":
        return [
          { text: "Optimal parameter bounds", p: "Suggest the appropriate logarithmic scale and default values for my plugin's frequency and resonance controls." },
          { text: "Skeuomorphic dial clusters", p: "Design a visual clustering guide layout for a 3-band parametric EQ effect." }
        ];
      case "decibel":
      default:
        return [
          { text: "Analyze for numerical blowup", p: "Check my current DSP script loop for possible blowup thresholds if resonance or feedback values exceed bounds." },
          { text: "Add a simple DC blocker code", p: "Provide a lightweight DC-blocker filter snippet in JavaScript to append to my processing chain." }
        ];
    }
  };

  return (
    <div id="ai-agent-chat" className="flex flex-col h-[520px] bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
      {/* 1. Panel Header */}
      <div className="bg-neutral-50 px-4 py-3.5 border-b border-neutral-200/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-neutral-900 border border-neutral-950 text-white rounded-lg">
            <MessageSquare className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <span className="text-[10px] bg-sky-50 text-sky-700 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">Consultation Panel</span>
            <h4 className="font-display font-semibold text-neutral-800 text-xs mt-0.5">Discussion with {selectedAgent.name}</h4>
          </div>
        </div>
        
        {chatHistory.length > 0 && (
          <button
            onClick={onClearChatHistory}
            className="text-[10px] font-bold text-neutral-450 hover:text-rose-500 transition-colors flex items-center gap-1"
          >
            <Trash className="w-3.5 h-3.5" />
            Clear Chat
          </button>
        )}
      </div>

      {/* 2. Messages Streaming Box */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[380px] scrollbar-thin bg-neutral-50/20">
        {chatHistory.length === 0 ? (
          <div className="text-center py-12 px-6 space-y-3.5 my-auto">
            <div className="w-12 h-12 rounded-full bg-sky-50 flex items-center justify-center mx-auto text-sky-500">
              <MessageSquare className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h5 className="font-display font-bold text-neutral-800 text-sm">Consult your specialized DSP team</h5>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed font-sans mt-1">
                Ask <strong>{selectedAgent.name}</strong> to optimize filter curves, help design visual assets, or write production transpiles. Your active JavaScript processor state is automatically compiled and visible in their context window!
              </p>
            </div>
            
            {/* Context status */}
            <div className="inline-flex items-center gap-1.5 text-[10px] font-mono text-neutral-450 bg-neutral-100 border border-neutral-200/60 rounded-full px-3 py-1">
              <Sparkles className="w-3 h-3 text-emerald-500" />
              <span>Current Code Connected</span>
            </div>

            {/* Suggestions cards */}
            <div className="pt-3 max-w-md mx-auto flex flex-wrap gap-1.5 justify-center">
              {getSuggestions().map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => useSamplePrompt(s.p)}
                  className="text-[10px] text-neutral-600 bg-white hover:bg-sky-50/50 hover:text-sky-800 border border-neutral-200/80 hover:border-sky-200 rounded-full px-3 py-1.5 font-sans transition-all text-left flex items-center gap-1"
                >
                  <Lightbulb className="w-3 h-3 text-amber-500 shrink-0" />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {chatHistory.map((msg) => {
              const isUser = msg.senderId === "user";
              const isSystem = msg.senderId === "error";

              return (
                <div key={msg.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-fadeIn`}>
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <span className="text-[10px] font-mono font-bold text-neutral-500">{msg.senderName}</span>
                    <span className="text-[9px] text-neutral-400">{msg.timestamp}</span>
                  </div>
                  <div
                    className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] font-sans whitespace-pre-wrap selection:bg-neutral-200 ${
                      isUser
                        ? "bg-neutral-900 border border-neutral-950 text-white rounded-tr-none"
                        : isSystem
                        ? "bg-rose-50 text-rose-750 border border-rose-100 rounded-tl-none font-mono"
                        : "bg-neutral-100 text-neutral-850 rounded-tl-none border border-neutral-200/50 shadow-3xs"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-start space-y-1 animate-pulse">
            <div className="flex items-center gap-1 mb-1 px-1">
              <span className="text-[10px] font-bold text-[#da9902] font-mono">{selectedAgent.name}</span>
              <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
            </div>
            <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-2xl rounded-tl-none max-w-[75%]">
              <p className="text-xs text-neutral-500 italic font-mono">
                Compiling equations & drafting core DSP concepts...
              </p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 3. Message Input Tray */}
      <form onSubmit={handleSubmit} className="border-t border-neutral-200 p-3 bg-white flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${selectedAgent.name} anything about DSP...`}
          className="flex-1 text-xs font-sans bg-neutral-50 hover:bg-neutral-100/50 focus:bg-white border border-neutral-200 focus:border-neutral-450 outline-none rounded-xl p-3 transition-all"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-neutral-950 hover:bg-neutral-850 text-white font-semibold rounded-xl p-3 transition-all flex items-center justify-center shrink-0 disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
