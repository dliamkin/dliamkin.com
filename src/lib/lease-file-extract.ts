// Client-side text extraction for the lease diff demo. Files never leave the
// browser - .txt is read directly and PDFs are parsed locally with
// pdfjs-dist, so only the extracted text (which the visitor can edit or
// redact first) is ever sent to the server.

// Below this, a "PDF" is almost certainly scanned page images with no text
// layer - this demo doesn't do OCR.
export const MIN_EXTRACTED_CHARS = 200;

export const MAX_LEASE_FILE_BYTES = 10_000_000; // 10 MB - plenty for a lease

export class LeaseFileError extends Error {}

async function extractPdfText(file: File): Promise<string> {
	// pdfjs-dist is heavy (~1 MB) - dynamic imports keep it out of the
	// initial bundle; Vite splits it into a chunk loaded only when a PDF is
	// actually chosen.
	const pdfjs = await import("pdfjs-dist");
	const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

	const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
	let doc;
	try {
		doc = await task.promise;
	} catch {
		void task.destroy();
		throw new LeaseFileError(
			"Couldn't read that PDF. It may be corrupted or password-protected.",
		);
	}

	try {
		const pages: string[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
		}
		// Normalize whitespace: PDF text comes out with arbitrary run breaks.
		return pages
			.map((page) => page.replace(/[^\S\n]+/g, " ").trim())
			.filter((page) => page.length > 0)
			.join("\n\n");
	} finally {
		void task.destroy();
	}
}

export async function extractLeaseText(file: File): Promise<string> {
	if (file.size > MAX_LEASE_FILE_BYTES) {
		throw new LeaseFileError("That file is too large. Please upload a file under 10 MB.");
	}

	const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
	const text = isPdf ? await extractPdfText(file) : (await file.text()).trim();

	if (isPdf && text.length < MIN_EXTRACTED_CHARS) {
		throw new LeaseFileError(
			"That PDF appears to contain scanned images rather than selectable text, and OCR isn't supported in this demo. Please paste the text instead.",
		);
	}
	if (text.length === 0) {
		throw new LeaseFileError("That file appears to be empty.");
	}
	return text;
}
