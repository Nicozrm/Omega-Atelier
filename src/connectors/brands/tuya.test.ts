import { describe, it, expect } from 'vitest'
import { tuyaStringToSign, tuyaSign, tuyaCapsFor, tuyaCommandFor } from './tuyaClient'
import { findCapability } from '@/domain'

const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('tuya signing (v2)', () => {
  it('builds the canonical stringToSign with an empty-body hash', async () => {
    const sts = await tuyaStringToSign('GET', '/v1.0/token?grant_type=1', '')
    expect(sts).toBe(`GET\n${SHA256_EMPTY}\n\n/v1.0/token?grant_type=1`)
  })

  it('produces a deterministic 64-char uppercase-hex signature', async () => {
    const args = { clientId: 'cid', secret: 'sec', t: '1700000000000', method: 'GET', path: '/v1.0/token?grant_type=1' }
    const sig = await tuyaSign(args)
    expect(sig).toMatch(/^[0-9A-F]{64}$/)
    expect(await tuyaSign(args)).toBe(sig)
    // token-sign (no access token) differs from a business-sign
    expect(await tuyaSign({ ...args, accessToken: 'atk' })).not.toBe(sig)
    // sensitive to secret
    expect(await tuyaSign({ ...args, secret: 'other' })).not.toBe(sig)
  })
})

describe('tuya DP → capabilities', () => {
  it('maps a robot vacuum (sd) to OnOff + Vacuum + battery', () => {
    const { caps, codes, battery } = tuyaCapsFor([
      { code: 'power_go', value: false },
      { code: 'mode', value: 'smart' },
      { code: 'battery_percentage', value: 80 },
    ], 'sd')
    expect(findCapability(caps, 'OnOff')).toBeTruthy()
    const vac = findCapability(caps, 'Vacuum')
    expect(vac?.activity).toBe('cleaning')
    expect(codes.Vacuum).toBe('power_go')
    expect(battery).toBe(80)
  })

  it('reads chargego as returning and charging as docked (not both docked)', () => {
    const act = (s: string) => findCapability(tuyaCapsFor([{ code: 'status', value: s }], 'sd').caps, 'Vacuum')?.activity
    expect(act('chargego')).toBe('returning')
    expect(act('goto_charge')).toBe('returning')
    expect(act('charging')).toBe('docked')
    expect(act('charge_done')).toBe('docked')
    expect(act('standby')).toBe('idle')
  })

  it('maps a dimmable light (dj)', () => {
    const { caps, codes } = tuyaCapsFor([
      { code: 'switch_led', value: true },
      { code: 'bright_value_v2', value: 500 },
    ], 'dj')
    expect(findCapability(caps, 'OnOff')?.on).toBe(true)
    expect(findCapability(caps, 'Brightness')?.percent).toBe(50)
    expect(codes.OnOff).toBe('switch_led')
    expect(codes.Brightness).toBe('bright_value_v2')
  })

  it('maps a metering plug (cz)', () => {
    const { caps, codes } = tuyaCapsFor([
      { code: 'switch_1', value: true },
      { code: 'cur_power', value: 425 },
    ], 'cz')
    expect(findCapability(caps, 'OnOff')?.on).toBe(true)
    expect(findCapability(caps, 'Energy')?.watts).toBe(43) // 425 * 0.1 W
    expect(codes.OnOff).toBe('switch_1')
  })
})

describe('tuya command mapping', () => {
  it('uses the recorded DP code for OnOff', () => {
    expect(tuyaCommandFor({ deviceId: 'd', capability: 'OnOff', payload: { on: true } }, { OnOff: 'switch_1' }))
      .toEqual([{ code: 'switch_1', value: true }])
  })
  it('sends mode:chargego to return the vacuum to its dock (not the seek beep)', () => {
    expect(tuyaCommandFor({ deviceId: 'd', capability: 'Vacuum', payload: { activity: 'returning' } }, {}))
      .toEqual([{ code: 'mode', value: 'chargego' }])
  })
  it('starts the vacuum with power_go', () => {
    expect(tuyaCommandFor({ deviceId: 'd', capability: 'Vacuum', payload: { activity: 'cleaning' } }, { Vacuum: 'power_go' }))
      .toEqual([{ code: 'power_go', value: true }])
  })
})
