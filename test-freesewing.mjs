import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Noble } from '@freesewing/noble'
import { cisFemaleAdult38 } from '@freesewing/models'
import { version as coreVersion } from '@freesewing/core'
import { degreeMeasurements } from '@freesewing/config'

const outDir = path.resolve('output')
fs.mkdirSync(outDir, { recursive: true })

const required = [...Noble.patternConfig.measurements]
const optional = [...(Noble.patternConfig.optionalMeasurements || [])]
const model = { ...cisFemaleAdult38 }

const missingFromModel = required.filter((key) => !Number.isFinite(model[key]))
if (missingFromModel.length) {
  throw new Error('cisFemaleAdult38 is missing Noble measurements: ' + missingFromModel.join(', '))
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

function svgStats(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] || null
  const width = svg.match(/width="([^"]+)"/)?.[1] || null
  const height = svg.match(/height="([^"]+)"/)?.[1] || null
  return {
    bytes: Buffer.byteLength(svg),
    sha256: sha256(svg),
    pathCount: (svg.match(/<path\b/g) || []).length,
    viewBox,
    width,
    height,
    seamAllowanceMarkers: (svg.match(/\bsa\b/g) || []).length,
  }
}

function draft(label, measurements, settings = {}) {
  const pattern = new Noble({
    measurements,
    ...settings,
  })
  pattern.draft()
  const svg = pattern.render()
  fs.writeFileSync(path.join(outDir, label + '.svg'), svg)
  const stats = svgStats(svg)
  stats.label = label
  stats.patternWidth = Number.isFinite(pattern.width) ? pattern.width : null
  stats.patternHeight = Number.isFinite(pattern.height) ? pattern.height : null
  stats.partCount = Object.keys(pattern.parts || {}).length
  stats.logSummary = Object.fromEntries(
    Object.entries(pattern.getLogs()?.pattern || {}).map(([level, entries]) => [
      level,
      Array.isArray(entries) ? entries.length : 0,
    ])
  )
  return stats
}

const baseline = draft('noble-baseline', model)
const baselineRepeat = draft('noble-baseline-repeat', model)
const determinismTest = {
  identicalSvgHash: baseline.sha256 === baselineRepeat.sha256,
  identicalViewBox: baseline.viewBox === baselineRepeat.viewBox,
  identicalBytes: baseline.bytes === baselineRepeat.bytes,
  sha256First: baseline.sha256,
  sha256Second: baselineRepeat.sha256,
}

const sensitivity = []
for (const key of required) {
  const before = model[key]
  const delta = Math.max(10, Math.round(Math.abs(before) * 0.05))
  const changed = { ...model, [key]: before + delta }
  const stats = draft('sensitivity-' + key, changed)
  sensitivity.push({
    measurement: key,
    beforeMm: before,
    afterMm: changed[key],
    deltaMm: delta,
    geometryChanged: stats.sha256 !== baseline.sha256,
    svgBytesDelta: stats.bytes - baseline.bytes,
    pathCountDelta: stats.pathCount - baseline.pathCount,
    baselineViewBox: baseline.viewBox,
    changedViewBox: stats.viewBox,
    changedSha256: stats.sha256,
  })
}

const bustKey = required.includes('chest') ? 'chest' : required.find((k) => /bustCircumference/i.test(k)) || required.find((k) => /bust/i.test(k)) || required.find((k) => /chest/i.test(k))

const waistKey =
  required.find((k) => /naturalWaist/i.test(k)) ||
  required.find((k) => /waistCircumference/i.test(k)) ||
  required.find((k) => /waist/i.test(k))

let bustTest = null
if (bustKey) {
  const measurements = { ...model, [bustKey]: model[bustKey] + 100 }
  const stats = draft('noble-bust-plus-100mm', measurements)
  bustTest = {
    measurement: bustKey,
    beforeMm: model[bustKey],
    afterMm: measurements[bustKey],
    geometryChanged: stats.sha256 !== baseline.sha256,
    svgBytesDelta: stats.bytes - baseline.bytes,
    pathCountDelta: stats.pathCount - baseline.pathCount,
    viewBoxBefore: baseline.viewBox,
    viewBoxAfter: stats.viewBox,
    sha256Before: baseline.sha256,
    sha256After: stats.sha256,
  }
}

let waistTest = null
if (waistKey) {
  const measurements = { ...model, [waistKey]: model[waistKey] + 100 }
  const stats = draft('noble-waist-plus-100mm', measurements)
  waistTest = {
    measurement: waistKey,
    beforeMm: model[waistKey],
    afterMm: measurements[waistKey],
    geometryChanged: stats.sha256 !== baseline.sha256,
    svgBytesDelta: stats.bytes - baseline.bytes,
    pathCountDelta: stats.pathCount - baseline.pathCount,
    viewBoxBefore: baseline.viewBox,
    viewBoxAfter: stats.viewBox,
    sha256Before: baseline.sha256,
    sha256After: stats.sha256,
  }
}

const withSa = draft('noble-seam-allowance-10mm', model, { sa: 10 })
const seamAllowanceTest = {
  requestedMm: 10,
  geometryChanged: withSa.sha256 !== baseline.sha256,
  baselineMarkers: baseline.seamAllowanceMarkers,
  withSaMarkers: withSa.seamAllowanceMarkers,
  baselinePathCount: baseline.pathCount,
  withSaPathCount: withSa.pathCount,
  svgBytesDelta: withSa.bytes - baseline.bytes,
}

let invalidMeasurementTest
try {
  const bad = { ...model, [required[0]]: 0 }
  const stats = draft('noble-invalid-zero-measurement', bad)
  invalidMeasurementTest = {
    measurement: required[0],
    suppliedMm: 0,
    rejected: false,
    rendered: true,
    sha256: stats.sha256,
    note: 'FreeSewing accepted the zero value at this layer; application-side validation is required.',
  }
} catch (error) {
  invalidMeasurementTest = {
    measurement: required[0],
    suppliedMm: 0,
    rejected: true,
    rendered: false,
    error: String(error?.stack || error),
  }
}

const allRequiredInfluenceGeometry = sensitivity.every((x) => x.geometryChanged)
const changedCount = sensitivity.filter((x) => x.geometryChanged).length

const results = {
  generatedAt: new Date().toISOString(),
  packageVersions: {
    core: coreVersion,
    noble: '4.10.2',
    bella: '4.10.2',
    models: '4.10.2',
  },
  design: {
    id: Noble.designConfig?.data?.id || 'noble',
    name: Noble.designConfig?.data?.name || 'Noble',
    requiredMeasurements: required,
    optionalMeasurements: optional,
  },
  baseline,
  baselineRepeat,
  determinismTest,
  bustTest,
  waistTest,
  seamAllowanceTest,
  invalidMeasurementTest,
  sensitivity,
  summary: {
    requiredMeasurementCount: required.length,
    deterministicRepeatPassed: determinismTest.identicalSvgHash && determinismTest.identicalViewBox && determinismTest.identicalBytes,
    measurementsChangingGeometry: changedCount,
    allRequiredMeasurementsChangedGeometry: allRequiredInfluenceGeometry,
    bustAutomationPassed: bustTest ? bustTest.geometryChanged : null,
    waistAutomationPassed: waistTest ? waistTest.geometryChanged : null,
    seamAllowancePassed: seamAllowanceTest.geometryChanged && seamAllowanceTest.withSaMarkers > seamAllowanceTest.baselineMarkers,
  },
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))

const lines = [
  '# FreeSewing Noble automation test',
  '',
  '- Core version: ' + coreVersion,
  '- Required measurements: ' + required.length,
  '- Required keys: ' + required.join(', '),
  '- Baseline SVG bytes: ' + baseline.bytes,
  '- Baseline SVG paths: ' + baseline.pathCount,
  '- Baseline pattern parts: ' + baseline.partCount,
  '- Deterministic repeat: ' + (results.summary.deterministicRepeatPassed ? 'PASS' : 'FAIL'),
  '- Baseline viewBox: ' + baseline.viewBox,
  '',
  '## Key automation checks',
  '',
  '- Bust +100 mm: ' + (bustTest ? (bustTest.geometryChanged ? 'PASS' : 'FAIL') + ' (' + bustTest.measurement + ')' : 'NOT FOUND'),
  '- Waist +100 mm: ' + (waistTest ? (waistTest.geometryChanged ? 'PASS' : 'FAIL') + ' (' + waistTest.measurement + ')' : 'NOT FOUND'),
  '- 10 mm seam allowance: ' + (results.summary.seamAllowancePassed ? 'PASS' : 'CHECK') +
    ' (SA markers ' + seamAllowanceTest.baselineMarkers + ' -> ' + seamAllowanceTest.withSaMarkers + ')',
  '- Sensitivity: ' + changedCount + '/' + required.length + ' required measurements changed SVG geometry',
  '- Invalid zero measurement rejected: ' + (invalidMeasurementTest.rejected ? 'YES' : 'NO'),
  '',
  '## Sensitivity matrix',
  '',
  '| Measurement | Unit | Before | After | Geometry changed | SVG bytes delta |',
  '|---|---|---:|---:|:---:|---:|',
  ...sensitivity.map((x) =>
    '| ' + x.measurement + ' | ' + (degreeMeasurements.includes(x.measurement) ? 'deg' : 'mm') + ' | ' + x.beforeMm + ' | ' + x.afterMm + ' | ' +
    (x.geometryChanged ? 'YES' : 'NO') + ' | ' + x.svgBytesDelta + ' |'
  ),
]
fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'))

console.log(JSON.stringify(results, null, 2))

if (!bustTest?.geometryChanged || !waistTest?.geometryChanged) process.exitCode = 2

// trigger workflow after workflow file exists
