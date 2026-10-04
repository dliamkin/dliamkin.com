import { ALLOWED_UPLOAD_TYPES, MAX_CLIENT_IMAGE_BYTES, MAX_IMAGE_EDGE_PX } from "@/lib/ui-analysis";

export interface PreparedImage {
	base64: string;
	mediaType: "image/jpeg";
	previewUrl: string; // object URL - caller revokes when done
	bytes: number;
}

export class ImagePrepError extends Error {}

// Downscales so the longest edge is ≤ MAX_IMAGE_EDGE_PX and re-encodes as
// JPEG. Re-encoding through a canvas produces brand-new image bytes, which
// strips EXIF metadata (GPS, device info, etc.) as a side effect - nothing
// from the original file's metadata survives.
export async function prepareScreenshot(file: File): Promise<PreparedImage> {
	if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
		throw new ImagePrepError("Please upload a PNG, JPEG, or WebP image.");
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new ImagePrepError("That file doesn't look like a readable image.");
	}

	const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new ImagePrepError("Your browser couldn't process the image.");
	}
	// White backing so transparent PNG regions don't turn black in JPEG.
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/jpeg", 0.85),
	);
	if (!blob) {
		throw new ImagePrepError("Your browser couldn't re-encode the image.");
	}
	if (blob.size > MAX_CLIENT_IMAGE_BYTES) {
		throw new ImagePrepError(
			"Even after compression this image is too large. Please crop it to the UI area and try again.",
		);
	}

	const base64 = await blobToBase64(blob);
	return {
		base64,
		mediaType: "image/jpeg",
		previewUrl: URL.createObjectURL(blob),
		bytes: blob.size,
	};
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			// result is "data:image/jpeg;base64,...." - strip the prefix.
			const dataUrl = reader.result as string;
			resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
		};
		reader.onerror = () => reject(new Error("Failed to read image data"));
		reader.readAsDataURL(blob);
	});
}
