/**
 * R3F v8 JSX augmentation.
 *
 * react-three-fiber renders three.js objects through lowercase intrinsic
 * JSX elements (`<mesh>`, `<meshStandardMaterial>`, …). Under TS strict
 * mode these are not part of React's built-in `JSX.IntrinsicElements`, so
 * we extend the namespace with R3F's `ThreeElements`. This replaces the
 * previous file-wide `@ts-nocheck` in ThreeDView with proper typing.
 */
import type { ThreeElements } from '@react-three/fiber'

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
