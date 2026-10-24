/**
 * Lecteur CSV robuste (RFC 4180 et variantes rencontrées dans les exports) : guillemets, guillemets
 * doublés, retours à la ligne dans un champ, fins de ligne CRLF/LF/CR, BOM, séparateur `,` ou `;`.
 */

/** Lignes du fichier, chaque ligne étant la liste de ses champs. */
export function parseCsv(input: string, delimiter?: ',' | ';'): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const sep = delimiter ?? guessDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // Ignore les lignes entièrement vides.
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i++
    } else if (c === sep) {
      endField()
      i++
    } else if (c === '\r') {
      endRow()
      i += text[i + 1] === '\n' ? 2 : 1
    } else if (c === '\n') {
      endRow()
      i++
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length) endRow()
  return rows
}

function guessDelimiter(text: string): ',' | ';' {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => first.split(ch).length - 1
  return count(';') > count(',') ? ';' : ','
}

/**
 * Enregistrements indexés par nom de colonne. La ligne d'en-tête est la première (parmi les 10 premières)
 * qui contient `required` : certains exports commencent par des lignes de notes.
 */
export function csvRecords(input: string, required?: string): Record<string, string>[] {
  const rows = parseCsv(input)
  const norm = (s: string) => s.trim().toLowerCase()
  let h = 0
  if (required) {
    const found = rows.slice(0, 10).findIndex((r) => r.some((c) => norm(c) === norm(required)))
    if (found < 0) return []
    h = found
  }
  const header = (rows[h] ?? []).map((c) => c.trim())
  return rows.slice(h + 1).map((r) => Object.fromEntries(header.map((name, i) => [name, (r[i] ?? '').trim()])))
}
