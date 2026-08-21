import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // P1-05 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
    // "archivos de diagnóstico incluidos en el alcance de ESLint" -- scripts
    // sueltos de depuración de sesiones anteriores (checks puntuales contra
    // la base con require() de Node, nunca pensados como parte de la app).
    // No se borran (podrían servir de referencia), pero no son código de
    // producción y no deben contar en la calidad estática del proyecto.
    "scratch/**",
    "test-*.js",
    "create-admin.js",
    "insert-role.js",
    "scratch-check.js",
  ]),
]);

export default eslintConfig;
