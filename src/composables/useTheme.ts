import { ref } from "vue";

export type Theme = "dark" | "light";

const THEME_KEY = "theme";
const THEME_COLORS: Record<Theme, string> = { dark: "#121417", light: "#ffffff" };

// Dark is the site's default look. An inline script in index.html applies the
// .dark class before first paint (so there's no light flash); this composable
// only reflects and updates that state. "light" is an explicit visitor choice,
// remembered in localStorage.
const theme = ref<Theme>(
	typeof document !== "undefined" && !document.documentElement.classList.contains("dark")
		? "light"
		: "dark",
);

export function useTheme() {
	function setTheme(next: Theme) {
		theme.value = next;
		document.documentElement.classList.toggle("dark", next === "dark");
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", THEME_COLORS[next]);
		try {
			localStorage.setItem(THEME_KEY, next);
		} catch {
			// Storage unavailable (private browsing) - the choice just won't persist.
		}
	}

	function toggleTheme() {
		setTheme(theme.value === "dark" ? "light" : "dark");
	}

	return { theme, setTheme, toggleTheme };
}
