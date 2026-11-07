import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bannerDirectory = join(process.cwd(), "src", "plugins", "channelTranslator", "banner");

// ponytail: pins fail on a re-copy by design; update them from sha256sum of brand\goatcam-banner\online\client\*.js after re-copying all four
const expected = {
    "banner-core.js": "876fdf2bea928f725dece0e29c0da3ae417f30a166db27a8c6d19e1a0368ff80",
    "banner-machine.js": "bb456db1f0c07db1185f1f3fe3c313b841e54bd55753cdb2c9b5b02af60492d1",
    "banner-fetch.js": "7b4e004e61a6cf91bd54acde6973d69ec1750c36be771435b968fd49f77d6896",
    "banner-key.js": "cf2710c3724b3df1fca9eb646fbe09218437f299e02e449e8762acec4e0723f5"
} as const;

describe("GoatCam shared client copies", () => {
    it.each(Object.keys(expected))("pins %s to the upstream byte copy", file => {
        const digest = createHash("sha256").update(readFileSync(join(bannerDirectory, file))).digest("hex");
        expect(digest).toBe(expected[file as keyof typeof expected]);
    });
});
