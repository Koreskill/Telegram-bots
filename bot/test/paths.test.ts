import { describe, expect, it } from "vitest";
import path from "node:path";
import { createPaths, slugify, UnsafePathError } from "../src/paths.js";

const p = createPaths("/data");

describe("paths", () => {
  it("construye rutas esperadas", () => {
    expect(p.proyectoDir("Inmo Demo", "palermo-3amb")).toBe(path.join("/data/clientes/Inmo Demo/proyectos/palermo-3amb"));
    expect(p.subdir("c", "s", "extendidas")).toBe("/data/clientes/c/proyectos/s/04_extendidas");
    expect(p.file("c", "s", "originales", "img_001.jpg")).toBe("/data/clientes/c/proyectos/s/02_media/originales/img_001.jpg");
  });
  it.each(["..", "../x", "a/b", "a\\b", "/etc/passwd", ".oculto", "", " x", "a\0b", "x/../../y"])(
    "bloquea nombre peligroso %j",
    (bad) => {
      expect(() => p.clienteDir(bad)).toThrow(UnsafePathError);
      expect(() => p.proyectoDir("ok", bad)).toThrow(UnsafePathError);
    },
  );
  it("bloquea traversal en nombres de archivo", () => {
    expect(() => p.file("c", "s", "guion", "../../manifest.json")).toThrow(UnsafePathError);
  });
  it("acepta nombres reales con acentos y espacios", () => {
    expect(() => p.clienteDir("Inmobiliaria Peña")).not.toThrow();
  });
  it("slugify normaliza", () => {
    expect(slugify("Palermo – Depto 3 amb. ¡Con balcón!")).toBe("palermo-depto-3-amb-con-balcon");
    expect(slugify("¿¿??")).toBe("proyecto");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
