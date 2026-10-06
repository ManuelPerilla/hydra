import { describe, expect, it } from "vitest";
import { locales, messages, plural } from "../src/i18n/messages";
describe("locale completeness", () => {
  it("ships the same messages in every language, including RTL Arabic", () => {
    for (const locale of locales) expect(Object.keys(messages[locale]).sort()).toEqual(Object.keys(messages.es).sort());
  });
  it("uses the locale's number and plural formats", () => {
    expect(plural("en", 1, "event", "events")).toBe("1 event");
    expect(plural("es", 2, "evento", "eventos")).toBe("2 eventos");
    expect(plural("ar", 3, "حدث", "أحداث")).toContain(new Intl.NumberFormat("ar").format(3));
  });
});
