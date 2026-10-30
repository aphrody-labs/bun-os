import { describe, it, expect, vi, beforeEach } from 'vitest'

const backend = vi.hoisted(() => ({ call: vi.fn(), tauri: vi.fn(() => true) }))
vi.mock('../../api/backend', async (o) => ({ ...(await o<typeof import('../../api/backend')>()), backendCall: backend.call, isTauri: backend.tauri }))

import { isTrashableMacRender, isTrashableRender, trashGalleryFile } from '../gallery-trash'
import type { GalleryItem } from '../../stores/createStore'

const item = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  id: 'a', type: 'image', filename: 'locally_uncensored_00001_.png', subfolder: '', prompt: '', negativePrompt: '',
  model: 'm', modelType: 'sdxl', seed: 1, steps: 1, cfgScale: 1, sampler: 'euler', scheduler: 'normal',
  width: 1, height: 1, batchSize: 1, createdAt: 1, ...over,
}) as GalleryItem

beforeEach(() => { backend.call.mockReset().mockResolvedValue({ trashed: true, missing: false }); backend.tauri.mockReturnValue(true) })

describe('gallery delete reaches the file (Discord 2026-09-25)', () => {
  it('a local ComfyUI render goes to the Recycle Bin', async () => {
    expect(await trashGalleryFile(item({ subfolder: 'x' }), [])).toBeNull()
    expect(backend.call).toHaveBeenCalledWith('trash_comfy_output', { filename: 'locally_uncensored_00001_.png', subfolder: 'x' })
  })

  it('cloud, input files and files another entry still shows are left alone, and an MLX file is not a ComfyUI one', () => {
    expect(isTrashableRender(item({ jobId: 'j' }), [])).toBe(false)
    expect(isTrashableRender(item({ remoteUrl: 'https://x' }), [])).toBe(false)
    expect(isTrashableRender(item({ localPath: '/x.mp4' }), [])).toBe(false)
    expect(isTrashableRender(item({ comfyType: 'input' }), [])).toBe(false)
    expect(isTrashableRender(item(), [item({ id: 'b' })])).toBe(false)
    expect(isTrashableRender(item(), [item({ id: 'b', filename: 'other.png' })])).toBe(true)
  })

  it('a failed move is reported, the gallery entry is gone anyway', async () => {
    backend.call.mockRejectedValue(new Error('access denied'))
    expect(await trashGalleryFile(item(), [])).toMatch(/stayed in the ComfyUI output folder: access denied/)
  })

  // Persona walk of the Mac app, 09.10.2026, Fund 13: on a Mac the entry went
  // and the file stayed in the app's output folder.
  describe('a render of the Mac engines goes to the Trash', () => {
    const still = () => item({ filename: 'mlx-1.png', localPath: '/Users/x/Library/Application Support/lu-labs/images/mlx-1-2.png' })
    const clip = () => item({ type: 'video', filename: '', localPath: '/Users/x/Library/Application Support/lu-labs/videos/abc.mp4' })

    it('a still and a clip are handed to mlx_output_trash by their path, and to nothing else', async () => {
      expect(await trashGalleryFile(still(), [])).toBeNull()
      expect(await trashGalleryFile(clip(), [item()])).toBeNull()
      expect(backend.call.mock.calls).toEqual([
        ['mlx_output_trash', { args: { path: still().localPath } }],
        ['mlx_output_trash', { args: { path: clip().localPath } }],
      ])
    })

    it('a file another entry still shows stays, and so does a cloud render that carries a path', async () => {
      expect(isTrashableMacRender(still(), [still()])).toBe(false)
      expect(isTrashableMacRender(still(), [clip()])).toBe(true)
      expect(isTrashableMacRender(item({ localPath: '/x.png', jobId: 'j' }), [])).toBe(false)
      expect(isTrashableMacRender(item({ localPath: '/x.png', remoteUrl: 'https://x' }), [])).toBe(false)
      expect(isTrashableMacRender(item(), [])).toBe(false)
      expect(await trashGalleryFile(still(), [item({ id: 'b', localPath: still().localPath })])).toBeNull()
      expect(backend.call).not.toHaveBeenCalled()
    })

    it('a failed move is said in Mac words, without ComfyUI', async () => {
      backend.call.mockRejectedValue(new Error('Could not move the file to the Trash: permission denied'))
      const line = await trashGalleryFile(still(), [])
      expect(line).toBe('Removed from the gallery, but the file stayed on this Mac: Could not move the file to the Trash: permission denied')
      expect(line).not.toMatch(/ComfyUI/)
    })

    it('outside the desktop app nothing is called', async () => {
      backend.tauri.mockReturnValue(false)
      expect(await trashGalleryFile(still(), [])).toBeNull()
      expect(backend.call).not.toHaveBeenCalled()
    })
  })
})
