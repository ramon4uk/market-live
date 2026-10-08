/// <reference lib="webworker" />
import { describe, MarketExports, ProducerCore } from './producer-core';
import { createCommandHandler } from './worker-handler';
import { WorkerInput, WorkerOutput } from './worker-protocol';

const post = (message: WorkerOutput, transfer: Transferable[] = []) => postMessage(message, transfer);

const imports: WebAssembly.Imports = {
  env: {
    abort: (_msg: number, _file: number, line: number, column: number) => {
      throw new Error(`Wasm abort at ${line}:${column}`);
    },
  },
};

/** The module is fetched and compiled once; each new producer gets a fresh instance (clean memory). */
let compiled: Promise<WebAssembly.Module> | null = null;

async function compile(wasmUrl: string): Promise<WebAssembly.Module> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
}

async function createCore(wasmUrl: string): Promise<ProducerCore> {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is not supported by this browser.');
  let exports: MarketExports;
  try {
    compiled ??= compile(wasmUrl);
    const instance = await WebAssembly.instantiate(await compiled, imports);
    exports = instance.exports as unknown as MarketExports;
  } catch (e) {
    compiled = null; // a failed download is retried on the next Apply
    throw new Error(`Failed to load the Wasm generator (${wasmUrl}): ${describe(e)}`);
  }
  return new ProducerCore(exports, post);
}

const handle = createCommandHandler(createCore, post);
addEventListener('message', ({ data }: MessageEvent<WorkerInput>) => void handle(data));
