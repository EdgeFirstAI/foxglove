const foxglove = require("@foxglove/eslint-plugin");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["dist/**"],
  },
  ...foxglove.configs.base,
  ...foxglove.configs.react,
  ...foxglove.configs.typescript.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        project: "./tsconfig.json",
      },
    },
  })),
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
);
