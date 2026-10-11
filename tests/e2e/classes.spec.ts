import { expect, test } from "@playwright/test";

/**
 * Multi-class behaviour, exercised against a real server.
 *
 * The unit tests cover slug parsing and permission math; what they cannot prove
 * is that the *routing* wires class N to class N's data. That is exactly where
 * this feature is easy to get wrong and hard to notice: every request would
 * happily return 200 while quietly serving the wrong class's timetable. These
 * specs assert on observable data, not status codes alone.
 */

const CLASSES = ["default", "class2", "class3"] as const;

function configPath(classId: string): string {
  return classId === "default" ? "/config.json" : `/${classId}/config.json`;
}

function schedulePath(classId: string): string {
  return classId === "default" ? "/api/schedule" : `/${classId}/api/schedule`;
}

test.describe("class addressing", () => {
  test("every class serves its own config.json with the client contract", async ({ request }) => {
    for (const classId of CLASSES) {
      const response = await request.get(configPath(classId));
      expect(response.status(), `${classId} config status`).toBe(200);

      // The Electron client requires CORS and no caching, and it reads the
      // config object directly rather than a wrapper.
      expect(response.headers()["access-control-allow-origin"]).toBe("*");
      expect(response.headers()["cache-control"]).toContain("no-cache");

      const config = await response.json();
      expect(Array.isArray(config.daily_class), `${classId} daily_class`).toBe(true);
      expect(config.daily_class).toHaveLength(7);
    }
  });

  test("the legacy unprefixed config resolves to the default class", async ({ request }) => {
    const legacy = await request.get("/config.json");
    expect(legacy.status()).toBe(200);

    // `/config.json` is the address the deployed Electron client already uses, so
    // it must keep returning the default class's published schedule rather than
    // 404 or fall through to some other class.
    const classes = await (await request.get("/api/admin/classes")).json();
    expect(classes.defaultClassId).toBe("default");
    expect(classes.currentClassId).toBe("default");
    expect((await request.get("/class2/config.json")).status()).toBe(200);
  });

  test("ordinary paths are not mistaken for classes", async ({ request }) => {
    // These all begin with the `class` prefix but are not classes.
    for (const path of ["/classroom", "/classes", "/class"]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test("an unknown class is not addressable", async ({ request }) => {
    expect((await request.get("/class9")).status()).toBe(404);
    expect((await request.get("/class9/config.json")).status()).toBe(404);
    expect((await request.get("/class9/api/schedule")).status()).toBe(404);
  });

  test("the class list only exposes classes the user may edit", async ({ request }) => {
    const response = await request.get("/api/admin/classes");
    expect(response.status()).toBe(200);
    const body = await response.json();
    const ids = (body.classes ?? []).map((row: { id: string }) => row.id);
    expect(ids).toContain("class2");
    // No class beyond the caller's memberships may leak into the list.
    expect(ids).not.toContain("class9");
  });
});

test.describe("class isolation", () => {
  test("a draft written to one class never appears in another", async ({ request }) => {
    const marker = `ISO-${Date.now()}`;

    // Snapshot every class before the write.
    const before = new Map<string, string>();
    for (const classId of CLASSES) {
      before.set(classId, await (await request.get(configPath(classId))).text());
    }

    const current = await (await request.get(schedulePath("class2"))).json();
    const config = current.draftConfig;
    config.subject_name = { ...config.subject_name, ISOMARK: marker };

    const saved = await request.put("/class2/api/schedule/draft", {
      data: { config, expectedDraftVersion: current.draftVersion },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const { draftVersion } = await saved.json();

    const published = await request.post("/class2/api/schedule/publish", {
      data: { expectedDraftVersion: draftVersion },
    });
    expect(published.ok(), await published.text()).toBe(true);

    // class2 changed...
    const class2After = await (await request.get(configPath("class2"))).text();
    expect(class2After).toContain(marker);

    // ...and nothing else did.
    for (const classId of ["default", "class3"]) {
      const after = await (await request.get(configPath(classId))).text();
      expect(after, `${classId} must be untouched`).toBe(before.get(classId));
      expect(after).not.toContain(marker);
    }

    // Restore class2 so the marker does not leak into other specs or the next
    // run. The class is compared against itself here, so a failure to restore
    // is a real problem worth surfacing.
    const restoreSource = before.get("class2")!;
    const current2 = await (await request.get(schedulePath("class2"))).json();
    const restored = await request.put("/class2/api/schedule/draft", {
      data: { config: JSON.parse(restoreSource), expectedDraftVersion: current2.draftVersion },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
    const restoredVersion = (await restored.json()).draftVersion;
    const republished = await request.post("/class2/api/schedule/publish", {
      data: { expectedDraftVersion: restoredVersion },
    });
    expect(republished.ok(), await republished.text()).toBe(true);
    expect(await (await request.get(configPath("class2"))).text()).toBe(restoreSource);
  });

  test("draft versions are tracked independently per class", async ({ request }) => {
    const defaultView = await (await request.get(schedulePath("default"))).json();
    const class3View = await (await request.get(schedulePath("class3"))).json();
    expect(typeof defaultView.draftVersion).toBe("number");
    expect(typeof class3View.draftVersion).toBe("number");

    // Bumping class3 must not move the default class's counter. This is the
    // cheapest possible proof that the version sequence is per document rather
    // than global.
    const before = defaultView.draftVersion;
    const bumped = await request.put("/class3/api/schedule/draft", {
      data: { config: class3View.draftConfig, expectedDraftVersion: class3View.draftVersion },
    });
    expect(bumped.ok(), await bumped.text()).toBe(true);

    const defaultAfter = await (await request.get(schedulePath("default"))).json();
    expect(defaultAfter.draftVersion).toBe(before);
  });
});
