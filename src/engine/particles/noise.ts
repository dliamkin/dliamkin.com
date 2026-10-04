/**
 * Cheap pseudo-noise flow field: three incommensurate sine waves summed into
 * an angle. Real gradient noise is overkill here - the eye only ever sees the
 * field integrated through particle motion, and this is a handful of
 * trig calls with zero allocation, which is what the frame budget cares about.
 */
export function flowAngle(x: number, y: number, t: number): number {
	// Wavelengths sit around 800–1800px so a desktop viewport holds several
	// flow cells - one wavelength across the whole screen reads as uniform
	// drift, not a storm.
	return (
		(Math.sin(x * 0.0052 + t * 0.00021) +
			Math.sin(y * 0.0067 - t * 0.00017) +
			Math.sin((x + y) * 0.0034 + t * 0.00011) * 0.7) *
		2.4
	);
}
