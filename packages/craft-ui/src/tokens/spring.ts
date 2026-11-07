/**
 * Spring Physics Engine for Luxury Micro-Interactions
 * Analytical solution to the damped harmonic oscillator:
 *   m * x'' + c * x' + k * x = 0
 */

export interface SpringConfig {
  stiffness?: number; // k (default: 400)
  damping?: number;   // c (default: 30)
  mass?: number;      // m (default: 1.0)
  precision?: number; // threshold to stop (default: 0.001)
}

export interface SpringState {
  position: number;
  velocity: number;
}

export class SpringSimulation {
  private stiffness: number;
  private damping: number;
  private mass: number;
  private precision: number;

  constructor(config: SpringConfig = {}) {
    this.stiffness = config.stiffness ?? 400;
    this.damping = config.damping ?? 30;
    this.mass = config.mass ?? 1.0;
    this.precision = config.precision ?? 0.001;
  }

  /**
   * Evaluates the next position and velocity after dt seconds.
   */
  public step(
    current: SpringState,
    target: number,
    dt: number
  ): SpringState {
    const displacement = current.position - target;
    const springForce = -this.stiffness * displacement;
    const dampingForce = -this.damping * current.velocity;
    const acceleration = (springForce + dampingForce) / this.mass;

    const newVelocity = current.velocity + acceleration * dt;
    const newPosition = current.position + newVelocity * dt;

    if (
      Math.abs(newPosition - target) < this.precision &&
      Math.abs(newVelocity) < this.precision
    ) {
      return { position: target, velocity: 0 };
    }

    return {
      position: newPosition,
      velocity: newVelocity,
    };
  }

  /**
   * Generates a CSS linear() timing function string equivalent to this spring.
   */
  public toCssLinear(durationMs = 600, points = 30): string {
    const dt = (durationMs / 1000) / points;
    let state: SpringState = { position: 0, velocity: 0 };
    const values: number[] = [];

    for (let i = 0; i <= points; i++) {
      values.push(Math.round(state.position * 1000) / 1000);
      state = this.step(state, 1, dt);
    }

    return `linear(${values.join(", ")})`;
  }
}

export const luxurySpring = new SpringSimulation({ stiffness: 420, damping: 28 });
export const snappySpring = new SpringSimulation({ stiffness: 600, damping: 35 });
export const gentleSpring = new SpringSimulation({ stiffness: 220, damping: 24 });
