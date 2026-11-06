import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "@/app/providers";
import { AppRouter } from "@/app/router";
import "@/styles/index.css";
import "@/operations/accessibility.css";

const BOOT_MINIMUM_MS = 900;
const BOOT_TIMEOUT_MS = 3_500;
const bootStartedAt = performance.now();

function setBootProgress(value: number) {
  const progress = document.getElementById("rg-boot-loader");
  progress?.style.setProperty("--rg-progress", String(Math.min(100, Math.max(0, value))));
}

function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    const done = () => resolve();
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
    image.src = src;
    if (image.complete) done();
  });
}

async function prepareInitialView() {
  if (window.location.pathname !== "/") {
    document.documentElement.classList.add("rg-app-ready");
    document.documentElement.classList.remove("rg-booting");
    document.getElementById("rg-boot-loader")?.remove();
    return;
  }

  let currentProgress = 8;
  setBootProgress(currentProgress);
  const progressTimer = window.setInterval(() => {
    const remaining = 88 - currentProgress;
    currentProgress += Math.max(1, remaining * 0.14);
    setBootProgress(currentProgress);
  }, 180);

  const assets = [
    window.innerWidth <= 960 ? "/images/field-hero-960.avif" : "/images/field-hero-1600.avif",
    "/images/mascot/field-companion-192.webp",
  ];

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  const pageReady = document.readyState === "complete"
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
  const essentials = Promise.all([fontsReady, pageReady, ...assets.map(preloadImage)]);
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, BOOT_TIMEOUT_MS));
  await Promise.race([essentials.then(() => undefined), timeout]);

  const remainingMinimum = Math.max(0, BOOT_MINIMUM_MS - (performance.now() - bootStartedAt));
  if (remainingMinimum) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMinimum));
  }

  window.clearInterval(progressTimer);
  setBootProgress(100);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 240));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  document.documentElement.classList.add("rg-app-ready");
  document.documentElement.classList.remove("rg-booting");
  const loader = document.getElementById("rg-boot-loader");
  loader?.classList.add("rg-boot-loader--leaving");
  window.setTimeout(() => loader?.remove(), 900);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </StrictMode>,
);

void prepareInitialView();
