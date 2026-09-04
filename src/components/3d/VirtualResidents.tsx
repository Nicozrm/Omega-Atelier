/**
 * Virtual residents — a subtle, high-quality occupancy simulation for the
 * Digital-Twin 3D view. NOT game characters: minimalist matte figures that walk
 * an automatic daily routine through the flat and let the smart home react
 * around them (doors open, room lights switch on, motion sensors pulse, the TV
 * glows, the coffee machine steams, the blinds roll). Everything is built
 * imperatively with three.js and driven from a single throttled frame loop, so
 * it stays cheap and never touches the plan document.
 *
 * Route (looping, retraced on the way back so nobody walks through walls):
 *   Schlafzimmer → Bad → Küche → Wohnen → Terrasse → … → Schlafzimmer
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Floor, Point } from '@/types'
import { DEVICES } from '@/data/devices'
import { RESIDENT_DOORS, clearResidentDoors } from './residentsBus'
import { loadPeopleGltf, getPeopleGltf } from './peopleLoader'
import { instantiatePersonFromGltf } from './PeopleModel'

const M = (cm: number) => cm / 100
const CAT = new Map(DEVICES.map((d) => [d.id, d.category] as const))

/** Soft round contact shadow — grounds each figure like the archviz reference
 *  (objects never float). Built once, shared across all residents. */
let _shadowTex: THREE.CanvasTexture | null = null
function shadowTexture(): THREE.CanvasTexture {
  if (_shadowTex) return _shadowTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31)
  grad.addColorStop(0, 'rgba(0,0,0,0.42)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.16)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  _shadowTex = new THREE.CanvasTexture(c)
  return _shadowTex
}

type Station = 'bedroom' | 'bath' | 'kitchen' | 'living' | 'terrace'
type Activity = 'sleep' | 'shower' | 'coffee' | 'cook' | 'eat' | 'tv' | 'work' | 'terrace'

const STATION_ORDER: Station[] = ['bedroom', 'bath', 'kitchen', 'living', 'terrace']

/** Rotating activities per station (varies lap to lap, so a resident cooks one
 *  round and makes coffee the next, watches TV then works, etc.). */
const STATION_ACTIVITIES: Record<Station, Activity[]> = {
  bedroom: ['sleep'],
  bath: ['shower'],
  kitchen: ['coffee', 'cook'],
  living: ['tv', 'eat', 'work'],
  terrace: ['terrace'],
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  sleep: 'Schlafen', shower: 'Duschen', coffee: 'Kaffee', cook: 'Kochen',
  eat: 'Essen', tv: 'Fernsehen', work: 'Arbeiten', terrace: 'Terrasse',
}
const STATION_LABEL: Record<Station, string> = {
  bedroom: 'Schlafzimmer', bath: 'Bad', kitchen: 'Küche', living: 'Wohnen', terrace: 'Terrasse',
}
/** The smart-home scene each activity would trigger — shown discreetly in the HUD. */
const ACTIVITY_SCENE: Partial<Record<Activity, string>> = {
  sleep: 'Nacht', coffee: 'Morgen', tv: 'Film', work: 'Tag / Büro', terrace: 'Entspannung',
}
const DWELL: Record<Activity, number> = {
  sleep: 7, shower: 5, coffee: 5, cook: 5, eat: 5, tv: 8, work: 7, terrace: 6,
}

export interface ResidentStatus { room: string; activity: string; scene?: string }

function classify(name: string, outdoor: boolean): Station | null {
  const n = name.toLowerCase()
  if (outdoor || /terrass|balkon|garten|patio|terrace|loggia/.test(n)) return 'terrace'
  if (/schlaf|bedroom|bett/.test(n)) return 'bedroom'
  if (/bad|bath|dusch|wc|sanitär/.test(n)) return 'bath'
  if (/küche|kueche|kitchen|koch/.test(n)) return 'kitchen'
  if (/wohn|living|essen|lounge|salon|stube/.test(n)) return 'living'
  return null
}

function centroid(poly: Point[]): { x: number; y: number } {
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

interface WP { p: THREE.Vector3; dwell: number; activity?: Activity; station?: Station; roomId?: string }
interface StationInfo { station: Station; roomId: string; c: { x: number; y: number } }

interface ResidentRT {
  group: THREE.Group
  body: THREE.Group
  legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D
  shadow: THREE.Mesh
  pos: THREE.Vector3
  from: THREE.Vector3
  toX: number; toZ: number
  wp: number
  mode: 'dwell' | 'walk'
  timer: number
  yaw: number
  yawT: number
  stride: number
  lap: number
  activity: Activity
  roomId: string
  prevRoomId: string
  lane: number
}

interface Built {
  root: THREE.Group
  update: (dt: number, ctx: { night: boolean; onStatus?: (s: ResidentStatus) => void }) => void
  dispose: () => void
}

/** Build a minimalist yet sculptural standing figure: tapered legs with feet,
 *  a waist→chest torso, soft shoulders, a slim neck and a slightly ovoid head.
 *  Head/torso/arms live under `body` so the upper form bobs without lifting the
 *  feet. A unit sphere (`ball`) is scaled per part so all masses share one
 *  smooth geometry. */
function makePerson(mat: THREE.Material, geo: {
  leg: THREE.BufferGeometry; torso: THREE.BufferGeometry; arm: THREE.BufferGeometry
  neck: THREE.BufferGeometry; ball: THREE.BufferGeometry
}) {
  const group = new THREE.Group()
  const legL = new THREE.Mesh(geo.leg, mat); legL.castShadow = true; legL.position.set(-0.093, 0.36, 0)
  const legR = new THREE.Mesh(geo.leg, mat); legR.castShadow = true; legR.position.set(0.093, 0.36, 0)
  const footL = new THREE.Mesh(geo.ball, mat); footL.position.set(-0.093, 0.035, 0.05); footL.scale.set(0.068, 0.045, 0.12)
  const footR = new THREE.Mesh(geo.ball, mat); footR.position.set(0.093, 0.035, 0.05); footR.scale.set(0.068, 0.045, 0.12)
  const hip = new THREE.Mesh(geo.ball, mat); hip.position.y = 0.78; hip.scale.set(0.145, 0.12, 0.125)
  group.add(legL, legR, footL, footR, hip)

  const body = new THREE.Group(); body.position.y = 0
  const torso = new THREE.Mesh(geo.torso, mat); torso.castShadow = true; torso.position.y = 1.0
  const chest = new THREE.Mesh(geo.ball, mat); chest.castShadow = true; chest.position.y = 1.17; chest.scale.set(0.16, 0.15, 0.125)
  const shoulders = new THREE.Mesh(geo.ball, mat); shoulders.castShadow = true; shoulders.position.y = 1.3; shoulders.scale.set(0.205, 0.1, 0.13)
  const armL = new THREE.Mesh(geo.arm, mat); armL.castShadow = true; armL.position.set(-0.195, 1.12, 0); armL.rotation.z = 0.09
  const armR = new THREE.Mesh(geo.arm, mat); armR.castShadow = true; armR.position.set(0.195, 1.12, 0); armR.rotation.z = -0.09
  const neck = new THREE.Mesh(geo.neck, mat); neck.position.y = 1.42
  const head = new THREE.Mesh(geo.ball, mat); head.castShadow = true; head.position.y = 1.55; head.scale.set(0.1, 0.112, 0.1)
  body.add(torso, chest, shoulders, armL, armR, neck, head)
  group.add(body)
  return { group, body, legL, legR, armL, armR }
}

function buildResidents(floor: Floor, count: number): Built | null {
  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(o: T): T => { disposables.push(o); return o }

  // ── Stations ──────────────────────────────────────────────────────────
  const seen = new Map<Station, StationInfo>()
  for (const r of floor.rooms) {
    if (r.polygon.length < 3) continue
    const s = classify(r.name, (r.zoneType ?? 'indoor') === 'outdoor')
    if (s && !seen.has(s)) seen.set(s, { station: s, roomId: r.id, c: centroid(r.polygon) })
  }
  const stations: StationInfo[] = STATION_ORDER.map((s) => seen.get(s)).filter((x): x is StationInfo => !!x)
  if (stations.length < 2) return null

  const stationPos = (s: StationInfo) => new THREE.Vector3(M(s.c.x), 0, M(s.c.y))
  const nearestRoomId = (p: THREE.Vector3): string => {
    let best = stations[0].roomId, bd = Infinity
    for (const s of stations) {
      const d = (M(s.c.x) - p.x) ** 2 + (M(s.c.y) - p.z) ** 2
      if (d < bd) { bd = d; best = s.roomId }
    }
    return best
  }

  // ── Route: forward with dwells, then retrace the middle stations without
  //    dwelling so the return trip stays inside the flat. Loops. ──────────
  const route: WP[] = []
  for (const s of stations) {
    const acts = STATION_ACTIVITIES[s.station]
    // activity/dwell get re-picked per lap at runtime; seed with the first.
    route.push({ p: stationPos(s), dwell: DWELL[acts[0]], station: s.station, roomId: s.roomId, activity: acts[0] })
  }
  for (let i = stations.length - 2; i >= 1; i--) {
    route.push({ p: stationPos(stations[i]), dwell: 0, roomId: stations[i].roomId })
  }

  const root = new THREE.Group()

  // ── Residents ────────────────────────────────────────────────────────
  const n = Math.max(1, Math.min(3, count))
  // Elegant, desaturated designer-figurine tones (warm alabaster / cool stone).
  const tints = ['#c7bfb1', '#8b9096', '#a99f8e']
  const personGeo = {
    leg: track(new THREE.CapsuleGeometry(0.07, 0.52, 6, 14)),
    torso: track(new THREE.CapsuleGeometry(0.125, 0.34, 8, 20)),
    arm: track(new THREE.CapsuleGeometry(0.044, 0.46, 5, 12)),
    neck: track(new THREE.CylinderGeometry(0.043, 0.052, 0.1, 14)),
    ball: track(new THREE.SphereGeometry(1, 24, 18)),
  }
  const shadowTex = shadowTexture()
  const residents: ResidentRT[] = []
  const peopleGltf = getPeopleGltf()

  for (let i = 0; i < n; i++) {
    const mat = track(new THREE.MeshStandardMaterial({ color: tints[i % tints.length], roughness: 0.52, metalness: 0.0, envMapIntensity: 0.7 }))
    const rig = makePerson(mat, personGeo)
    root.add(rig.group)

    // If a people GLB is loaded, clone and attach it as a visual overlay so
    // the procedural rig still drives the gait while the GLB provides quality.
    if (peopleGltf) {
      try {
        const gl = instantiatePersonFromGltf(peopleGltf)
        // scale down a bit to match the procedural unit; authors differ
        gl.scale.setScalar(0.9)
        gl.position.set(0, 0, 0)
        rig.group.add(gl)
      } catch (e) {
        // ignore cloning errors — fall back to procedural only
        console.warn('Failed to attach people GLB', e)
      }
    }

    // Soft contact shadow that follows the figure.
    const shMat = track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.85, depthWrite: false }))
    const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(0.72, 0.72)), shMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.renderOrder = 1
    root.add(shadow)
    // Space residents out around the loop so they occupy different rooms.
    const startWp = Math.floor((route.length / n) * i)
    const first = route[startWp]
    const pos = first.p.clone()
    residents.push({
      ...rig, shadow, pos, from: pos.clone(), toX: pos.x, toZ: pos.z, wp: startWp,
      mode: first.dwell > 0 ? 'dwell' : 'walk',
      timer: first.dwell > 0 ? 1 + i * 1.5 : 0, yaw: 0, yawT: 0, stride: 0, lap: i,
      activity: first.activity ?? 'sleep', roomId: first.roomId ?? stations[0].roomId,
      prevRoomId: '', lane: (i - (n - 1) / 2) * 0.34,
    })
    rig.group.position.copy(pos)
  }

  // ── Occupancy lights — one warm luminaire per station room, ramped by use.
  const occ = stations.map((s) => {
    const light = new THREE.PointLight('#ffd9a6', 0, 6.5, 1.9)
    light.position.set(M(s.c.x), M(235), M(s.c.y))
    root.add(light)
    return { roomId: s.roomId, light, cur: 0 }
  })

  // ── Motion-sensor pulse rings ────────────────────────────────────────
  const ringGeo = track(new THREE.RingGeometry(0.28, 0.4, 28))
  const sensors = floor.devices
    .filter((d) => CAT.get(d.deviceId) === 'sensor' && d.roomId)
    .slice(0, 10)
    .map((d) => {
      const mat = track(new THREE.MeshBasicMaterial({ color: '#7fe3c0', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
      const mesh = new THREE.Mesh(ringGeo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(M(d.position.x), 0.03, M(d.position.y))
      mesh.renderOrder = 3
      root.add(mesh)
      return { roomId: d.roomId as string, mat, mesh, t: 0 }
    })

  // ── Television glow (living-room TV) ─────────────────────────────────
  const livingId = seen.get('living')?.roomId
  const tvDev = floor.devices.find((d) => CAT.get(d.deviceId) === 'tv' && (!livingId || d.roomId === livingId))
    ?? floor.devices.find((d) => CAT.get(d.deviceId) === 'tv')
  let tv: { panel: THREE.Mesh; mat: THREE.MeshStandardMaterial; light: THREE.PointLight; cur: number } | null = null
  if (tvDev) {
    const mat = track(new THREE.MeshStandardMaterial({ color: '#0a0c12', emissive: '#8fb3ff', emissiveIntensity: 0, roughness: 0.4, toneMapped: false }))
    const panel = new THREE.Mesh(track(new THREE.PlaneGeometry(0.9, 0.52)), mat)
    panel.position.set(M(tvDev.position.x), 0.85, M(tvDev.position.y))
    const light = new THREE.PointLight('#9fc0ff', 0, 4.2, 2.0)
    light.position.set(M(tvDev.position.x), 1.0, M(tvDev.position.y))
    root.add(panel, light)
    tv = { panel, mat, light, cur: 0 }
  }

  // ── Coffee machine — warm glow + rising steam (kitchen) ──────────────
  const kitchenId = seen.get('kitchen')?.roomId
  const coffeeDev = floor.devices.find((d) => /kaffee|coffee/i.test(d.note ?? '') && (!kitchenId || d.roomId === kitchenId))
    ?? floor.devices.find((d) => /kaffee|coffee/i.test(d.note ?? ''))
  let coffee: { group: THREE.Group; puffs: THREE.Mesh[]; mats: THREE.MeshStandardMaterial[]; glow: THREE.PointLight; cur: number } | null = null
  if (coffeeDev) {
    const group = new THREE.Group()
    group.position.set(M(coffeeDev.position.x), 0.92, M(coffeeDev.position.y))
    const puffGeo = track(new THREE.SphereGeometry(0.035, 8, 8))
    const puffs: THREE.Mesh[] = []
    const mats: THREE.MeshStandardMaterial[] = []
    for (let i = 0; i < 4; i++) {
      const mat = track(new THREE.MeshStandardMaterial({ color: '#e8e6e2', transparent: true, opacity: 0, roughness: 1, depthWrite: false }))
      const m = new THREE.Mesh(puffGeo, mat)
      mats.push(mat); puffs.push(m); group.add(m)
    }
    const glow = new THREE.PointLight('#ffb066', 0, 1.3, 2.2)
    glow.position.y = -0.1
    group.add(glow)
    root.add(group)
    coffee = { group, puffs, mats, glow, cur: 0 }
  }

  // ── Roller blinds on the windows of bedroom / living / terrace ───────
  const blindRoomIds = new Set([seen.get('bedroom')?.roomId, seen.get('living')?.roomId, seen.get('terrace')?.roomId].filter(Boolean) as string[])
  const blindMat = track(new THREE.MeshStandardMaterial({ color: '#d9cfbe', roughness: 0.9, metalness: 0, transparent: true, opacity: 0.97, side: THREE.DoubleSide }))
  const blindBox = track(new THREE.BoxGeometry(1, 1, 0.02))
  const blinds: Array<{ mesh: THREE.Mesh; top: number; drop: number }> = []
  for (const w of floor.walls) {
    if (w.subtype !== 'window') continue
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
    // Which station room is this window nearest to?
    let near: string | undefined, nd = Infinity
    for (const s of stations) {
      const d = (s.c.x - mid.x) ** 2 + (s.c.y - mid.y) ** 2
      if (d < nd) { nd = d; near = s.roomId }
    }
    if (!near || !blindRoomIds.has(near)) continue
    const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x)
    const ow = Math.min(w.openingWidth ?? 120, Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) - 20)
    const opH = M(w.openingHeight ?? 100)
    const top = M(w.openingSill ?? 90) + opH
    const drop = opH * 0.96
    const mesh = new THREE.Mesh(blindBox, blindMat)
    mesh.scale.set(M(ow) * 0.94, 0.001, 1)
    mesh.position.set(M(mid.x), top, M(mid.y))
    mesh.rotation.y = -ang
    root.add(mesh)
    blinds.push({ mesh, top, drop })
    if (blinds.length >= 4) break
  }

  // ── Frame state ──────────────────────────────────────────────────────
  let clock = 0
  let lastStatus = ''

  const pickActivity = (station: Station, lap: number): Activity => {
    const acts = STATION_ACTIVITIES[station]
    return acts[((lap % acts.length) + acts.length) % acts.length]
  }
  const setupWalk = (r: ResidentRT) => {
    r.from.copy(r.pos)
    const w = route[r.wp]
    r.mode = 'walk'
    // apply a small lateral lane offset so two residents don't overlap
    r.toX = w.p.x + r.lane
    r.toZ = w.p.z + r.lane * 0.4
  }
  const rts = residents

  const SPEED = 0.82

  const update: Built['update'] = (dt, ctx) => {
    clock += dt
    const occupied = new Set<string>()
    let sleeping = false
    let tvOn = false
    let coffeeOn = false

    for (const r of rts) {
      if (r.mode === 'dwell') {
        r.timer -= dt
        r.stride *= Math.max(0, 1 - dt * 4)
        if (r.timer <= 0) { r.wp = (r.wp + 1) % route.length; setupWalk(r) }
      } else {
        const dx = r.toX - r.pos.x, dz = r.toZ - r.pos.z
        const dist = Math.hypot(dx, dz)
        if (dist > 1e-3) {
          r.yawT = Math.atan2(dx, dz)
          const step = Math.min(dist, SPEED * dt)
          r.pos.x += (dx / dist) * step
          r.pos.z += (dz / dist) * step
          r.stride += step * 3.4
        }
        if (dist <= 0.06) {
          const w = route[r.wp]
          r.roomId = w.roomId ?? nearestRoomId(r.pos)
          if (w.dwell > 0 && w.station) {
            if (w.station === 'bedroom') r.lap++
            r.activity = pickActivity(w.station, r.lap)
            r.timer = DWELL[r.activity]
            r.mode = 'dwell'
          } else {
            r.wp = (r.wp + 1) % route.length
            setupWalk(r)
          }
        }
      }

      // Occupancy + activity aggregation
      const walkingRoom = r.mode === 'walk' ? nearestRoomId(r.pos) : r.roomId
      occupied.add(walkingRoom)
      if (r.mode === 'dwell') {
        if (r.activity === 'sleep') sleeping = true
        if (r.activity === 'tv') tvOn = true
        if (r.activity === 'coffee') coffeeOn = true
      }
      // Motion sensor: fire on room entry
      if (walkingRoom !== r.prevRoomId) {
        for (const s of sensors) if (s.roomId === walkingRoom) s.t = 1.15
        r.prevRoomId = walkingRoom
      }

      // Ease yaw and apply the rig transform + gait
      let dy = r.yawT - r.yaw
      while (dy > Math.PI) dy -= Math.PI * 2
      while (dy < -Math.PI) dy += Math.PI * 2
      r.yaw += dy * Math.min(1, dt * 8)
      r.group.position.set(r.pos.x, 0, r.pos.z)
      r.group.rotation.y = r.yaw
      r.shadow.position.set(r.pos.x, 0.02, r.pos.z)
      const sw = Math.sin(r.stride)
      const active = r.mode === 'walk' ? 1 : Math.max(0, 1 - (DWELL[r.activity] - r.timer))
      r.legL.rotation.x = sw * 0.44 * active
      r.legR.rotation.x = -sw * 0.44 * active
      r.armL.rotation.x = -sw * 0.32 * active
      r.armR.rotation.x = sw * 0.32 * active
      r.body.position.y = Math.abs(Math.sin(r.stride)) * 0.016 * active + Math.sin(clock * 1.5 + r.lane) * 0.0035
    }

    // Occupancy lights
    const base = ctx.night ? 2.6 : 1.5
    for (const o of occ) {
      const tgt = occupied.has(o.roomId) ? 1 : 0
      o.cur += (tgt - o.cur) * Math.min(1, dt * 3)
      o.light.intensity = o.cur * base
    }
    // Motion rings
    for (const s of sensors) {
      if (s.t > 0) {
        s.t = Math.max(0, s.t - dt)
        const k = 1 - s.t / 1.15
        s.mesh.scale.setScalar(0.5 + k * 2.2)
        s.mat.opacity = Math.max(0, 0.5 * (1 - k))
      } else if (s.mat.opacity !== 0) {
        s.mat.opacity = 0
      }
    }
    // TV
    if (tv) {
      tv.cur += ((tvOn ? 1 : 0) - tv.cur) * Math.min(1, dt * 3)
      const flick = 1 + Math.sin(clock * 13) * 0.18 + Math.sin(clock * 6.3) * 0.12
      tv.mat.emissiveIntensity = tv.cur * 2.4 * flick
      tv.light.intensity = tv.cur * 1.7 * flick
    }
    // Coffee
    if (coffee) {
      coffee.cur += ((coffeeOn ? 1 : 0) - coffee.cur) * Math.min(1, dt * 2.5)
      coffee.glow.intensity = coffee.cur * 0.9
      coffee.puffs.forEach((m, i) => {
        const ph = (clock * 0.5 + i * 0.28) % 1
        m.position.set(Math.sin(clock * 1.3 + i) * 0.03, ph * 0.5, Math.cos(clock + i) * 0.03)
        m.scale.setScalar(0.6 + ph * 1.4)
        coffee!.mats[i].opacity = coffee!.cur * Math.max(0, 0.5 * (1 - ph))
      })
    }
    // Blinds — lower when someone is sleeping (else raised).
    const bt = sleeping ? 1 : 0
    for (const b of blinds) {
      const cur = (b.mesh.scale.y = b.mesh.scale.y + (bt - b.mesh.scale.y) * Math.min(1, dt * 2))
      const h = cur * b.drop
      b.mesh.position.y = b.top - h / 2
      b.mesh.visible = cur > 0.01
    }

    // Doors — proximity of any resident to any door opening.
    for (const w of floor.walls) {
      if (w.subtype !== 'door') continue
      const mx = M((w.a.x + w.b.x) / 2), mz = M((w.a.y + w.b.y) / 2)
      let open = 0
      for (const r of rts) {
        const d = Math.hypot(r.pos.x - mx, r.pos.z - mz)
        if (d < 1.25) { open = Math.max(open, 1 - d / 1.25); if (open >= 1) break }
      }
      RESIDENT_DOORS.set(w.id, Math.min(1, open * 1.4))
    }

    // HUD status from the lead resident — only pushed on change (never per frame).
    if (ctx.onStatus) {
      const r = rts[0]
      const room = STATION_LABEL[(STATION_ORDER.find((s) => seen.get(s)?.roomId === r.roomId)) ?? 'living']
      const activity = r.mode === 'walk' ? 'Unterwegs' : ACTIVITY_LABEL[r.activity]
      const key = room + '|' + activity
      if (key !== lastStatus) {
        lastStatus = key
        ctx.onStatus({ room, activity, scene: r.mode === 'walk' ? undefined : ACTIVITY_SCENE[r.activity] })
      }
    }
  }

  const dispose = () => {
    for (const d of disposables) d.dispose()
    clearResidentDoors()
  }

  return { root, update, dispose }
}

export function VirtualResidents({ floor, count, night, onStatus }: {
  floor: Floor; count: number; night: boolean; onStatus?: (s: ResidentStatus) => void
}) {
  const ctxRef = useRef({ night, onStatus })
  ctxRef.current = { night, onStatus }

  const built = useMemo(() => (count > 0 ? buildResidents(floor, count) : null), [floor, count])

  useFrame((_, dt) => { built?.update(Math.min(dt, 0.05), ctxRef.current) })

  useEffect(() => () => built?.dispose(), [built])

  if (!built) return null
  return <primitive object={built.root} />
}
