import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Noble } from '@freesewing/noble'
import { cisFemaleAdult38 } from '@freesewing/models'

const out = path.resolve('hybrid-output/freesewing')
fs.mkdirSync(out, { recursive: true })

const measurements = { ...cisFemaleAdult38 }
const pattern = new Noble({ measurements, sa: 10 })
pattern.draft()
const svg = pattern.render()

const file = path.join(out, 'noble-bodice-reference.svg')
fs.writeFileSync(file, svg)

const result = {
  engine: 'FreeSewing Noble 4.10.2',
  role: 'Fitted princess-seam bodice reference for hybrid test',
  bodyFixture: 'cisFemaleAdult38',
  requiredMeasurements: Noble.patternConfig.measurements,
  patternParts: Object.keys(pattern.parts || {}),
  partCount: Object.keys(pattern.parts || {}).length,
  widthMm: pattern.width,
  heightMm: pattern.height,
  svgBytes: Buffer.byteLength(svg),
  svgSha256: crypto.createHash('sha256').update(svg).digest('hex'),
  seamAllowanceMm: 10
}
fs.writeFileSync(path.join(out, 'noble-reference.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
