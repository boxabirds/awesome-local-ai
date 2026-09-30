// Vite's `?inline` imports (fixture files as data URLs), for the Workers-typed test config.
declare module '*?inline' {
  const dataUrl: string;
  export default dataUrl;
}
