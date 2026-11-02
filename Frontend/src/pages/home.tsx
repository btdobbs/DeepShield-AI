import { useCallback, useEffect, useRef, useState } from 'react';
import { useDetectImage, useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import type { DetectionResult } from '@workspace/api-client-react';
import { AlertCircle, ChevronDown, Crop, ImagePlus, Loader2, RotateCcw, ScanSearch, ShieldCheck, X } from 'lucide-react';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
type CropBox = { left: number; top: number; right: number; bottom: number };
const FULL: CropBox = { left: 0, top: 0, right: 0, bottom: 0 };

function dataUrlBytes(u: string) {
  const b64 = u.slice(u.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}
const frac = (v: number) => Math.max(0, Math.min(1, v <= 1 ? v : v / 100));

function Slider({ id, label, value, max, onChange, disabled }: { id: string; label: string; value: number; max: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span><span>{value}%</span>
      </label>
      <input id={id} data-testid={`slider-${id}`} className="ds" type="range" min={0} max={max} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export default function Home() {
  const detect = useDetectImage({ mutation: { retry: false } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: false } });
  const [orig, setOrig] = useState<{ url: string; w: number; h: number; name: string; el: HTMLImageElement } | null>(null);
  const [crop, setCrop] = useState<CropBox>(FULL);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const reqId = useRef(0);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = useCallback(() => {
    reqId.current += 1;
    busyRef.current = false;
    setBusy(false);
    setResult(null);
    setError(null);
  }, []);

  // Build exact bytes that will be sent (and previewed).
  useEffect(() => {
    if (!orig) { setSent(null); return; }
    const isFull = crop.left + crop.top + crop.right + crop.bottom === 0;
    if (isFull) { setSent(orig.url); return; }
    setSent(null);
    const t = setTimeout(() => {
      const sx = Math.round((orig.w * crop.left) / 100);
      const sy = Math.round((orig.h * crop.top) / 100);
      const sw = Math.max(1, Math.round(orig.w * (1 - (crop.left + crop.right) / 100)));
      const sh = Math.max(1, Math.round(orig.h * (1 - (crop.top + crop.bottom) / 100)));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const ctx = c.getContext('2d');
      if (!ctx) { setError('Your browser could not create a crop canvas.'); return; }
      ctx.drawImage(orig.el, sx, sy, sw, sh, 0, 0, sw, sh);
      const out = c.toDataURL('image/png');
      if (dataUrlBytes(out) > MAX_BYTES) { setError('This crop is over 10MB once encoded. Crop tighter or use a smaller image.'); return; }
      setSent(out);
    }, 120);
    return () => clearTimeout(t);
  }, [orig, crop]);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    invalidate();
    const selectionId = reqId.current;
    setOrig(null);
    setSent(null);
    if (!TYPES.includes(file.type)) { setError('Unsupported file type. Use JPEG, PNG or WebP.'); return; }
    if (file.size > MAX_BYTES) { setError('File is over 10MB. Choose a smaller image.'); return; }
    const reader = new FileReader();
    reader.onerror = () => { if (selectionId === reqId.current) setError('The file could not be read.'); };
    reader.onload = () => {
      if (selectionId !== reqId.current) return;
      const url = String(reader.result);
      const el = new Image();
      el.onload = () => { if (selectionId !== reqId.current) return; setCrop(FULL); setOrig({ url, w: el.naturalWidth, h: el.naturalHeight, name: file.name, el }); };
      el.onerror = () => { if (selectionId === reqId.current) setError('This file could not be decoded as an image. It may be corrupt.'); };
      el.src = url;
    };
    reader.readAsDataURL(file);
  };

  const changeCrop = (patch: Partial<CropBox>) => { invalidate(); setSent(null); setCrop((c) => ({ ...c, ...patch })); };

  const analyze = async () => {
    if (!sent || busyRef.current) return;
    const id = ++reqId.current;
    busyRef.current = true;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await detect.mutateAsync({ data: { imageBase64: sent } });
      if (id !== reqId.current) return;
      setResult(r);
    } catch (e) {
      if (id !== reqId.current) return;
      const msg = e instanceof Error && e.message ? e.message : 'Analysis failed.';
      setError(`Analysis failed: ${msg}`);
    } finally {
      if (id === reqId.current) { busyRef.current = false; setBusy(false); }
    }
  };

  const reset = () => { invalidate(); setOrig(null); setCrop(FULL); setSent(null); if (fileRef.current) fileRef.current.value = ''; };

  const h = health.data;
  const cropped = !!orig && sent !== orig.url;


  const ai = result ? frac(result.scores.ai_generated) : 0;
  const R = 70, C = 2 * Math.PI * R;
  const cfg = (v: boolean | undefined) => (v === undefined ? 'unknown' : v ? 'configured' : 'not configured');
  const card = 'rounded-3xl border border-card-border bg-card p-5 sm:p-7';

  return (
    <div className="min-h-[100dvh] bg-background bg-[radial-gradient(ellipse_at_top,hsl(262_60%_18%/0.55),transparent_60%)]">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="ds-grad flex h-11 w-11 items-center justify-center rounded-2xl"><ShieldCheck className="h-6 w-6 text-white" /></div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">DeepShield <span className="ds-text-grad">AI</span></h1>
            <p className="text-xs text-muted-foreground">Check a social-media image for signs of AI</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground" data-testid="status-health">
          {health.isLoading ? 'Checking service...' : health.isError || !h ? 'Service unreachable' : (
            <div className="flex gap-3"><span>Hive: {cfg(h.hive_ready)}</span><span>Sightengine: {cfg(h.sightengine_ready)}</span></div>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-5 px-4 pb-10">
        <section className={card}>
          <div className="text-center">
            <span className="inline-block rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-semibold text-primary-foreground/90">Step 1: Choose an image</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Drop an image to check</h2>
            <p className="mt-2 text-sm text-muted-foreground">JPEG, PNG or WebP, up to 10MB. Nothing is sent until you press Analyze.</p>
          </div>

          {!orig ? (
            <div
              role="button" tabIndex={0} data-testid="dropzone"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); loadFile(e.dataTransfer.files[0]); }}
              className={`mt-6 flex min-h-[16rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${drag ? 'border-accent bg-primary/15' : 'border-input/70 bg-background/40 hover:border-primary'}`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><ImagePlus className="h-7 w-7 text-primary" /></div>
              <p className="font-semibold">Drop photo here, or <span className="text-primary underline underline-offset-4">browse files</span></p>
              <p className="text-xs text-muted-foreground">Supports JPG, PNG, WEBP (max 10MB)</p>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-border bg-background/40 p-3">
              <div className="relative flex min-h-[14rem] items-center justify-center overflow-hidden rounded-xl bg-black/30">
                {sent ? <img src={sent} alt="Image that will be analyzed" data-testid="img-preview" className="max-h-[28rem] w-auto max-w-full object-contain" /> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                {busy && <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-primary/40 to-transparent scan" />}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate" data-testid="text-filename">{orig.name} · {orig.w}×{orig.h}px{cropped ? ' · cropped' : ''}</span>
                <button onClick={reset} data-testid="button-reset" className="inline-flex items-center gap-1 rounded-full px-3 py-1 hover:bg-secondary"><X className="h-3 w-3" />Clear image</button>
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept={TYPES.join(',')} hidden data-testid="input-file" onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />

          {orig && (
            <details className="group mt-4 rounded-2xl border border-border bg-background/40 p-4" data-testid="details-crop">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex items-center gap-2"><Crop className="h-4 w-4 text-primary" />Crop image (optional)</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <fieldset className="mt-3" disabled={busy}>
                <p className="mb-3 text-sm text-muted-foreground">Screenshots can hide an image from detectors. Trim away the page around the picture. The preview is exactly what gets sent.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Slider id="left" label="Left" value={crop.left} max={90 - crop.right} onChange={(n) => changeCrop({ left: n })} disabled={busy} />
                  <Slider id="right" label="Right" value={crop.right} max={90 - crop.left} onChange={(n) => changeCrop({ right: n })} disabled={busy} />
                  <Slider id="top" label="Top" value={crop.top} max={90 - crop.bottom} onChange={(n) => changeCrop({ top: n })} disabled={busy} />
                  <Slider id="bottom" label="Bottom" value={crop.bottom} max={90 - crop.top} onChange={(n) => changeCrop({ bottom: n })} disabled={busy} />
                </div>
                <button onClick={() => changeCrop(FULL)} disabled={!cropped || busy} data-testid="button-reset-crop" className="mt-3 inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />Reset crop to original</button>
              </fieldset>
            </details>
          )}

          <div className="mt-5 flex flex-col items-center gap-3">
            <button onClick={analyze} disabled={!sent || busy} data-testid="button-analyze" className="ds-grad inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full px-6 py-3 font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {busy ? 'Analyzing...' : 'Analyze image'}
            </button>
            <p className="max-w-md text-center text-xs text-muted-foreground">Analyze sends the previewed image to Hive. If Hive fails, Sightengine is used as a fallback. One request per press, no automatic retry.</p>
            {error && (
              <div role="alert" data-testid="text-error" className="flex w-full items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}{orig && error.startsWith('Analysis failed') && <button onClick={analyze} data-testid="button-retry" className="ml-2 underline">Try again</button>}</span>
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <section className={card} aria-live="polite" data-testid="panel-result-area">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Step 2: Result</p>
            {result ? (
              <div className="rise flex flex-col items-center text-center" data-testid="panel-result">
                <div className="relative mt-4 h-44 w-44">
                  <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label="AI-generated score ring">
                    <defs><linearGradient id="dsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="hsl(262 85% 62%)" /><stop offset="100%" stopColor="hsl(340 85% 66%)" /></linearGradient></defs>
                    <circle cx="80" cy="80" r={R} fill="none" stroke="hsl(232 25% 16%)" strokeWidth="12" />
                    <circle cx="80" cy="80" r={R} fill="none" stroke="url(#dsg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ai)} className="ds-ring" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold" data-testid="text-score-ai_generated">{(result.scores.ai_generated * 100).toFixed(3)}%</span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">AI-generated score</span>
                  </div>
                </div>
                <p className="mt-4 rounded-full border border-primary/40 bg-primary/15 px-4 py-1 text-sm font-bold" data-testid="text-label">{result.label}</p>
                <p className="mt-2 text-xs text-muted-foreground">Provider: <span data-testid="text-provider" className="text-foreground">{result.provider}</span> · {result.model}</p>
                <p className="mt-3 text-sm">Not-AI-generated score: <span className="font-semibold" data-testid="text-score-not_ai_generated">{(result.scores.not_ai_generated * 100).toFixed(3)}%</span></p>
                {result.note && <p className="mt-3 text-sm text-muted-foreground" data-testid="text-note">{result.note}</p>}
                <p className="mt-3 text-xs text-muted-foreground">A score is an estimate from a model, not proof either way.</p>
                <button onClick={reset} data-testid="button-next" className="mt-4 inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-sm hover:bg-secondary"><RotateCcw className="h-3.5 w-3.5" />Check another image</button>
              </div>
            ) : (
              <div className="mt-4 flex min-h-[14rem] flex-col items-center justify-center gap-3 text-center text-muted-foreground" data-testid="empty-result">
                {busy ? <Loader2 className="h-10 w-10 animate-spin text-primary" /> : <div className="flex h-24 w-24 items-center justify-center rounded-full border-[10px] border-secondary"><ScanSearch className="h-8 w-8" /></div>}
                <p className="text-sm">{busy ? 'Waiting for the provider to respond...' : orig ? 'Press Analyze to see the score here.' : 'Choose an image to get started. Your result will appear here.'}</p>
              </div>
            )}
          </section>

          <section className={card}>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Good to know</p>
            <h2 className="mt-1 text-xl font-extrabold">Reading a result</h2>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li>A full browser screenshot can evade detectors. Crop down to just the image first: in one real example, cropping made the difference.</li>
              <li>A low AI score does not mean the image is real. AI images can be missed.</li>
              <li>Scores come from a model and are estimates, not a verdict.</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
