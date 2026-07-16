# GitHub Pages generator

The website is a framework-free static build. It reads Markdown from `../articles/` and writes plain HTML/CSS to `../dist/`.

```bash
npm ci
npm run check
npm run build
npm run smoke
```

For local URLs rooted at `/`:

```bash
npm run build:local
```

The production build defaults to the GitHub project path `/i/`. Set `BASE_PATH` to override it.
