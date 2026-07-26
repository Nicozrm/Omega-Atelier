/**
 * simulatedTransport.ts — an in-memory Tuya Cloud, protocol-faithful enough to
 * drive the real connector end to end without credentials or network.
 *
 * It answers the exact endpoints the connector calls — token, device list,
 * device status, command POST — with Tuya's response envelope, holds mutable
 * device state so commands actually change status, and drifts sensor values so
 * polling sees live change. It ignores the signature (there is no secret to
 * verify against), which is the ONLY thing it fakes; everything else matches
 * the shape of the real API.
 */

import type { TuyaTransport, TuyaRequest, TuyaApiResponse } from './transport'
import type { TuyaDevice, TuyaStatus } from './mapping'

export interface SimulatedTuyaOptions {
  /** Optional fixed fleet; a believable default is used otherwise. */
  devices?: TuyaDevice[]
}

const DEFAULT_FLEET = (): TuyaDevice[] => [
  {
    id: 'tuya-bulb-wz', name: 'Deckenlampe Wohnzimmer', category: 'dj', online: true, room: 'Wohnzimmer',
    status: [
      { code: 'switch_led', value: true },
      { code: 'bright_value_v2', value: 720 },
      { code: 'temp_value_v2', value: 400 },
      { code: 'colour_data_v2', value: JSON.stringify({ h: 40, s: 700, v: 900 }) },
    ],
  },
  {
    id: 'tuya-plug-tv', name: 'WLAN-Steckdose TV', category: 'cz', online: true, room: 'Wohnzimmer',
    status: [{ code: 'switch_1', value: true }, { code: 'cur_power', value: 842 }],
  },
  {
    id: 'tuya-sensor-bad', name: 'Klimasensor Bad', category: 'wsdcg', online: true, room: 'Bad',
    status: [{ code: 'va_temperature', value: 224 }, { code: 'va_humidity', value: 58 }, { code: 'battery_percentage', value: 76 }],
  },
  {
    id: 'tuya-pir-flur', name: 'Bewegungsmelder Flur', category: 'pir', online: true, room: 'Flur',
    status: [{ code: 'pir', value: 'none' }, { code: 'battery_percentage', value: 91 }],
  },
  {
    id: 'tuya-robo-s8', name: 'Saug- & Wischroboter S8', category: 'sd', online: true, room: 'Wohnzimmer',
    // Real-robot data points: the live state rides on the `status` enum, start/
    // pause on `power_go`, plus the usual cleaning telemetry + battery.
    status: [
      { code: 'status', value: 'charging' },
      { code: 'power_go', value: false },
      { code: 'mode', value: 'smart' },
      { code: 'battery_percentage', value: 84 },
      { code: 'clean_area', value: 0 },
      { code: 'clean_time', value: 0 },
    ],
  },
]

const isVacuum = (d: TuyaDevice): boolean => d.category === 'sd' || d.category === 'sweeper'

export class SimulatedTuyaTransport implements TuyaTransport {
  private devices: TuyaDevice[]
  private tick = 0

  constructor(opts: SimulatedTuyaOptions = {}) {
    this.devices = (opts.devices ?? DEFAULT_FLEET()).map((d) => ({ ...d, status: (d.status ?? []).map((s) => ({ ...s })) }))
  }

  private device(id: string): TuyaDevice | undefined {
    return this.devices.find((d) => d.id === id)
  }

  /** Small believable drift so a polling connector sees live change. */
  private drift(): void {
    this.tick++
    for (const d of this.devices) {
      const s = d.status ?? []
      const temp = s.find((x) => x.code === 'va_temperature')
      if (temp) temp.value = Math.max(160, Math.min(280, (temp.value as number) + Math.round((Math.random() - 0.5) * 6)))
      const power = s.find((x) => x.code === 'cur_power')
      const on = s.find((x) => x.code === 'switch_1' || x.code === 'switch_led')
      if (power) power.value = on && on.value ? 800 + Math.round(Math.random() * 120) : 0
      const pir = s.find((x) => x.code === 'pir')
      if (pir) pir.value = Math.random() < 0.2 ? 'pir' : 'none'

      // Robot vacuum lifecycle: clean → drain → auto-return → charge → dock.
      if (isVacuum(d)) this.driftRobot(s)
    }
  }

  /** Advance one robot-vacuum tick through its cleaning/charging cycle. */
  private driftRobot(s: TuyaStatus[]): void {
    const get = (code: string) => s.find((x) => x.code === code)
    const st = get('status')
    if (!st) return
    const bat = get('battery_percentage')
    const batVal = () => (bat ? (bat.value as number) : 100)
    switch (st.value) {
      case 'cleaning': {
        const area = get('clean_area'); if (area) area.value = (area.value as number) + 2
        const time = get('clean_time'); if (time) time.value = (time.value as number) + 1
        if (bat) bat.value = Math.max(8, batVal() - 1)
        if (batVal() <= 15) st.value = 'goto_charge' // low battery → head home
        break
      }
      case 'goto_charge':
        st.value = 'charging'
        break
      case 'charging':
        if (bat) bat.value = Math.min(100, batVal() + 3)
        if (batVal() >= 100) st.value = 'charge_done'
        break
    }
  }

  async request<T = unknown>(req: TuyaRequest): Promise<TuyaApiResponse<T>> {
    const ok = <R>(result: R): TuyaApiResponse<R> => ({ success: true, result, t: Date.now() })
    const path = req.path.split('?')[0]

    // Token grant / refresh.
    if (path.startsWith('/v1.0/token')) {
      return ok({
        access_token: 'sim-access-' + this.tick,
        refresh_token: 'sim-refresh',
        expire_time: 7200,
        uid: 'sim-uid',
      }) as TuyaApiResponse<T>
    }

    // Device list (associated users / project devices).
    if (/\/v1\.0\/(users\/[^/]+\/devices|iot-01\/associated-users\/devices)$/.test(path) || path === '/v1.0/devices') {
      this.drift()
      return ok(this.devices.map((d) => ({ ...d, status: (d.status ?? []).map((s) => ({ ...s })) }))) as TuyaApiResponse<T>
    }

    // Single device status.
    const statusMatch = path.match(/\/v1\.0\/devices\/([^/]+)\/status$/)
    if (statusMatch && req.method === 'GET') {
      this.drift()
      const d = this.device(statusMatch[1])
      return ok((d?.status ?? []).map((s) => ({ ...s }))) as TuyaApiResponse<T>
    }

    // Command POST — mutate the held state so the next poll reflects it.
    const cmdMatch = path.match(/\/v1\.0\/devices\/([^/]+)\/commands$/)
    if (cmdMatch && req.method === 'POST') {
      const d = this.device(cmdMatch[1])
      if (!d) return { success: false, code: 1106, msg: 'device not found' }
      const parsed = JSON.parse(req.body ?? '{}') as { commands?: TuyaStatus[] }
      for (const c of parsed.commands ?? []) {
        const existing = (d.status ?? []).find((x) => x.code === c.code)
        if (existing) existing.value = c.value
        else (d.status ??= []).push({ ...c })
        // OnOff also drives the power reading, like a real plug.
        if ((c.code === 'switch_1' || c.code === 'switch_led')) {
          const power = (d.status ?? []).find((x) => x.code === 'cur_power')
          if (power) power.value = c.value ? 850 : 0
        }
      }
      // Robot vacuum: reflect the control DPs into the live `status` enum so the
      // next poll shows the real transition (start → cleaning, home → returning).
      if (isVacuum(d)) {
        const cmds = parsed.commands ?? []
        const setStatus = (value: string) => {
          const st = (d.status ??= []).find((x) => x.code === 'status')
          if (st) st.value = value; else d.status.push({ code: 'status', value })
        }
        const mode = cmds.find((c) => c.code === 'mode')
        const powerGo = cmds.find((c) => c.code === 'power_go')
        if (mode && mode.value === 'chargego') setStatus('goto_charge')
        else if (powerGo) setStatus(powerGo.value ? 'cleaning' : 'standby')
      }
      return ok(true) as TuyaApiResponse<T>
    }

    return { success: false, code: 1108, msg: 'unsupported path: ' + path }
  }
}
