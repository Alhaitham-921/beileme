import { http } from '../api/client.js'

// Fetch through the authenticated API client (including silent token renewal).
// Object URLs belong to the calling component and must be revoked there.
export async function loadMemoryImage(path, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const image = await http.getBlob(path, { signal, timeoutMs: 7000 })
      return URL.createObjectURL(image)
    } catch (error) {
      if (attempt || signal.aborted || (error.status !== 0 && error.status < 500)) throw error
    }
  }
}
