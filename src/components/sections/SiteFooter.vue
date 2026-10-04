<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import SiteHealthWidget from "@/components/SiteHealthWidget.vue";

const ACCESS_KEY = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY ?? "";

interface SocialLink {
	label: string;
	icon: string;
	href: string;
	brand: string;
}

const socials: SocialLink[] = [
	{
		label: "LinkedIn",
		icon: "fa-brands fa-linkedin-in",
		href: "https://www.linkedin.com/in/denis-liamkin-a81441b9/",
		brand: "#0a66c2",
	},
	{
		label: "GitHub",
		icon: "fa-brands fa-github",
		href: "https://github.com/dliamkin",
		brand: "#e5e7eb",
	},
	{
		label: "Stack Overflow",
		icon: "fa-brands fa-stack-overflow",
		href: "https://stackoverflow.com/users/3792634",
		brand: "#f48024",
	},
	{
		label: "Email",
		icon: "fa-solid fa-envelope",
		href: "mailto:dliamkin@gmail.com",
		brand: "#5cb85c",
	},
];

type FormField = "name" | "email" | "phone" | "message";
type Status = "idle" | "sending" | "success" | "error";

const form = reactive({
	name: "",
	email: "",
	phone: "",
	message: "",
	botcheck: "",
});

const errors = reactive<Record<FormField, string>>({
	name: "",
	email: "",
	phone: "",
	message: "",
});

const touched = reactive<Record<FormField, boolean>>({
	name: false,
	email: false,
	phone: false,
	message: false,
});

const status = ref<Status>("idle");
const serverMessage = ref("");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[+]?[\d\s().-]{7,20}$/;

function validateField(field: FormField): string {
	switch (field) {
		case "name": {
			const value = form.name.trim();
			if (!value) return "Please enter your name.";
			if (value.length < 2) return "That name looks a little short.";
			return "";
		}
		case "email": {
			const value = form.email.trim();
			if (!value) return "Please enter your email.";
			if (!emailPattern.test(value)) return "Please enter a valid email address.";
			return "";
		}
		case "phone": {
			const value = form.phone.trim();
			if (!value) return "";
			if (!phonePattern.test(value)) return "Please enter a valid phone number.";
			return "";
		}
		case "message": {
			const value = form.message.trim();
			if (!value) return "Please enter a message.";
			if (value.length < 10) return "A little more detail, please (10+ characters).";
			return "";
		}
	}
}

function runValidation(field: FormField) {
	errors[field] = validateField(field);
}

function onBlur(field: FormField) {
	touched[field] = true;
	runValidation(field);
}

function onInput(field: FormField) {
	if (touched[field]) runValidation(field);
}

const isValid = computed(() =>
	(["name", "email", "phone", "message"] as FormField[]).every(
		(field) => validateField(field) === "",
	),
);

function resetForm() {
	form.name = "";
	form.email = "";
	form.phone = "";
	form.message = "";
	(["name", "email", "phone", "message"] as FormField[]).forEach((field) => {
		errors[field] = "";
		touched[field] = false;
	});
}

async function onSubmit() {
	if (form.botcheck) return;
	(["name", "email", "phone", "message"] as FormField[]).forEach((field) => {
		touched[field] = true;
		runValidation(field);
	});
	if (!isValid.value) {
		document.querySelector<HTMLElement>(".field-input.invalid")?.focus();
		return;
	}

	if (!ACCESS_KEY) {
		status.value = "error";
		serverMessage.value =
			"The contact form isn't configured yet (missing Web3Forms key). Please email me directly at dliamkin@gmail.com.";
		return;
	}

	status.value = "sending";
	serverMessage.value = "";

	try {
		const response = await fetch("https://api.web3forms.com/submit", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				access_key: ACCESS_KEY,
				subject: `New dliamkin.com portfolio message from ${form.name.trim()}`,
				from_name: "dliamkin.com Contact Form Submission",
				name: form.name.trim(),
				email: form.email.trim(),
				phone: form.phone.trim() || "Not provided",
				message: form.message.trim(),
			}),
		});
		const data = await response.json();

		if (data.success) {
			status.value = "success";
			resetForm();
		} else {
			status.value = "error";
			serverMessage.value =
				data.message ?? "Something went wrong sending your message. Please try again.";
		}
	} catch {
		status.value = "error";
		serverMessage.value =
			"Couldn't reach the mail service. Check your connection and try again, or email me directly.";
	}
}
</script>

<template>
	<footer id="contact" class="site-footer">
		<div class="footer-inner">
			<div class="footer-intro">
				<p class="eyebrow">// Get In Touch</p>
				<h2>Let's build something great.</h2>
				<p class="intro-lede">
					Have a role, a project, or just a question about my work? Drop me a line and
					I'll get back to you.
				</p>

				<ul class="contact-details">
					<li>
						<span class="detail-icon"><i class="fa-solid fa-envelope"></i></span>
						<a href="mailto:dliamkin@gmail.com">dliamkin@gmail.com</a>
					</li>
					<li>
						<span class="detail-icon"><i class="fa-solid fa-phone"></i></span>
						<a href="tel:+13219613687">(321) 961-3687</a>
					</li>
					<li>
						<span class="detail-icon"><i class="fa-solid fa-location-dot"></i></span>
						<span>Melbourne, FL</span>
					</li>
				</ul>

				<div class="socials">
					<a
						v-for="social in socials"
						:key="social.label"
						:href="social.href"
						class="social-icon"
						:style="{ '--brand': social.brand }"
						:aria-label="social.label"
						target="_blank"
						rel="noopener noreferrer"
					>
						<i :class="social.icon"></i>
					</a>
				</div>
			</div>

			<div class="footer-form">
				<Transition name="swap" mode="out-in">
					<div v-if="status === 'success'" key="success" class="success-panel">
						<div class="success-check"><i class="fa-solid fa-check"></i></div>
						<h3>Message sent!</h3>
						<p>Thanks for reaching out - I'll get back to you soon.</p>
						<button type="button" class="ghost-btn" @click="status = 'idle'">
							Send another
						</button>
					</div>

					<form
						v-else
						key="form"
						class="contact-form"
						novalidate
						@submit.prevent="onSubmit"
					>
						<input
							v-model="form.botcheck"
							type="text"
							class="honeypot"
							tabindex="-1"
							autocomplete="off"
							aria-hidden="true"
						/>

						<div class="field">
							<label for="cf-name">Name <span class="req">*</span></label>
							<input
								id="cf-name"
								v-model="form.name"
								type="text"
								class="field-input"
								:class="{ invalid: touched.name && errors.name }"
								placeholder="Jane Doe"
								autocomplete="name"
								:aria-invalid="touched.name && !!errors.name"
								aria-describedby="cf-name-err"
								@blur="onBlur('name')"
								@input="onInput('name')"
							/>
							<span id="cf-name-err" class="field-error" role="alert">
								{{ touched.name ? errors.name : "" }}
							</span>
						</div>

						<div class="field-row">
							<div class="field">
								<label for="cf-email">Email <span class="req">*</span></label>
								<input
									id="cf-email"
									v-model="form.email"
									type="email"
									class="field-input"
									:class="{ invalid: touched.email && errors.email }"
									placeholder="jane@company.com"
									autocomplete="email"
									:aria-invalid="touched.email && !!errors.email"
									aria-describedby="cf-email-err"
									@blur="onBlur('email')"
									@input="onInput('email')"
								/>
								<span id="cf-email-err" class="field-error" role="alert">
									{{ touched.email ? errors.email : "" }}
								</span>
							</div>

							<div class="field">
								<label for="cf-phone"
									>Phone <span class="opt">(optional)</span></label
								>
								<input
									id="cf-phone"
									v-model="form.phone"
									type="tel"
									class="field-input"
									:class="{ invalid: touched.phone && errors.phone }"
									placeholder="(555) 555-5555"
									autocomplete="tel"
									:aria-invalid="touched.phone && !!errors.phone"
									aria-describedby="cf-phone-err"
									@blur="onBlur('phone')"
									@input="onInput('phone')"
								/>
								<span id="cf-phone-err" class="field-error" role="alert">
									{{ touched.phone ? errors.phone : "" }}
								</span>
							</div>
						</div>

						<div class="field">
							<label for="cf-message">Message <span class="req">*</span></label>
							<textarea
								id="cf-message"
								v-model="form.message"
								rows="5"
								class="field-input"
								:class="{ invalid: touched.message && errors.message }"
								placeholder="Tell me about the role or project…"
								:aria-invalid="touched.message && !!errors.message"
								aria-describedby="cf-message-err"
								@blur="onBlur('message')"
								@input="onInput('message')"
							></textarea>
							<span id="cf-message-err" class="field-error" role="alert">
								{{ touched.message ? errors.message : "" }}
							</span>
						</div>

						<p v-if="status === 'error'" class="form-status error" role="alert">
							<i class="fa-solid fa-circle-exclamation"></i> {{ serverMessage }}
						</p>

						<button type="submit" class="submit-btn" :disabled="status === 'sending'">
							<span
								v-if="status === 'sending'"
								class="spinner"
								aria-hidden="true"
							></span>
							<span>{{ status === "sending" ? "Sending…" : "Send Message" }}</span>
						</button>
					</form>
				</Transition>
			</div>
		</div>

		<div class="footer-bottom">
			<p class="copyright">Denis Liamkin &copy; {{ new Date().getFullYear() }}</p>
			<SiteHealthWidget />
		</div>
	</footer>
</template>

<style scoped>
.site-footer {
	position: relative;
	background: #2b2f36;
	background-image:
		radial-gradient(circle at 12% 15%, rgba(39, 169, 224, 0.14), transparent 40%),
		radial-gradient(circle at 88% 85%, rgba(92, 184, 92, 0.12), transparent 42%);
	color: #eef1f4;
	padding: 5rem 2rem 2rem;
}

.footer-inner {
	max-width: 1150px;
	margin: 0 auto;
	display: grid;
	grid-template-columns: 1fr 1.1fr;
	gap: 4rem;
	align-items: start;
}

/* ---- Left intro ---- */
.eyebrow {
	font-family: "JetBrains Mono", monospace;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-size: 0.85rem;
	font-weight: 500;
	color: #66c6ef;
	margin: 0 0 1rem;
}

.footer-intro h2 {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(1.9rem, 3.5vw, 2.75rem);
	color: #fff;
	margin: 0 0 1rem;
}

.intro-lede {
	font-family: "Raleway", sans-serif;
	font-size: 1.05rem;
	line-height: 1.65;
	color: #aab1ba;
	margin: 0 0 2rem;
	max-width: 34ch;
}

.contact-details {
	list-style: none;
	margin: 0 0 2rem;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.contact-details li {
	display: flex;
	align-items: center;
	gap: 0.9rem;
	font-family: "Raleway", sans-serif;
	font-size: 1rem;
}

.detail-icon {
	width: 2.4rem;
	height: 2.4rem;
	border-radius: 10px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.09);
	color: #66c6ef;
	flex-shrink: 0;
}

.contact-details a {
	color: #eef1f4;
	text-decoration: none;
	transition: color 0.25s ease;
}

.contact-details a:hover {
	color: #66c6ef;
}

.socials {
	display: flex;
	gap: 0.75rem;
}

.social-icon {
	width: 2.8rem;
	height: 2.8rem;
	border-radius: 50%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 1.15rem;
	color: #cdd3da;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.09);
	text-decoration: none;
	transition:
		transform 0.25s ease,
		background 0.25s ease,
		color 0.25s ease,
		border-color 0.25s ease;
}

.social-icon:hover {
	transform: translateY(-4px);
	background: var(--brand);
	border-color: var(--brand);
	color: #1a1d23;
}

/* ---- Form ---- */
.footer-form {
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.09);
	border-radius: 16px;
	padding: 2rem;
	backdrop-filter: blur(4px);
}

.honeypot {
	position: absolute;
	left: -9999px;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.field {
	flex: 1;
	margin-bottom: 1.1rem;
	display: flex;
	flex-direction: column;
}

.field-row {
	display: flex;
	gap: 1rem;
}

label {
	font-family: "Raleway", sans-serif;
	font-size: 0.85rem;
	font-weight: 700;
	color: #cdd3da;
	margin-bottom: 0.45rem;
}

.req {
	color: #ff6b6b;
}

.opt {
	color: #8a8b8f;
	font-weight: 400;
}

.field-input {
	width: 100%;
	padding: 0.75rem 0.9rem;
	background: rgba(0, 0, 0, 0.25);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 8px;
	color: #fff;
	font-family: "Raleway", sans-serif;
	font-size: 0.95rem;
	transition:
		border-color 0.25s ease,
		box-shadow 0.25s ease;
}

.field-input::placeholder {
	color: rgba(255, 255, 255, 0.35);
}

.field-input:focus {
	outline: none;
	border-color: #27a9e0;
	box-shadow: 0 0 0 3px rgba(39, 169, 224, 0.18);
}

textarea.field-input {
	resize: vertical;
	min-height: 120px;
}

.field-input.invalid {
	border-color: #ff6b6b;
}

.field-input.invalid:focus {
	box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.18);
}

.field-error {
	font-family: "Raleway", sans-serif;
	font-size: 0.78rem;
	color: #ff8f8f;
	min-height: 1rem;
	margin-top: 0.3rem;
}

.form-status {
	font-family: "Raleway", sans-serif;
	font-size: 0.85rem;
	margin: 0 0 1rem;
}

.form-status.error {
	color: #ff8f8f;
}

.submit-btn {
	width: 100%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.6rem;
	/* AA-contrast green (5.5:1 with white) - keep in sync with .nav-cta and .contact-me-btn. */
	background: #337733;
	color: #fff;
	border: none;
	padding: 0.9rem 1.5rem;
	border-radius: 8px;
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1.05rem;
	cursor: pointer;
	transition:
		background 0.25s ease,
		transform 0.15s ease;
}

.submit-btn:hover:not(:disabled) {
	background: #275f27;
}

.submit-btn:active:not(:disabled) {
	transform: translateY(1px);
}

.submit-btn:disabled {
	opacity: 0.7;
	cursor: not-allowed;
}

.spinner {
	width: 1.05rem;
	height: 1.05rem;
	border: 2px solid rgba(255, 255, 255, 0.4);
	border-top-color: #fff;
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

/* ---- Success ---- */
.success-panel {
	text-align: center;
	padding: 2rem 1rem;
}

.success-check {
	width: 4rem;
	height: 4rem;
	margin: 0 auto 1.25rem;
	border-radius: 50%;
	background: rgba(92, 184, 92, 0.15);
	border: 2px solid #5cb85c;
	color: #5cb85c;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.6rem;
	animation: pop 0.4s cubic-bezier(0.22, 1.2, 0.4, 1);
}

@keyframes pop {
	from {
		transform: scale(0.4);
		opacity: 0;
	}
	to {
		transform: scale(1);
		opacity: 1;
	}
}

.success-panel h3 {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: 1.6rem;
	color: #fff;
	margin: 0 0 0.5rem;
}

.success-panel p {
	font-family: "Raleway", sans-serif;
	color: #aab1ba;
	margin: 0 0 1.5rem;
}

.ghost-btn {
	background: transparent;
	border: 1px solid rgba(255, 255, 255, 0.25);
	color: #eef1f4;
	padding: 0.6rem 1.4rem;
	border-radius: 8px;
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	cursor: pointer;
	transition:
		border-color 0.25s ease,
		color 0.25s ease;
}

.ghost-btn:hover {
	border-color: #66c6ef;
	color: #66c6ef;
}

.swap-enter-active,
.swap-leave-active {
	transition:
		opacity 0.3s ease,
		transform 0.3s ease;
}

.swap-enter-from {
	opacity: 0;
	transform: translateY(10px);
}

.swap-leave-to {
	opacity: 0;
	transform: translateY(-10px);
}

/* ---- Bottom bar ---- */
.footer-bottom {
	max-width: 1150px;
	margin: 3.5rem auto 0;
	padding-top: 1.5rem;
	border-top: 1px solid rgba(255, 255, 255, 0.09);
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.copyright,
.built-with {
	font-family: "Raleway", sans-serif;
	font-size: 0.9rem;
	color: #8a8b8f;
	margin: 0;
}

.built-with i {
	color: #42b883;
	margin-right: 0.35rem;
}

@media (max-width: 860px) {
	.footer-inner {
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}
}

@media (max-width: 520px) {
	.field-row {
		flex-direction: column;
		gap: 0;
	}

	.footer-bottom {
		justify-content: center;
		text-align: center;
	}
}

@media (max-width: 600px) {
	.site-footer {
		padding: 5rem 1rem 2rem;
	}

	.footer-form {
		background: none;
		border: none;
		border-radius: 0;
		backdrop-filter: none;
		padding: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.spinner {
		animation-duration: 1.6s;
	}

	.success-check {
		animation: none;
	}

	.swap-enter-active,
	.swap-leave-active {
		transition: opacity 0.2s ease;
	}

	.swap-enter-from,
	.swap-leave-to {
		transform: none;
	}
}
</style>
