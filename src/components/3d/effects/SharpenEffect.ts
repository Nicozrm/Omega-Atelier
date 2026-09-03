import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

/**
 * SharpenEffect — contrast-adaptive sharpening, the last step of the pipeline.
 *
 * Two things upstream soften the image and both are deliberate: supersampling
 * (rendering above the display resolution, then downscaling) and SMAA. That
 * softness is the price of clean edges — and it is exactly what a *camera*
 * would not have. Photographs are sharp at the pixel level.
 *
 * A plain unsharp mask would undo it at the cost of white halos around every
 * high-contrast edge (the classic over-sharpened look). This is AMD's CAS idea
 * instead: measure how much local contrast a pixel *already* has, and sharpen
 * in inverse proportion. Flat regions — walls, floors, sky — get the full
 * amount, where it reads as detail. Edges that are already at the limit get
 * almost none, so no ringing appears.
 *
 * Five taps, no branches, no extra render target.
 */

const FRAGMENT = /* glsl */ `
  uniform float uSharpness;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;

    // Cross-pattern neighbours (the CAS kernel — corners add cost, not quality).
    vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
    vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
    vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
    vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;

    // Local headroom: how far the neighbourhood sits from both black and white.
    // Where a pixel is already near either rail, amp → 0 and sharpening stops,
    // which is precisely where halos would otherwise form.
    vec3 mn = min(min(min(n, s), min(w, e)), c);
    vec3 mx = max(max(max(n, s), max(w, e)), c);
    vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
    amp = sqrt(amp);

    vec3 blur = (n + s + w + e) * 0.25;
    vec3 sharpened = c + (c - blur) * uSharpness * amp;

    outputColor = vec4(clamp(sharpened, 0.0, 1.0), inputColor.a);
  }
`

export interface SharpenEffectOptions {
  /** 0 = off, ~0.3–0.5 pairs well with supersampled input. */
  sharpness?: number
}

export class SharpenEffect extends Effect {
  constructor({ sharpness = 0.35 }: SharpenEffectOptions = {}) {
    super('SharpenEffect', FRAGMENT, {
      // Declared as a convolution so the composer gives it its own pass. Without
      // that it would be merged into the shader of whatever sits beside it and
      // its neighbour taps would read the *pre*-chain buffer — sharpening an
      // image nobody ends up seeing.
      attributes: EffectAttribute.CONVOLUTION,
      // NORMAL, not the Effect default of SCREEN: this *replaces* the pixel with
      // its sharpened version rather than adding a second copy on top of it.
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uSharpness', new Uniform(sharpness)]]),
    })
  }

  get sharpness(): number {
    return this.uniforms.get('uSharpness')!.value as number
  }

  set sharpness(v: number) {
    this.uniforms.get('uSharpness')!.value = v
  }
}
