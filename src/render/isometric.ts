/**
 * Isometric projection helpers (VROL-191).
 *
 * Vrolen renders the factory floor in 2.5D using the classic 2:1 isometric
 * grid (tile width 64, height 32). All sprite placement, click hit-testing,
 * and camera math route through worldToScreen / screenToWorld so the rest
 * of the codebase can think in tile coordinates and stay zoom-agnostic.
 *
 * Conventions:
 *   • World coords (x, y) are FLOAT TILE INDICES. (0, 0) is the back corner;
 *     +x walks toward the right wall, +y walks toward the front wall.
 *   • Screen coords (sx, sy) are PIXELS in the canvas, AFTER camera + zoom
 *     have been applied. (0, 0) is the canvas top-left.
 *   • z is an optional vertical (stack) offset in tile-heights. Used by
 *     depth-sort so a worker on top of a conveyor draws over it.
 *   • Camera: pan = pixel offset added after projection; zoom multiplies
 *     the tile size uniformly.
 *
 * Pure functions, no side effects, trivially testable. The render worker
 * uses them via `worldToScreen` per frame; click handlers on the main
 * thread use `screenToWorld` to know which tile the user picked.
 */

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export interface Camera {
  /** Camera pan in pixels, applied after projection. */
  readonly x: number;
  readonly y: number;
  /** Linear zoom. 1 = native tile size, 2 = doubled, etc. */
  readonly zoom: number;
}

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  /** Optional stack height in tile-heights. Defaults to 0. */
  readonly z?: number;
}

/**
 * Project a world point to screen space using the active camera.
 *
 * The math:
 *   sx = (x - y) * (tileWidth/2) * zoom + cameraX
 *   sy = (x + y) * (tileHeight/2) * zoom - z * tileHeight * zoom + cameraY
 *
 * The z term subtracts because "up" on the screen is -y.
 */
export function worldToScreen(world: WorldPoint, camera: Camera = IDENTITY_CAMERA): ScreenPoint {
  const z = world.z ?? 0;
  const halfW = (TILE_WIDTH / 2) * camera.zoom;
  const halfH = (TILE_HEIGHT / 2) * camera.zoom;
  const sx = (world.x - world.y) * halfW + camera.x;
  const sy = (world.x + world.y) * halfH - z * TILE_HEIGHT * camera.zoom + camera.y;
  return { sx, sy };
}

/**
 * Inverse of worldToScreen for z=0. Reports the world (x, y) at the floor
 * plane under the given screen point. Use this for click-to-pick on the
 * floor; pick-against-stacked-sprites needs hit-testing in render space.
 *
 * Derivation: from the forward equations with z=0, we have a 2x2 linear
 * system in (x, y) that inverts to:
 *
 *   x = ((sx - camX) / halfW + (sy - camY) / halfH) / 2
 *   y = ((sy - camY) / halfH - (sx - camX) / halfW) / 2
 */
export function screenToWorld(screen: ScreenPoint, camera: Camera = IDENTITY_CAMERA): WorldPoint {
  const halfW = (TILE_WIDTH / 2) * camera.zoom;
  const halfH = (TILE_HEIGHT / 2) * camera.zoom;
  const dx = screen.sx - camera.x;
  const dy = screen.sy - camera.y;
  const x = (dx / halfW + dy / halfH) / 2;
  const y = (dy / halfH - dx / halfW) / 2;
  return { x, y };
}

/**
 * Depth-sort key for isometric occlusion. Larger keys draw on top.
 *
 * Sort by (worldY + worldX + z * smallEpsilon) so two sprites at the same
 * floor location resolve consistently when one is stacked above the other.
 * worldX is included so that two sprites at the same y but different x get
 * a deterministic order — the one further from the back corner draws on top.
 */
export function depthKey(world: WorldPoint): number {
  const z = world.z ?? 0;
  // 1e-4 keeps the z bias smaller than meaningful x/y differences but still
  // enough to break ties for stacked sprites at the same floor cell.
  return world.y + world.x * 1e-3 + z * 1e-4;
}

/**
 * Build the four screen-space corners of the floor tile at (x, y).
 * Helpful for hit-testing or rendering tile outlines / hover halos.
 *
 *   north (back)
 *   west (left)  east (right)
 *   south (front)
 */
export function tileCorners(
  world: WorldPoint,
  camera: Camera = IDENTITY_CAMERA,
): {
  readonly north: ScreenPoint;
  readonly east: ScreenPoint;
  readonly south: ScreenPoint;
  readonly west: ScreenPoint;
} {
  const halfW = (TILE_WIDTH / 2) * camera.zoom;
  const halfH = (TILE_HEIGHT / 2) * camera.zoom;
  const center = worldToScreen({ ...world, z: world.z ?? 0 }, camera);
  return {
    north: { sx: center.sx, sy: center.sy - halfH },
    east: { sx: center.sx + halfW, sy: center.sy },
    south: { sx: center.sx, sy: center.sy + halfH },
    west: { sx: center.sx - halfW, sy: center.sy },
  };
}

/**
 * Point-in-tile hit test using diamond geometry. Returns true if `screen`
 * lies inside the rhombus of the tile at world (x, y) given the camera.
 *
 * The diamond is defined by |Δsx / halfW| + |Δsy / halfH| ≤ 1 around
 * the tile center, which is exactly how isometric tiles tile (pun intended)
 * the plane without overlap.
 */
export function isPointInTile(
  screen: ScreenPoint,
  world: WorldPoint,
  camera: Camera = IDENTITY_CAMERA,
): boolean {
  const center = worldToScreen(world, camera);
  const halfW = (TILE_WIDTH / 2) * camera.zoom;
  const halfH = (TILE_HEIGHT / 2) * camera.zoom;
  const dx = Math.abs(screen.sx - center.sx) / halfW;
  const dy = Math.abs(screen.sy - center.sy) / halfH;
  return dx + dy <= 1;
}
