/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Web3Forms access key - see .env.local. Safe to expose client-side. */
	readonly VITE_WEB3FORMS_ACCESS_KEY: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	/** Google Analytics stub defined inline in index.html. */
	gtag?: (...args: unknown[]) => void;
	dataLayer?: unknown[];
}
