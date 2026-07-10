export type ImageDimensions = { width: number; height: number }

function validDimension(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 10000
}

export function inferImageDimensions(src: string): ImageDimensions | null {
  try {
    const url = new URL(src, 'https://local.invalid')
    const segments = url.pathname.split('/').filter(Boolean)
    const width = Number(segments.at(-2))
    const height = Number(segments.at(-1))
    if (validDimension(width) && validDimension(height)) return { width, height }

    const filename = segments.at(-1) ?? ''
    const filenameMatch = /(?:^|[-_])(\d{1,5})x(\d{1,5})(?:[._-]|$)/i.exec(filename)
    if (filenameMatch) {
      const filenameWidth = Number(filenameMatch[1])
      const filenameHeight = Number(filenameMatch[2])
      if (validDimension(filenameWidth) && validDimension(filenameHeight)) {
        return { width: filenameWidth, height: filenameHeight }
      }
    }

    const queryWidth = Number(url.searchParams.get('width') ?? url.searchParams.get('w'))
    const queryHeight = Number(url.searchParams.get('height') ?? url.searchParams.get('h'))
    if (validDimension(queryWidth) && validDimension(queryHeight)) return { width: queryWidth, height: queryHeight }
  } catch {
    return null
  }
  return null
}
