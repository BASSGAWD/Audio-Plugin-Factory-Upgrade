import './fonts.css';
import asset0 from "./assets/claros-hills.png";

import React from 'react';
import { ArrowRight, Sparkles, ShieldCheck, Zap, Search, TrendingUp } from 'lucide-react';

export default function Claros() {
  return (
    <div className="w-full h-full overflow-hidden relative bg-white font-['Inter'] text-[#0F172A] antialiased box-border">

      {/* HERO BACKGROUND — green hills + blue sky */}
      <div className="absolute top-0 left-0 w-full h-[640px] overflow-hidden">
        <img
          src={asset0}
          alt="Green rolling hills under a blue sky"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sky-200/10 via-transparent to-white" />
      </div>

      {/* NAV */}
      <div className="relative z-20 flex items-center justify-between px-12 pt-8">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#0F172A] flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-white" />
          </div>
          <span className="text-[20px] font-bold tracking-tight">Claros</span>
        </div>

        <nav className="flex items-center gap-8 text-[13px] font-medium text-[#0F172A]/80">
          <a href="#" className="hover:text-[#0F172A] transition-colors">About</a>
          <a href="#" className="hover:text-[#0F172A] transition-colors">Features</a>
          <a href="#" className="hover:text-[#0F172A] transition-colors">Solutions</a>
          <a href="#" className="hover:text-[#0F172A] transition-colors">Pricing</a>
          <a href="#" className="hover:text-[#0F172A] transition-colors">Pages</a>
        </nav>

        <button className="flex items-center gap-2 bg-[#0F172A] text-white text-[13px] font-semibold pl-5 pr-2 py-2 rounded-full hover:bg-[#1E293B] transition-colors">
          Get started
          <span className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center">
            <ArrowRight size={13} strokeWidth={2.5} />
          </span>
        </button>
      </div>

      {/* HERO CONTENT */}
      <div className="relative z-20 flex flex-col items-center text-center px-12 mt-16">
        <div className="flex items-center gap-2 bg-white/70 backdrop-blur-sm border border-white/80 rounded-full px-4 py-1.5 shadow-sm">
          <Sparkles size={13} className="text-[#2563EB]" strokeWidth={2.5} />
          <span className="text-[11px] font-semibold tracking-wide text-[#0F172A]/80">
            Intelligent finance, made simple
          </span>
        </div>

        <h1 className="mt-7 text-[78px] leading-[0.95] font-bold tracking-[-0.03em] text-[#0F172A] flex items-center gap-4">
          Finance
          <span className="inline-flex items-center bg-[#2563EB] text-white text-[36px] font-bold px-5 py-1 rounded-2xl tracking-tight align-middle">
            AI
          </span>
          Platform
        </h1>

        <p className="mt-6 max-w-[560px] text-[15px] leading-relaxed text-[#0F172A]/65">
          Turn raw market noise into confident moves. Claros pairs real-time
          signals with AI-driven investment insights so every decision is
          grounded in clarity, not guesswork.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <button className="flex items-center gap-2 bg-[#0F172A] text-white text-[14px] font-semibold px-6 py-3 rounded-full hover:bg-[#1E293B] transition-colors">
            Get started
            <ArrowRight size={15} strokeWidth={2.5} />
          </button>
          <button className="bg-white/70 backdrop-blur-sm border border-white text-[#0F172A] text-[14px] font-semibold px-6 py-3 rounded-full hover:bg-white transition-colors shadow-sm">
            How it works
          </button>
        </div>

        <div className="mt-6 flex items-center gap-6 text-[11px] font-medium text-[#0F172A]/55">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-[#16A34A]" strokeWidth={2.2} />
            Bank-grade security
          </div>
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="text-[#16A34A]" strokeWidth={2.2} />
            Built for fast teams
          </div>
        </div>
      </div>

      {/* FLOATING NEURAL COMMAND CARD */}
      <div className="absolute z-30 left-1/2 -translate-x-1/2 top-[560px] w-[520px] bg-white rounded-2xl shadow-[0_30px_60px_-20px_rgba(15,23,42,0.35)] border border-slate-100 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#2563EB] flex items-center justify-center">
              <Search size={14} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold text-[#0F172A]">Neural Command</span>
          </div>
          <span className="text-[10px] font-semibold text-[#16A34A] bg-[#16A34A]/10 px-2.5 py-1 rounded-full">
            Live
          </span>
        </div>

        <div className="mt-4 flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <Search size={15} className="text-slate-400" />
          <span className="text-[13px] text-slate-400">Ask Claros to forecast next quarter revenue...</span>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-[#16A34A]/10 flex items-center justify-center">
              <TrendingUp size={16} className="text-[#16A34A]" strokeWidth={2.5} />
            </span>
            <div className="text-left">
              <div className="text-[13px] font-bold text-[#0F172A] font-['Oxanium']">+18.4%</div>
              <div className="text-[10px] text-slate-400">Projected growth</div>
            </div>
          </div>
          <button className="flex items-center gap-1.5 bg-[#0F172A] text-white text-[12px] font-semibold px-4 py-2 rounded-lg hover:bg-[#1E293B] transition-colors">
            Analyze
            <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* LOGO STRIP */}
      <div className="absolute z-20 bottom-[120px] left-0 w-full px-12">
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] uppercase text-slate-400">
          Trusted by forward-thinking finance teams
        </p>
        <div className="mt-5 flex items-center justify-center gap-12 opacity-45 grayscale">
          <span className="text-[18px] font-bold tracking-tight text-[#0F172A]">Northbay</span>
          <span className="text-[18px] font-semibold italic text-[#0F172A]">Lumen</span>
          <span className="text-[18px] font-extrabold tracking-tighter text-[#0F172A]">VOLT</span>
          <span className="text-[18px] font-bold text-[#0F172A] font-['Space_Grotesk']">Kestra</span>
          <span className="text-[18px] font-semibold tracking-wide text-[#0F172A]">Pavo</span>
        </div>
      </div>

      {/* CLOSING LINE */}
      <div className="absolute z-20 bottom-[48px] left-0 w-full text-center">
        <h2 className="text-[26px] font-bold tracking-tight text-[#0F172A]">
          Smarter decisions, built on clearer data.
        </h2>
      </div>

    </div>
  );
}
