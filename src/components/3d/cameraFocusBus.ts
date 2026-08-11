import * as THREE from 'three'

/**
 * Shared camera-focus channel: the CinematicDirector writes where the story
 * looks and how hard to pull focus; the depth-of-field driver in `PostFX` reads
 * it each frame. A plain mutable object — no React state at 60 fps.
 *
 * It lives in its own module because both the scene (writer) and the post stack
 * (reader) need it, and neither should have to import the other.
 */
export const cameraFocus = {
  point: new THREE.Vector3(0, 1, 0),
  /** 0 = ambient depth … 1 = full cinematic focus pull (mid-glide). */
  pull: 0,
}
