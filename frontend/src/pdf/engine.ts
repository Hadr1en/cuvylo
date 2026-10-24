import type { PDFDocumentProxy, PDFWorker } from 'pdfjs-dist'

/**
 * Moteurs PDF chargés à la demande (react-pdf pour produire, pdf.js pour lire) et partagés :
 * - un seul chargement des modules et des polices ;
 * - un seul worker pdf.js pour tous les documents ouverts (aperçu, miniatures, analyse) ;
 * - une file : une génération react-pdf à la fois, pour ne pas figer l'interface.
 * L'analyse d'un PDF n'a besoin que du lecteur (`loadReader`) : le générateur, plus lourd, n'est
 * chargé que pour produire un document (`loadEngines`).
 */
let reader: ReturnType<typeof loadReaderModules> | null = null
let engines: ReturnType<typeof load> | null = null

async function loadReaderModules() {
  const [pdfjs, workerUrl, { extractPdfText }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    import('./extract'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default
  return { pdfjs, extractPdfText }
}

async function load() {
  const [{ pdf }, { CvDocument }, { registerWebFonts }, read] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./CvDocument'),
    import('./fonts.web'),
    loadReader(),
  ])
  registerWebFonts()
  return { pdf, CvDocument, ...read }
}

/** Nouvel essai possible après un échec (réseau coupé pendant le chargement, par exemple). */
function retryable<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  return promise.catch((e: unknown) => {
    forget()
    throw e
  })
}

/** Lecteur seul (pdf.js et extraction du texte) : analyse d'un PDF, aperçu. */
export function loadReader() {
  reader ??= retryable(loadReaderModules(), () => (reader = null))
  return reader
}

/** Lecteur et générateur (react-pdf, modèles, polices) : production d'un CV ou d'une lettre. */
export function loadEngines() {
  engines ??= retryable(load(), () => (engines = null))
  return engines
}

let worker: PDFWorker | null = null

/** Document pdf.js ouvert : à fermer avec `close()` quand il n'est plus affiché. */
export interface OpenPdf {
  doc: PDFDocumentProxy
  close: () => Promise<void>
}

export async function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  const { pdfjs } = await loadReader()
  worker ??= new pdfjs.PDFWorker()
  const task = pdfjs.getDocument({ data: bytes, worker, verbosity: 0 })
  try {
    const doc = await task.promise
    let closed = false
    return {
      doc,
      close: async () => {
        if (closed) return
        closed = true
        await task.destroy()
      },
    }
  } catch (e) {
    await task.destroy()
    throw e
  }
}

let queue: Promise<unknown> = Promise.resolve()

export class Cancelled extends Error {
  constructor() {
    super('Génération annulée')
    this.name = 'Cancelled'
  }
}

/** Place un travail dans la file ; s'il est annulé avant son tour, il n'est pas exécuté. */
export function enqueue<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) throw new Cancelled()
    await new Promise((r) => setTimeout(r, 0)) // laisse respirer le thread principal
    if (signal?.aborted) throw new Cancelled()
    return job()
  })
  queue = run.catch(() => undefined)
  return run
}
