/**
 * solar.ts — physical solar geometry.
 *
 * Where the sun is in the sky for a given time, date, latitude and building
 * orientation. Pure numbers (degrees + a unit direction vector); no THREE types,
 * no rendering concerns, no React.
 *
 * This is a *reusable primitive* of the environment domain. The same azimuth /
 * elevation / direction feeds scene lighting today and — unchanged — solar-yield,
 * shading and window-light analyses later. It is intentionally **not** consumed
 * by renderers directly (they consume `deriveEnvironment`); it is a building
 * block of that domain.
 *
 * Accuracy: a standard simplified-NOAA model (seasonal declination + hour
 * angle). Local clock time is treated as solar time — longitude and
 * equation-of-time corrections are deliberately omitted ("physically sensible",
 * not ephemeris-exact). The shape is ready for those corrections to be added in
 * exactly one place.
 */

const DEG = Math.PI / 180

export interface SolarInput {
  /** Hour of day, 0…24 (local clock ≈ solar time). */
  hour: number
  /** Day of the year, 1…365 (drives seasonal declination). */
  dayOfYear: number
  /** Observer latitude in degrees (+N / −S). */
  latitudeDeg: number
  /**
   * Building orientation: degrees the plan is rotated clockwise relative to true
   * compass. Applied to the resulting azimuth so the sun is expressed in plan
   * space (reused later for window light / facade shading).
   */
  orientationDeg: number
}

export interface SolarPosition {
  /**
   * Azimuth in plan space, degrees: 0 = plan-north, 90 = plan-east,
   * 180 = plan-south, 270 = plan-west.
   */
  azimuth: number
  /** Elevation above the horizon, degrees (negative = below → night). */
  elevation: number
  /** True when the sun is above the horizon. */
  aboveHorizon: boolean
  /**
   * Unit vector pointing FROM the scene TOWARD the sun, in a right-handed Y-up
   * frame aligned to the plan: +X = plan-east, +Y = up, +Z = plan-south.
   * Renderers scale this by a distance — no trigonometry downstream.
   */
  direction: { x: number; y: number; z: number }
}

/** Calendar month (1–12) + day (1–31) → day-of-year (1–365). */
export function dayOfYear(month: number, day: number): number {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const m = Math.min(12, Math.max(1, Math.round(month)))
  const d = Math.min(31, Math.max(1, Math.round(day)))
  return cum[m - 1] + d
}

/** Solar declination in degrees for a day of year. */
export function solarDeclination(doy: number): number {
  return 23.45 * Math.sin(DEG * ((360 * (284 + doy)) / 365))
}

/** Compute the sun's position for the given conditions. */
export function solarPosition(input: SolarInput): SolarPosition {
  const lat = input.latitudeDeg * DEG
  const decl = solarDeclination(input.dayOfYear) * DEG
  // Hour angle: 0 at solar noon, +15°/h in the afternoon.
  const hourAngle = (input.hour - 12) * 15 * DEG

  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)))

  // Azimuth from true south, positive toward west.
  const azSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  )
  // South-referenced (+W) → compass (0 = N, clockwise) → plan space.
  let azimuthDeg = (180 + azSouth / DEG + input.orientationDeg) % 360
  if (azimuthDeg < 0) azimuthDeg += 360

  const elevationDeg = elevation / DEG
  const a = azimuthDeg * DEG
  const cosE = Math.cos(elevation)
  // north (az 0) → −Z ; east (az 90) → +X ; south (az 180) → +Z.
  const direction = {
    x: cosE * Math.sin(a),
    y: Math.sin(elevation),
    z: -cosE * Math.cos(a),
  }

  return {
    azimuth: azimuthDeg,
    elevation: elevationDeg,
    aboveHorizon: elevationDeg > 0,
    direction,
  }
}
