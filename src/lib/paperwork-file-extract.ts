// Client-side text extraction for the Paperwork → Calendar demo. Files never
// leave the browser - .txt is read directly, PDFs are parsed locally with
// pdfjs-dist, and .docx with mammoth - so only the extracted text (which the
// visitor can review and redact first) is ever sent to the server.

// Below this, a "PDF" is almost certainly scanned page images with no text
// layer - this demo's OCR path is the photo tab, not the upload tab.
export const MIN_EXTRACTED_CHARS = 200;

export const MAX_PAPERWORK_FILE_BYTES = 10_000_000; // 10 MB - plenty for a document

export class PaperworkFileError extends Error {}

// Thrown specifically for scanned PDFs so the UI can point at the photo tab.
export class ScannedPdfError extends PaperworkFileError {}

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
		throw new PaperworkFileError(
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

async function extractDocxText(file: File): Promise<string> {
	// mammoth is also lazy-loaded - only visitors who actually upload a .docx
	// pay for the chunk. Vite resolves the package's `browser` field, so the
	// browser-safe unzip path is used automatically.
	const mammoth = await import("mammoth");
	let result;
	try {
		result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
	} catch {
		throw new PaperworkFileError(
			"Couldn't read that .docx file. It may be corrupted or an older .doc format.",
		);
	}
	return result.value.replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractPaperworkText(file: File): Promise<string> {
	if (file.size > MAX_PAPERWORK_FILE_BYTES) {
		throw new PaperworkFileError(
			"That file is too large. Please upload a file under 10 MB.",
		);
	}

	const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
	const isDocx =
		file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		/\.docx$/i.test(file.name);

	const text = isPdf
		? await extractPdfText(file)
		: isDocx
			? await extractDocxText(file)
			: (await file.text()).trim();

	if (isPdf && text.length < MIN_EXTRACTED_CHARS) {
		throw new ScannedPdfError(
			"That PDF appears to contain scanned images rather than selectable text. Try the “Photograph it” tab instead - the vision path reads photographed pages.",
		);
	}
	if (text.length === 0) {
		throw new PaperworkFileError("That file appears to be empty.");
	}
	return text;
}
