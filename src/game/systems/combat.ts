import { Vector3 } from '../babylon';
import { PLAYER } from '../config';
import type { PigKnight } from '../entities/PigKnight';
import type { Wolf } from '../entities/Wolf';

export interface SwordContact {
  wolf: Wolf;
  point: Vector3;
  damage: number;
  poise: number;
  finisher: boolean;
  comboStep: number;
}

/**
 * Sword resolution.
 *
 * A swing is an arc, not a ray: the check is "inside reach and inside the
 * angular window", which lets one cleave catch two wolves standing close
 * together while still missing one that is beside ARNO but behind him. The
 * hit is polled every frame inside the active window and can only land once
 * per swing, so a wolf lunging *through* a held blade still gets cut.
 */
export function resolveSwing(player: PigKnight, wolves: readonly Wolf[]): SwordContact[] {
  const hit = player.currentHit();
  if (!hit) return [];

  const contacts: SwordContact[] = [];
  const halfArc = (hit.arcDeg * Math.PI) / 360;

  for (const wolf of wolves) {
    if (!wolf.alive) continue;
    const dx = wolf.position.x - player.position.x;
    const dz = wolf.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    // Blade length plus the wolf's own body radius: contact, not a centre hit.
    if (dist > hit.reach + wolf.radius) continue;
    const bearing = Math.atan2(dx, dz);
    let off = (bearing - hit.facing) % (Math.PI * 2);
    if (off > Math.PI) off -= Math.PI * 2;
    if (off < -Math.PI) off += Math.PI * 2;
    if (Math.abs(off) > halfArc) continue;

    contacts.push({
      wolf,
      point: wolf.chestWorld,
      damage: hit.damage,
      poise: hit.poise,
      finisher: hit.finisher,
      comboStep: hit.comboStep,
    });
  }

  // One contact per swing keeps hit-stop readable; the finisher still cuts
  // through to a second body because it is a wide horizontal sweep.
  if (contacts.length > 0 && !hit.finisher) contacts.length = 1;
  if (contacts.length > 0) player.markHitLanded();
  return contacts;
}

/**
 * A wolf's bite lands when its lunge window overlaps a short distance check.
 * Returns the damage ARNO actually took, or null when he rolled through it.
 */
export function resolveBite(wolf: Wolf, player: PigKnight): number | null {
  const bite = wolf.liveBite();
  if (!bite) return null;
  const dx = player.position.x - bite.from.x;
  const dz = player.position.z - bite.from.z;
  const dist = Math.hypot(dx, dz);
  if (dist > WOLF_BITE_RANGE + PLAYER.radius) return null;
  // The bite is committed either way, so a dodge that happens a frame early
  // still costs the wolf its window instead of leaving it dangling.
  wolf.markBiteResolved();
  if (player.invulnerable) return null;
  return bite.damage;
}

/** Distance at which a lunging muzzle can reach ARNO's body. */
export const WOLF_BITE_RANGE = 1.75;

/**
 * Where the blade actually meets the body — used to place sparks and the
 * damage number so they do not float at the wolf's feet.
 */
export function contactPoint(player: PigKnight, wolf: Wolf): Vector3 {
  const mid = Vector3.Lerp(player.chestWorld, wolf.headWorld, 0.62);
  mid.y = Math.max(mid.y, wolf.position.y + 0.45);
  return mid;
}
