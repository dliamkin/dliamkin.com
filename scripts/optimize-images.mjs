// Regenerates the optimized/responsive variants of the hero portfolio-wall
// images and the navbar logos in public/images. Rerun after adding or
// replacing any of the source files below:
//
//   node ./scripts/optimize-images.mjs
//
// Wall images: the wall column renders at 340–680 CSS px wide depending on
// viewport (see HeroBanner.vue), so each 500x320 source gets a 340x218
// sibling ("<name>-340.webp") for 1x-DPR viewports, and the 500w original is
// recompressed in place when that saves meaningful bytes. HeroBanner.vue's
// srcset and index.html's preloads reference both files - keep in sync.
//
// Logos: the PNG sources stay in git as the editable originals; this emits a
// lossless WebP twin for AppNavbar.vue. No downscaled variant - resizing
// smooths the flat colors and the 220w lossless file comes out LARGER than
// the full 326w one, so the full size serves every DPR.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = path.join(root, "public", "images");

const WALL_IMAGES = [
	"entomology.webp",
	"resetu.webp",
	"oakwood.webp",
	"ole.webp",
	"firsteyefilm.webp",
	"toolsoffitness.webp",
	"spicegalgourmet.webp",
	"plumbingeasy.webp",
	"aptsintally.webp",
	"grenninglab.webp",
];
const LOGOS = ["DenisLiamkinLogo.png", "DenisLiamkinLogoDarkMode.png"];

const WEBP_OPTS = { quality: 68, effort: 6 };
// Logos are flat-color line art with alpha - lossless WebP keeps the edges
// crisp and still beats the PNGs.
const LOGO_OPTS = { lossless: true, effort: 6 };

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

for (const name of WALL_IMAGES) {
	const src = path.join(imagesDir, name);
	const jpgMaster = src.replace(/\.webp$/, ".jpg");
	// Encode from the JPG master when it exists - one lossy generation
	// instead of two, so the same byte budget keeps more fidelity. (The .jpg
	// files in public/images are the originals the .webp files came from.)
	const source = await fs.readFile(jpgMaster).catch(() => fs.readFile(src));
	const current = await fs.readFile(src);

	const small = await sharp(source).resize(340, 218).webp(WEBP_OPTS).toBuffer();
	const smallPath = src.replace(/\.webp$/, "-340.webp");
	await fs.writeFile(smallPath, small);

	const recompressed = await sharp(source).resize(500, 320).webp(WEBP_OPTS).toBuffer();
	const keepCurrent = recompressed.length >= current.length;
	if (!keepCurrent) await fs.writeFile(src, recompressed);

	console.log(
		`${name}: 500w ${kb(current.length)} -> ${keepCurrent ? "kept" : kb(recompressed.length)}, 340w ${kb(small.length)}`,
	);
}

// Sample-picker card thumbnails for the Screenshot → PrimeVue demo: the
// cards render ~290 CSS px wide, so the 1280px PNG masters get 576w webp
// twins (2x DPR). The PNGs stay untouched - they're what actually loads
// into the demo preview (see src/data/screenshot-sample-images.ts).
for (const name of ["login", "dashboard", "pricing"]) {
	const src = path.join(root, "src", "assets", "demo-samples", `${name}.png`);
	const master = await fs.readFile(src);
	const thumb = await sharp(master).resize(576, 360).webp({ quality: 70, effort: 6 }).toBuffer();
	await fs.writeFile(src.replace(/\.png$/, "-thumb.webp"), thumb);
	console.log(`${name}.png: thumb 576w ${kb(thumb.length)}`);
}

// The ResponsiveShowcase mockup renders at up to 1099 CSS px on desktop but
// only ~350–600 px on phones - emit a 560w sibling for the srcset in
// ResponsiveShowcase.vue, and rebuild the full-size file from the PNG master.
{
	const master = await fs.readFile(path.join(imagesDir, "mock.png"));
	const full = await sharp(master).webp(WEBP_OPTS).toBuffer();
	const small = await sharp(master).resize(560, 145).webp(WEBP_OPTS).toBuffer();
	await fs.writeFile(path.join(imagesDir, "mock.webp"), full);
	await fs.writeFile(path.join(imagesDir, "mock-560.webp"), small);
	console.log(`mock.png: 1099w ${kb(full.length)}, 560w ${kb(small.length)}`);
}

for (const name of LOGOS) {
	const src = path.join(imagesDir, name);
	const original = await fs.readFile(src);

	const full = await sharp(original).webp(LOGO_OPTS).toBuffer();
	await fs.writeFile(src.replace(/\.png$/, ".webp"), full);

	console.log(`${name}: png ${kb(original.length)} -> webp ${kb(full.length)}`);
}

// Conference carousel photos (ConferencesSection.vue): the cards render
// 4:3 at ~370 CSS px wide on desktop, so every JPG master in the folder
// gets a 760x570 webp (2x DPR) plus a 380x285 sibling for 1x screens,
// cover-cropped to 4:3 so portrait/odd-ratio sources don't letterbox. The
// JPGs stay in git as the editable originals; the component only loads webp.
{
	const dir = path.join(imagesDir, "conferences");
	const jpgs = (await fs.readdir(dir)).filter((f) => /\.jpe?g$/i.test(f)).sort();
	for (const name of jpgs) {
		const master = await fs.readFile(path.join(dir, name));
		const base = name.replace(/\.jpe?g$/i, "");
		const large = await sharp(master)
			.rotate()
			.resize(760, 570, { fit: "cover" })
			.webp(WEBP_OPTS)
			.toBuffer();
		const small = await sharp(master)
			.rotate()
			.resize(380, 285, { fit: "cover" })
			.webp(WEBP_OPTS)
			.toBuffer();
		await fs.writeFile(path.join(dir, `${base}.webp`), large);
		await fs.writeFile(path.join(dir, `${base}-380.webp`), small);
		console.log(
			`conferences/${name}: jpg ${kb(master.length)} -> 760w ${kb(large.length)}, 380w ${kb(small.length)}`,
		);
	}
}
