// The Qwen-Image 2.1 prompt enhancer: the graph and the run (GH #148).
//
// The enhancer is a 9B text model that ComfyUI runs with its own core nodes,
// no node pack needed. The graph is the enhancer half of the two official
// Comfy-Org templates (image_qwen_image_2_1_t2i.json and
// image_qwen_image_2_1_image_edit.json, read 2026-10-03):
//
//   CLIPLoader (the enhancer file) -> TextGenerate <- PrimitiveStringMultiline
//                    LoadImage(s) -> BatchImagesNode -^   (the system prompt)
//                                    TextGenerate -> PreviewAny
//
// It runs as its own short ComfyUI job BEFORE the picture, not inside the
// picture's graph, for three reasons: the rewritten prompt can be read, checked
// and shown before anything is rendered, a failed rewrite falls back to the
// user's own prompt instead of failing the picture, and the enhancer is out of
// the card's memory before the image model loads (freeMemory below).

import type { ComfyApiGraph, ComfyNodeInputs } from '../types/comfy-graph'
import { isRecord } from '../types/json-guards'
import { getAllNodeInfo } from './comfyui-nodes'
import { submitWorkflow, getHistory, freeMemory, abandonPrompt } from './comfyui'
import { WorkflowUnavailableError } from './dynamic-workflow'
import { enhancedOutcome, type QwenEnhancerMode } from '../lib/render/qwen-enhancer'
import type { ImproveOutcome } from '../lib/render/improve-prompt'
import { QWEN_PE_I2I_SYSTEM_PROMPT, QWEN_PE_T2I_SYSTEM_PROMPT } from './qwen-enhancer-prompts'

/** The sentence an older ComfyUI gets. TextGenerate takes a system prompt
 *  since ComfyUI 0.37.2 (comfy_extras/nodes_textgen.py, read off the tags
 *  0.37.1 and 0.37.2 on 2026-10-03); without that input the enhancer would run
 *  on the wrong instructions. "Update ComfyUI" is what Create keys the one
 *  click update on. */
export const QWEN_ENHANCER_NEEDS_UPDATE = 'The Qwen prompt enhancer needs ComfyUI 0.37.2 or newer. Update ComfyUI in Settings.'

/** Room for the reasoning plus the rewritten prompt, the value of the official
 *  templates. Qwen's own 16256 and 24000 can run for many minutes. */
export const QWEN_ENHANCER_MAX_LENGTH = 4096

/** How long the rewrite may take, loading the 9 GB file included. After this
 *  the job is taken out of the queue and the run goes on with the user's prompt. */
export const QWEN_ENHANCER_TIMEOUT_MS = 15 * 60_000

const POLL_MS = 1500

/** The node whose text is the answer. */
export const QWEN_ENHANCER_OUTPUT_NODE = '9'

export interface QwenEnhancerRequest {
  /** The enhancer file as ComfyUI lists it. */
  file: string
  mode: QwenEnhancerMode
  prompt: string
  /** Edit only: the source first, then the references, as ComfyUI input names.
   *  The order is the order the picture's own graph numbers them in. */
  images?: string[]
  seed: number
}

/** Sampling as the official templates set it, which follow Qwen's release:
 *  temperature 1.0, top_p 0.95, top_k 20, min_p 0, repetition_penalty 1.0, and
 *  presence_penalty 1.5 for a new picture, 0 for an edit. The dotted names are
 *  how ComfyUI spells the fields of a DynamicCombo in the API format. */
function sampling(mode: QwenEnhancerMode, seed: number): ComfyNodeInputs {
  return {
    sampling_mode: 'on',
    'sampling_mode.temperature': 1,
    'sampling_mode.top_k': 20,
    'sampling_mode.top_p': 0.95,
    'sampling_mode.min_p': 0,
    'sampling_mode.repetition_penalty': 1,
    'sampling_mode.seed': seed,
    'sampling_mode.presence_penalty': mode === 't2i' ? 1.5 : 0,
  }
}

/** The enhancer graph. Pure: `nodes` is the set of node classes ComfyUI has,
 *  with their inputs. Throws the update sentence on a ComfyUI that cannot run it. */
export function qwenEnhancerGraph(
  req: QwenEnhancerRequest,
  nodes: Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>,
): ComfyApiGraph {
  const images = req.mode === 'i2i' ? (req.images ?? []).filter(Boolean) : []
  const textGenerate = nodes.TextGenerate
  const takesSystemPrompt = !!textGenerate?.input?.optional && 'system_prompt' in textGenerate.input.optional
  const ready = takesSystemPrompt && !!nodes.PrimitiveStringMultiline && !!nodes.PreviewAny
    && (images.length < 2 || !!nodes.BatchImagesNode)
  if (!ready) {
    throw new WorkflowUnavailableError(QWEN_ENHANCER_NEEDS_UPDATE, 'unet_qwenimage', undefined, { needsComfyUpdate: true })
  }

  const graph: ComfyApiGraph = {
    // ComfyUI recognizes the enhancer by its weights, the type only has to be
    // one the loader knows. The edit template and the loader docs use this one.
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: req.file, type: 'qwen_image', device: 'default' } },
    '2': {
      class_type: 'PrimitiveStringMultiline',
      inputs: { value: req.mode === 't2i' ? QWEN_PE_T2I_SYSTEM_PROMPT : QWEN_PE_I2I_SYSTEM_PROMPT },
    },
  }
  const generate: ComfyNodeInputs = {
    clip: ['1', 0],
    prompt: req.prompt,
    max_length: QWEN_ENHANCER_MAX_LENGTH,
    ...sampling(req.mode, req.seed),
    // The enhancer was trained to reason first and writes worse prompts without it.
    thinking: true,
    use_default_template: true,
    mtp: 'auto',
    system_prompt: ['2', 0],
  }
  if (images.length > 0) {
    let n = 10
    const loaded: Array<[string, number]> = images.map((image) => {
      const id = String(n++)
      graph[id] = { class_type: 'LoadImage', inputs: { image } }
      return [id, 0]
    })
    if (loaded.length === 1) {
      generate.image = loaded[0]
    } else {
      // Several pictures reach the enhancer as one batch, as in the template.
      const batch: ComfyNodeInputs = {}
      loaded.forEach((ref, i) => { batch[`images.image${i}`] = ref })
      graph['3'] = { class_type: 'BatchImagesNode', inputs: batch }
      generate.image = ['3', 0]
    }
  }
  graph['4'] = { class_type: 'TextGenerate', inputs: generate }
  graph[QWEN_ENHANCER_OUTPUT_NODE] = { class_type: 'PreviewAny', inputs: { source: ['4', 0] } }
  return graph
}

/** The graph for this ComfyUI. */
export async function buildQwenEnhancerWorkflow(req: QwenEnhancerRequest): Promise<ComfyApiGraph> {
  return qwenEnhancerGraph(req, await getAllNodeInfo())
}

/** PreviewAny answers with `{ text: [value] }`. */
function answerText(outputs: unknown): string | null {
  const node = isRecord(outputs) ? outputs[QWEN_ENHANCER_OUTPUT_NODE] : undefined
  const text = isRecord(node) ? node.text : undefined
  const first: unknown = Array.isArray(text) ? text[0] : undefined
  return typeof first === 'string' ? first : null
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(done, ms)
  function done() {
    clearTimeout(timer)
    signal?.removeEventListener('abort', done)
    resolve()
  }
  signal?.addEventListener('abort', done)
})

/**
 * Run the enhancer graph and read the rewritten prompt. Never throws: a
 * rejected graph, a ComfyUI error, the time limit or Cancel all answer
 * `failed`, and the run goes on with the user's own prompt (Cancel is the
 * caller's to notice on its signal).
 *
 * Afterwards the enhancer is unloaded, whatever happened: it and Qwen-Image
 * 2.1 run one after the other on the same card, and 9 GB of text model must
 * not sit there while the encoder and the image model load.
 */
export async function runQwenEnhancer(
  workflow: ComfyApiGraph,
  original: string,
  opts: { clientId?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ImproveOutcome> {
  const { signal } = opts
  if (signal?.aborted) return { status: 'failed' }
  let promptId: string | null = null
  try {
    promptId = await submitWorkflow(workflow, opts.clientId)
    const deadline = Date.now() + (opts.timeoutMs ?? QWEN_ENHANCER_TIMEOUT_MS)
    for (;;) {
      if (signal?.aborted || Date.now() > deadline) break
      const entry = await getHistory(promptId)
      const status = entry?.status?.status_str
      if (status === 'success') {
        promptId = null
        return enhancedOutcome(answerText(entry?.outputs), original)
      }
      if (status === 'error') {
        promptId = null
        return { status: 'failed' }
      }
      await wait(POLL_MS, signal)
    }
    return { status: 'failed' }
  } catch {
    return { status: 'failed' }
  } finally {
    // Cancelled or out of time: our job must not keep the card busy.
    if (promptId) await abandonPrompt(promptId).catch(() => {})
    await freeMemory()
  }
}
