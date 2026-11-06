import { describe, expect, it } from 'vitest'
import { currentMeasurementMonth, measurementPeriod } from './measurement.js'

describe('período da medição', () => {
  it('padrão: mês cheio, fecha no último dia', () => {
    expect(measurementPeriod('2026-11', null)).toMatchObject({ first: '2026-11-01', last: '2026-11-30' })
    expect(measurementPeriod('2028-02', null)).toMatchObject({ first: '2028-02-01', last: '2028-02-29' })
    const p = measurementPeriod('2026-12', null)
    expect(p.end.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })
  it('fechamento no dia 25: de 26 do mês anterior a 25', () => {
    const p = measurementPeriod('2026-11', 25)
    expect(p).toMatchObject({ first: '2026-10-26', last: '2026-11-25' })
    expect(p.start.toISOString()).toBe('2026-10-26T03:00:00.000Z')
    expect(p.end.toISOString()).toBe('2026-11-26T03:00:00.000Z')
    expect(measurementPeriod('2027-01', 25)).toMatchObject({ first: '2026-12-26', last: '2027-01-25' })
  })
  it('fechamento no dia 28 com fevereiro curto começa no dia 1º', () => {
    expect(measurementPeriod('2027-03', 28)).toMatchObject({ first: '2027-03-01', last: '2027-03-28' })
  })
  it('medição em andamento: depois do fechamento já é a do mês seguinte', () => {
    expect(currentMeasurementMonth(null, '2026-11-30')).toBe('2026-11')
    expect(currentMeasurementMonth(25, '2026-11-25')).toBe('2026-11')
    expect(currentMeasurementMonth(25, '2026-11-26')).toBe('2026-12')
    expect(currentMeasurementMonth(25, '2026-12-27')).toBe('2027-01')
  })
})
