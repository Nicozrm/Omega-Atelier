import { BlendFunction, Effect } from 'postprocessing'
import { Uniform } from 'three'

/**
 * FilmGrainEffect — sensor noise, the cheapest photorealism there is.
 *
 * Renders are *too clean*. Every real photograph carries grain, and the brain
 * reads its absence as "synthetic" long before it can name why. Adding a little
 * back does something else useful too: grain is dithering, so it breaks up the
 * banding that gradients (a sky, a wall lit by one lamp, a soft shadow) show on
 * an 8-bit display.
 *
 * Two details separate this from a generic noise overlay:
 *
 *  - **Luminance weighting.** Film grain lives in the midtones. Deep shadows
 *    hold almost none and highlights bleach it out, so the amount is shaped by
 *    a curve that peaks around mid grey. Flat noise over the whole frame reads
 *    as video interference instead.
 *  - **Monochrome.** Colour noise is a digital-sensor artefact and looks like a
 *    fault; silver-halide grain is achromatic. Applying one value to all three
 *    channels keeps it as texture rather than confetti.
 *  - **Sized in screen space, not buffer space.** Grain is a property of the
 *    *print*, not of the renderer: a 35 mm frame does not grow finer grain
 *    because it was scanned at a higher resolution. Sampling the hash once per
 *    buffer pixel — the obvious implementation — does exactly that, so the top
 *    profile at 2.25× supersampling ended up with grain more than twice as fine
 *    as the bottom one, which is the difference between "film" and "the sensor
 *    is struggling". `pixelScale` divides it back out.
 */

const FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uTime;
  uniform float uPixelScale;

  // Cheap high-frequency hash. The time term is added *after* quantisation so
  // the pattern is re-drawn every frame — static grain reads as a dirty lens —
  // while the cells themselves stay put within a frame.
  float grainHash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p.xy, p.yx + 19.19);
    return fract(p.x * p.y) * 2.0 - 1.0;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Peaks at mid grey, falls off toward both rails: 4·l·(1−l) is the classic
    // shape, softened with a sqrt so the shadows keep a little texture.
    float response = sqrt(clamp(4.0 * l * (1.0 - l), 0.0, 1.0));

    // floor() is what turns the hash into actual grains: without it, dividing
    // the coordinate down would just sample a chaotic function at a finer step
    // and every buffer pixel would still get its own value — the cell size
    // would change nothing at all.
    vec2 cell = floor(uv * resolution.xy / max(uPixelScale, 1e-3));
    float g = grainHash(cell + vec2(uTime * 71.3, uTime * 37.7));
    outputColor = vec4(inputColor.rgb + g * uIntensity * response, inputColor.a);
  }
`

export interface FilmGrainEffectOptions {
  /** Amplitude in output units. 0.02–0.03 is "35 mm at ISO 400". */
  intensity?: number
  /**
   * Grain cell size in buffer pixels. Set to the live render DPR times the
   * desired size in CSS pixels, so the grain keeps a constant *perceived*
   * size as the adaptive resolution ramps.
   */
  pixelScale?: number
}

export class FilmGrainEffect extends Effect {
  constructor({ intensity = 0.024, pixelScale = 1.5 }: FilmGrainEffectOptions = {}) {
    super('FilmGrainEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uIntensity', new Uniform(intensity)],
        ['uTime', new Uniform(0)],
        ['uPixelScale', new Uniform(pixelScale)],
      ]),
    })
  }

  get intensity(): number {
    return this.uniforms.get('uIntensity')!.value as number
  }

  set intensity(v: number) {
    this.uniforms.get('uIntensity')!.value = v
  }

  get pixelScale(): number {
    return this.uniforms.get('uPixelScale')!.value as number
  }

  set pixelScale(v: number) {
    this.uniforms.get('uPixelScale')!.value = v
  }

  /** Called by the composer once per frame. */
  update(_renderer: unknown, _inputBuffer: unknown, deltaTime = 0.016): void {
    const t = this.uniforms.get('uTime')!
    // Wrap well before float precision degrades in the hash.
    t.value = ((t.value as number) + deltaTime) % 1000
  }
}
