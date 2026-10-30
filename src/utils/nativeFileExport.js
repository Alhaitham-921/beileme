import { Capacitor } from '@capacitor/core'

async function loadNativePlugins() {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  return { Filesystem, Directory, Share }
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks = []
  // Avoid passing a whole PDF as function arguments, which can overflow the stack.
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  }
  return btoa(chunks.join(''))
}

/** Native exports use the system share sheet; browser exports keep downloads.
 * Returns the file name, or null when the user dismisses the share sheet.
 * The optional platform/plugin adapters also allow binary export tests in Node.
 */
export async function saveExportFile(blob, name, {
  native = Capacitor.isNativePlatform(),
  loadPlugins = loadNativePlugins,
} = {}) {
  if (native) {
    const { Filesystem, Directory, Share } = await loadPlugins()
    const { uri } = await Filesystem.writeFile({
      path: `reports/${name}`,
      data: await blobBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    })
    // Cache files need no public storage permission and are allowed by the
    // Android FileProvider. Keep the file after sharing: recipients may read it
    // asynchronously. Another export of the same report replaces its cache copy.
    try {
      await Share.share({
        title: name,
        dialogTitle: '保存或分享练习小结',
        files: [uri],
      })
    } catch (error) {
      if (error?.name === 'AbortError' || /^Share cancel(?:ed|led)$/i.test(error?.message || '')) return null
      throw error
    }
    return name
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  try { link.click() }
  finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  return name
}
