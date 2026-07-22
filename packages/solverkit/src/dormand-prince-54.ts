import {
  EmbeddedRKStepper,
  type DenseOutputCoefficients,
  type EmbeddedButcherTableau,
} from "./embedded-rk-kernel.js";
import type { Stepper, StepperInfo } from "./types.js";

/**
 * Dormand-Prince RK5(4)7M (§4.5): the platform's reference production
 * solver, 7 stages, FSAL (P2.24). `b` (order 5) advances the accepted
 * solution; `bHat` (order 4) is the embedded estimate used for error
 * control (P2.26/27). `b` is *exactly* `a`'s 7th row (all zero-indexed:
 * `a[6]`) with a trailing 0 -- the defining FSAL property, since $c_7=1$
 * makes stage 7 evaluate $f$ at exactly $(t+h, \mathbf y_{k+1})$, the same
 * point stage 0 of the *next* step would evaluate at.
 *
 * See the [derivation](./dormand-prince-54.derivation.md) for the embedded-pair error
 * estimate, the eq. 4.9-4.10 step-size controller, and the dense-output interpolant (§4.9).
 */
export const DOPRI5_TABLEAU: EmbeddedButcherTableau = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  bHat: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
  embeddedOrder: 4,
};

/** {@link DOPRI5_TABLEAU}'s stable metadata (§5.1), incl. `denseOrder=4` (P2.30's interpolant order). */
export const DOPRI5_INFO: StepperInfo = {
  id: "dopri5",
  order: 5,
  embeddedOrder: 4,
  fsal: true,
  denseOrder: 4,
  symplectic: false,
};

/**
 * The "free" 4th-order dense-output interpolant (§4.9) for DOPRI5's 7
 * stages -- Shampine's continuous extension of the Dormand-Prince pair,
 * the same coefficients used by the reference Fortran `dopri5.f` and
 * SciPy's `RK45` dense output. Row `s`'s four entries are $[p_{s,1},
 * p_{s,2}, p_{s,3}, p_{s,4}]$ per {@link DenseOutputCoefficients}: at
 * $\theta=1$ each row sums to `DOPRI5_TABLEAU.b[s]` (reproduces $\mathbf
 * y_{k+1}$ exactly) and the $\theta^1$ coefficients are $(1,0,0,0,0,0,0)$
 * (reproduces $\mathbf f(t_k,\mathbf y_k)$ exactly at $\theta=0$) --
 * verified to machine precision against exact rational arithmetic when
 * this table was transcribed, not just spot-checked numerically.
 */
export const DOPRI5_DENSE_OUTPUT_COEFFICIENTS: DenseOutputCoefficients = [
  [1, -8048581381 / 2820520608, 8663915743 / 2820520608, -12715105075 / 11282082432],
  [0, 0, 0, 0],
  [0, 131558114200 / 32700410799, -68118460800 / 10900136933, 87487479700 / 32700410799],
  [0, -1754552775 / 470086768, 14199869525 / 1410260304, -10690763975 / 1880347072],
  [0, 127303824393 / 49829197408, -318862633887 / 49829197408, 701980252875 / 199316789632],
  [0, -282668133 / 205662961, 2019193451 / 616988883, -1453857185 / 822651844],
  [0, 40617522 / 29380423, -110615467 / 29380423, 69997945 / 29380423],
];

/** Builds a fresh {@link EmbeddedRKStepper} wired with {@link DOPRI5_TABLEAU} (P2.24) and dense output (P2.30). */
export function createDormandPrince54Stepper(): Stepper {
  return new EmbeddedRKStepper(DOPRI5_INFO, DOPRI5_TABLEAU, DOPRI5_DENSE_OUTPUT_COEFFICIENTS);
}
