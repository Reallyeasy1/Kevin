'use client';

import { ROUTING_MODES, RouteRequest, type RoutingMode } from '@subbuddy/contracts';
import { useState, type FormEvent } from 'react';

const MODE_HELP: Record<RoutingMode, string> = {
  balanced: 'Quality vs price',
  quality: 'Best task score',
  cheapest: 'Lowest price',
  fastest: 'Lowest latency',
};

export function Composer({
  asset,
  disabled,
  onSubmit,
}: {
  asset: string;
  disabled: boolean;
  onSubmit: (req: RouteRequest) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<RoutingMode>('balanced');
  const [maxCost, setMaxCost] = useState('0.020000');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [issue, setIssue] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const tokens = maxOutputTokens.trim() === '' ? undefined : Number(maxOutputTokens);
    // maxCost stays a decimal string end to end (INV-006); RouteRequest validates the shape (FR-001).
    const parsed = RouteRequest.safeParse({
      prompt,
      mode,
      maxCost: maxCost.trim(),
      ...(tokens === undefined ? {} : { maxOutputTokens: tokens }),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setIssue(`${String(first?.path[0] ?? 'input')}: ${first?.message ?? 'invalid'}`);
      return;
    }
    setIssue(null);
    onSubmit(parsed.data);
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Prompt composer"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Prompt
        <textarea
          name="prompt"
          required
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
          placeholder="Implement Dijkstra's algorithm and explain its complexity."
          className="w-full resize-y rounded-md border border-neutral-300 p-2 font-normal focus:outline-2 focus:outline-indigo-600"
        />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">Routing mode</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
          {ROUTING_MODES.map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-md border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-600 ${
                mode === m ? 'border-indigo-600 bg-indigo-50' : 'border-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                disabled={disabled}
                className="sr-only"
              />
              <span className="block font-medium capitalize">{m}</span>
              <span className="block text-xs text-neutral-500">{MODE_HELP[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Max cost
          <span className="flex items-stretch">
            <input
              name="maxCost"
              inputMode="decimal"
              required
              value={maxCost}
              onChange={(e) => setMaxCost(e.target.value)}
              disabled={disabled}
              aria-describedby="maxcost-help"
              className="w-full rounded-l-md border border-neutral-300 p-2 font-mono font-normal focus:outline-2 focus:outline-indigo-600"
            />
            <span className="flex items-center rounded-r-md border border-l-0 border-neutral-300 bg-neutral-100 px-3 text-xs font-medium">
              {asset}
            </span>
          </span>
          <span id="maxcost-help" className="text-xs font-normal text-neutral-500">
            Spend mandate: at most this amount, one payment, XRPL Testnet only, expires in 5
            minutes.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Output limit (tokens, optional)
          <input
            name="maxOutputTokens"
            type="number"
            min={1}
            step={1}
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(e.target.value)}
            disabled={disabled}
            placeholder="1200"
            className="w-full rounded-md border border-neutral-300 p-2 font-mono font-normal focus:outline-2 focus:outline-indigo-600"
          />
        </label>
      </div>

      {issue && (
        <p role="alert" className="text-sm text-red-700">
          {issue}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {disabled ? 'Running…' : 'Route and Run'}
      </button>
    </form>
  );
}
