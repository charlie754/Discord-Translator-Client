import { createGoogleProvider } from "./google";
import type { HttpTransport, TranslationProvider } from "./types";

export const registry = new Map<string, (http: HttpTransport) => TranslationProvider>([
    ["google", createGoogleProvider]
]);
