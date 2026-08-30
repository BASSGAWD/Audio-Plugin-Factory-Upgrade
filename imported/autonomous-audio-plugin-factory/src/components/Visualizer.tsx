import React, { useEffect, useRef } from "react";
import { Activity } from "lucide-react";
import { SPECTRUM_ANALYZER_RECIPE, spectrumBinToHz, byteMagnitudeToDisplayHeight01 } from "../utils/uiRenderPatterns";

interface VisualizerProps {
  analyserNode: AnalyserNode | null;
  isPlaying: boolean;
  aspectSquare?: boolean;
}

export default function Visualizer({ analyserNode, isPlaying, aspectSquare }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high density displays (retina) smoothly
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Buffer allocations
    let bufferLength = analyserNode ? analyserNode.frequencyBinCount : 256;
    let dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      // Loop
      animationRef.current = requestAnimationFrame(draw);

      // Background styling: pure, clean, premium dark slate canvas
      ctx.fillStyle = "#1e1e24";
      ctx.fillRect(0, 0, width, height);

      // Subtle horizontal baseline grid
      ctx.strokeStyle = "#2e2e38";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Top and bottom boundary lines
      ctx.strokeStyle = "#25252d";
      ctx.strokeRect(0, 0, width, height);

      if (isPlaying && analyserNode) {
        // Real-time audio waveform render from AnalyserNode
        analyserNode.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0ea5e9"; // Cyan hue
        ctx.shadowBlur = 0;

        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0; // Normalized -1 to 1
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw frequency spectrum outline in semi-transparent cyan
        analyserNode.getByteFrequencyData(dataArray);
        ctx.fillStyle = "rgba(14, 165, 233, 0.15)";
        
        ctx.beginPath();
        ctx.moveTo(0, height);
        
        const barWidth = width / bufferLength;
        let barX = 0;
        const sampleRate = analyserNode.context.sampleRate;

        for (let i = 0; i < bufferLength; i++) {
          // dB-converted + tilt-compensated (not raw linear magnitude) so a
          // flat-spectrum signal reads visually flat instead of sloping down
          // at high frequencies -- a standard analyzer convention, not any
          // product's proprietary curve.
          const hz = spectrumBinToHz(i, bufferLength, sampleRate);
          const h01 = byteMagnitudeToDisplayHeight01(dataArray[i], hz, SPECTRUM_ANALYZER_RECIPE);
          const barHeight = h01 * height * 0.76;
          ctx.lineTo(barX, height - barHeight);
          barX += barWidth;
        }
        ctx.lineTo(width, height);
        ctx.fill();

        // Reset shadow for subsequent drawings
        ctx.shadowBlur = 0;

      } else {
        // Offline / Stopped Simulation: draw a gorgeous drifting ambient sine wave
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#475569"; // Slate gray
        ctx.shadowBlur = 0;

        ctx.beginPath();

        let x = 0;
        const amplitude = 30;
        const frequency = 0.03;

        for (let i = 0; i < width; i++) {
          const y = height / 2 + Math.sin(x * frequency + time) * amplitude;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x++;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Overlay text
        ctx.fillStyle = "#64748b";
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.fillText("SIMULATION OFFLINE — WAVE GENERATOR IDLE", 15, 20);
      }
    };

    const time = 0; // standard constant timeline variable reference helper inside window closure
    const animLoop = () => {
      // Re-trigger inside draw closure
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, analyserNode]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between select-none">
        <label className="text-[10px] font-bold text-neutral-450 uppercase tracking-widest flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-sky-500" />
          Real-Time Oscilloscope & Frequency Spectrum
        </label>
        <span className="text-[9px] font-mono bg-neutral-900 border border-neutral-800 text-sky-400 px-2.5 py-0.5 rounded-full uppercase tracking-tighter shadow-sm animate-pulse">
          {isPlaying ? "Live Audio Graph" : "IDLE"}
        </span>
      </div>
      <div className="relative rounded-2xl overflow-hidden border border-neutral-800 shadow-xl bg-[#1e1e24] group">
        <canvas 
          ref={canvasRef} 
          className={`w-full block cursor-pointer transition-all ${
            aspectSquare ? "aspect-square max-h-[460px] md:max-h-[440px]" : "h-36"
          }`} 
          title="Oscilloscope Screen" 
        />
      </div>
    </div>
  );
}
