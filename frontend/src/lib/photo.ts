import { MAX_PHOTO_CHARS } from '@/domain/profile'

/**
 * Photo de CV : recadrée au carré (centre), réduite à 480 px et réencodée en JPEG
 * jusqu'à tenir dans la limite du contrat (200 000 caractères en data URL).
 * Le réencodage supprime aussi les métadonnées (EXIF : position GPS, appareil…).
 */
export async function photoToDataUrl(file: File, size = 480): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Format accepté : JPEG, PNG ou WebP.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Image trop lourde (15 Mo au plus).')
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    const out = Math.min(size, side)
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Traitement d’image indisponible dans ce navigateur.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out, out)
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
      const url = canvas.toDataURL('image/jpeg', q)
      if (url.length <= MAX_PHOTO_CHARS) return url
    }
    throw new Error('Image trop détaillée : essayez une photo plus simple.')
  } finally {
    bitmap.close()
  }
}
